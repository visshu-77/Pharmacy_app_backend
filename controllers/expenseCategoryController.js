import mongoose from "mongoose";
import expenseCategoryModel from "../model/expenseCategory.js";
import expenseRecurringModel from "../model/recurringExpense.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { seedExpenseCategories } from "../services/expenseService.js";

const CATEGORY_TYPES = ["expense", "investment", "income"];

const parseCategory = (body) => {
    const name = String(body.name || "").trim();
    const type = String(body.type || "");
    if (!name || name.length > 60) return { error: "Enter a category name (up to 60 characters)" };
    if (!CATEGORY_TYPES.includes(type)) return { error: "Choose a valid category type" };
    return { name, type, normalizedName: name.toLowerCase() };
};

export const getExpenseCategories = async (req, res) => {
    try {
        await seedExpenseCategories(req.user.id);
        const categories = await expenseCategoryModel.find({ userId: req.user.id })
            .sort({ type: 1, name: 1 })
            .lean();
        return res.status(200).json({ categories });
    } catch (error) {
        console.error("Get expense categories error:", error);
        return res.status(500).json({ message: "Could not load categories" });
    }
};

export const createExpenseCategory = async (req, res) => {
    try {
        const values = parseCategory(req.body);
        if (values.error) return res.status(400).json({ message: values.error });
        const category = await expenseCategoryModel.create({
            userId: req.user.id,
            ...values,
            isDefault: false
        });
        return res.status(201).json({ message: "Category added", category });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "That category already exists" });
        console.error("Create expense category error:", error);
        return res.status(500).json({ message: "Could not add category" });
    }
};

export const updateExpenseCategory = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid category ID" });
        const values = parseCategory(req.body);
        if (values.error) return res.status(400).json({ message: values.error });
        const existing = await expenseCategoryModel.findOne({ _id: req.params.id, userId: req.user.id });
        if (!existing) return res.status(404).json({ message: "Category not found" });
        if (existing.type !== values.type) {
            const [transactionCount, recurringCount] = await Promise.all([
                expenseTransactionModel.countDocuments({ userId: req.user.id, categoryId: existing._id }),
                expenseRecurringModel.countDocuments({ userId: req.user.id, categoryId: existing._id })
            ]);
            if (transactionCount || recurringCount) {
                return res.status(409).json({ message: "A category's type cannot be changed while it is in use" });
            }
        }
        const category = await expenseCategoryModel.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: values },
            { new: true, runValidators: true }
        );
        if (!category) return res.status(404).json({ message: "Category not found" });
        return res.status(200).json({ message: "Category updated", category });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "That category already exists" });
        console.error("Update expense category error:", error);
        return res.status(500).json({ message: "Could not update category" });
    }
};

export const deleteExpenseCategory = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: "Invalid category ID" });
        const category = await expenseCategoryModel.findOne({ _id: req.params.id, userId: req.user.id });
        if (!category) return res.status(404).json({ message: "Category not found" });

        const [transactionCount, recurringCount] = await Promise.all([
            expenseTransactionModel.countDocuments({ userId: req.user.id, categoryId: category._id }),
            expenseRecurringModel.countDocuments({ userId: req.user.id, categoryId: category._id })
        ]);
        if (transactionCount || recurringCount) {
            return res.status(409).json({ message: "This category is used by transactions or recurring rules and cannot be deleted" });
        }

        await category.deleteOne();
        return res.status(200).json({ message: "Category deleted" });
    } catch (error) {
        console.error("Delete expense category error:", error);
        return res.status(500).json({ message: "Could not delete category" });
    }
};
