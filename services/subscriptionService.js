import subscriptionModel from "../model/subscription.js";

/**
 * Add a billing cycle to a date. Month arithmetic is clamped so that
 * 31 Jan + 1 month = 28/29 Feb (not 3 Mar), and 29 Feb + 1 year = 28 Feb.
 */
export const calculateEndDate = (startDate, duration) => {
    const start = new Date(startDate);
    const months = { monthly: 1, sixMonths: 6, yearly: 12 }[duration] || 0;

    const end = new Date(start);
    end.setDate(1);
    end.setMonth(end.getMonth() + months);

    const lastDayOfTargetMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    end.setDate(Math.min(start.getDate(), lastDayOfTargetMonth));

    return end;
};

/**
 * Bring a user's subscriptions up to date and return what they have right
 * now. This is the ONLY place subscription status changes over time, so the
 * access check and the "my subscription" screen can never disagree.
 *
 *   - active plans whose end date has passed become "expired"
 *   - a queued ("pending") renewal whose start date has arrived becomes "active"
 *   - a queued renewal that has already run out becomes "expired"
 *
 * Returns { current, upcoming, accessEndsAt }:
 *   current       the plan in force now, or null
 *   upcoming      renewals already paid for, queued after `current`
 *   accessEndsAt  when access ends if nothing else is bought
 */
export const resolveSubscription = async (userId) => {
    const now = new Date();

    await subscriptionModel.updateMany(
        {
            userId,
            paymentStatus: "paid",
            subscriptionStatus: { $in: ["active", "pending"] },
            endDate: { $lte: now }
        },
        { $set: { subscriptionStatus: "expired" } }
    );

    await subscriptionModel.updateMany(
        {
            userId,
            paymentStatus: "paid",
            subscriptionStatus: "pending",
            startDate: { $lte: now },
            endDate: { $gt: now }
        },
        { $set: { subscriptionStatus: "active" } }
    );

    const live = await subscriptionModel
        .find({
            userId,
            paymentStatus: "paid",
            subscriptionStatus: { $in: ["active", "pending"] },
            endDate: { $gt: now }
        })
        .sort({ startDate: 1 });

    const current =
        live.find(
            (sub) =>
                sub.subscriptionStatus === "active" &&
                new Date(sub.startDate) <= now
        ) || null;

    const upcoming = live.filter(
        (sub) => sub !== current && new Date(sub.startDate) > now
    );

    const accessEndsAt = live.length
        ? new Date(Math.max(...live.map((sub) => new Date(sub.endDate).getTime())))
        : null;

    return { current, upcoming, accessEndsAt };
};
