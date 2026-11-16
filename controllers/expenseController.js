import mongoose from "mongoose";
import expenseCategoryModel from "../model/expenseCategory.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import {
    calculateFinancialTotals,
    parseDate,
    roundMoney,
    seedExpenseCategories,
    validateCategory
} from "../services/expenseService.js";

const PAGE_SIZE_MAX = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPENSE_TIME_ZONE = "Asia/Kolkata";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isValidId = (value) => mongoose.Types.ObjectId.isValid(value);
const getExpenseCalendarParts = (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: EXPENSE_TIME_ZONE,
        year: "numeric",
        month: "numeric",
        day: "numeric"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day)
    };
};
const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const endExclusiveUtcDay = (date) => new Date(startOfUtcDay(date).getTime() + DAY_MS);

const reportMatch = (userId, from, to) => ({
    userId,
    transactionDate: { $gte: from, $lt: endExclusiveUtcDay(to) }
});

const aggregateSummary = (rows = []) => rows[0] || {
    expenses: 0,
    refunds: 0,
    income: 0,
    investments: 0,
    transfers: 0,
    transactions: 0
};

const summaryStages = (match) => [
    { $match: match },
    {
        $group: {
            _id: null,
            expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
            refunds: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } },
            income: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
            investments: { $sum: { $cond: [{ $eq: ["$type", "investment"] }, "$amount", 0] } },
            transfers: { $sum: { $cond: [{ $eq: ["$type", "transfer"] }, "$amount", 0] } },
            transactions: { $sum: 1 }
        }
    }
];

const toNetTotals = calculateFinancialTotals;

const getExpenseCategoryTotals = async ({ userId, categoryId, excludeId = null }) => {
    const rows = await expenseTransactionModel.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                categoryId,
                type: { $in: ["expense", "refund"] },
                ...(excludeId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeId) } } : {})
            }
        },
        { $group: { _id: "$type", total: { $sum: "$amount" } } }
    ]);
    return {
        expenses: rows.find((row) => row._id === "expense")?.total || 0,
        refunds: rows.find((row) => row._id === "refund")?.total || 0
    };
};

const parseTransactionPayload = (req) => {
    if (!req.body.payload) return req.body;
    try {
        return JSON.parse(req.body.payload);
    } catch {
        return null;
    }
};

const validateTransaction = async (payload, userId, excludeId = null) => {
    const title = String(payload.title || "").trim();
    const type = String(payload.type || "");
    const amount = Number(payload.amount);
    const paymentMethod = String(payload.paymentMethod || "");
    const transactionDate = parseDate(payload.transactionDate);
    const description = String(payload.description || "").trim();

    if (!title || title.length > 120) return { error: "Enter a transaction title (up to 120 characters)" };
    if (!["expense", "income", "investment", "refund", "transfer"].includes(type)) {
        return { error: "Choose a valid transaction type" };
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || roundMoney(amount) !== amount) {
        return { error: "Enter a valid amount with no more than two decimal places" };
    }
    if (!["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"].includes(paymentMethod)) {
        return { error: "Choose a valid payment method" };
    }
    if (!transactionDate) return { error: "Choose a valid transaction date" };
    if (description.length > 2000) return { error: "Notes must be 2000 characters or fewer" };

    const categoryResult = await validateCategory({
        userId,
        categoryId: payload.categoryId || null,
        type,
        required: type !== "transfer"
    });
    if (categoryResult.error) return categoryResult;

    if (type === "expense" || type === "refund") {
        const categoryTotals = await getExpenseCategoryTotals({
            userId,
            categoryId: categoryResult.category._id,
            excludeId
        });
        const nextExpenseTotal = categoryTotals.expenses + (type === "expense" ? amount : 0);
        const nextRefundTotal = categoryTotals.refunds + (type === "refund" ? amount : 0);
        if (nextRefundTotal > nextExpenseTotal) {
            return { error: "Refunds cannot exceed recorded expenses in the selected category" };
        }
    }

    return {
        values: {
            title,
            type,
            amount: roundMoney(amount),
            categoryId: categoryResult.category?._id || null,
            paymentMethod,
            transactionDate,
            description
        }
    };
};

