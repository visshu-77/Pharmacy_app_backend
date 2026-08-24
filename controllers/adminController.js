import userModel from "../model/users.js";
import subscriptionModel from "../model/subscription.js";


/*
|--------------------------------------------------------------------------
| GET ALL CUSTOMERS
|--------------------------------------------------------------------------
*/


export const getAllCustomers = async (req, res) => {
    try {

        const {
            page = 1,
            limit = 10,
            search = "",
            status = "all",
            plan = "all"
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

/*
|--------------------------------------------------------------------------
| GET SINGLE CUSTOMER
|--------------------------------------------------------------------------
*/


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



/*
|--------------------------------------------------------------------------
| UPDATE CUSTOMER
|--------------------------------------------------------------------------
*/

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
            licenseNumber
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


/*
|--------------------------------------------------------------------------
| ACTIVATE / DEACTIVATE CUSTOMER
|--------------------------------------------------------------------------
*/

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


/*
|--------------------------------------------------------------------------
| DELETE CUSTOMER
|--------------------------------------------------------------------------
*/

export const deleteCustomer = async (req, res) => {
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


        /*
         * Delete customer's subscriptions also.
         */

        await subscriptionModel.deleteMany({
            userId: id
        });


        await userModel.deleteOne({
            _id: id
        });


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


/*
|--------------------------------------------------------------------------
| GET CUSTOMER SUBSCRIPTIONS
|--------------------------------------------------------------------------
*/

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

        // Total revenue
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


        return res.status(200).json({

            message: "Admin dashboard data fetched successfully",

            stats: {
                totalCustomers,
                activeCustomers,
                inactiveCustomers,
                activeSubscriptions,
                expiredSubscriptions,
                pendingSubscriptions,
                totalRevenue
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