import userModel from "../model/users.js";
import subscriptionModel from "../model/subscription.js";
import bcrypt from "bcrypt";
import { getBusinessType, BUSINESS_TYPE_IDS } from "../config/businessTypes.js";


// GET ALL CUSTOMERS
export const getAllCustomers = async (req, res) => {
    try {

        const {
            page = 1,
            limit = 10,
            search = "",
            status = "all",
            plan = "all",
            businessType = "all"
        } = req.query;

        const pageNumber = Math.max(
            parseInt(page) || 1,
            1
        );

        const limitNumber = Math.min(
            parseInt(limit) || 10,
            100
        );

        const skip =
            (pageNumber - 1) * limitNumber;

        /*
        |--------------------------------------------------------------------------
        | Customer Search
        |--------------------------------------------------------------------------
        */

        const searchQuery = {
            role: "user"
        };

        if (businessType && businessType !== "all") {
            searchQuery.businessType = businessType;
        }

        if (search.trim()) {

            searchQuery.$or = [
                {
                    ownerName: {
                        $regex: search.trim(),
                        $options: "i"
                    }
                },
                {
                    Shopname: {
                        $regex: search.trim(),
                        $options: "i"
                    }
                },
                {
                    email: {
                        $regex: search.trim(),
                        $options: "i"
                    }
                },
                {
                    city: {
                        $regex: search.trim(),
                        $options: "i"
                    }
                }
            ];
        }

        /*
        |--------------------------------------------------------------------------
        | Get Customers
        |--------------------------------------------------------------------------
        */

        const totalCustomers =
            await userModel.countDocuments(
                searchQuery
            );

        const customers =
            await userModel
                .find(searchQuery)
                .select("-Password")
                .sort({
                    createdAt: -1
                })
                .skip(skip)
                .limit(limitNumber)
                .lean();

        /*
        |--------------------------------------------------------------------------
        | Get Subscriptions
        |--------------------------------------------------------------------------
        */

        const customerIds =
            customers.map(
                customer => customer._id
            );

        const subscriptions =
            await subscriptionModel
                .find({
                    userId: {
                        $in: customerIds
                    },
                    paymentStatus: "paid"
                })
                .sort({
                    endDate: -1
                })
                .lean();

        const now = new Date();

        /*
        |--------------------------------------------------------------------------
        | Attach Subscription
        |--------------------------------------------------------------------------
        */

        let customersWithSubscription =
            customers.map(customer => {

                const customerSubscriptions =
                    subscriptions.filter(
                        subscription =>
                            subscription.userId.toString() ===
                            customer._id.toString()
                    );

                const activeSubscription =
                    customerSubscriptions.find(
                        subscription =>
                            subscription.subscriptionStatus === "active" &&
                            new Date(subscription.startDate) <= now &&
                            new Date(subscription.endDate) > now
                    );

                let subscriptionStatus =
                    "noSubscription";

                if (activeSubscription) {

                    subscriptionStatus = "active";

                } else {

                    const expiredSubscription =
                        customerSubscriptions.find(
                            subscription =>
                                new Date(subscription.endDate) <= now
                        );

                    if (expiredSubscription) {
                        subscriptionStatus = "expired";
                    }
                }

                return {
                    ...customer,

                    subscriptionStatus,

                    currentSubscription:
                        activeSubscription || null
                };

            });


        /*
        |--------------------------------------------------------------------------
        | Filter By Subscription Status
        |--------------------------------------------------------------------------
        */

        if (status !== "all") {

            customersWithSubscription =
                customersWithSubscription.filter(
                    customer =>
                        customer.subscriptionStatus === status
                );

        }


        /*
        |--------------------------------------------------------------------------
        | Filter By Plan
        |--------------------------------------------------------------------------
        */

        if (plan !== "all") {

            customersWithSubscription =
                customersWithSubscription.filter(
                    customer =>
                        customer.currentSubscription?.plan === plan
                );

        }


        return res.status(200).json({

            message:
                "Customers fetched successfully",

            pagination: {
                currentPage: pageNumber,
                totalPages:
                    Math.ceil(
                        totalCustomers /
                        limitNumber
                    ),
                totalCustomers,
                limit: limitNumber
            },

            customers:
                customersWithSubscription

        });

    } catch (error) {

        console.log(
            "Get all customers error:",
            error
        );

        return res.status(500).json({
            message: "Server error"
        });

    }
};

