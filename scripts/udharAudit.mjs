import "dotenv/config";

import mongoose from "mongoose";

import creditCustomerModel from "../model/creditCustomer.js";
import creditTransactionModel from "../model/creditTransaction.js";
import orderModel from "../model/order.js";
import { getCustomerTotals } from "../services/creditService.js";

/**
 * Checks the udhar khata for anything that does not add up.
 *
 *     node scripts/udharAudit.mjs            # every shop
 *     node scripts/udharAudit.mjs <userId>   # one shop
 *
 * READ ONLY. It never writes, deletes or "repairs" anything: a financial
 * record is not something a script should quietly rewrite. It prints what is
 * wrong and, where a fix exists, says what the fix would be so it can be
 * applied deliberately. See MIGRATION NOTES at the bottom of this file.
 *
 * Exit code 0 means clean, 1 means something needs a human.
 */

const argument = process.argv[2];

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;

const problems = [];

const flag = (kind, detail) => problems.push({ kind, detail });

/** Balances are derived; this proves the aggregation agrees with plain JS. */
const recomputeInJs = async (userId, customerId) => {
    const rows = await creditTransactionModel
        .find({ userId, customerId })
        .select("amount direction")
        .lean();

    const total = rows.reduce(
        (sum, row) => sum + (row.direction === "decrease" ? -row.amount : row.amount),
        0
    );

    return Math.round(total * 100) / 100;
};

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const scope = argument ? { userId: new mongoose.Types.ObjectId(argument) } : {};

    const customers = await creditCustomerModel.find(scope).lean();
    const transactions = await creditTransactionModel.find(scope).lean();

    console.log(
        `Checking ${customers.length} customer(s) and ${transactions.length} ledger entries` +
        (argument ? ` for shop ${argument}` : " across every shop")
    );

    // 1. No stored balance should exist anywhere. If a future change adds one,
    //    this is where it would have to be reconciled.
    const withStoredBalance = customers.filter(
        (customer) => customer.outstanding !== undefined || customer.balance !== undefined
    );

    if (withStoredBalance.length > 0) {
        flag(
            "stored balance field",
            `${withStoredBalance.length} customer(s) carry a stored balance. The ledger is the ` +
            "only source of truth; reconcile and remove the field."
        );
    }

    // 2. The aggregation and a plain sum must agree, per customer.
    const byCustomer = new Map(customers.map((customer) => [String(customer._id), customer]));

    for (const customer of customers) {
        const derived = await getCustomerTotals(customer.userId, customer._id);
        const plain = await recomputeInJs(customer.userId, customer._id);

        if (Math.abs(derived.outstanding - plain) > 0.001) {
            flag(
                "balance mismatch",
                `${customer.customerName}: aggregation says ${money(derived.outstanding)}, ` +
                `summing the rows says ${money(plain)}`
            );
        }
    }

    // 3. Entries whose customer is gone would be money owed by nobody.
    for (const row of transactions) {
        if (!byCustomer.has(String(row.customerId)) && !argument) {
            flag("orphan entry", `entry ${row._id} (${money(row.amount)}) has no customer`);
        }
    }

    // 4. Money must be positive and in paise; the schema enforces this for new
    //    rows, so a hit here is data written before that rule existed.
    for (const row of transactions) {
        const amount = Number(row.amount);

        if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) {
            flag("invalid amount", `entry ${row._id} has amount ${row.amount}`);
        }

        if (!["increase", "decrease"].includes(row.direction)) {
            flag("invalid direction", `entry ${row._id} has direction "${row.direction}"`);
        }

        if (row.type === "PAYMENT" && !row.paymentMethod) {
            flag("payment with no method", `entry ${row._id}`);
        }

        if (row.type === "ADJUSTMENT" && !row.reason) {
            flag("adjustment with no reason", `entry ${row._id}`);
        }
    }

    // 5. A reversal and its original must point at each other.
    const reversals = transactions.filter((row) => row.reversalOf);
    const reversedIds = new Set(reversals.map((row) => String(row.reversalOf)));

    for (const row of transactions) {
        if (row.isReversed && !reversedIds.has(String(row._id))) {
            flag(
                "cancelled with no reversal",
                `entry ${row._id} is marked cancelled but nothing reverses it — ` +
                `the balance still counts it`
            );
        }
    }

    for (const row of reversals) {
        const original = transactions.find((other) => String(other._id) === String(row.reversalOf));

        if (!original) {
            flag("reversal of nothing", `entry ${row._id} reverses a missing entry`);
            continue;
        }

        if (!original.isReversed) {
            flag("original not marked", `entry ${original._id} is reversed but not flagged`);
        }

        if (Math.abs(original.amount - row.amount) > 0.001) {
            flag(
                "reversal amount differs",
                `entry ${original._id} is ${money(original.amount)} but its reversal is ${money(row.amount)}`
            );
        }
    }

    // 6. An itemised credit sale and its bill come as a pair.
    const creditOrders = await orderModel.find({ ...scope, source: "credit" }).select("_id grandTotal paymentStatus").lean();
    const ledgerOrderIds = new Set(
        transactions.filter((row) => row.orderId).map((row) => String(row.orderId))
    );

    for (const order of creditOrders) {
        if (!ledgerOrderIds.has(String(order._id))) {
            flag(
                "credit bill with no ledger entry",
                `order ${order._id} (${money(order.grandTotal)}) took stock but is in nobody's khata`
            );
        }
    }

    for (const row of transactions) {
        if (!row.orderId) continue;

        const order = creditOrders.find((candidate) => String(candidate._id) === String(row.orderId));

        if (!order) {
            flag("ledger entry with no bill", `entry ${row._id} points at a missing order`);
            continue;
        }

        // A cancelled entry must have had its bill cancelled too, or the stock
        // went back without the debt going away (or the other way round).
        const cancelledOrder = order.paymentStatus === "Cancelled";

        if (Boolean(row.isReversed) !== cancelledOrder) {
            flag(
                "entry and bill disagree",
                `entry ${row._id} is ${row.isReversed ? "" : "not "}cancelled but order ` +
                `${order._id} is ${cancelledOrder ? "" : "not "}cancelled`
            );
        }
    }

    // 7. A credit sale must never count as money taken.
    const countedAsPaid = await orderModel.countDocuments({
        ...scope,
        source: "credit",
        paymentStatus: "Paid"
    });

    if (countedAsPaid > 0) {
        flag(
            "credit sale counted as cash",
            `${countedAsPaid} credit order(s) are marked Paid and are inflating the sales reports`
        );
    }

    // ---------------------------------------------------------------- report
    console.log("");

    if (problems.length === 0) {
        console.log("Clean — the ledger explains every balance.");
    } else {
        console.log(`${problems.length} problem(s) found:\n`);

        const grouped = problems.reduce((map, problem) => {
            (map[problem.kind] ||= []).push(problem.detail);
            return map;
        }, {});

        for (const [kind, details] of Object.entries(grouped)) {
            console.log(`  ${kind} (${details.length})`);
            details.slice(0, 10).forEach((detail) => console.log(`    - ${detail}`));

            if (details.length > 10) {
                console.log(`    …and ${details.length - 10} more`);
            }
        }

        console.log("\nNothing has been changed. See MIGRATION NOTES in this file.");
    }

    await mongoose.disconnect();

    process.exit(problems.length === 0 ? 0 : 1);
};