const attachReceipt = (transaction, file) => {
    if (!file) return;
    transaction.receipt = {
        fileName: file.originalname.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255),
        contentType: file.mimetype,
        data: file.buffer
    };
};

export const getExpenseTransactions = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const filter = { userId: req.user.id };
        const { search, type, categoryId, paymentMethod, from, to } = req.query;
        const sortMap = {
            latest: { transactionDate: -1, _id: -1 },
            oldest: { transactionDate: 1, _id: 1 },
            highest: { amount: -1, transactionDate: -1 },
            lowest: { amount: 1, transactionDate: -1 }
        };

        if (search) filter.title = { $regex: escapeRegex(String(search).slice(0, 120)), $options: "i" };
        if (type && !["expense", "income", "investment", "refund", "transfer"].includes(type)) {
            return res.status(400).json({ message: "Invalid transaction type filter" });
        }
        if (type) filter.type = type;
        if (categoryId && !isValidId(categoryId)) return res.status(400).json({ message: "Invalid category filter" });
        if (categoryId) filter.categoryId = categoryId;
        if (paymentMethod && !["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"].includes(paymentMethod)) {
            return res.status(400).json({ message: "Invalid payment method filter" });
        }
        if (paymentMethod) {
            filter.paymentMethod = paymentMethod;
        }
        if (from || to) {
            const start = from ? parseDate(String(from)) : new Date(0);
            const end = to ? parseDate(String(to)) : new Date();
            if (!start || !end || start > end) {
                return res.status(400).json({ message: "Choose a valid date range" });
            }
            filter.transactionDate = { $gte: start, $lt: endExclusiveUtcDay(end) };
        }

        const sort = sortMap[req.query.sort] || sortMap.latest;
        const [transactions, total] = await Promise.all([
            expenseTransactionModel.find(filter)
                .select("-receipt.data")
                .populate("categoryId", "name type")
                .sort(sort)
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            expenseTransactionModel.countDocuments(filter)
        ]);

        return res.status(200).json({ transactions, page, limit, total, hasMore: page * limit < total });
    } catch (error) {
        console.error("Get expense transactions error:", error);
        return res.status(500).json({ message: "Could not load transactions" });
    }
};

export const getExpenseTransaction = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid transaction ID" });
        const transaction = await expenseTransactionModel.findOne({
            _id: req.params.id,
            userId: req.user.id
        }).select("-receipt.data").populate("categoryId", "name type").lean();
        if (!transaction) return res.status(404).json({ message: "Transaction not found" });
        return res.status(200).json({ transaction });
    } catch (error) {
        console.error("Get expense transaction error:", error);
        return res.status(500).json({ message: "Could not load transaction" });
    }
};

export const createExpenseTransaction = async (req, res) => {
    try {
        const payload = parseTransactionPayload(req);
        if (!payload) return res.status(400).json({ message: "Transaction details are invalid" });
        const validation = await validateTransaction(payload, req.user.id);
        if (validation.error) return res.status(400).json({ message: validation.error });

        const transaction = new expenseTransactionModel({ userId: req.user.id, ...validation.values });
        attachReceipt(transaction, req.file);
        await transaction.save();

        const result = await expenseTransactionModel.findById(transaction._id)
            .select("-receipt.data").populate("categoryId", "name type").lean();
        return res.status(201).json({ message: "Transaction added", transaction: result });
    } catch (error) {
        if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
        console.error("Create expense transaction error:", error);
        return res.status(500).json({ message: "Could not add transaction" });
    }
};

