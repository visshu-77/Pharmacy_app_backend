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

        grandTotal: {
            type: Number,
            required: true
        },

        paymentMethod: {
            type: String,
            enum: ["Cash", "Card", "UPI"],
            required: true
        },

        paymentStatus: {
            type: String,
            enum: ["Pending", "Paid"],
            default: "Paid"
        },

        // "billing": a full bill from the Billing screen.
        // "note":    a quick line jotted on the Sales Note page. Still a real
        //            sale — stock moves and reports count it — just without
        //            customer details or a printed invoice.
        source: {
            type: String,
            enum: ["billing", "note"],
            default: "billing"
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