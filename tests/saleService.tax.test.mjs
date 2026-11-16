import assert from "node:assert/strict";
import test from "node:test";

import { applyItemTaxes, roundBillTotal } from "../services/saleService.js";

test("calculates item tax using each GST rate and splits it after discount", () => {
    const result = applyItemTaxes({
        orderItems: [
            { total: 100, taxRate: 18 },
            { total: 50, taxRate: 5 }
        ],
        subtotal: 150,
        discount: 15
    });

    assert.deepEqual(result.orderItems.map(({ taxableAmount, cgst, sgst, amount }) => ({
        taxableAmount,
        cgst,
        sgst,
        amount
    })), [
        { taxableAmount: 90, cgst: 8.1, sgst: 8.1, amount: 106.2 },
        { taxableAmount: 45, cgst: 1.13, sgst: 1.12, amount: 47.25 }
    ]);
    assert.equal(result.cgst, 9.23);
    assert.equal(result.sgst, 9.22);
    assert.equal(result.tax, 18.45);
});

test("rounds a billing total to the nearest rupee and records the adjustment", () => {
    assert.deepEqual(roundBillTotal(294999.61), {
        grandTotal: 295000,
        roundOff: 0.39
    });
    assert.deepEqual(roundBillTotal(99.49), {
        grandTotal: 99,
        roundOff: -0.49
    });
    assert.deepEqual(roundBillTotal(100), {
        grandTotal: 100,
        roundOff: 0
    });
});
