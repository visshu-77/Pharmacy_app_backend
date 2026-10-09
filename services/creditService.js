import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";

/**
 * Balance maths for the udhar khata.
 *
 * Nothing stores what a customer owes. It is always summed from the ledger:
 *
 *     outstanding = Σ (increase rows) − Σ (decrease rows)
 *
 * so a balance can never drift away from the entries that explain it. A
 * reversal is an opposite row pointing at the original, so the pair simply
 * nets to zero and both stay visible in the history.
 */

export const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/** Treat a user-typed search term as text, not as a pattern. */
export const escapeRegex = (text) =>
    String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const CUSTOMER_SORTS = ["outstanding", "name", "recent"];
export const CUSTOMER_FILTERS = ["all", "due", "clear"];
export const CUSTOMER_STATUSES = ["all", "active", "inactive"];

const SORT_STAGES = {
    // Who owes the most, first — what the owner opens the page to see.
    outstanding: { outstanding: -1, customerName: 1, _id: 1 },
    name: { customerName: 1, _id: 1 },
    recent: { lastActivityAt: -1, createdAt: -1, _id: 1 }
};

/** $group accumulators shared by every balance query. */
const totalsAccumulators = {
    charged: {
        $sum: { $cond: [{ $eq: ["$direction", "increase"] }, "$amount", 0] }
    },

    paid: {
        $sum: { $cond: [{ $eq: ["$direction", "decrease"] }, "$amount", 0] }
    },

    entryCount: { $sum: 1 },

    lastActivityAt: { $max: "$date" }
};

export const EMPTY_TOTALS = {
    charged: 0,
    paid: 0,
    outstanding: 0,
    entryCount: 0,
    lastActivityAt: null
};

const shapeTotals = (row) => ({
    charged: round2(row?.charged),
    paid: round2(row?.paid),
    outstanding: round2(Number(row?.charged || 0) - Number(row?.paid || 0)),
    entryCount: row?.entryCount || 0,
    lastActivityAt: row?.lastActivityAt || null
});

/**
 * Ledger totals for one customer of one shop.
 * Returns zeroes for a customer with no entries yet.
 */
export const getCustomerTotals = async (userId, customerId, session = null) => {
    const query = creditTransactionModel.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                customerId: new mongoose.Types.ObjectId(customerId)
            }
        },
        { $group: { _id: null, ...totalsAccumulators } }
    ]);

    // Inside a transaction the balance must be read through the same
    // session, so it sees the writes this transaction has already made.
    if (session) query.session(session);

    const [row] = await query;

    return shapeTotals(row);
};

/**
 * One page of customers with their balances, plus the shop-wide totals.
 *
 * Balances are computed inside the same aggregation that pages the list, so
 * sorting by "who owes the most" stays correct across pages.
 */
