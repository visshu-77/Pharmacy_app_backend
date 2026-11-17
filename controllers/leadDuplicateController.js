import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import leadActivityModel from "../model/leadActivity.js";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadConversionModel from "../model/leadConversion.js";
import { recordLeadActivity } from "../services/leadActivityService.js";
import { validObjectId } from "../services/leadService.js";
import { withTransaction } from "../services/dbSession.js";

const LEAD_FIELDS = [
    "companyName", "alternateNumber", "email", "whatsappNumber", "address",
    "city", "state", "pincode", "interestedProduct"
];
const text = (value) => String(value ?? "").trim();

const phoneRegex = (digits) => new RegExp(`^\\D*${digits.split("").join("\\D*")}\\D*$`);
const emailRegex = (email) => new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

const findMatches = async ({ userId, mobileNumber, email, excludeId }) => {
    const digits = String(mobileNumber || "").replace(/\D/g, "");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const conditions = [];
    if (digits.length >= 7) {
        conditions.push(
            { mobileNumberNormalized: digits },
            { mobileNumber: phoneRegex(digits) }
        );
    }
    if (normalizedEmail) {
        conditions.push(
            { emailNormalized: normalizedEmail },
            { email: emailRegex(normalizedEmail) }
        );
    }
    if (!conditions.length) return [];
    return leadModel.find({
        userId,
        isMerged: { $ne: true },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        $or: conditions
    }).select("customerName companyName title mobileNumber email source statusName statusColor priority assignedEmployee leadDate category")
        .sort({ createdAt: -1 }).limit(20).lean();
};

export const checkLeadDuplicates = async (req, res) => {
    try {
        const mobileNumber = text(req.body.mobileNumber);
        const email = text(req.body.email);
        const excludeId = req.body.excludeId || null;
        if (excludeId && !validObjectId(excludeId)) {
            return res.status(400).json({ message: "Invalid lead ID" });
        }
        if (mobileNumber && !/^[+\d() .-]{7,20}$/.test(mobileNumber)) {
            return res.status(400).json({ message: "Enter a valid mobile number" });
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "Enter a valid email address" });
        }
        if (!mobileNumber && !email) {
            return res.status(400).json({ message: "Enter a mobile number or email to check duplicates" });
        }
        return res.status(200).json({
            duplicates: await findMatches({ userId: req.user.id, mobileNumber, email, excludeId })
        });
    } catch (error) {
        console.error("Check duplicate leads error:", error);
        return res.status(500).json({ message: "Could not check for duplicate leads" });
    }
};

export const getLeadDuplicates = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const lead = await leadModel.findOne({
            _id: req.params.id, userId: req.user.id, isMerged: { $ne: true }
        }).select("mobileNumber email").lean();
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        return res.status(200).json({
            duplicates: await findMatches({
                userId: req.user.id,
                mobileNumber: lead.mobileNumber,
                email: lead.email,
                excludeId: lead._id
            })
        });
    } catch (error) {
        console.error("Get lead duplicate matches error:", error);
        return res.status(500).json({ message: "Could not load duplicate matches" });
    }
};

const mergeFields = (target, source) => {
    for (const field of LEAD_FIELDS) {
        if (!target[field] && source[field]) target[field] = source[field];
    }
    if (target.expectedBudget == null && source.expectedBudget != null) target.expectedBudget = source.expectedBudget;
    if (target.expectedDealValue == null && source.expectedDealValue != null) target.expectedDealValue = source.expectedDealValue;
    if (target.finalQuotationAmount == null && source.finalQuotationAmount != null) target.finalQuotationAmount = source.finalQuotationAmount;
    if (target.finalAmount == null && source.finalAmount != null) target.finalAmount = source.finalAmount;
    if (!target.category && source.category) target.category = source.category;
    if (!target.description && source.description) target.description = source.description;
    if (source.notes) {
        const importedNotes = `Merged notes from ${source.customerName} (${source._id}):\n${source.notes}`;
        target.notes = [target.notes, importedNotes].filter(Boolean).join("\n\n").slice(0, 5000);
    }
};

const isTerminalLead = async (lead, userId, session = null) => {
    const query = leadStatusModel.findOne({ _id: lead.statusId, userId }).select("systemKey");
    const conversionQuery = leadConversionModel.exists({ leadId: lead._id, userId });
    if (session) {
        query.session(session);
        conversionQuery.session(session);
    }
    const [status, conversion] = await Promise.all([query, conversionQuery]);
    return Boolean(conversion || ["converted_won", "lost"].includes(status?.systemKey));
};

