import { resolveSubscription } from "../services/subscriptionService.js";

/**
 * Blocks the request unless the user has a plan in force right now.
 * Uses the same resolver as /subscription/my-subscription, so an expiring
 * plan with a paid renewal queued behind it rolls over without a gap.
 */
export const checkSubscription = async (req, res, next) => {
    try {
        const { current } = await resolveSubscription(req.user.id);

        if (!current) {
            return res.status(403).json({
                message: "Your subscription has expired. Renew to continue.",
                subscriptionRequired: true
            });
        }

        req.subscription = current;

        next();

    } catch (error) {

        console.log("Subscription middleware error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};
