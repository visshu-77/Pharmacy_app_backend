import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadConversionModel from "../model/leadConversion.js";
import {
    createLeadNotification,
    recordLeadActivity
} from "../services/leadActivityService.js";
import { parseDate, validObjectId } from "../services/leadService.js";
import { withTransaction } from "../services/dbSession.js";
import { importLegacyLeadFollowUps } from "./leadFollowUpController.js";
import { getLeadSettings } from "../services/leadSettingsService.js";

const text = (value) => String(value ?? "").trim();

export const convertLead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        await importLegacyLeadFollowUps(req.user);
        const finalDealAmount = Number(req.body.finalDealAmount);
        const conversionDate = parseDate(req.body.conversionDate);
        const notes = text(req.body.notes);
        const responsibleEmployee = text(req.body.responsibleEmployee);
        if (!Number.isFinite(finalDealAmount) || finalDealAmount < 0 || finalDealAmount > 10000000000 || Math.round(finalDealAmount * 100) / 100 !== finalDealAmount) {
            return res.status(400).json({ message: "Enter a valid final deal amount with up to two decimal places" });
        }
        if (!conversionDate) return res.status(400).json({ message: "Choose a valid conversion date" });
        if (notes.length > 2000) return res.status(400).json({ message: "Conversion notes must be 2000 characters or fewer" });

        const conversionData = {
            userId: req.user.id,
            leadId: req.params.id,
            referenceId: `CNV-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`,
            finalDealAmount,
            conversionDate,
            notes
        };
        let result;
        try {
            result = await withTransaction(async (session) => {
                const lead = await leadModel.findOne({
                    _id: req.params.id, userId: req.user.id, isMerged: { $ne: true }
                }).session(session);
                if (!lead) {
                    const error = new Error("Lead not found");
                    error.status = 404;
                    throw error;
                }
                const [previousStatus, convertedStatus, existingConversion] = await Promise.all([
                    leadStatusModel.findOne({ _id: lead.statusId, userId: req.user.id }).session(session),
                    leadStatusModel.findOne({ userId: req.user.id, systemKey: "converted_won", active: true }).session(session),
                    leadConversionModel.findOne({ userId: req.user.id, leadId: lead._id }).session(session)
                ]);
                if (existingConversion || previousStatus?.systemKey === "converted_won") {
                    const error = new Error("This lead has already been converted");
                    error.status = 409;
                    throw error;
                }
                if (previousStatus?.systemKey === "lost") {
                    const error = new Error("A lost lead must be reopened before it can be converted");
                    error.status = 409;
                    throw error;
                }
                if (!convertedStatus) {
                    const error = new Error("The Converted / Won status is unavailable");
                    error.status = 400;
                    throw error;
                }
                const employee = responsibleEmployee || lead.assignedEmployee;
                if (!employee) {
                    const error = new Error("Enter a responsible employee");
                    error.status = 400;
                    throw error;
                }
                if (employee.length > 120) {
                    const error = new Error("Responsible employee must be 120 characters or fewer");
                    error.status = 400;
                    throw error;
                }

                const conversion = new leadConversionModel({ ...conversionData, responsibleEmployee: employee });
                await conversion.save({ session });
                const previousStatusName = lead.statusName;
                lead.statusId = convertedStatus._id;
                lead.statusName = convertedStatus.name;
                lead.statusColor = convertedStatus.color;
                lead.convertedAt = conversionDate;
                lead.nextFollowUpAt = null;
                await lead.save({ session });
                await leadFollowUpModel.updateMany(
                    { userId: req.user.id, leadId: lead._id, status: "Pending" },
                    { $set: { status: "Cancelled" } },
                    { session }
                );
                await recordLeadActivity({
                    lead,
                    user: req.user,
                    type: "lead_converted",
                    message: `Lead converted (${conversion.referenceId})`,
                    description: `Final deal amount: ${finalDealAmount}. ${notes}`.trim(),
                    previousStatus: previousStatusName,
                    newStatus: convertedStatus.name,
                    session
                });
                return { lead, conversion };
            }, {
                fallback: async () => {
                    const lead = await leadModel.findOne({ _id: req.params.id, userId: req.user.id, isMerged: { $ne: true } });
                    if (!lead) {
                        const error = new Error("Lead not found");
                        error.status = 404;
                        throw error;
                    }
                    const [previousStatus, convertedStatus, existingConversion] = await Promise.all([
                        leadStatusModel.findOne({ _id: lead.statusId, userId: req.user.id }),
                        leadStatusModel.findOne({ userId: req.user.id, systemKey: "converted_won", active: true }),
                        leadConversionModel.findOne({ userId: req.user.id, leadId: lead._id })
                    ]);
                    if (existingConversion || previousStatus?.systemKey === "converted_won") {
                        const error = new Error("This lead has already been converted");
                        error.status = 409;
                        throw error;
                    }
                    if (previousStatus?.systemKey === "lost") {
                        const error = new Error("A lost lead must be reopened before it can be converted");
                        error.status = 409;
                        throw error;
                    }
                    if (!convertedStatus) {
                        const error = new Error("The Converted / Won status is unavailable");
                        error.status = 400;
                        throw error;
                    }
                    const employee = responsibleEmployee || lead.assignedEmployee;
                    if (!employee || employee.length > 120) {
                        const error = new Error(employee ? "Responsible employee must be 120 characters or fewer" : "Enter a responsible employee");
                        error.status = 400;
                        throw error;
                    }

                    const previous = {
                        statusId: lead.statusId,
                        statusName: lead.statusName,
                        statusColor: lead.statusColor,
                        convertedAt: lead.convertedAt,
                        nextFollowUpAt: lead.nextFollowUpAt
                    };
                    const conversion = await leadConversionModel.create({
                        ...conversionData,
                        responsibleEmployee: employee
                    });
                    try {
                        const previousStatusName = lead.statusName;
                        lead.statusId = convertedStatus._id;
                        lead.statusName = convertedStatus.name;
                        lead.statusColor = convertedStatus.color;
                        lead.convertedAt = conversionDate;
                        lead.nextFollowUpAt = null;
                        await lead.save();
                        await leadFollowUpModel.updateMany(
                            { userId: req.user.id, leadId: lead._id, status: "Pending" },
                            { $set: { status: "Cancelled" } }
                        );
                        await recordLeadActivity({
                            lead,
                            user: req.user,
                            type: "lead_converted",
                            message: `Lead converted (${conversion.referenceId})`,
                            description: `Final deal amount: ${finalDealAmount}. ${notes}`.trim(),
                            previousStatus: previousStatusName,
                            newStatus: convertedStatus.name
                        });
                        return { lead, conversion };
                    } catch (error) {
                        await leadConversionModel.deleteOne({ _id: conversion._id, userId: req.user.id });
                        await leadModel.updateOne({ _id: lead._id, userId: req.user.id }, { $set: previous });
                        throw error;
                    }
                }
            });
        } catch (error) {
            if (error?.code === 11000) return res.status(409).json({ message: "This lead has already been converted" });
            if (error.status) return res.status(error.status).json({ message: error.message });
            throw error;
        }

        await createLeadNotification({
            userId: req.user.id,
            leadId: result.lead._id,
            kind: "lead_converted",
            title: "Lead converted",
            message: `${result.lead.customerName} was converted (${result.conversion.referenceId}).`,
            eventKey: `lead:${result.lead._id}:converted`
        });
        return res.status(201).json(result);
    } catch (error) {
        console.error("Convert lead error:", error);
        return res.status(500).json({ message: "Could not convert lead" });
    }
};

