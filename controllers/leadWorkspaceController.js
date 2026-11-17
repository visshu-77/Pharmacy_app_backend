import mongoose from "mongoose";
import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import { seedLeadStatuses } from "../services/leadService.js";

const PIPELINE_STAGES = [
    "new_lead", "contacted", "interested", "qualified", "proposal_sent",
    "negotiation", "completed", "converted_won", "on_hold", "lost", "not_interested"
];
const TERMINAL_KEYS = new Set(["converted_won", "lost"]);

export const getLeadPipeline = async (req, res) => {
    try {
        await seedLeadStatuses(req.user.id);
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const statuses = await leadStatusModel.find({
            userId,
            systemKey: { $in: PIPELINE_STAGES }
        }).sort({ order: 1 }).lean();
        const stageStats = await leadModel.aggregate([
            { $match: { userId, isMerged: { $ne: true } } },
            {
                $group: {
                    _id: "$statusId",
                    count: { $sum: 1 },
                    expectedDealValue: { $sum: { $ifNull: ["$expectedDealValue", 0] } }
                }
            }
        ]);
        const stages = await Promise.all(statuses.map(async (status) => {
            const stats = stageStats.find((item) => String(item._id) === String(status._id));
            const leads = await leadModel.find({
                userId, statusId: status._id, isMerged: { $ne: true }
            })
                .sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)
                .select("customerName title mobileNumber source priority expectedDealValue finalQuotationAmount finalAmount assignedEmployee statusId statusName statusColor")
                .lean();
            return {
                statusId: status._id,
                name: status.name,
                color: status.color,
                systemKey: status.systemKey,
                active: status.active,
                terminal: TERMINAL_KEYS.has(status.systemKey),
                count: stats?.count || 0,
                expectedDealValue: status.systemKey === "completed" ? 0 : (stats?.expectedDealValue || 0),
                leads,
                page,
                hasMore: (stats?.count || 0) > page * limit
            };
        }));
        return res.status(200).json({ stages });
    } catch (error) {
        console.error("Get lead pipeline error:", error);
        return res.status(500).json({ message: "Could not load lead pipeline" });
    }
};

export const getLeadTeamSummary = async (req, res) => {
    try {
        await seedLeadStatuses(req.user.id);
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const statuses = await leadStatusModel.find({ userId }).lean();
        const convertedStatusNames = new Set(
            statuses.filter((status) => status.systemKey === "converted_won").map((status) => status.name)
        );
        const lostStatusNames = new Set(
            statuses.filter((status) => status.systemKey === "lost").map((status) => status.name)
        );
        const completedStatusNames = new Set(
            statuses.filter((status) => status.systemKey === "completed").map((status) => status.name)
        );
        const leads = await leadModel.aggregate([
            { $match: { userId, isMerged: { $ne: true } } },
            {
                $group: {
                    _id: { $ifNull: ["$assignedEmployee", ""] },
                    total: { $sum: 1 },
                    expectedDealValue: {
                        $sum: {
                            $cond: [
                                { $in: ["$statusName", [...completedStatusNames]] },
                                0,
                                { $ifNull: ["$expectedDealValue", 0] }
                            ]
                        }
                    },
                    converted: { $sum: { $cond: [{ $in: ["$statusName", [...convertedStatusNames]] }, 1, 0] } },
                    lost: { $sum: { $cond: [{ $in: ["$statusName", [...lostStatusNames]] }, 1, 0] } },
                    completed: { $sum: { $cond: [{ $in: ["$statusName", [...completedStatusNames]] }, 1, 0] } }
                }
            },
            { $sort: { total: -1, _id: 1 } }
        ]);
        const summaries = leads.map((item) => {
            const converted = item.converted || 0;
            const lost = item.lost || 0;
            const completed = item.completed || 0;
            return {
                employee: item._id || "Unassigned",
                total: item.total,
                pending: item.total - converted - lost - completed,
                converted,
                completed,
                expectedDealValue: item.expectedDealValue
            };
        });
        return res.status(200).json({ employees: summaries });
    } catch (error) {
        console.error("Get lead team summary error:", error);
        return res.status(500).json({ message: "Could not load employee lead summary" });
    }
};

