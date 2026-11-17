import mongoose from "mongoose";
import leadConversionModel from "../model/leadConversion.js";
import expenseCategoryModel from "../model/expenseCategory.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { parseDate, validObjectId } from "../services/leadService.js";
import { roundMoney, seedExpenseCategories } from "../services/expenseService.js";
import { withTransaction } from "../services/dbSession.js";

const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Credit Card", "Debit Card", "Other"];

const saveConfirmedIncome = async ({ conversion, userId, payload, eventKey, session = null }) => {
    const amount = Number(payload.amount);
    const transactionDate = parseDate(payload.transactionDate);
    const paymentMethod = String(payload.paymentMethod || "");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || roundMoney(amount) !== amount) {
        const error = new Error("Enter a confirmed payment amount with up to two decimal places");
        error.status = 400;
        throw error;
    }
    if (!transactionDate) {
        const error = new Error("Choose a valid payment date");
        error.status = 400;
        throw error;
    }
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
        const error = new Error("Choose a valid payment method");
        error.status = 400;
        throw error;
    }

    const totalQuery = expenseTransactionModel.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), sourceConversionId: conversion._id } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    if (session) totalQuery.session(session);
    const totalRows = await totalQuery;
    const alreadyRecorded = totalRows[0]?.total || 0;
    if (roundMoney(alreadyRecorded + amount) > conversion.finalDealAmount) {
        const error = new Error("This payment exceeds the remaining converted deal amount");
        error.status = 409;
        throw error;
    }

    const updateQuery = leadConversionModel.updateOne(
        {
            _id: conversion._id,
            userId,
            $expr: {
                $lte: [
                    { $add: [{ $ifNull: ["$incomeRecordedAmount", 0] }, amount] },
                    "$finalDealAmount"
                ]
            }
        },
        { $inc: { incomeRecordedAmount: amount } },
        session ? { session } : {}
    );
    const updated = await updateQuery;
    if (!updated.modifiedCount && !updated.nModified) {
        const error = new Error("This payment exceeds the remaining converted deal amount");
        error.status = 409;
        throw error;
    }

    try {
        const categoryQuery = expenseCategoryModel.findOne({
            userId, type: "income", normalizedName: "sales"
        }).select("_id");
        if (session) categoryQuery.session(session);
        const category = await categoryQuery;
        const description = `CRM conversion ${conversion.referenceId}`;
        const transaction = new expenseTransactionModel({
            userId,
            title: `Confirmed CRM payment · ${conversion.referenceId}`,
            type: "income",
            amount: roundMoney(amount),
            categoryId: category?._id || null,
            paymentMethod,
            transactionDate,
            description,
            sourceConversionId: conversion._id,
            sourceEventKey: eventKey
        });
        await transaction.save(session ? { session } : {});
        return transaction;
    } catch (error) {
        if (!session) {
            await leadConversionModel.updateOne(
                { _id: conversion._id, userId },
                { $inc: { incomeRecordedAmount: -amount } }
            );
        }
        throw error;
    }
};

export const recordLeadIncome = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const requestedKey = String(req.body.eventKey || "");
        if (!/^[A-Za-z0-9._:-]{8,80}$/.test(requestedKey)) {
            return res.status(400).json({ message: "A valid payment submission key is required" });
        }
        const conversion = await leadConversionModel.findOne({
            leadId: req.params.id, userId: req.user.id
        });
        if (!conversion) return res.status(404).json({ message: "Lead conversion not found" });
        const eventKey = `${conversion._id}:${requestedKey}`;
        const existing = await expenseTransactionModel.findOne({
            userId: req.user.id, sourceEventKey: eventKey
        }).lean();
        if (existing) return res.status(200).json({ transaction: existing, duplicateSubmission: true });

        await seedExpenseCategories(req.user.id);
        const transaction = await withTransaction(async (session) => {
            const currentConversion = await leadConversionModel.findOne({
                _id: conversion._id, userId: req.user.id
            }).session(session);
            return saveConfirmedIncome({
                conversion: currentConversion,
                userId: req.user.id,
                payload: req.body,
                eventKey,
                session
            });
        }, {
            fallback: async () => saveConfirmedIncome({
                conversion,
                userId: req.user.id,
                payload: req.body,
                eventKey
            })
        });
        return res.status(201).json({ transaction });
    } catch (error) {
        if (error?.code === 11000) {
            const eventKey = String(req.body.eventKey || "");
            const conversion = await leadConversionModel.findOne({
                leadId: req.params.id, userId: req.user.id
            }).select("_id");
            const existing = conversion && await expenseTransactionModel.findOne({
                userId: req.user.id,
                sourceEventKey: `${conversion._id}:${eventKey}`
            }).lean();
            if (existing) return res.status(200).json({ transaction: existing, duplicateSubmission: true });
            return res.status(409).json({ message: "This payment submission conflicts with an existing transaction" });
        }
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("Record confirmed lead income error:", error);
        return res.status(500).json({ message: "Could not record confirmed income" });
    }
};