export const markLeadLost = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        await importLegacyLeadFollowUps(req.user);
        const settings = await getLeadSettings(req.user.id);
        const reason = text(req.body.reason);
        const remarks = text(req.body.remarks);
        if (!settings.lostReasons.includes(reason)) return res.status(400).json({ message: "Choose a valid reason for marking the lead lost" });
        if (remarks.length > 2000) return res.status(400).json({ message: "Remarks must be 2000 characters or fewer" });

        const lead = await leadModel.findOne({
            _id: req.params.id, userId: req.user.id, isMerged: { $ne: true }
        });
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        const [currentStatus, lostStatus, conversion] = await Promise.all([
            leadStatusModel.findOne({ _id: lead.statusId, userId: req.user.id }),
            leadStatusModel.findOne({ userId: req.user.id, systemKey: "lost", active: true }),
            leadConversionModel.findOne({ userId: req.user.id, leadId: lead._id })
        ]);
        if (conversion || currentStatus?.systemKey === "converted_won") {
            return res.status(409).json({ message: "A converted lead cannot be marked lost" });
        }
        if (currentStatus?.systemKey === "lost") return res.status(409).json({ message: "This lead is already marked lost" });
        if (!lostStatus) return res.status(400).json({ message: "The Lost status is unavailable" });

        const prior = {
            statusId: lead.statusId,
            statusName: lead.statusName,
            statusColor: lead.statusColor,
            lostReason: lead.lostReason,
            lostRemarks: lead.lostRemarks,
            lostAt: lead.lostAt,
            nextFollowUpAt: lead.nextFollowUpAt
        };
        try {
            lead.statusId = lostStatus._id;
            lead.statusName = lostStatus.name;
            lead.statusColor = lostStatus.color;
            lead.lostReason = reason;
            lead.lostRemarks = remarks;
            lead.lostAt = new Date();
            lead.nextFollowUpAt = null;
            await lead.save();
            await leadFollowUpModel.updateMany(
                { userId: req.user.id, leadId: lead._id, status: "Pending" },
                { $set: { status: "Cancelled" } }
            );
            await recordLeadActivity({
                lead,
                user: req.user,
                type: "lead_lost",
                message: `Lead marked lost: ${reason}`,
                description: remarks,
                previousStatus: prior.statusName,
                newStatus: lostStatus.name
            });
        } catch (error) {
            await leadModel.updateOne({ _id: lead._id, userId: req.user.id }, { $set: prior });
            throw error;
        }
        await createLeadNotification({
            userId: req.user.id,
            leadId: lead._id,
            kind: "lead_lost",
            title: "Lead marked lost",
            message: `${lead.customerName} was marked lost: ${reason}.`,
            eventKey: `lead:${lead._id}:lost`
        });
        return res.status(200).json({ lead });
    } catch (error) {
        console.error("Mark lead lost error:", error);
        return res.status(500).json({ message: "Could not mark lead lost" });
    }
};

export const getLeadConversion = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const conversion = await leadConversionModel.findOne({
            leadId: req.params.id,
            userId: req.user.id
        }).lean();
        if (!conversion) return res.status(404).json({ message: "Conversion not found" });
        return res.status(200).json({ conversion });
    } catch (error) {
        console.error("Get lead conversion error:", error);
        return res.status(500).json({ message: "Could not load conversion details" });
    }
};

