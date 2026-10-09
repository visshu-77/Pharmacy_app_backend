import mongoose from "mongoose";

/**
 * A customer who buys on credit (udhar) from one shop.
 *
 * This is deliberately separate from `dashboard/suppliers` (money flows the
 * other way) and from the free-text `customerName` on an order: an udhar
 * customer is a standing record with a running balance.
 *
 * Every document belongs to exactly one shop owner through `userId`, and every
 * query in the controllers filters on it.
 */
const creditCustomerSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },

        customerName: {
            type: String,
            required: true,
            trim: true,
            maxlength: [80, "Customer name is too long"]
        },

        // Optional: a regular who is known by face may not give a number.
        // Same rule as the billing screen — blank, or exactly 10 digits.
        phone: {
            type: String,
            default: "",
            trim: true,
            validate: {
                validator: (value) => !value || /^\d{10}$/.test(value),
                message: "Mobile number should be 10 digits"
            }
        },

        address: {
            type: String,
            default: "",
            trim: true,
            maxlength: [250, "Address is too long"]
        },

        note: {
            type: String,
            default: "",
            trim: true,
            maxlength: [250, "Note is too long"]
        },

        // Kept instead of deleting, so the ledger history stays readable.
        isActive: {
            type: Boolean,
            default: true
        },

        /**
         * Bumped on every ledger write for this customer. NOT a balance —
         * what is owed is always summed from the transactions.
         *
         * It exists so two repayments arriving at once collide on one
         * document: inside a transaction that is a write conflict the driver
         * retries, and without transactions it is a compare-and-set the
         * loser repeats. Either way one payment is applied at a time, so a
         * balance cannot be overdrawn by a double tap.
         */
        ledgerVersion: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

// Name lookups and the default A–Z listing.
creditCustomerSchema.index({ userId: 1, customerName: 1 });

/**
 * One phone number can belong to only one customer in a shop — this is the
 * real duplicate guard. Partial, because a blank phone is allowed and several
 * customers may have none; the controller also checks first so the owner gets
 * a readable message instead of a driver error.
 */
creditCustomerSchema.index(
    { userId: 1, phone: 1 },
    {
        unique: true,
        partialFilterExpression: { phone: { $gt: "" } }
    }
);

const creditCustomerModel = mongoose.model(
    "dashboard/creditCustomers",
    creditCustomerSchema
);

export default creditCustomerModel;
