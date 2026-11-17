import mongoose from "mongoose";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadModel from "../model/lead.js";
import { parseDate, validObjectId } from "../services/leadService.js";
import { recordLeadActivity } from "../services/leadActivityService.js";
import { getLeadSettings } from "../services/leadSettingsService.js";

const FOLLOW_UP_STATUSES = ["Pending", "Completed", "Rescheduled", "Cancelled"];
const REMINDER_OPTIONS = [0, 15, 60, 1440];
const dayStart = (date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric"
    }).formatToParts(date).map(({ type, value }) => [type, Number(value)]));
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - (5 * 60 + 30) * 60000);
};
const text = (value) => String(value ?? "").trim();

export const importLegacyLeadFollowUps = async (user) => {
    const leads = await leadModel.find({
        userId: user.id,
        isMerged: { $ne: true },
        nextFollowUpAt: { $ne: null },
        legacyFollowUpImported: { $ne: true }
    }).select("_id nextFollowUpAt assignedEmployee").lean();

    for (const lead of leads) {
        let imported = false;
        try {
            await leadFollowUpModel.create({
                userId: user.id,
                leadId: lead._id,
                type: "Other",
                scheduledAt: lead.nextFollowUpAt,
                assignedEmployee: lead.assignedEmployee || "",
                description: "Imported from the lead's existing next follow-up date.",
                status: "Pending",
                legacyImport: true
            });
            imported = true;
        } catch (error) {
            if (error?.code !== 11000) throw error;
        }

        await leadModel.updateOne(
            { _id: lead._id, userId: user.id },
            { $set: { legacyFollowUpImported: true } }
        );
        if (imported) {
            await recordLeadActivity({
                lead,
                user,
                type: "followup_scheduled",
                message: "Existing follow-up imported",
                description: "The lead's existing next follow-up date was moved into Follow-up Management."
            });
        }
    }
};

const validateFollowUp = (input, allowedTypes, { requireLead = true } = {}) => {
    if (requireLead && !validObjectId(input.leadId)) return { error: "Choose a valid lead" };
    const type = text(input.type);
    if (!allowedTypes.includes(type)) return { error: "Choose a valid follow-up type" };
    const scheduledAt = parseDate(input.scheduledAt);
    if (!scheduledAt) return { error: "Choose a valid follow-up date and time" };
    const assignedEmployee = text(input.assignedEmployee);
    const description = text(input.description);
    const reminderMinutes = Number(input.reminderMinutes ?? 0);
    if (assignedEmployee.length > 120) return { error: "Employee name must be 120 characters or fewer" };
    if (description.length > 2000) return { error: "Description must be 2000 characters or fewer" };
    if (!REMINDER_OPTIONS.includes(reminderMinutes)) return { error: "Choose a valid reminder" };
    return {
        values: { type, scheduledAt, assignedEmployee, description, reminderMinutes }
    };
};

const syncNextLeadFollowUp = async (leadId, userId) => {
    const next = await leadFollowUpModel.findOne({
        leadId, userId, status: "Pending", scheduledAt: { $gte: new Date() }
    }).sort({ scheduledAt: 1 }).select("scheduledAt").lean();
    await leadModel.updateOne({ _id: leadId, userId }, {
        $set: {
            nextFollowUpAt: next?.scheduledAt || null,
            legacyFollowUpImported: true
        }
    });
};

export const getLeadFollowUps = async (req, res) => {
    try {
        await importLegacyLeadFollowUps(req.user);
        const view = String(req.query.view || "today");
        const allowedViews = ["today", "upcoming", "overdue", "completed"];
        if (!allowedViews.includes(view)) return res.status(400).json({ message: "Choose a valid follow-up view" });
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
        const today = dayStart(new Date());
        const tomorrow = new Date(today.getTime() + 86400000);
        const filter = { userId: req.user.id };
        if (view === "today") {
            filter.status = "Pending";
            filter.scheduledAt = { $gte: today, $lt: tomorrow };
        } else if (view === "upcoming") {
            filter.status = "Pending";
            filter.scheduledAt = { $gte: tomorrow };
        } else if (view === "overdue") {
            filter.status = "Pending";
            filter.scheduledAt = { $lt: today };
        } else {
            filter.status = "Completed";
        }
        const [followUps, total] = await Promise.all([
            leadFollowUpModel.find(filter)
                .populate("leadId", "customerName title mobileNumber statusName assignedEmployee")
                .sort({ scheduledAt: view === "overdue" ? 1 : -1 })
                .skip((page - 1) * limit).limit(limit).lean(),
            leadFollowUpModel.countDocuments(filter)
        ]);
        return res.status(200).json({ followUps, page, limit, total, hasMore: page * limit < total });
    } catch (error) {
        console.error("Get lead follow-ups error:", error);
        return res.status(500).json({ message: "Could not load follow-ups" });
    }
};

