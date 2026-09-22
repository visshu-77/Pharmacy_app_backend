/**
 * StoreFlow sells a single plan with every feature included. Only the
 * billing cycle changes the price.
 *
 * Keep in sync with dashboard/src/config/plans.js.
 */
export const subscriptionPlans = {
    pro: {
        monthly: 999,
        sixMonths: 4999,
        yearly: 9999
    }
};

/** The only plan new subscriptions can be bought on. */
export const DEFAULT_PLAN = "pro";

/**
 * Plan ids that existing subscriptions may still carry from before the
 * switch to a single plan. They stay valid until they expire; renewals move
 * onto "pro".
 */
export const LEGACY_PLANS = ["normal", "premium", "business"];