// GET SINGLE CUSTOMER
export const getCustomerById = async (req, res) => {
    try {

        const { id } = req.params;

        /*
        |--------------------------------------------------------------------------
        | Find Customer
        |--------------------------------------------------------------------------
        */

        const customer = await userModel
            .findOne({
                _id: id,
                role: "user"
            })
            .select("-Password")
            .lean();

        if (!customer) {

            return res.status(404).json({
                message: "Customer not found"
            });

        }


        /*
        |--------------------------------------------------------------------------
        | Find Customer Subscriptions
        |--------------------------------------------------------------------------
        */

        const subscriptions =
            await subscriptionModel
                .find({
                    userId: customer._id,
                    paymentStatus: "paid"
                })
                .sort({
                    createdAt: -1
                })
                .lean();


        /*
        |--------------------------------------------------------------------------
        | Find Current Subscription
        |--------------------------------------------------------------------------
        */

        const now = new Date();

        const currentSubscription =
            subscriptions.find(
                subscription =>
                    subscription.subscriptionStatus === "active" &&
                    new Date(subscription.startDate) <= now &&
                    new Date(subscription.endDate) > now
            );


        /*
        |--------------------------------------------------------------------------
        | Determine Subscription Status
        |--------------------------------------------------------------------------
        */

        let subscriptionStatus =
            "noSubscription";

        if (currentSubscription) {

            subscriptionStatus = "active";

        } else if (subscriptions.length > 0) {

            const hasExpiredSubscription =
                subscriptions.some(
                    subscription =>
                        new Date(subscription.endDate) <= now
                );

            if (hasExpiredSubscription) {
                subscriptionStatus = "expired";
            }

        }


        /*
        |--------------------------------------------------------------------------
        | Response
        |--------------------------------------------------------------------------
        */

        return res.status(200).json({

            message:
                "Customer details fetched successfully",

            customer: {

                ...customer,

                subscriptionStatus,

                currentSubscription:
                    currentSubscription || null,

                subscriptionHistory:
                    subscriptions

            }

        });

    } catch (error) {

        console.log(
            "Get customer details error:",
            error
        );

        return res.status(500).json({
            message: "Server error"
        });

    }
};

