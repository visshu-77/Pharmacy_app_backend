import expenseCategoryModel from "../model/expenseCategory.js";

export const TRANSACTION_TYPES = ["expense", "income", "investment", "refund", "transfer"];
export const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"];
export const RECURRING_FREQUENCIES = ["daily", "weekly", "monthly"];

const DEFAULT_CATEGORIES = [
    ["expense", "Tea & Snacks"], ["expense", "Food"], ["expense", "Travelling"],
    ["expense", "Petrol / Diesel"], ["expense", "Shopping"], ["expense", "Groceries"],
    ["expense", "Other"], ["expense", "Office Rent"], ["expense", "Electricity Bill"],
    ["expense", "Internet"], ["expense", "Employee Salary"], ["expense", "Marketing"],
    ["expense", "Software / Subscriptions"], ["expense", "Maintenance"],
    ["investment", "Equipment Purchase"], ["investment", "Business Expansion"],
    ["investment", "Marketing Investment"], ["investment", "Stock / Inventory"],
    ["investment", "New Projects"], ["investment", "Other"],
    ["income", "Sales"], ["income", "Other Income"]
];

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const calculateFinancialTotals = (summary = {}) => {
    const expenses = roundMoney(Number(summary.expenses || 0) - Number(summary.refunds || 0));
    const income = roundMoney(summary.income || 0);
    const investments = roundMoney(summary.investments || 0);

    return {
        expenses,
        income,
        investments,
        transfers: roundMoney(summary.transfers || 0),
        transactions: Number(summary.transactions || 0),
        netCashFlow: roundMoney(income - expenses - investments)
    };
};

export const parseDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
        ? date
        : null;
};

export const toDateKey = (date) => date.toISOString().slice(0, 10);

export const getNextRecurringDate = (date, frequency) => {
    const next = new Date(date);
    if (frequency === "daily") {
        next.setUTCDate(next.getUTCDate() + 1);
    } else if (frequency === "weekly") {
        next.setUTCDate(next.getUTCDate() + 7);
    } else {
        const day = next.getUTCDate();
        next.setUTCDate(1);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
        next.setUTCDate(Math.min(day, lastDay));
    }
    return next;
};

export const seedExpenseCategories = async (userId) => {
    try {
        await expenseCategoryModel.bulkWrite(
            DEFAULT_CATEGORIES.map(([type, name]) => ({
                updateOne: {
                    filter: { userId, type, normalizedName: name.toLowerCase() },
                    update: {
                        $setOnInsert: {
                            userId,
                            type,
                            name,
                            normalizedName: name.toLowerCase(),
                            isDefault: true
                        }
                    },
                    upsert: true
                }
            })),
            { ordered: false }
        );
    } catch (error) {
        if (error.code !== 11000 && !error.writeErrors?.every((entry) => entry.code === 11000)) {
            throw error;
        }
    }
};

export const validateCategory = async ({ userId, categoryId, type, required = true }) => {
    if (!categoryId && !required) return { category: null };
    if (!categoryId) return { error: "Choose a category" };
    if (!/^[a-f\d]{24}$/i.test(String(categoryId))) return { error: "Choose a valid category" };

    const category = await expenseCategoryModel.findOne({ _id: categoryId, userId });
    if (!category) return { error: "Category not found" };

    const categoryType = type === "refund" ? "expense" : type;
    if (category.type !== categoryType) {
        return { error: `Choose a ${categoryType} category` };
    }

    return { category };
};
