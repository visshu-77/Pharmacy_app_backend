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