run().catch(async (error) => {
    console.error("Audit failed:", error.message);

    await mongoose.disconnect().catch(() => {});
    process.exit(2);
});

/*
 * MIGRATION NOTES
 * ---------------
 * None of these are applied automatically. Each needs a decision from the
 * shop owner, because each one changes what somebody owes.
 *
 *   orphan entry
 *     The customer record was removed while entries remained. Either restore
 *     the customer (preferred — the history then reads normally) or write a
 *     dated ADJUSTMENT with a reason that closes the balance off.
 *
 *   invalid amount / direction / missing method or reason
 *     Written before the current schema rules. Do not edit the row: cancel it
 *     through POST /udhar/transaction/:id/reverse with a reason, then record
 *     the correct entry. The pair stays in the history, which is the point.
 *
 *   cancelled with no reversal
 *     An interrupted cancellation. The entry is flagged but still counted.
 *     Either clear the flag (the entry stands) or write the reversal. Both
 *     must be decided per entry; a blanket fix would move real balances.
 *
 *   credit bill with no ledger entry
 *     Stock left the shop and nobody was charged. Record the matching credit
 *     sale against the right customer, or cancel the order and put the stock
 *     back — whichever matches what actually happened at the counter.
 *
 *   credit sale counted as cash
 *     Set those orders back to paymentStatus "Pending". This is the one case
 *     that is safe to fix in bulk, because a credit order is never cash:
 *       db.getCollection("dashboard/orders").updateMany(
 *           { source: "credit", paymentStatus: "Paid" },
 *           { $set: { paymentStatus: "Pending" } }
 *       )
 *     Take a backup first, and expect historical report totals to drop by the
 *     amount that was wrongly counted.
 */
