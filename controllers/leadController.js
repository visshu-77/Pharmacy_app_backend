import mongoose from "mongoose";
import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import leadActivityModel from "../model/leadActivity.js";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadConversionModel from "../model/leadConversion.js";
import leadNotificationModel from "../model/leadNotification.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { createLeadNotification } from "../services/leadActivityService.js";
import { importLegacyLeadFollowUps } from "./leadFollowUpController.js";
import { buildLeadReportData } from "./leadReportController.js";
import {
    escapeRegex,
    parseDate,
    seedLeadStatuses,
    isCompletedStatus,
    validateCompletedAmounts,
    validObjectId,
    validateLeadPayload
} from "../services/leadService.js";

const PAGE_MAX = 100;
const userName = (user) => String(user.ownerName || user.name || user.email || "Account user").slice(0, 120);
const istDayStart = (date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric"
    }).formatToParts(date).map(({ type, value }) => [type, Number(value)]));
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - 330 * 60000);
};
const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
};
const sendError = (res, error, message) => {
    if (error?.code === 11000) return res.status(409).json({ message: "A status with that name already exists" });
    console.error(`${message}:`, error);
    return res.status(500).json({ message });
};

const createActivity = (lead, userId, type, message, extra = {}) => leadActivityModel.create({
    userId,
    leadId: lead._id,
    type,
    message,
    changedBy: extra.changedBy || "",
    changedByUserId: userId,
    previousStatus: extra.previousStatus || "",
    newStatus: extra.newStatus || ""
});

export const getLeadStatuses = async (req, res) => {
    try {
        await seedLeadStatuses(req.user.id);
        const statuses = await leadStatusModel.find({ userId: req.user.id })
            .sort({ order: 1, createdAt: 1 }).lean();
        return res.status(200).json({ statuses });
    } catch (error) {
        return sendError(res, error, "Could not load lead statuses");
    }
};

export const createLeadStatus = async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const color = String(req.body.color || "");
        if (!name || name.length > 40) return res.status(400).json({ message: "Status name is required (up to 40 characters)" });
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ message: "Choose a valid status color" });
        const order = req.body.order === undefined ? 99 : Number(req.body.order);
        if (!Number.isInteger(order) || order < 0 || order > 999) {
            return res.status(400).json({ message: "Status order must be from 0 to 999" });
        }
        const status = await leadStatusModel.create({
            userId: req.user.id, name, color, order, active: true
        });
        return res.status(201).json({ status });
    } catch (error) {
        return sendError(res, error, "Could not create lead status");
    }
};

export const updateLeadStatus = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid status ID" });
        const status = await leadStatusModel.findOne({ _id: req.params.id, userId: req.user.id });
        if (!status) return res.status(404).json({ message: "Lead status not found" });
        if (status.systemKey === "completed" && req.body.active === false) {
            return res.status(400).json({ message: "The Completed status must remain active" });
        }
        const update = {};
        if (req.body.name !== undefined) {
            const name = String(req.body.name).trim();
            if (!name || name.length > 40) return res.status(400).json({ message: "Status name is required (up to 40 characters)" });
            update.name = name;
        }
        if (req.body.color !== undefined) {
            const color = String(req.body.color);
            if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ message: "Choose a valid status color" });
            update.color = color;
        }
        if (req.body.order !== undefined) {
            const order = Number(req.body.order);
            if (!Number.isInteger(order) || order < 0 || order > 999) return res.status(400).json({ message: "Status order must be from 0 to 999" });
            update.order = order;
        }
        if (req.body.active !== undefined) {
            if (typeof req.body.active !== "boolean") return res.status(400).json({ message: "Status active must be true or false" });
            update.active = req.body.active;
        }

        Object.assign(status, update);
        await status.save();
        if (update.name || update.color) {
            await leadModel.updateMany(
                { userId: req.user.id, statusId: status._id },
                { $set: { statusName: status.name, statusColor: status.color } }
            );
        }
        return res.status(200).json({ status });
    } catch (error) {
        return sendError(res, error, "Could not update lead status");
    }
};