export const updateExpenseTransaction = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid transaction ID" });
        const transaction = await expenseTransactionModel.findOne({
            _id: req.params.id,
            userId: req.user.id
        });
        if (!transaction) return res.status(404).json({ message: "Transaction not found" });
        const payload = parseTransactionPayload(req);
        if (!payload) return res.status(400).json({ message: "Transaction details are invalid" });
        const validation = await validateTransaction(payload, req.user.id, req.params.id);
        if (validation.error) return res.status(400).json({ message: validation.error });

        const categoryChanged = String(transaction.categoryId || "") !== String(validation.values.categoryId || "");
        if (transaction.type === "expense" && (categoryChanged || validation.values.type !== "expense")) {
            const existingCategoryTotals = await getExpenseCategoryTotals({
                userId: req.user.id,
                categoryId: transaction.categoryId,
                excludeId: transaction._id
            });
            if (existingCategoryTotals.refunds > existingCategoryTotals.expenses) {
                return res.status(409).json({ message: "This expense has refunds recorded against its category and cannot be moved" });
            }
        }

        Object.assign(transaction, validation.values);
        if (req.body.removeReceipt === "true") transaction.receipt = undefined;
        attachReceipt(transaction, req.file);
        await transaction.save();

        const result = await expenseTransactionModel.findById(transaction._id)
            .select("-receipt.data").populate("categoryId", "name type").lean();
        return res.status(200).json({ message: "Transaction updated", transaction: result });
    } catch (error) {
        if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
        console.error("Update expense transaction error:", error);
        return res.status(500).json({ message: "Could not update transaction" });
    }
};

export const deleteExpenseTransaction = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid transaction ID" });
        const transaction = await expenseTransactionModel.findOne({
            _id: req.params.id,
            userId: req.user.id
        });
        if (!transaction) return res.status(404).json({ message: "Transaction not found" });
        if (transaction.type === "expense") {
            const categoryTotals = await getExpenseCategoryTotals({
                userId: req.user.id,
                categoryId: transaction.categoryId,
                excludeId: transaction._id
            });
            if (categoryTotals.refunds > categoryTotals.expenses) {
                return res.status(409).json({ message: "This expense has refunds recorded against its category and cannot be deleted" });
            }
        }
        await transaction.deleteOne();
        return res.status(200).json({ message: "Transaction deleted" });
    } catch (error) {
        console.error("Delete expense transaction error:", error);
        return res.status(500).json({ message: "Could not delete transaction" });
    }
};

export const getExpenseReceipt = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid transaction ID" });
        const transaction = await expenseTransactionModel.findOne({
            _id: req.params.id,
            userId: req.user.id
        }).select("receipt");
        if (!transaction?.receipt?.data) return res.status(404).json({ message: "No receipt is attached" });

        res.set("Content-Type", transaction.receipt.contentType);
        const safeFileName = transaction.receipt.fileName.replace(/[^\w .()-]/g, "_").slice(0, 255);
        res.set("Content-Disposition", `inline; filename="${safeFileName}"`);
        res.set("X-Content-Type-Options", "nosniff");
        return res.send(transaction.receipt.data);
    } catch (error) {
        console.error("Get expense receipt error:", error);
        return res.status(500).json({ message: "Could not load receipt" });
    }
};

