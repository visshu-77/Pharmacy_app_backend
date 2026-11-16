import assert from "node:assert/strict";
import test from "node:test";

import {
    calculateFinancialTotals,
    getNextRecurringDate,
    parseDate,
    roundMoney,
    toDateKey
} from "../services/expenseService.js";

test("validates date-only values and rounds money to paise", () => {
    assert.equal(parseDate("2026-03-08").toISOString(), "2026-03-08T00:00:00.000Z");
    assert.equal(parseDate("08/03/2026"), null);
    assert.equal(parseDate("2026-02-31"), null);
    assert.equal(roundMoney(5.235), 5.24);
});

test("advances recurring dates without overflowing short months", () => {
    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    const february = getNextRecurringDate(jan31, "monthly");
    assert.equal(toDateKey(february), "2026-02-28");
    assert.equal(toDateKey(getNextRecurringDate(february, "monthly")), "2026-03-28");
    assert.equal(toDateKey(getNextRecurringDate(jan31, "weekly")), "2026-02-07");
});

test("refunds reduce expenses, investments stay separate, and transfers do not affect cash flow", () => {
    assert.deepEqual(calculateFinancialTotals({
        expenses: 250,
        refunds: 40,
        income: 500,
        investments: 100,
        transfers: 300,
        transactions: 7
    }), {
        expenses: 210,
        income: 500,
        investments: 100,
        transfers: 300,
        transactions: 7,
        netCashFlow: 190
    });
});