export const getLeadDashboard = async (req, res) => {
    try {
        await seedLeadStatuses(req.user.id);
        await importLegacyLeadFollowUps(req.user);
        const report = await buildLeadReportData(req.user.id, req.query);
        if (report.error) return res.status(400).json({ message: report.error });
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const todayStart = istDayStart(new Date());
        const tomorrowStart = new Date(todayStart.getTime() + 86400000);
        const [recentLeads, todayFollowUps, overdueFollowUps] = await Promise.all([
            leadModel.find({ userId, isMerged: { $ne: true } })
                .sort({ createdAt: -1 }).limit(6)
                .select("customerName title source statusName statusColor priority assignedEmployee leadDate createdAt")
                .lean(),
            leadFollowUpModel.countDocuments({
                userId, status: "Pending", scheduledAt: { $gte: todayStart, $lt: tomorrowStart }
            }),
            leadFollowUpModel.countDocuments({
                userId, status: "Pending", scheduledAt: { $lt: todayStart }
            })
        ]);
        return res.status(200).json({
            ...report,
            summary: {
                ...report.summary,
                todayFollowUps,
                overdueFollowUps,
                total: report.summary.totalLeads,
                converted: report.summary.convertedLeads,
                lost: report.summary.lostLeads,
            },
            statusDistribution: report.statusReports.map((item) => ({
                name: item.status, count: item.count, color: item.color
            })),
            recentLeads,
            monthlyLeads: report.monthlyLeadGeneration.map((item) => ({
                month: item._id, count: item.count
            }))
        });
    } catch (error) {
        return sendError(res, error, "Could not load CRM dashboard");
    }
};

const buildLeadFilter = (req, res) => {
    const filter = { userId: req.user.id, isMerged: { $ne: true } };
    const { search, statusId, source, priority, category, assignedEmployee, from, to } = req.query;
    if (search) {
        const term = String(search).trim().slice(0, 120);
        const regex = new RegExp(escapeRegex(term), "i");
        filter.$or = [
            { customerName: regex }, { mobileNumber: regex }, { email: regex },
            { title: regex }, { source: regex }, { assignedEmployee: regex }
        ];
        if (validObjectId(term)) filter.$or.push({ _id: term });
    }
    if (statusId) {
        if (!validObjectId(statusId)) return { error: "Invalid status filter" };
        filter.statusId = statusId;
    }
    if (source) filter.source = String(source).slice(0, 60);
    if (priority) filter.priority = String(priority).slice(0, 60);
    if (category) filter.category = String(category).slice(0, 60);
    if (assignedEmployee) filter.assignedEmployee = String(assignedEmployee).slice(0, 120);
    if (from || to) {
        const start = from ? parseDate(from) : new Date(0);
        const endDate = to ? parseDate(to) : new Date();
        if (!start || !endDate || start > endDate) return { error: "Choose a valid date range" };
        const endExclusive = new Date(Date.UTC(
            endDate.getUTCFullYear(),
            endDate.getUTCMonth(),
            endDate.getUTCDate() + 1
        ));
        filter.leadDate = { $gte: start, $lt: endExclusive };
    }
    return { filter };
};

export const getLeads = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const { filter, error } = buildLeadFilter(req, res);
        if (error) return res.status(400).json({ message: error });
        const sorts = {
            newest: { leadDate: -1, _id: -1 },
            oldest: { leadDate: 1, _id: 1 },
            name: { customerName: 1, _id: 1 },
            priority: { priority: -1, leadDate: -1 }
        };
        const sort = sorts[req.query.sort] || sorts.newest;
        const [leads, total] = await Promise.all([
            leadModel.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
            leadModel.countDocuments(filter)
        ]);
        return res.status(200).json({ leads, page, limit, total, hasMore: page * limit < total });
    } catch (error) {
        return sendError(res, error, "Could not load leads");
    }
};

export const createLead = async (req, res) => {
    try {
        await seedLeadStatuses(req.user.id);
        const result = await validateLeadPayload(req.body, req.user.id);
        if (result.error) return res.status(400).json({ message: result.error });
        if (["converted_won", "lost"].includes(result.status.systemKey)) {
            return res.status(400).json({ message: "Create a lead in an active pipeline status, then use the conversion or lost action" });
        }
        const lead = await leadModel.create({ userId: req.user.id, ...result.values });
        await createActivity(lead, req.user.id, "created", "Lead created", { changedBy: userName(req.user) });
        if (lead.assignedEmployee) {
            await createLeadNotification({
                userId: req.user.id,
                leadId: lead._id,
                kind: "lead_assigned",
                title: "New lead assigned",
                message: `${lead.customerName} was assigned to ${lead.assignedEmployee}.`,
                eventKey: `lead:${lead._id}:assigned`
            });
        }
        return res.status(201).json({ lead });
    } catch (error) {
        return sendError(res, error, "Could not create lead");
    }
};