export const listCustomersWithBalances = async ({
    userId,
    search = "",
    filter = "all",
    sort = "outstanding",
    page = 1,
    limit = 20,
    status = "all"
}) => {
    const ownerId = new mongoose.Types.ObjectId(userId);

    const match = { userId: ownerId };

    // Every customer counts towards what the shop is owed by default; a
    // customer marked inactive still shows the money they never paid back.
    if (status === "active") match.isActive = true;
    if (status === "inactive") match.isActive = false;

    if (search.trim()) {
        const pattern = new RegExp(escapeRegex(search.trim()), "i");
        match.$or = [{ customerName: pattern }, { phone: pattern }];
    }

    const filterStage =
        filter === "due" ? [{ $match: { outstanding: { $gt: 0 } } }]
            : filter === "clear" ? [{ $match: { outstanding: { $lte: 0 } } }]
                : [];

    const [result] = await creditCustomerModel.aggregate([
        { $match: match },

        {
            $lookup: {
                from: creditTransactionModel.collection.name,
                let: { customerId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$userId", ownerId] },
                                    { $eq: ["$customerId", "$$customerId"] }
                                ]
                            }
                        }
                    },
                    { $group: { _id: null, ...totalsAccumulators } }
                ],
                as: "ledger"
            }
        },

        { $set: { ledger: { $first: "$ledger" } } },

        {
            $set: {
                charged: { $round: [{ $ifNull: ["$ledger.charged", 0] }, 2] },
                paid: { $round: [{ $ifNull: ["$ledger.paid", 0] }, 2] },
                entryCount: { $ifNull: ["$ledger.entryCount", 0] },
                lastActivityAt: "$ledger.lastActivityAt"
            }
        },

        {
            $set: {
                outstanding: { $round: [{ $subtract: ["$charged", "$paid"] }, 2] }
            }
        },

        { $unset: "ledger" },

        ...filterStage,

        {
            $facet: {
                rows: [
                    { $sort: SORT_STAGES[sort] || SORT_STAGES.outstanding },
                    { $skip: (page - 1) * limit },
                    { $limit: limit }
                ],

                summary: [
                    {
                        $group: {
                            _id: null,
                            customers: { $sum: 1 },

                            dueCustomers: {
                                $sum: { $cond: [{ $gt: ["$outstanding", 0] }, 1, 0] }
                            },

                            // Only real debts; an advance must not quietly
                            // reduce what the shop is owed.
                            outstanding: {
                                $sum: {
                                    $cond: [{ $gt: ["$outstanding", 0] }, "$outstanding", 0]
                                }
                            },

                            advance: {
                                $sum: {
                                    $cond: [{ $lt: ["$outstanding", 0] }, "$outstanding", 0]
                                }
                            }
                        }
                    }
                ]
            }
        }
    ]);

    const summary = result?.summary?.[0];
    const total = summary?.customers || 0;

    return {
        customers: result?.rows || [],
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        totals: {
            customers: total,
            dueCustomers: summary?.dueCustomers || 0,
            outstanding: round2(summary?.outstanding),
            advance: round2(Math.abs(summary?.advance || 0))
        }
    };
};

/** Sum of signed amounts for a filter — the balance that filter describes. */
const sumSignedAmount = async (match) => {
    const [row] = await creditTransactionModel.aggregate([
        { $match: match },
        { $group: { _id: null, ...totalsAccumulators } }
    ]);

    return round2(Number(row?.charged || 0) - Number(row?.paid || 0));
};

/**
 * A customer's khata for a date range: what they owed when the range opened,
 * every entry in it with the balance after each one, and what is left at the
 * close.
 *
 * Rows come back oldest-first by default, which is how a statement reads. On
 * page 2 the opening balance already includes page 1, so the running balance
 * is continuous however the list is paged.
 */