const mergeRecords = async ({ sourceId, targetId, user, session = null, resultIds = {} }) => {
    const userId = user.id;
    const sourceQuery = leadModel.findOne({ _id: sourceId, userId, isMerged: { $ne: true } });
    const targetQuery = leadModel.findOne({ _id: targetId, userId, isMerged: { $ne: true } });
    if (session) {
        sourceQuery.session(session);
        targetQuery.session(session);
    }
    const [source, target] = await Promise.all([sourceQuery, targetQuery]);
    if (!source || !target) {
        const error = new Error("Both leads must exist in your account and be active");
        error.status = 404;
        throw error;
    }
    if (await isTerminalLead(source, userId, session) || await isTerminalLead(target, userId, session)) {
        const error = new Error("Converted or Lost leads cannot be merged so their outcome history remains intact");
        error.status = 409;
        throw error;
    }

    resultIds.sourceSnapshot = source.toObject();
    resultIds.targetSnapshot = target.toObject();
    const followUpQuery = leadFollowUpModel.find({ userId, leadId: source._id }).select("_id").lean();
    if (session) followUpQuery.session(session);
    resultIds.followUpIds = (await followUpQuery).map((followUp) => followUp._id);

    mergeFields(target, source);
    await target.save(session ? { session } : {});

    const activitiesQuery = leadActivityModel.find({ userId, leadId: source._id }).lean();
    if (session) activitiesQuery.session(session);
    const activities = await activitiesQuery;
    if (activities.length) {
        const copies = activities.map(({ _id, ...activity }) => ({ ...activity, leadId: target._id }));
        const copied = await leadActivityModel.insertMany(copies, session ? { session } : {});
        resultIds.activityIds.push(...copied.map((activity) => activity._id));
    }
    const followUpsUpdate = await leadFollowUpModel.updateMany(
        { userId, leadId: source._id },
        { $set: { leadId: target._id } },
        session ? { session } : {}
    );
    resultIds.followUpCount = followUpsUpdate.modifiedCount ?? followUpsUpdate.nModified ?? 0;
    const nextFollowUpQuery = leadFollowUpModel.findOne({
        userId, leadId: target._id, status: "Pending", scheduledAt: { $gte: new Date() }
    }).sort({ scheduledAt: 1 }).select("scheduledAt");
    if (session) nextFollowUpQuery.session(session);
    const nextFollowUp = await nextFollowUpQuery.lean();
    target.nextFollowUpAt = nextFollowUp?.scheduledAt || null;
    await target.save(session ? { session } : {});

    const sourceBeforeArchive = source.toObject();
    source.isMerged = true;
    source.mergedInto = target._id;
    source.mergedAt = new Date();
    source.mergedByUserId = userId;
    await source.save(session ? { session } : {});

    const mergeActivity = await recordLeadActivity({
        lead: target,
        user,
        type: "lead_merged",
        message: `Lead ${source._id} merged into this lead`,
        description: `${source.customerName} (${source.mobileNumber}) was retained as an archived lead record.`,
        session
    });
    resultIds.activityIds.push(mergeActivity._id);

    return { lead: target.toObject(), archivedLead: source.toObject(), sourceBeforeArchive };
};

export const mergeDuplicateLead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id) || !validObjectId(req.body.targetLeadId)) {
            return res.status(400).json({ message: "Choose valid source and target leads" });
        }
        if (String(req.params.id) === String(req.body.targetLeadId)) {
            return res.status(400).json({ message: "A lead cannot be merged into itself" });
        }

        const resultIds = { activityIds: [], followUpCount: 0 };
        const result = await withTransaction(
            (session) => mergeRecords({
                sourceId: req.params.id,
                targetId: req.body.targetLeadId,
                user: req.user,
                session,
                resultIds
            }),
            {
                fallback: async () => {
                    try {
                        return await mergeRecords({
                            sourceId: req.params.id,
                            targetId: req.body.targetLeadId,
                            user: req.user,
                            resultIds
                        });
                    } catch (error) {
                        if (resultIds.targetSnapshot) {
                            await leadModel.replaceOne(
                                { _id: resultIds.targetSnapshot._id, userId: req.user.id },
                                resultIds.targetSnapshot
                            );
                        }
                        if (resultIds.sourceSnapshot) {
                            await leadModel.replaceOne(
                                { _id: resultIds.sourceSnapshot._id, userId: req.user.id },
                                resultIds.sourceSnapshot
                            );
                        }
                        if (resultIds.activityIds.length) {
                            await leadActivityModel.deleteMany({ _id: { $in: resultIds.activityIds }, userId: req.user.id });
                        }
                        if (resultIds.followUpIds?.length) {
                            await leadFollowUpModel.updateMany(
                                { userId: req.user.id, _id: { $in: resultIds.followUpIds } },
                                { $set: { leadId: req.params.id } }
                            );
                        }
                        throw error;
                    }
                }
            }
        );
        return res.status(200).json({
            message: "Lead merged and original retained as an archived record",
            lead: result.lead,
            archivedLead: result.archivedLead
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        console.error("Merge duplicate lead error:", error);
        return res.status(500).json({ message: "Could not merge duplicate lead" });
    }
};
