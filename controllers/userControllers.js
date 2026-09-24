import userModel from '../model/users.js';
import bcrypt from "bcrypt";
import subscriptionModel from "../model/subscription.js";
import { seedStarterCategories } from "../services/categorySeedService.js";

import jwt from "jsonwebtoken";

import {
    BUSINESS_TYPES,
    BUSINESS_TYPE_IDS,
    DEFAULT_BUSINESS_TYPE,
    getBusinessType
} from "../config/businessTypes.js";

/**
 * Public list of shop types, used by the registration screen and by Settings.
 * No auth needed — it is static configuration.
 */
export const listBusinessTypes = (req, res) => {
    return res.status(200).json({
        businessTypes: BUSINESS_TYPES.map((type) => ({
            id: type.id,
            label: type.label,
            itemLabel: type.itemLabel,
            itemLabelPlural: type.itemLabelPlural,
            tracksExpiry: type.tracksExpiry,
            tracksBatch: type.tracksBatch,
            licence: type.licence,
            units: type.units,
            defaultUnit: type.defaultUnit,
            lowStockThreshold: type.lowStockThreshold,
            defaultTaxRate: type.defaultTaxRate,
            defaultCategories: type.defaultCategories
        }))
    });
};

/**
 * Direct signup is closed: accounts are now created only after the email code
 * is verified (see controllers/signupOtpController.js). Kept as an explicit
 * error so an old cached frontend gets a clear message instead of silently
 * creating an unverified account.
 */
export const registeruser = async (req, res) => {
    return res.status(410).json({
        message: "Please refresh the page — signup now verifies your email with a code.",
        useEndpoints: ["/api/register/send-otp", "/api/register/verify-otp"]
    });
};

export const getProfile = async (req, res) => {
    try {

        const user = await userModel
            .findById(req.user.id)
            .select("-Password");

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        return res.status(200).json({
            message: "Profile fetched successfully",
            user
        });

    } catch (error) {

        console.log("Get profile error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const loginUser = async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!(email && password)) {
            return res.status(401).json({ message: "Fields are required" })
        }

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User Not found please enter correct credentials" })
        }

        if (!user.isActive) {
            return res.status(402).json({ message: "Your Account is deactivate. please contact to admin" });
        }

        const isMatch = await bcrypt.compare(
            password,
            user.Password
        )

        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid Password"
            });
        }

        const token = jwt.sign(
            {
                id: user._id,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET_KEY,
            {
                expiresIn: "1d"
            }
        )

        res.status(200).json({
            message: "Login Successfull",
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                Shopname: user.Shopname,
                businessType: user.businessType
            }
        });

    } catch (err) {
        res.status(501).json({ message: "server error" })
        console.log(err);
    }
};

export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        const {
            Shopname,
            ownerName,
            mobileNumber,
            email,
            shopAddress,
            city,
            state,
            gstNumber,
            licenseNumber,
            businessType,
            upiId
        } = req.body;

        const user = await userModel.findById(userId);

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Check email already used by another user
        if (email && email !== user.email) {
            const existingEmail = await userModel.findOne({
                email,
                _id: { $ne: userId }
            });

            if (existingEmail) {
                return res.status(400).json({
                    message: "Email already exists"
                });
            }
        }

        // Check mobile already used by another user
        if (
            mobileNumber &&
            Number(mobileNumber) !== user.mobileNumber
        ) {
            const existingMobile = await userModel.findOne({
                mobileNumber: Number(mobileNumber),
                _id: { $ne: userId }
            });

            if (existingMobile) {
                return res.status(400).json({
                    message: "Mobile number already exists"
                });
            }
        }

        // Switching business type only relabels the UI and changes which
        // fields are shown — existing products and orders are untouched.
        if (businessType && BUSINESS_TYPE_IDS.includes(businessType)) {
            const profile = getBusinessType(businessType);

            if (
                profile.licence?.required &&
                !(licenseNumber ?? user.licenseNumber)
            ) {
                return res.status(400).json({
                    message: `${profile.licence.label} is required for a ${profile.label}`
                });
            }

            user.businessType = businessType;
        }

        user.Shopname = Shopname ?? user.Shopname;
        user.ownerName = ownerName ?? user.ownerName;
        user.mobileNumber = mobileNumber ?? user.mobileNumber;
        user.email = email ?? user.email;
        user.shopAddress = shopAddress ?? user.shopAddress;
        user.city = city ?? user.city;
        user.state = state ?? user.state;
        user.gstNumber = gstNumber ?? user.gstNumber;
        user.licenseNumber = licenseNumber ?? user.licenseNumber;
        user.upiId = upiId ?? user.upiId;

        await user.save();

        return res.status(200).json({
            message: "Profile updated successfully",
            user: {
                id: user._id,
                Shopname: user.Shopname,
                businessType: user.businessType,
                ownerName: user.ownerName,
                mobileNumber: user.mobileNumber,
                email: user.email,
                shopAddress: user.shopAddress,
                city: user.city,
                state: user.state,
                gstNumber: user.gstNumber,
                licenseNumber: user.licenseNumber,
                upiId: user.upiId
            }
        });

    } catch (error) {
        console.log("Update profile error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const changePassword = async (req, res) => {
    try {
        const {
            currentPassword,
            newPassword,
            confirmPassword
        } = req.body;

        if (!(currentPassword || newPassword || confirmPassword)) {
            return res.status(400).json({
                message: "All Password fields are required"
            })
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                message: "Password and confirm password doesn't match"
            })
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                message: "Password should be 8 character long"
            })
        }

        const user = await userModel.findById(req.user.id);

        if (!user) {
            return res.status(400).json({
                message: "User not found"
            })
        }

        const isPasswordCorrect = await bcrypt.compare(
            currentPassword,
            user.Password
        );

        if (!isPasswordCorrect) {
            return res.status(400).json({
                message: "Current Password is incorrect"
            })
        }

        const isSamePassword = await bcrypt.compare(
            newPassword,
            user.Password
        )

        if (isSamePassword) {
            return res.status(400).json({
                message: "New Password should be different form current password"
            })
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        user.Password = hashedPassword;
        await user.save();

        return res.status(200).json({
            message: "Password Changes Successfully"
        })

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Server Error"
        })
    }
};