export const getLead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const [lead, activities, followUps, conversion, mergedSources] = await Promise.all([
            leadModel.findOne({ _id: req.params.id, userId: req.user.id }).lean(),
            leadActivityModel.find({ leadId: req.params.id, userId: req.user.id }).sort({ createdAt: -1 }).lean(),
            leadFollowUpModel.find({ leadId: req.params.id, userId: req.user.id }).sort({ scheduledAt: -1 }).lean(),
            leadConversionModel.findOne({ leadId: req.params.id, userId: req.user.id }).lean(),
            leadModel.find({ userId: req.user.id, isMerged: true, mergedInto: req.params.id })
                .select("customerName mobileNumber email mergedAt").sort({ mergedAt: -1 }).lean()
        ]);
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        const recordedIncome = conversion
            ? await expenseTransactionModel.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(req.user.id), sourceConversionId: conversion._id } },
                { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
            ])
            : [];
        return res.status(200).json({
            lead, activities, followUps, conversion, mergedSources,
            recordedIncome: recordedIncome[0] || { total: 0, count: 0 }
        });
    } catch (error) {
        return sendError(res, error, "Could not load lead details");
    }
};

export const updateLead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const existing = await leadModel.findOne({
            _id: req.params.id, userId: req.user.id, isMerged: { $ne: true }
        });
        if (!existing) return res.status(404).json({ message: "Lead not found" });
        const result = await validateLeadPayload(req.body, req.user.id, existing.statusId);
        if (result.error) return res.status(400).json({ message: result.error });
        const previousStatus = existing.statusName;
        const previousAssignee = existing.assignedEmployee;
        const statusChanged = String(existing.statusId) !== String(result.values.statusId);
        if (statusChanged && ["converted_won", "lost"].includes(result.status.systemKey)) {
            return res.status(400).json({ message: "Use the conversion or lost action to set a terminal lead status" });
        }
        const [currentStatus, conversion] = await Promise.all([
            leadStatusModel.findOne({ _id: existing.statusId, userId: req.user.id }),
            leadConversionModel.findOne({ leadId: existing._id, userId: req.user.id })
        ]);
        if (statusChanged && (conversion || ["converted_won", "lost"].includes(currentStatus?.systemKey))) {
            return res.status(409).json({ message: "This lead is in a terminal outcome and must be reopened before changing status" });
        }
        Object.assign(existing, result.values);
        await existing.save();
        await createActivity(existing, req.user.id, "updated", "Lead details updated", { changedBy: userName(req.user) });
        if (previousAssignee !== result.values.assignedEmployee) {
            await createActivity(existing, req.user.id, "employee_reassigned",
                result.values.assignedEmployee
                    ? `Lead assigned to ${result.values.assignedEmployee}`
                    : "Lead assignment cleared",
                { changedBy: userName(req.user) });
            if (result.values.assignedEmployee) {
                await createLeadNotification({
                    userId: req.user.id,
                    leadId: existing._id,
                    kind: previousAssignee ? "lead_reassigned" : "lead_assigned",
                    title: previousAssignee ? "Lead reassigned" : "Lead assigned",
                    message: `${existing.customerName} was assigned to ${result.values.assignedEmployee}.`,
                    eventKey: `lead:${existing._id}:assigned:${Date.now()}`
                });
            }
        }
        if (statusChanged) {
            await createActivity(existing, req.user.id, "status_changed", `Status changed from ${previousStatus} to ${existing.statusName}`, {
                changedBy: userName(req.user), previousStatus, newStatus: existing.statusName
            });
        }
        return res.status(200).json({ lead: existing });
    } catch (error) {
        return sendError(res, error, "Could not update lead");
    }
};

