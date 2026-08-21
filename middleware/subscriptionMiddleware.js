import subscriptionModel from "../model/subscription.js";

export const checkSubscription = async (req, res, next) => {
    try {

        // console.log("USER ID FROM TOKEN:", req.user.id);

        const subscription = await subscriptionModel.findOne({
            userId: req.user.id,
            paymentStatus: "paid",
            subscriptionStatus: "active"
        }).sort({ createdAt: -1 });

        // console.log("SUBSCRIPTION FOUND:", subscription);

        if (!subscription) {
            return res.status(403).json({
                message: "Active Subscription is required",
                subscriptionRequired: true
            });
        }

        if (
            subscription.endDate &&
            new Date(subscription.endDate) <= new Date()
        ) {

            subscription.subscriptionStatus = "expired";
            await subscription.save();

            return res.status(403).json({
                message: "Your subscription has expired",
                subscriptionRequired: true
            });
        }

        req.subscription = subscription;

        next();

    } catch (error) {

        console.log("Subscription middleware error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};