// UPDATE CUSTOMER
export const updateCustomer = async (req, res) => {
    try {

        const { id } = req.params;

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
            businessType
        } = req.body;


        const customer = await userModel.findOne({
            _id: id,
            role: "user"
        });

        if (!customer) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }


        // Check email
        if (email && email !== customer.email) {

            const existingEmail = await userModel.findOne({
                email,
                _id: { $ne: id }
            });

            if (existingEmail) {
                return res.status(400).json({
                    message: "Email already exists"
                });
            }
        }


        // Check mobile
        if (
            mobileNumber &&
            Number(mobileNumber) !== customer.mobileNumber
        ) {

            const existingMobile = await userModel.findOne({
                mobileNumber: Number(mobileNumber),
                _id: { $ne: id }
            });

            if (existingMobile) {
                return res.status(400).json({
                    message: "Mobile number already exists"
                });
            }
        }


        customer.Shopname = Shopname ?? customer.Shopname;
        customer.ownerName = ownerName ?? customer.ownerName;
        customer.mobileNumber =
            mobileNumber ?? customer.mobileNumber;
        customer.email = email ?? customer.email;
        customer.shopAddress =
            shopAddress ?? customer.shopAddress;
        customer.city = city ?? customer.city;
        customer.state = state ?? customer.state;
        customer.gstNumber =
            gstNumber ?? customer.gstNumber;
        customer.licenseNumber =
            licenseNumber ?? customer.licenseNumber;

        if (businessType && BUSINESS_TYPE_IDS.includes(businessType)) {
            customer.businessType = businessType;
        }


        await customer.save();


        return res.status(200).json({
            message: "Customer updated successfully",
            customer: {
                id: customer._id,
                Shopname: customer.Shopname,
                ownerName: customer.ownerName,
                mobileNumber: customer.mobileNumber,
                email: customer.email,
                shopAddress: customer.shopAddress,
                city: customer.city,
                state: customer.state,
                gstNumber: customer.gstNumber,
                licenseNumber: customer.licenseNumber,
                businessType: customer.businessType,
                isActive: customer.isActive
            }
        });

    } catch (error) {

        console.log("Update customer error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// ACTIVATE / DEACTIVATE CUSTOMER
export const toggleCustomerStatus = async (req, res) => {
    try {

        const { id } = req.params;

        const customer = await userModel.findOne({
            _id: id,
            role: "user"
        });

        if (!customer) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }


        customer.isActive = !customer.isActive;

        await customer.save();


        return res.status(200).json({
            message: customer.isActive
                ? "Customer activated successfully"
                : "Customer deactivated successfully",

            isActive: customer.isActive
        });

    } catch (error) {

        console.log("Toggle customer status error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// DELETE CUSTOMER
export const deleteCustomer = async (req, res) => {
    try {

        const { id } = req.params;
        const { password } = req.body;

        // 1. Password is required
        if (!password) {
            return res.status(400).json({
                message: "Admin password is required"
            });
        }

        // 2. Get the currently logged-in admin
        // req.user.id comes from authMiddleware JWT
        const admin = await userModel.findById(req.user.id);

        if (!admin) {
            return res.status(404).json({
                message: "Admin user not found"
            });
        }

        // 3. Make sure logged-in user is actually admin
        if (admin.role !== "admin") {
            return res.status(403).json({
                message: "Only admin can delete customers"
            });
        }

        // 4. Verify admin password
        const isPasswordCorrect = await bcrypt.compare(
            password,
            admin.Password
        );

        if (!isPasswordCorrect) {
            return res.status(401).json({
                message: "Incorrect admin password"
            });
        }

        // 5. Don't allow admin to delete himself
        if (id === admin._id.toString()) {
            return res.status(400).json({
                message: "You cannot delete your own admin account"
            });
        }

        // 6. Find customer
        // Only role=user can be deleted
        const customer = await userModel.findOne({
            _id: id,
            role: "user"
        });

        if (!customer) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }

        // 7. Delete customer's subscriptions
        await subscriptionModel.deleteMany({
            userId: id
        });

        // 8. Delete customer
        await userModel.deleteOne({
            _id: id
        });

        // 9. Success response
        return res.status(200).json({
            message: "Customer and subscription history deleted successfully"
        });

    } catch (error) {

        console.log("Delete customer error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// GET CUSTOMER SUBSCRIPTIONS
export const getCustomerSubscriptions = async (req, res) => {
    try {

        const { id } = req.params;

        const customer = await userModel.findOne({
            _id: id,
            role: "user"
        });

        if (!customer) {
            return res.status(404).json({
                message: "Customer not found"
            });
        }


        const subscriptions = await subscriptionModel
            .find({
                userId: id
            })
            .sort({
                createdAt: -1
            });


        const now = new Date();

        const currentSubscription = subscriptions.find(
            (subscription) =>
                subscription.subscriptionStatus === "active" &&
                new Date(subscription.startDate) <= now &&
                new Date(subscription.endDate) > now
        );


        return res.status(200).json({
            message: "Customer subscriptions fetched successfully",

            customer: {
                id: customer._id,
                Shopname: customer.Shopname,
                ownerName: customer.ownerName,
                email: customer.email
            },

            currentSubscription:
                currentSubscription || null,

            subscriptions
        });

    } catch (error) {

        console.log(
            "Get customer subscriptions error:",
            error
        );

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// ADMIN DASHBOARD DATA
export const getAdminDashboard = async (req, res) => {
    try {

        const now = new Date();

        // Total customers
        const totalCustomers = await userModel.countDocuments({
            role: "user"
        });

        // Active customers
        const activeCustomers = await userModel.countDocuments({
            role: "user",
            isActive: true
        });

        // Inactive customers
        const inactiveCustomers = await userModel.countDocuments({
            role: "user",
            isActive: false
        });

        // Active subscriptions
        const activeSubscriptions =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                subscriptionStatus: "active",
                startDate: { $lte: now },
                endDate: { $gt: now }
            });

        // Expired subscriptions
        const expiredSubscriptions =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                endDate: { $lte: now }
            });

        // Pending subscriptions
        const pendingSubscriptions =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                subscriptionStatus: "pending"
            });

        // -----------------------------------------
        // Total Revenue
        // -----------------------------------------

        const revenueResult = await subscriptionModel.aggregate([
            {
                $match: {
                    paymentStatus: "paid"
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: {
                        $sum: "$price"
                    }
                }
            }
        ]);

        const totalRevenue =
            revenueResult[0]?.totalRevenue || 0;


        // -----------------------------------------
        // Monthly Revenue - Last 12 Months
        // -----------------------------------------

        const monthlyRevenue = await subscriptionModel.aggregate([

            {
                $match: {
                    paymentStatus: "paid",

                    createdAt: {
                        $gte: new Date(
                            now.getFullYear(),
                            now.getMonth() - 11,
                            1
                        )
                    }
                }
            },

            {
                $group: {
                    _id: {
                        year: {
                            $year: "$createdAt"
                        },
                        month: {
                            $month: "$createdAt"
                        }
                    },

                    revenue: {
                        $sum: "$price"
                    },

                    subscriptions: {
                        $sum: 1
                    }
                }
            },

            {
                $sort: {
                    "_id.year": 1,
                    "_id.month": 1
                }
            }

        ]);


        // -----------------------------------------
        // Format Monthly Revenue
        // -----------------------------------------

        const formattedMonthlyRevenue =
            monthlyRevenue.map((item) => {

                const monthName = new Date(
                    item._id.year,
                    item._id.month - 1
                ).toLocaleString("en-IN", {
                    month: "short"
                });

                return {
                    year: item._id.year,
                    month: item._id.month,
                    monthName,
                    revenue: item.revenue,
                    subscriptions: item.subscriptions
                };

            });


        const customerGrowth = await userModel.aggregate([
            {
                $match: {
                    role: "user"
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    customers: {
                        $sum: 1
                    }
                }
            },
            {
                $sort: {
                    "_id.year": 1,
                    "_id.month": 1
                }
            }
        ]);

        const customerGrowthData = customerGrowth.map((item) => ({
            month: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
            customers: item.customers
        }));

        // Subscriptions expiring within next 7 days
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

        const expiringWithin7Days =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                subscriptionStatus: "active",
                endDate: {
                    $gt: now,
                    $lte: sevenDaysFromNow
                }
            });


        // Customers with expired subscriptions
        const expiredCustomers =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                subscriptionStatus: "expired",
                endDate: {
                    $lte: now
                }
            });


        // New subscriptions this month
        const startOfMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
        );

        const newSubscriptionsThisMonth =
            await subscriptionModel.countDocuments({
                paymentStatus: "paid",
                createdAt: {
                    $gte: startOfMonth
                }
            });



        // Which kinds of shops use the platform — grocery, hardware, pharmacy…
        const businessTypeCounts = await userModel.aggregate([
            { $match: { role: "user" } },
            {
                $group: {
                    _id: { $ifNull: ["$businessType", "general"] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        const businessTypes = businessTypeCounts.map((item) => ({
            id: item._id,
            label: getBusinessType(item._id).label,
            count: item.count
        }));

        return res.status(200).json({

            message: "Admin dashboard data fetched successfully",

            businessTypes,

            stats: {
                totalCustomers,
                activeCustomers,
                inactiveCustomers,
                activeSubscriptions,
                expiredSubscriptions,
                pendingSubscriptions,
                totalRevenue
            },

            monthlyRevenue: formattedMonthlyRevenue,
            customerGrowth: customerGrowthData,

            subscriptionAlerts: {
                expiringWithin7Days,
                expiredCustomers,
                newSubscriptionsThisMonth
            }

        });

    } catch (error) {

        console.log(
            "Admin dashboard error:",
            error
        );

        return res.status(500).json({
            message: "Server error"
        });
    }
};