export const changeLeadStatus = async (req, res) => {
    try {
        if (!validObjectId(req.params.id) || !validObjectId(req.body.statusId)) {
            return res.status(400).json({ message: "Choose a valid lead and status" });
        }
        const [lead, status] = await Promise.all([
            leadModel.findOne({ _id: req.params.id, userId: req.user.id, isMerged: { $ne: true } }),
            leadStatusModel.findOne({ _id: req.body.statusId, userId: req.user.id, active: true })
        ]);
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        if (!status) return res.status(400).json({ message: "The selected lead status is unavailable" });
        if (String(lead.statusId) === String(status._id)) return res.status(200).json({ lead });
        if (["converted_won", "lost"].includes(status.systemKey)) {
            return res.status(400).json({ message: "Use the conversion or lost action to set a terminal status" });
        }
        const completedAmounts = isCompletedStatus(status)
            ? validateCompletedAmounts(req.body)
            : null;
        if (completedAmounts?.error) return res.status(400).json({ message: completedAmounts.error });
        const [currentStatus, conversion] = await Promise.all([
            leadStatusModel.findOne({ _id: lead.statusId, userId: req.user.id }),
            leadConversionModel.findOne({ leadId: lead._id, userId: req.user.id })
        ]);
        if (conversion || ["converted_won", "lost"].includes(currentStatus?.systemKey)) {
            return res.status(409).json({ message: "This lead is in a terminal outcome and must be reopened before changing status" });
        }
        const previousStatus = lead.statusName;
        lead.statusId = status._id;
        lead.statusName = status.name;
        lead.statusColor = status.color;
        if (completedAmounts?.values) Object.assign(lead, completedAmounts.values);
        await lead.save();
        const completedNote = completedAmounts?.values
            ? ` Final quotation amount: ${completedAmounts.values.finalQuotationAmount}; final amount: ${completedAmounts.values.finalAmount}.`
            : "";
        await createActivity(lead, req.user.id, "status_changed", `Status changed from ${previousStatus} to ${status.name}.${completedNote}`, {
            changedBy: userName(req.user), previousStatus, newStatus: status.name
        });
        return res.status(200).json({ lead });
    } catch (error) {
        return sendError(res, error, "Could not change lead status");
    }
};

export const deleteLead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const lead = await leadModel.findOne({ _id: req.params.id, userId: req.user.id, isMerged: { $ne: true } });
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        const status = await leadStatusModel.findOne({ _id: lead.statusId, userId: req.user.id });
        const conversion = await leadConversionModel.exists({ leadId: lead._id, userId: req.user.id });
        if (conversion || ["converted_won", "lost"].includes(status?.systemKey)) {
            return res.status(409).json({ message: "Terminal leads cannot be deleted because their outcome history must be retained" });
        }
        await leadModel.deleteOne({ _id: lead._id, userId: req.user.id });
        await Promise.all([
            leadActivityModel.deleteMany({ leadId: lead._id, userId: req.user.id }),
            leadFollowUpModel.deleteMany({ leadId: lead._id, userId: req.user.id }),
            leadNotificationModel.deleteMany({ leadId: lead._id, userId: req.user.id })
        ]);
        return res.status(200).json({ message: "Lead deleted" });
    } catch (error) {
        return sendError(res, error, "Could not delete lead");
    }
};

