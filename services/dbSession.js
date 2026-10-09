import mongoose from "mongoose";

/**
 * Multi-document writes, on deployments that can and cannot do transactions.
 *
 * MongoDB only offers transactions on a replica set or a sharded cluster.
 * Atlas (what this app runs on in production) is a replica set, so the real
 * thing is used there. A plain `mongod` on a developer's laptop is not, and
 * refuses with "Transaction numbers are only allowed on a replica set member
 * or mongos".
 *
 * Rather than assume, this detects the server's answer once and then uses the
 * caller's own compensating path when transactions are unavailable — the same
 * approach controllers/noteController.js already takes by hand. Nothing here
 * pretends that several writes were atomic when they were not.
 */

// null until the server has told us, then true/false for the process.
let transactionsAvailable = null;

/** What the server says when it has no transaction support. */
const isUnsupported = (error) => {
    if (!error) return false;

    // IllegalOperation, and the sharding/standalone variants.
    if ([20, 263].includes(error.code)) return true;

    return /transaction numbers are only allowed|transactions are not supported|replica set member or mongos/i
        .test(error.message || "");
};

/** For diagnostics and tests; null means "not established yet". */
export const transactionSupport = () => transactionsAvailable;

/**
 * Runs `work(session)` inside a transaction when the deployment has them.
 *
 * On a server without transactions, runs `fallback()` instead — which must
 * do its own compensation — so the caller is always explicit about both
 * paths. A transaction is retried by the driver on a write conflict, which
 * is how two concurrent writers to one customer are serialised.
 */
export const withTransaction = async (work, { fallback } = {}) => {
    if (transactionsAvailable === false) {
        return runFallback(fallback);
    }

    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            result = await work(session);
        });

        transactionsAvailable = true;

        return result;

    } catch (error) {
        if (isUnsupported(error)) {
            if (transactionsAvailable === null) {
                console.log(
                    "MongoDB has no transaction support here (not a replica set) — " +
                    "using compensating writes instead."
                );
            }

            transactionsAvailable = false;

            return runFallback(fallback);
        }

        throw error;

    } finally {
        await session.endSession();
    }
};

const runFallback = async (fallback) => {
    if (!fallback) {
        throw new Error(
            "This operation needs MongoDB transactions (a replica set or Atlas)."
        );
    }

    return fallback();
};
