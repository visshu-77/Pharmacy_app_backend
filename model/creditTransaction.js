import mongoose from "mongoose";

/** CREDIT_SALE adds to the balance, PAYMENT clears it, ADJUSTMENT corrects it. */
export const CREDIT_TRANSACTION_TYPES = ["CREDIT_SALE", "PAYMENT", "ADJUSTMENT"];

/** Mirrors the paymentMethod enum on dashboard/orders. */
export const CREDIT_PAYMENT_METHODS = ["Cash", "Card", "UPI"];

/** The two types whose direction can never be chosen by the caller. */
const FIXED_DIRECTION = {
    CREDIT_SALE: "increase",
    PAYMENT: "decrease"
};

const MAX_AMOUNT = 10000000;

/** Rupees: finite, above zero, and no finer than a paisa. */
const isMoney = (value) =>
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT &&
    Math.round(value * 100) / 100 === value;

const moneyField = (label) => ({
    type: Number,
    required: true,
    validate: {
        validator: isMoney,
        message: `${label} must be more than 0, at most ${MAX_AMOUNT}, and in rupees and paise`
    }
});

/** Same, but zero is allowed — a free item, or a bill with no discount. */
const amountField = (label, { required = true } = {}) => ({
    type: Number,
    required,
    default: required ? undefined : 0,
    validate: {
        validator: (value) =>
            value === undefined ||
            (Number.isFinite(value) &&
                value >= 0 &&
                value <= MAX_AMOUNT &&
                Math.round(value * 100) / 100 === value),
        message: `${label} must be 0 or more, at most ${MAX_AMOUNT}, and in rupees and paise`
    }
});

/**
 * What was sold, frozen at the moment of sale. Same field names as the items
 * on dashboard/orders so both read alike — an old entry stays correct even
 * after the product is renamed, repriced or deleted.
 */
const creditItemSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/products"
        },

        productName: {
            type: String,
            required: true,
            trim: true
        },

        price: amountField("Price"),

        quantity: {
            type: Number,
            required: true,
            min: [0, "Quantity cannot be negative"]
        },

        unit: {
            type: String,
            default: "piece"
        },

        total: amountField("Line total")
    },
    { _id: false }
);

/**
 * One line of a customer's udhar khata.
 *
 * The ledger is the only source of truth for what is owed: no balance is
 * stored on the customer, it is summed from these rows (see
 * services/creditService.js). Amounts are always positive — `direction`
 * carries the sign — so a stray minus can never quietly reverse a debt.
 */
const creditTransactionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },

        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/creditCustomers",
            required: true
        },

        type: {
            type: String,
            enum: CREDIT_TRANSACTION_TYPES,
            required: true
        },

        // Set from `type` for sales and payments; an ADJUSTMENT must say
        // which way it goes (a write-off down, a missed charge up).
        direction: {
            type: String,
            enum: ["increase", "decrease"],
            required: true
        },

        amount: moneyField("Amount"),

        // The day the money or goods actually moved. Separate from createdAt
        // because udhar is often written into the app a day or two late.
        date: {
            type: Date,
            required: true,
            default: Date.now
        },

        description: {
            type: String,
            default: "",
            trim: true,
            maxlength: [250, "Description is too long"]
        },

        // A correction has to say why.
        reason: {
            type: String,
            default: "",
            trim: true,
            maxlength: [250, "Reason is too long"],
            required: function () {
                return this.type === "ADJUSTMENT";
            }
        },

        paymentMethod: {
            type: String,
            enum: CREDIT_PAYMENT_METHODS,
            required: function () {
                return this.type === "PAYMENT";
            }
        },

        // "custom": an amount written straight into the khata.
        // "product": items were sold, so stock moved and an order exists.
        entryMode: {
            type: String,
            enum: ["custom", "product"],
            default: "custom"
        },

        items: {
            type: [creditItemSchema],
            default: []
        },

        // Bill-level discount and tax on an itemised credit sale, exactly as
        // the billing screen works them out. Kept here so `amount` can be
        // checked against the lines it came from.
        discount: amountField("Discount", { required: false }),

        tax: amountField("Tax", { required: false }),

        // The bill this entry came from, when it came from one (Phase 2).
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/orders"
        },

        // Receipt / bill number written on the paper slip, if any.
        referenceNumber: {
            type: String,
            default: "",
            trim: true,
            maxlength: [40, "Reference number is too long"]
        },

        // Set on a row that cancels an earlier one. The original is kept and
        // still counted; the two simply net to zero, so history stays whole.
        reversalOf: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/creditTransactions"
        },

        // Flag on the original, for the UI. The balance never reads it.
        isReversed: {
            type: Boolean,
            default: false
        },

        // Supplied by the client on a write so a double-tapped "Record
        // payment" cannot become two payments (unique per shop, below).
        idempotencyKey: {
            type: String,
            trim: true,
            maxlength: [64, "Idempotency key is too long"]
        },

        // Who wrote the line. Today that is always the shop owner; kept
        // explicit so staff logins later do not need a migration.
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        }
    },
    {
        timestamps: true
    }
);

creditTransactionSchema.pre("validate", function () {
    // The direction of a sale or a payment is not a choice.
    if (FIXED_DIRECTION[this.type]) {
        this.direction = FIXED_DIRECTION[this.type];
    }

    if (this.type !== "CREDIT_SALE" && this.items.length > 0) {
        this.invalidate("items", "Only a credit sale can carry items");
        return;
    }

    if (this.items.length > 0) {
        const itemsTotal = this.items.reduce((sum, item) => sum + Number(item.total || 0), 0);

        const expected =
            Math.round((itemsTotal - Number(this.discount || 0) + Number(this.tax || 0)) * 100) / 100;

        // A paisa of slack for rounding in the caller.
        if (Math.abs(expected - Number(this.amount || 0)) > 0.01) {
            this.invalidate(
                "amount",
                "Amount must equal the items sold, less discount, plus tax"
            );
        }
    }
});

/** The amount as it affects the balance: +charge, −payment. */
creditTransactionSchema.virtual("signedAmount").get(function () {
    return this.direction === "decrease" ? -this.amount : this.amount;
});

// One customer's statement, newest first.
creditTransactionSchema.index({ userId: 1, customerId: 1, date: -1 });

// Shop-wide day/range totals.
creditTransactionSchema.index({ userId: 1, date: -1 });

// The same submission can never be saved twice for one shop.
creditTransactionSchema.index(
    { userId: 1, idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } }
    }
);

// A transaction can be reversed once, never twice.
creditTransactionSchema.index(
    { reversalOf: 1 },
    {
        unique: true,
        partialFilterExpression: { reversalOf: { $type: "objectId" } }
    }
);

// Finding the ledger row that belongs to a bill (Phase 2).
creditTransactionSchema.index(
    { orderId: 1 },
    { partialFilterExpression: { orderId: { $type: "objectId" } } }
);

const creditTransactionModel = mongoose.model(
    "dashboard/creditTransactions",
    creditTransactionSchema
);

export default creditTransactionModel;