export const getStatement = async ({
    userId,
    customerId,
    from = null,
    to = null,
    type = null,
    paymentMethod = null,
    page = 1,
    limit = 50,
    order = "asc"
}) => {
    const ownerId = new mongoose.Types.ObjectId(userId);
    const customerKey = new mongoose.Types.ObjectId(customerId);

    const scope = { userId: ownerId, customerId: customerKey };

    const range = {};
    if (from) range.$gte = from;
    if (to) range.$lt = to;

    const inRange = {
        ...scope,
        ...(from || to ? { date: range } : {}),
        ...(type ? { type } : {}),
        ...(paymentMethod ? { paymentMethod } : {})
    };

    // Everything before the window is the opening balance.
    const openingBalance = from
        ? await sumSignedAmount({ ...scope, date: { $lt: from } })
        : 0;

    const [total, totalsRow] = await Promise.all([
        creditTransactionModel.countDocuments(inRange),

        creditTransactionModel.aggregate([
            { $match: inRange },
            {
                $group: {
                    _id: null,
                    ...totalsAccumulators,

                    adjustmentsUp: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$type", "ADJUSTMENT"] }, { $eq: ["$direction", "increase"] }] },
                                "$amount",
                                0
                            ]
                        }
                    },

                    adjustmentsDown: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$type", "ADJUSTMENT"] }, { $eq: ["$direction", "decrease"] }] },
                                "$amount",
                                0
                            ]
                        }
                    },

                    charges: {
                        $sum: { $cond: [{ $eq: ["$type", "CREDIT_SALE"] }, "$amount", 0] }
                    },

                    payments: {
                        $sum: { $cond: [{ $eq: ["$type", "PAYMENT"] }, "$amount", 0] }
                    }
                }
            }
        ])
    ]);

    const sortOrder = order === "desc" ? -1 : 1;
    const skip = (page - 1) * limit;

    const rows = await creditTransactionModel
        .find(inRange)
        .sort({ date: sortOrder, createdAt: sortOrder, _id: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

    // Everything in the window that comes before this page, so the running
    // balance picks up where the previous page left off.
    const skipped = skip > 0
        ? await creditTransactionModel
            .find(inRange)
            .sort({ date: sortOrder, createdAt: sortOrder, _id: sortOrder })
            .limit(skip)
            .select("amount direction")
            .lean()
        : [];

    const signed = (row) => (row.direction === "decrease" ? -row.amount : row.amount);

    let running = round2(
        openingBalance + skipped.reduce((sum, row) => sum + signed(row), 0)
    );

    const transactions = rows.map((row) => {
        running = round2(running + signed(row));

        return { ...row, signedAmount: signed(row), runningBalance: running };
    });

    const totals = totalsRow[0];

    return {
        openingBalance,
        transactions,
        pagination: {
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / limit))
        },
        summary: {
            charges: round2(totals?.charges),
            payments: round2(totals?.payments),
            adjustmentsUp: round2(totals?.adjustmentsUp),
            adjustmentsDown: round2(totals?.adjustmentsDown),
            entryCount: total,
            // What is owed now, whatever window was asked for.
            closingBalance: await sumSignedAmount(scope)
        }
    };
};

/**
 * Shop-wide udhar figures: what is owed in total right now, and how much was
 * given out and collected inside a date range.
 */
export const getShopSummary = async ({ userId, from = null, to = null, topDebtors = 5 }) => {
    const ownerId = new mongoose.Types.ObjectId(userId);

    const range = {};
    if (from) range.$gte = from;
    if (to) range.$lt = to;

    const inRange = from || to ? { date: range } : {};

    const [periodRow, customerTotals] = await Promise.all([
        creditTransactionModel.aggregate([
            { $match: { userId: ownerId, ...inRange } },
            {
                $group: {
                    _id: null,

                    creditGiven: {
                        $sum: {
                            $cond: [{ $eq: ["$direction", "increase"] }, "$amount", 0]
                        }
                    },

                    paymentsCollected: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "PAYMENT"] }, "$amount", 0]
                        }
                    },

                    entryCount: { $sum: 1 }
                }
            }
        ]),

        // Sorted by who owes most, so the first few rows are the top debtors
        // and the facet's own group still totals every customer.
        listCustomersWithBalances({ userId, page: 1, limit: topDebtors, sort: "outstanding" })
    ]);

    const period = periodRow[0];

    return {
        summary: {
            outstanding: customerTotals.totals.outstanding,
            advance: customerTotals.totals.advance,
            customers: customerTotals.totals.customers,
            dueCustomers: customerTotals.totals.dueCustomers,
            creditGiven: round2(period?.creditGiven),
            paymentsCollected: round2(period?.paymentsCollected),
            entryCount: period?.entryCount || 0
        },

        topDebtors: customerTotals.customers
            .filter((customer) => customer.outstanding > 0)
            .map((customer) => ({
                _id: customer._id,
                customerName: customer.customerName,
                phone: customer.phone,
                outstanding: customer.outstanding,
                entryCount: customer.entryCount,
                lastActivityAt: customer.lastActivityAt
            }))
    };
};

