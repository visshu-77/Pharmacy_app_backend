import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        Shopname: {
            type: String,
            required: true,
        },
        ownerName: {
            type: String,
            required: true
        },
        mobileNumber: {
            type: Number,
            required: true,
            unique: true
        },
        email: {
            type: String,
            required: true,
            unique: true
        },
        Password: {
            type: String,
            required: true
        },
        shopAddress: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        state: {
            type: String,
            required: true
        },
        gstNumber: {
            type: String,
            required: true
        },
        licenseNumber: {
            type: String,
            required: true
        },
        notificationSettings: {
            emailNotifications: {
                type: Boolean,
                default: true
            },

            orderNotifications: {
                type: Boolean,
                default: true
            },

            lowStockAlerts: {
                type: Boolean,
                default: true
            },

            subscriptionExpiryAlerts: {
                type: Boolean,
                default: true
            },

            paymentNotifications: {
                type: Boolean,
                default: true
            },

            promotionalUpdates: {
                type: Boolean,
                default: false
            }
        },
        preferences: {
            language: {
                type: String,
                default: "English"
            },

            currency: {
                type: String,
                default: "INR"
            },

            timezone: {
                type: String,
                default: "Asia/Kolkata"
            },

            dateFormat: {
                type: String,
                default: "DD/MM/YYYY"
            },

            defaultPage: {
                type: String,
                default: "dashboard"
            },

            theme: {
                type: String,
                default: "light"
            }
        },
    }
)

const users = mongoose.model("dashboard/userData", userSchema)

export default users;