export const createLeadFollowUp = async (req, res) => {
    try {
        await importLegacyLeadFollowUps(req.user);
        const settings = await getLeadSettings(req.user.id);
        const validation = validateFollowUp(req.body, settings.followUpTypes);
        if (validation.error) return res.status(400).json({ message: validation.error });
        const lead = await leadModel.findOne({
            _id: req.body.leadId, userId: req.user.id, isMerged: { $ne: true }
        });
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        const followUp = await leadFollowUpModel.create({
            userId: req.user.id,
            leadId: lead._id,
            ...validation.values,
            assignedEmployee: validation.values.assignedEmployee || lead.assignedEmployee
        });
        await syncNextLeadFollowUp(lead._id, req.user.id);
        await recordLeadActivity({
            lead,
            user: req.user,
            type: "followup_scheduled",
            message: `${followUp.type} follow-up scheduled`,
            description: `${followUp.description}${followUp.assignedEmployee ? ` · Assigned to ${followUp.assignedEmployee}` : ""}`
        });
        return res.status(201).json({ followUp });
    } catch (error) {
        console.error("Create lead follow-up error:", error);
        return res.status(500).json({ message: "Could not schedule follow-up" });
    }
};

export const updateLeadFollowUp = async (req, res) => {
    try {
        await importLegacyLeadFollowUps(req.user);
        const settings = await getLeadSettings(req.user.id);
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid follow-up ID" });
        const followUp = await leadFollowUpModel.findOne({ _id: req.params.id, userId: req.user.id });
        if (!followUp) return res.status(404).json({ message: "Follow-up not found" });
        if (!FOLLOW_UP_STATUSES.includes(req.body.status || followUp.status)) {
            return res.status(400).json({ message: "Choose a valid follow-up status" });
        }
        const lead = await leadModel.findOne({
            _id: followUp.leadId, userId: req.user.id, isMerged: { $ne: true }
        });
        if (!lead) return res.status(404).json({ message: "Lead not found" });

        if (req.body.status === "Rescheduled") {
            if (followUp.status !== "Pending") return res.status(409).json({ message: "Only pending follow-ups can be rescheduled" });
            const validation = validateFollowUp({
                leadId: String(lead._id),
                type: req.body.type || followUp.type,
                scheduledAt: req.body.scheduledAt,
                assignedEmployee: req.body.assignedEmployee ?? followUp.assignedEmployee,
                reminderMinutes: req.body.reminderMinutes ?? followUp.reminderMinutes,
                description: req.body.description ?? followUp.description
            }, settings.followUpTypes);
            if (validation.error) return res.status(400).json({ message: validation.error });
            if (validation.values.scheduledAt <= new Date()) return res.status(400).json({ message: "Choose a future reschedule date and time" });
            const [replacement] = await leadFollowUpModel.create([{
                userId: req.user.id, leadId: lead._id, ...validation.values
            }]);
            followUp.status = "Rescheduled";
            followUp.rescheduledTo = replacement._id;
            await followUp.save();
            await syncNextLeadFollowUp(lead._id, req.user.id);
            await recordLeadActivity({
                lead,
                user: req.user,
                type: "followup_updated",
                message: `${followUp.type} follow-up rescheduled`,
                description: `New follow-up scheduled for ${replacement.scheduledAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
            });
            return res.status(200).json({ followUp, replacement });
        }

        if (req.body.scheduledAt && new Date(req.body.scheduledAt).getTime() !== followUp.scheduledAt.getTime()) {
            return res.status(400).json({ message: "Use the Rescheduled status to change the follow-up date" });
        }
        if (req.body.type !== undefined) {
            if (!settings.followUpTypes.includes(req.body.type)) return res.status(400).json({ message: "Choose a valid follow-up type" });
            followUp.type = req.body.type;
        }
        if (req.body.assignedEmployee !== undefined) {
            const assignedEmployee = text(req.body.assignedEmployee);
            if (assignedEmployee.length > 120) return res.status(400).json({ message: "Employee name must be 120 characters or fewer" });
            followUp.assignedEmployee = assignedEmployee;
        }
        if (req.body.description !== undefined) {
            const description = text(req.body.description);
            if (description.length > 2000) return res.status(400).json({ message: "Description must be 2000 characters or fewer" });
            followUp.description = description;
        }
        if (req.body.reminderMinutes !== undefined) {
            const reminder = Number(req.body.reminderMinutes);
            if (!REMINDER_OPTIONS.includes(reminder)) return res.status(400).json({ message: "Choose a valid reminder" });
            followUp.reminderMinutes = reminder;
        }
        if (req.body.status !== undefined) {
            if (followUp.status !== "Pending" && followUp.status !== req.body.status) {
                return res.status(409).json({ message: "Only pending follow-ups can change status" });
            }
            followUp.status = req.body.status;
            followUp.completedAt = req.body.status === "Completed" ? new Date() : null;
        }
        await followUp.save();
        await syncNextLeadFollowUp(lead._id, req.user.id);
        await recordLeadActivity({
            lead,
            user: req.user,
            type: "followup_updated",
            message: `${followUp.type} follow-up marked ${followUp.status.toLowerCase()}`,
            description: followUp.description
        });
        return res.status(200).json({ followUp });
    } catch (error) {
        console.error("Update lead follow-up error:", error);
        return res.status(500).json({ message: "Could not update follow-up" });
    }
};