export const getExpenseDashboard = async (req, res) => {
    try {
        await seedExpenseCategories(req.user.id);
        const now = new Date();
        const calendar = getExpenseCalendarParts(now);
        const todayStart = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day));
        const monthStart = new Date(Date.UTC(calendar.year, calendar.month - 1, 1));
        const startOfNextMonth = new Date(Date.UTC(calendar.year, calendar.month, 1));
        const month30Start = new Date(todayStart.getTime() - 29 * DAY_MS);
        const twelveMonthStart = new Date(Date.UTC(calendar.year, calendar.month - 12, 1));
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const [allTimeRow, todayRow, monthRow, dailyRows, monthlyRows, categoryRows, recent] = await Promise.all([
            expenseTransactionModel.aggregate(summaryStages({ userId })),
            expenseTransactionModel.aggregate(summaryStages({ userId, transactionDate: { $gte: todayStart, $lt: new Date(todayStart.getTime() + DAY_MS) } })),
            expenseTransactionModel.aggregate(summaryStages({ userId, transactionDate: { $gte: monthStart, $lt: startOfNextMonth } })),
            expenseTransactionModel.aggregate([
                { $match: { userId, transactionDate: { $gte: month30Start, $lt: new Date(todayStart.getTime() + DAY_MS) } } },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$transactionDate", timezone: "UTC" } },
                    expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
                    refunds: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } },
                    income: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
                    investments: { $sum: { $cond: [{ $eq: ["$type", "investment"] }, "$amount", 0] } }
                } },
                { $sort: { _id: 1 } }
            ]),
            expenseTransactionModel.aggregate([
                { $match: { userId, transactionDate: { $gte: twelveMonthStart } } },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$transactionDate", timezone: "UTC" } },
                    expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
                    refunds: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } },
                    income: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
                    investments: { $sum: { $cond: [{ $eq: ["$type", "investment"] }, "$amount", 0] } }
                } },
                { $sort: { _id: 1 } }
            ]),
            expenseTransactionModel.aggregate([
                { $match: { userId, transactionDate: { $gte: monthStart, $lt: startOfNextMonth }, type: { $in: ["expense", "refund"] } } },
                { $group: {
                    _id: "$categoryId",
                    expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", { $multiply: ["$amount", -1] }] } }
                } },
                { $sort: { expenses: -1 } }
            ]),
            expenseTransactionModel.find({ userId })
                .select("-receipt.data")
                .populate("categoryId", "name type")
                .sort({ transactionDate: -1, _id: -1 })
                .limit(8)
                .lean()
        ]);

        const allTime = toNetTotals(aggregateSummary(allTimeRow));
        const today = toNetTotals(aggregateSummary(todayRow));
        const thisMonth = toNetTotals(aggregateSummary(monthRow));
        const categories = await expenseCategoryModel.find({
            _id: { $in: categoryRows.map((row) => row._id).filter(Boolean) },
            userId
        }).select("name type").lean();
        const categoryById = new Map(categories.map((category) => [String(category._id), category]));
        const byDay = new Map(dailyRows.map((row) => [row._id, row]));
        const daily = Array.from({ length: 30 }, (_, index) => {
            const date = new Date(month30Start.getTime() + index * DAY_MS);
            const key = date.toISOString().slice(0, 10);
            const row = byDay.get(key) || {};
            return {
                date: key,
                expenses: roundMoney((row.expenses || 0) - (row.refunds || 0)),
                income: roundMoney(row.income || 0),
                investments: roundMoney(row.investments || 0)
            };
        });
        const byMonth = new Map(monthlyRows.map((row) => [row._id, row]));
        const monthly = Array.from({ length: 12 }, (_, index) => {
            const date = new Date(Date.UTC(calendar.year, calendar.month - 12 + index, 1));
            const key = date.toISOString().slice(0, 7);
            const row = byMonth.get(key) || {};
            return {
                month: key,
                expenses: roundMoney((row.expenses || 0) - (row.refunds || 0)),
                income: roundMoney(row.income || 0),
                investments: roundMoney(row.investments || 0)
            };
        });
        const categoryBreakdown = categoryRows.map((row) => ({
            categoryId: row._id,
            name: categoryById.get(String(row._id))?.name || "Uncategorized",
            amount: roundMoney(row.expenses)
        })).filter((row) => row.amount > 0);

        return res.status(200).json({
            totals: {
                expensesToday: today.expenses,
                expensesThisMonth: thisMonth.expenses,
                totalInvestments: allTime.investments,
                totalIncome: allTime.income,
                totalBalance: allTime.netCashFlow,
                totalTransactions: allTime.transactions
            },
            daily,
            monthly,
            categoryBreakdown,
            topCategories: categoryBreakdown.slice(0, 5),
            recent
        });
    } catch (error) {
        console.error("Get expense dashboard error:", error);
        return res.status(500).json({ message: "Could not load expense dashboard" });
    }
};

