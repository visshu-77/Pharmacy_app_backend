import recurringExpenseModel from "../model/recurringExpense.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { getNextRecurringDate, toDateKey } from "./expenseService.js";

let isRunning = false;

export const generateDueRecurringExpenses = async (now = new Date()) => {
    if (isRunning) return 0;
    isRunning = true;
    let generated = 0;

    try {
        const rules = await recurringExpenseModel.find({
            active: true,
            nextRunDate: { $lte: now }
        }).limit(500);

        for (const rule of rules) {
            let dueDate = new Date(rule.nextRunDate);
            let iterations = 0;
            while (
                dueDate <= now &&
                (!rule.endDate || dueDate <= rule.endDate) &&
                iterations < 3660
            ) {
                const recurrenceKey = `${rule._id}:${toDateKey(dueDate)}`;
                const result = await expenseTransactionModel.updateOne(
                    { recurrenceKey },
                    {
                        $setOnInsert: {
                            userId: rule.userId,
                            title: rule.title,
                            type: rule.type,
                            amount: rule.amount,
                            categoryId: rule.categoryId,
                            paymentMethod: rule.paymentMethod,
                            transactionDate: dueDate,
                            description: rule.description,
                            recurrenceKey,
                            recurringRuleId: rule._id
                        }
                    },
                    { upsert: true }
                );
                if (result.upsertedCount) generated += 1;
                dueDate = getNextRecurringDate(dueDate, rule.frequency);
                iterations += 1;
            }

            const updates = dueDate <= now && iterations >= 3660
                ? { nextRunDate: dueDate }
                : (!rule.endDate || dueDate <= rule.endDate)
                    ? { nextRunDate: dueDate }
                    : { nextRunDate: dueDate, active: false };
            await recurringExpenseModel.updateOne(
                { _id: rule._id, nextRunDate: rule.nextRunDate },
                { $set: updates }
            );
        }
        return generated;
    } finally {
        isRunning = false;
    }
};

export const startRecurringExpenseScheduler = () => {
    const run = () => generateDueRecurringExpenses().catch((error) => {
        console.error("Recurring expense generation failed:", error);
    });
    run();
    const timer = setInterval(run, 60 * 1000);
    timer.unref();
};