export const updateNotifcationSettings = async (req, res) => {
    try {
        const {
            emailNotifications,
            orderNotifications,
            lowStockAlerts,
            subscriptionExpiryAlerts,
            paymentNotifications,
            promotionalUpdates
        } = req.body;

        const user = await userModel.findById(req.user.id);

        if (!user) {
            return res.status(400).json({
                message: "User Not found"
            })
        }

        user.notificationSettings = {
            emailNotifications: Boolean(emailNotifications),
            orderNotifications: Boolean(orderNotifications),
            lowStockAlerts: Boolean(lowStockAlerts),
            subscriptionExpiryAlerts: Boolean(subscriptionExpiryAlerts),
            paymentNotifications: Boolean(paymentNotifications),
            promotionalUpdates: Boolean(promotionalUpdates)
        }

        await user.save();

        return res.status(200).json({
            message: "Notification Setting changed successfully",
            notificationSettings: user.notificationSettings
        })


    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Server Error"
        })
    }
};

export const getNotificationSettings = async (req, res) => {
    try {
        const user = await userModel.findById(req.user.id).select("notificationSettings");
        if (!user) {
            return res.status(404).json({
                message: "user not found"
            })
        }

        return res.status(200).json({
            notificationSettings: user.notificationSettings
        })
    } catch (err) {
        console.log(err)
        return res.status(500).json({
            message: "Server Error"
        })
    }
};

export const getPreference = async (req, res) => {
    try {
        const user = await userModel.findById(req.user.id).select("preferences");
        if (!user) {
            return res.status(400).json({
                message: "user not found"
            })
        }

        return res.status(200).json({
            preferences: user.preferences
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Server Error"
        })
    }
};

export const updatePreference = async (req, res) => {
    try {
        const user = await userModel.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            })
        }

        const allowed = [
            "language",
            "currency",
            "timezone",
            "dateFormat",
            "defaultPage",
            "theme",
            "lowStockThreshold",
            "defaultTaxRate"
        ];

        // Merge rather than replace: the settings screen posts one section at
        // a time, and a partial payload used to wipe every other preference.
        for (const key of allowed) {
            if (req.body[key] === undefined) continue;

            user.preferences[key] =
                key === "lowStockThreshold" || key === "defaultTaxRate"
                    ? Number(req.body[key]) || 0
                    : req.body[key];
        }

        await user.save();
        return res.status(200).json({
            message: "Preferences update successfully",
            preferences: user.preferences
        })

    } catch (err) {
        console.log(err)
        return res.status(500).json({
            message: "Server Error"
        })
    }
};

export const getBillingDetails = async (req, res) => {
    try {
        const userId = req.user.id;

        const subscriptions = await subscriptionModel
            .find({
                userId,
                paymentStatus: "paid"
            })
            .sort({
                createdAt: -1
            });

        if (!subscriptions.length) {
            return res.status(200).json({
                currentSubscription: null,
                paymentHistory: []
            });
        }

        const now = new Date();

        const currentSubscription = subscriptions.find(
            (subscription) =>
                subscription.subscriptionStatus === "active" &&
                new Date(subscription.startDate) <= now &&
                new Date(subscription.endDate) > now
        );

        return res.status(200).json({
            currentSubscription: currentSubscription || null,
            paymentHistory: subscriptions
        });

    } catch (err) {
        console.log(err);

        return res.status(500).json({
            message: "Server Error"
        });
    }
};