export const getExpenseReport = async (req, res) => {
    try {
        const from = parseDate(String(req.query.from || ""));
        const to = parseDate(String(req.query.to || ""));
        if (!from || !to || from > to) return res.status(400).json({ message: "Choose a valid report date range" });

        const match = reportMatch(new mongoose.Types.ObjectId(req.user.id), from, to);
        const [totalsRows, dailyRows, monthlyRows, categoryRows] = await Promise.all([
            expenseTransactionModel.aggregate(summaryStages(match)),
            expenseTransactionModel.aggregate([
                { $match: match },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$transactionDate", timezone: "UTC" } },
                    expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
                    refunds: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } },
                    income: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
                    investments: { $sum: { $cond: [{ $eq: ["$type", "investment"] }, "$amount", 0] } }
                } },
                { $sort: { _id: 1 } }
            ]),
            expenseTransactionModel.aggregate([
                { $match: match },
                { $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$transactionDate", timezone: "UTC" } },
                    expenses: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", 0] } },
                    refunds: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } },
                    income: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", 0] } },
                    investments: { $sum: { $cond: [{ $eq: ["$type", "investment"] }, "$amount", 0] } }
                } },
                { $sort: { _id: 1 } }
            ]),
            expenseTransactionModel.aggregate([
                { $match: { ...match, type: { $in: ["expense", "refund"] } } },
                { $group: {
                    _id: "$categoryId",
                    amount: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", { $multiply: ["$amount", -1] }] } }
                } },
                { $sort: { amount: -1 } }
            ])
        ]);
        const totals = toNetTotals(aggregateSummary(totalsRows));
        const categories = await expenseCategoryModel.find({
            _id: { $in: categoryRows.map((row) => row._id).filter(Boolean) },
            userId: req.user.id
        }).select("name").lean();
        const names = new Map(categories.map((category) => [String(category._id), category.name]));

        return res.status(200).json({
            from: req.query.from,
            to: req.query.to,
            totals: {
                ...totals,
                netCashFlow: totals.netCashFlow
            },
            daily: dailyRows.map((row) => ({
                date: row._id,
                expenses: roundMoney(row.expenses - row.refunds),
                income: roundMoney(row.income),
                investments: roundMoney(row.investments)
            })),
            monthly: monthlyRows.map((row) => ({
                month: row._id,
                expenses: roundMoney(row.expenses - row.refunds),
                income: roundMoney(row.income),
                investments: roundMoney(row.investments)
            })),
            categories: categoryRows.map((row) => ({
                name: names.get(String(row._id)) || "Uncategorized",
                amount: roundMoney(row.amount)
            })).filter((row) => row.amount !== 0)
        });
    } catch (error) {
        console.error("Get expense report error:", error);
        return res.status(500).json({ message: "Could not create expense report" });
    }
};

export const exportExpenseReport = async (req, res) => {
    try {
        const from = parseDate(String(req.query.from || ""));
        const to = parseDate(String(req.query.to || ""));
        if (!from || !to || from > to) return res.status(400).json({ message: "Choose a valid export date range" });
        const transactions = await expenseTransactionModel.find(reportMatch(req.user.id, from, to))
            .select("-receipt.data")
            .populate("categoryId", "name")
            .sort({ transactionDate: -1 })
            .lean();
        const quote = (value) => {
            const text = String(value ?? "");
            const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
            return `"${safeText.replace(/"/g, '""')}"`;
        };
        const rows = [
            ["Date", "Title", "Type", "Category", "Payment Method", "Amount", "Notes"].map(quote).join(","),
            ...transactions.map((transaction) => [
                new Date(transaction.transactionDate).toISOString().slice(0, 10),
                transaction.title,
                transaction.type,
                transaction.categoryId?.name || "",
                transaction.paymentMethod,
                transaction.amount,
                transaction.description
            ].map(quote).join(","))
        ];
        res.set("Content-Type", "text/csv; charset=utf-8");
        res.set("Content-Disposition", `attachment; filename="expense-report-${req.query.from}-to-${req.query.to}.csv"`);
        return res.send(`\uFEFF${rows.join("\r\n")}`);
    } catch (error) {
        console.error("Export expense report error:", error);
        return res.status(500).json({ message: "Could not export expense report" });
    }
};