export const bulkUpdateLeads = async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
        if (!ids.length || ids.length > 100 || ids.some((id) => !validObjectId(id))) {
            return res.status(400).json({ message: "Select between 1 and 100 valid leads" });
        }
        const update = {};
        let nextStatus = null;
        if (req.body.statusId) {
            if (!validObjectId(req.body.statusId)) return res.status(400).json({ message: "Choose a valid status" });
            nextStatus = await leadStatusModel.findOne({ _id: req.body.statusId, userId: req.user.id, active: true });
            if (!nextStatus) return res.status(400).json({ message: "The selected lead status is unavailable" });
            if (isCompletedStatus(nextStatus)) {
                return res.status(400).json({ message: "Move leads to Completed individually so both final amounts can be recorded" });
            }
            if (["converted_won", "lost"].includes(nextStatus.systemKey)) {
                return res.status(400).json({ message: "Use the conversion or lost action to set a terminal status" });
            }
            update.statusId = nextStatus._id;
            update.statusName = nextStatus.name;
            update.statusColor = nextStatus.color;
        }
        if (req.body.assignedEmployee !== undefined) {
            const assignedEmployee = String(req.body.assignedEmployee).trim();
            if (assignedEmployee.length > 120) return res.status(400).json({ message: "Employee name must be 120 characters or fewer" });
            update.assignedEmployee = assignedEmployee;
        }
        if (!Object.keys(update).length) return res.status(400).json({ message: "Choose a status or employee assignment to update" });
        const leads = await leadModel.find({ _id: { $in: ids }, userId: req.user.id, isMerged: { $ne: true } });
        if (!leads.length) return res.status(404).json({ message: "No matching leads found" });
        if (nextStatus) {
            const [terminalStatus, convertedLead] = await Promise.all([
                leadStatusModel.exists({
                    userId: req.user.id,
                    _id: { $in: leads.map((lead) => lead.statusId) },
                    systemKey: { $in: ["converted_won", "lost"] }
                }),
                leadConversionModel.exists({
                    userId: req.user.id,
                    leadId: { $in: leads.map((lead) => lead._id) }
                })
            ]);
            if (terminalStatus || convertedLead) {
                return res.status(409).json({ message: "Terminal leads cannot be moved using a bulk status update" });
            }
        }
        await leadModel.updateMany({ _id: { $in: leads.map((lead) => lead._id) }, userId: req.user.id }, { $set: update });
        if (req.body.assignedEmployee !== undefined) {
            const assignedEmployee = update.assignedEmployee || "unassigned";
            await leadActivityModel.insertMany(leads
                .filter((lead) => lead.assignedEmployee !== update.assignedEmployee)
                .map((lead) => ({
                    userId: req.user.id,
                    leadId: lead._id,
                    type: "employee_reassigned",
                    message: `Lead assigned to ${assignedEmployee}`,
                    changedBy: userName(req.user),
                    changedByUserId: req.user.id
                })));
            await Promise.all(leads
                .filter((lead) => lead.assignedEmployee !== update.assignedEmployee && update.assignedEmployee)
                .map((lead) => createLeadNotification({
                    userId: req.user.id,
                    leadId: lead._id,
                    kind: lead.assignedEmployee ? "lead_reassigned" : "lead_assigned",
                    title: lead.assignedEmployee ? "Lead reassigned" : "Lead assigned",
                    message: `${lead.customerName} was assigned to ${update.assignedEmployee}.`,
                    eventKey: `lead:${lead._id}:assigned:${Date.now()}`
                })));
        }
        if (nextStatus) {
            await leadActivityModel.insertMany(leads
                .filter((lead) => String(lead.statusId) !== String(nextStatus._id))
                .map((lead) => ({
                    userId: req.user.id,
                    leadId: lead._id,
                    type: "status_changed",
                    message: `Status changed from ${lead.statusName} to ${nextStatus.name}`,
                    previousStatus: lead.statusName,
                    newStatus: nextStatus.name,
                    changedBy: userName(req.user),
                    changedByUserId: req.user.id
                })));
        }
        return res.status(200).json({ updated: leads.length });
    } catch (error) {
        return sendError(res, error, "Could not update selected leads");
    }
};

export const exportLeads = async (req, res) => {
    try {
        const { filter, error } = buildLeadFilter(req, res);
        if (error) return res.status(400).json({ message: error });
        const leads = await leadModel.find(filter).sort({ leadDate: -1 }).lean();
        const columns = [
            ["Lead ID", "_id"], ["Customer Name", "customerName"], ["Company", "companyName"],
            ["Phone", "mobileNumber"], ["Email", "email"], ["Source", "source"],
            ["Interested Product/Service", "interestedProduct"], ["Category", "category"], ["Assigned Employee", "assignedEmployee"],
            ["Status", "statusName"], ["Priority", "priority"], ["Final Quotation Amount", "finalQuotationAmount"],
            ["Final Amount", "finalAmount"], ["Created Date", "leadDate"]
        ];
        const lines = [
            columns.map(([label]) => csvCell(label)).join(","),
            ...leads.map((lead) => columns.map(([, field]) =>
                field === "leadDate" ? csvCell(new Date(lead[field]).toLocaleDateString("en-IN")) : csvCell(lead[field])
            ).join(","))
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
        return res.status(200).send(`\uFEFF${lines.join("\r\n")}`);
    } catch (error) {
        return sendError(res, error, "Could not export leads");
    }
};
