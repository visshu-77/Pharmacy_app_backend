import mongoose from "mongoose";

import {
    BUSINESS_TYPE_IDS,
    DEFAULT_BUSINESS_TYPE
} from "../config/businessTypes.js";

const userSchema = new mongoose.Schema(
    {
        Shopname: {
            type: String,
            required: true,
        },
        businessType: {
            type: String,
            enum: BUSINESS_TYPE_IDS,
            default: DEFAULT_BUSINESS_TYPE
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
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },
        isActive: {
            type: Boolean,
            default: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        // Set when the signup code sent to this address was confirmed.
        emailVerified: {
            type: Boolean,
            default: false
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
        // Optional: plenty of small shops are below the GST threshold.
        gstNumber: {
            type: String,
            default: ""
        },
        // Trade / drug / FSSAI licence. Only some business types need one —
        // see `licence` on the profile in config/businessTypes.js.
        licenseNumber: {
            type: String,
            default: ""
        },
        // Shown as a payable QR on the billing screen.
        upiId: {
            type: String,
            default: "",
            trim: true
        },
        googleId: {
            type: String,
            unique: true,
            sparse: true
        },

        authProvider: {
            type: String,
            enum: ["local", "google"],
            default: "local"
        },

        profileImage: {
            type: String,
            default: ""
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
            },

            // Stock at or below this count is flagged "Low Stock" across the
            // app. Seeded from the business type profile at registration
            // because a kirana store and an electronics showroom do not mean
            // the same thing by "running low".
            lowStockThreshold: {
                type: Number,
                default: 10
            },

            defaultTaxRate: {
                type: Number,
                default: 0
            }
        },
    },
    {
        timestamps: true
    }
)

const users = mongoose.model("dashboard/userData", userSchema)

export default users;