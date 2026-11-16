import mongoose from "mongoose";
import recurringExpenseModel from "../model/recurringExpense.js";
import { parseDate, RECURRING_FREQUENCIES, validateCategory } from "../services/expenseService.js";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"];
const RECURRING_TYPES = ["expense", "income", "investment"];

const validateRule = async (body, userId) => {
    const title = String(body.title || "").trim();
    const type = String(body.type || "");
    const amount = Number(body.amount);
    const paymentMethod = String(body.paymentMethod || "");
    const frequency = String(body.frequency || "");
    const startDate = parseDate(body.startDate);
    const endDate = body.endDate ? parseDate(body.endDate) : null;
    const description = String(body.description || "").trim();

    if (!title || title.length > 120) return { error: "Enter a title (up to 120 characters)" };
    if (!RECURRING_TYPES.includes(type)) return { error: "Recurring transactions must be expenses, income, or investments" };
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.round(amount * 100) / 100 !== amount) {
        return { error: "Enter a valid amount with no more than two decimal places" };
    }
    if (!PAYMENT_METHODS.includes(paymentMethod)) return { error: "Choose a valid payment method" };
    if (!RECURRING_FREQUENCIES.includes(frequency)) return { error: "Choose a valid frequency" };
    if (!startDate || (body.endDate && !endDate) || (endDate && endDate < startDate)) {
        return { error: "Choose a valid start and end date" };
    }
    if (description.length > 2000) return { error: "Notes must be 2000 characters or fewer" };

    const categoryResult = await validateCategory({
        userId,
        categoryId: body.categoryId,
        type,
        required: true
    });
    if (categoryResult.error) return categoryResult;

    return {
        values: {
            title,
            type,
            amount: Math.round(amount * 100) / 100,
            categoryId: categoryResult.category._id,
            paymentMethod,
            frequency,
            startDate,
            endDate,
            description
        }
    };
};

export const getRecurringExpenses = async (req, res) => {
    try {
        const rules = await recurringExpenseModel.find({ userId: req.user.id })
            .populate("categoryId", "name type")
            .sort({ active: -1, nextRunDate: 1 })
            .lean();
        return res.status(200).json({ rules });
    } catch (error) {
        console.error("Get recurring expenses error:", error);
        return res.status(500).json({ message: "Could not load recurring transactions" });
    }
};

export const createRecurringExpense = async (req, res) => {
    try {
        const validation = await validateRule(req.body, req.user.id);
        if (validation.error) return res.status(400).json({ message: validation.error });
        const rule = await recurringExpenseModel.create({
            userId: req.user.id,
            ...validation.values,
            nextRunDate: validation.values.startDate,
            active: true
        });
        return res.status(201).json({ message: "Recurring transaction created", rule });
    } catch (error) {
        console.error("Create recurring expense error:", error);
        return res.status(500).json({ message: "Could not create recurring transaction" });
    }
};

export const updateRecurringExpense = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid recurring transaction ID" });
        const existing = await recurringExpenseModel.findOne({ _id: req.params.id, userId: req.user.id });
        if (!existing) return res.status(404).json({ message: "Recurring transaction not found" });

        if (typeof req.body.active === "boolean" && Object.keys(req.body).length === 1) {
            existing.active = req.body.active;
            if (existing.active && existing.nextRunDate < new Date() && existing.endDate && existing.endDate < new Date()) {
                existing.active = false;
                return res.status(400).json({ message: "This recurring transaction has passed its end date" });
            }
            await existing.save();
            return res.status(200).json({ message: "Recurring transaction updated", rule: existing });
        }

        const validation = await validateRule(req.body, req.user.id);
        if (validation.error) return res.status(400).json({ message: validation.error });
        const startChanged = existing.startDate.toISOString().slice(0, 10) !== validation.values.startDate.toISOString().slice(0, 10);
        Object.assign(existing, validation.values);
        if (startChanged) existing.nextRunDate = validation.values.startDate;
        await existing.save();
        return res.status(200).json({ message: "Recurring transaction updated", rule: existing });
    } catch (error) {
        console.error("Update recurring expense error:", error);
        return res.status(500).json({ message: "Could not update recurring transaction" });
    }
};

export const deleteRecurringExpense = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid recurring transaction ID" });
        const deleted = await recurringExpenseModel.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        if (!deleted) return res.status(404).json({ message: "Recurring transaction not found" });
        return res.status(200).json({ message: "Recurring transaction deleted; existing transactions were kept" });
    } catch (error) {
        console.error("Delete recurring expense error:", error);
        return res.status(500).json({ message: "Could not delete recurring transaction" });
    }
};