/**
 * The widest window an export or a statement may ask for, and the most rows
 * one export may produce. Both are guards against a request that would pull
 * a whole database into memory.
 */
export const MAX_RANGE_DAYS = 1830;        // five years
export const MAX_EXPORT_ROWS = 5000;

/**
 * Turns `?from=&to=` into real dates, or says what is wrong with them.
 * Returns { from, to, error } — `to` stays exclusive, as the queries expect.
 */
export const resolveDateRange = ({ from, to }) => {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;

    if ((from && Number.isNaN(start?.getTime())) || (to && Number.isNaN(end?.getTime()))) {
        return { error: "Invalid date range" };
    }

    if (start && end && end <= start) {
        return { error: "The end date must be after the start date" };
    }

    if (start && end && (end - start) / 86400000 > MAX_RANGE_DAYS) {
        return { error: "Choose a shorter period — at most five years at a time" };
    }

    return { from: start, to: end };
};

/** Who owes the most right now, biggest first. */
export const getTopDebtors = async ({ userId, limit = 5 }) => {
    const { customers } = await listCustomersWithBalances({
        userId,
        filter: "due",
        sort: "outstanding",
        page: 1,
        limit
    });

    return customers.map((customer) => ({
        _id: customer._id,
        customerName: customer.customerName,
        phone: customer.phone,
        outstanding: customer.outstanding,
        entryCount: customer.entryCount,
        lastActivityAt: customer.lastActivityAt
    }));
};

/** The latest entries across the whole shop, with the customer's name. */
export const getRecentActivity = async ({ userId, limit = 8, from = null, to = null }) => {
    const ownerId = new mongoose.Types.ObjectId(userId);

    const range = {};
    if (from) range.$gte = from;
    if (to) range.$lt = to;

    return creditTransactionModel.aggregate([
        { $match: { userId: ownerId, ...(from || to ? { date: range } : {}) } },
        { $sort: { date: -1, createdAt: -1 } },
        { $limit: limit },
        {
            $lookup: {
                from: creditCustomerModel.collection.name,
                localField: "customerId",
                foreignField: "_id",
                as: "customer"
            }
        },
        { $set: { customer: { $first: "$customer" } } },
        {
            $project: {
                type: 1,
                direction: 1,
                amount: 1,
                date: 1,
                description: 1,
                paymentMethod: 1,
                isReversed: 1,
                customerId: 1,
                customerName: "$customer.customerName"
            }
        }
    ]);
};

/**
 * Every row of a customer's ledger in a range, flattened for a CSV file and
 * carrying its running balance — the same numbers the statement shows,
 * read back from the database rather than recomputed in the browser.
 */
export const getStatementRows = async ({ userId, customerId, from, to, limit = MAX_EXPORT_ROWS }) => {
    const ownerId = new mongoose.Types.ObjectId(userId);
    const customerKey = new mongoose.Types.ObjectId(customerId);

    const scope = { userId: ownerId, customerId: customerKey };

    const range = {};
    if (from) range.$gte = from;
    if (to) range.$lt = to;

    const inRange = { ...scope, ...(from || to ? { date: range } : {}) };

    const openingBalance = from
        ? await sumSignedAmount({ ...scope, date: { $lt: from } })
        : 0;

    const total = await creditTransactionModel.countDocuments(inRange);

    const rows = await creditTransactionModel
        .find(inRange)
        .sort({ date: 1, createdAt: 1, _id: 1 })
        .limit(limit)
        .lean();

    let running = openingBalance;

    const lines = rows.map((row) => {
        const signed = row.direction === "decrease" ? -row.amount : row.amount;
        running = round2(running + signed);

        return { ...row, runningBalance: running };
    });

    return {
        openingBalance,
        rows: lines,
        total,
        truncated: total > lines.length,
        closingBalance: await sumSignedAmount(scope)
    };
};
