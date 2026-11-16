import assert from "node:assert/strict";
import test from "node:test";

import { applyItemTaxes } from "../services/saleService.js";

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
