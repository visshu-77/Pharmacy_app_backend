import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
    {
        invoiceNumber: {
            type: String,
            required: true,
            unique: true
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true
        },

        customerName: {
            type: String,
            default: ""
        },

        customerPhone: {
            type: String,
            default: ""
        },

        items: [
            {
                productId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "dashboard/products",
                    required: true
                },

                productName: {
                    type: String,
                    required: true
                },

                hsnCode: {
                    type: String,
                    default: ""
                },

                price: {
                    type: Number,
                    required: true
                },

                quantity: {
                    type: Number,
                    required: true
                },

                // Snapshot of how it was sold (kg, strip, metre…) so old
                // invoices still read correctly if the product changes.
                unit: {
                    type: String,
                    default: "piece"
                },

                total: {
                    type: Number,
                    required: true
                },

                taxableAmount: {
                    type: Number,
                    min: 0
                },

                amount: {
                    type: Number,
                    min: 0
                },

                taxRate: {
                    type: Number,
                    min: 0,
                    max: 100
                },

                cgst: {
                    type: Number,
                    min: 0
                },

                sgst: {
                    type: Number,
                    min: 0
                }
            }
        ],

        subtotal: {
            type: Number,
            required: true
        },

        discount: {
            type: Number,
            default: 0
        },

        tax: {
            type: Number,
            default: 0
        },

        cgst: {
            type: Number,
            default: null,
            min: 0
        },

        sgst: {
            type: Number,
            default: null,
            min: 0
        },

        grandTotal: {
            type: Number,
            required: true
        },

        paymentMethod: {
            type: String,
            // "Credit" = sold on udhar; the money is owed, not collected.
            enum: ["Cash", "Card", "UPI", "Bank", "Credit"],
            required: true
        },

        paymentStatus: {
            type: String,
            // A credit sale stays "Pending" for good: what has been repaid is
            // a fact about the customer's khata as a whole, not about one
            // bill, so no bill is ever flipped to "Paid" later. Reports count
            // only "Paid", which keeps udhar out of cash takings.
            enum: ["Pending", "Paid", "Cancelled"],
            default: "Paid"
        },

        // "billing": a full bill from the Billing screen.
        // "note":    a quick line jotted on the Sales Note page. Still a real
        //            sale — stock moves and reports count it — just without
        //            customer details or a printed invoice.
        // "credit":  goods taken on udhar. Stock moves; the money is tracked
        //            in the customer's ledger instead of the till.
        source: {
            type: String,
            enum: ["billing", "note", "credit"],
            default: "billing"
        },

        // Set only on a credit sale — the khata this bill was booked to.
        creditCustomerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/creditCustomers"
        },

        remark: {
            type: String,
            default: "",
            trim: true
        }
    },
    {
        timestamps: true
    }
);

const orderModel = mongoose.model(
    "dashboard/orders",
    orderSchema
);

export default orderModel;