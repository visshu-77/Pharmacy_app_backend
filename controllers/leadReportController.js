import mongoose from "mongoose";
import leadModel from "../model/lead.js";
import leadStatusModel from "../model/leadStatus.js";
import leadFollowUpModel from "../model/leadFollowUp.js";
import leadConversionModel from "../model/leadConversion.js";
import expenseTransactionModel from "../model/expenseTransaction.js";
import { getLeadSettings } from "../services/leadSettingsService.js";
import { seedLeadStatuses } from "../services/leadService.js";

const DAY_MS = 86400000;
const TIME_ZONE = "Asia/Kolkata";
const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
};

const calendarParts = (date) => Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric"
    }).formatToParts(date).map(({ type, value }) => [type, Number(value)])
);

const localDayStart = (date) => {
    const parts = calendarParts(date);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - 330 * 60000);
};

const parseRange = (query, now = new Date()) => {
    const period = String(query.period || "monthly");
    if (!["daily", "weekly", "monthly", "yearly"].includes(period)) {
        return { error: "Choose daily, weekly, monthly, or yearly reporting" };
    }

    let start;
    let endExclusive;
    if (query.from || query.to) {
        const from = query.from ? new Date(String(query.from)) : new Date(String(query.to));
        const to = query.to ? new Date(String(query.to)) : from;
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
            return { error: "Choose a valid report date range" };
        }
        start = localDayStart(from);
        endExclusive = new Date(localDayStart(to).getTime() + DAY_MS);
    } else {
        start = localDayStart(now);
        const parts = calendarParts(now);
        if (period === "daily") {
            endExclusive = new Date(start.getTime() + DAY_MS);
        } else if (period === "weekly") {
            const weekday = new Date(start.getTime() + 330 * 60000).getUTCDay();
            start = new Date(start.getTime() - ((weekday + 6) % 7) * DAY_MS);
            endExclusive = new Date(start.getTime() + 7 * DAY_MS);
        } else if (period === "monthly") {
            start = new Date(Date.UTC(parts.year, parts.month - 1, 1) - 330 * 60000);
            endExclusive = new Date(Date.UTC(parts.year, parts.month, 1) - 330 * 60000);
        } else {
            start = new Date(Date.UTC(parts.year, 0, 1) - 330 * 60000);
            endExclusive = new Date(Date.UTC(parts.year + 1, 0, 1) - 330 * 60000);
        }
    }

    if (endExclusive.getTime() - start.getTime() > 5 * 366 * DAY_MS) {
        return { error: "Report date ranges cannot exceed five years" };
    }
    return { period, from: start, to: new Date(endExclusive.getTime() - 1), endExclusive };
};

const reportData = async (userId, query, { exportAll = false } = {}) => {
    const range = parseRange(query);
    if (range.error) return range;
    await seedLeadStatuses(userId);
    const page = exportAll ? 1 : Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = exportAll ? 10000 : Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    const ownerId = new mongoose.Types.ObjectId(userId);
    const leadFilter = {
        userId: ownerId,
        isMerged: { $ne: true },
        leadDate: { $gte: range.from, $lt: range.endExclusive }
    };
    const [statuses, settings] = await Promise.all([
        leadStatusModel.find({ userId: ownerId }).sort({ order: 1 }).lean(),
        getLeadSettings(userId)
    ]);
    const statusById = new Map(statuses.map((status) => [String(status._id), status]));
    const statusIds = (key) => statuses.filter((status) => status.systemKey === key).map((status) => status._id);
    const convertedIds = statusIds("converted_won");
    const lostIds = statusIds("lost");
    const closedPipelineIds = [...convertedIds, ...lostIds, ...statusIds("completed")];
    const conversionReport = await leadConversionModel.aggregate([
        { $match: { userId: ownerId, conversionDate: { $gte: range.from, $lt: range.endExclusive } } },
        {
            $lookup: {
                from: leadModel.collection.name,
                localField: "leadId",
                foreignField: "_id",
                as: "lead"
            }
        },
        { $unwind: "$lead" },
        { $match: { "lead.isMerged": { $ne: true } } },
        {
            $project: {
                finalDealAmount: 1,
                conversionDate: 1,
                responsibleEmployee: 1,
                source: "$lead.source",
                leadDate: "$lead.leadDate",
                customerName: "$lead.customerName"
            }
        },
        {
            $facet: {
                summary: [{
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        totalDealValue: { $sum: "$finalDealAmount" },
                        averageDays: { $avg: { $divide: [{ $subtract: ["$conversionDate", "$leadDate"] }, DAY_MS] } }
                    }
                }],
                bySource: [{
                    $group: { _id: "$source", convertedDealValue: { $sum: "$finalDealAmount" } }
                }],
                byEmployee: [{
                    $group: { _id: "$responsibleEmployee", convertedDealValue: { $sum: "$finalDealAmount" } }
                }],
                items: [
                    { $sort: { conversionDate: -1, _id: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit }
                ]
            }
        }
    ]).then((result) => result[0] || { summary: [], bySource: [], byEmployee: [], items: [] });

    const [statusCounts, sourceRows, dailyRows, monthlyRows, teamRows, followupRows, lostReasons, lostRows, lostTotal, confirmedIncomeRows] = await Promise.all([
        leadModel.aggregate([
            { $match: leadFilter },
            { $group: { _id: "$statusId", count: { $sum: 1 }, expected: { $sum: { $ifNull: ["$expectedDealValue", 0] } } } }
        ]),
        leadModel.aggregate([
            { $match: leadFilter },
            {
                $group: {
                    _id: "$source",
                    total: { $sum: 1 },
                    converted: { $sum: { $cond: [{ $in: ["$statusId", convertedIds] }, 1, 0] } },
                    lost: { $sum: { $cond: [{ $in: ["$statusId", lostIds] }, 1, 0] } },
                    expectedPipelineRevenue: {
                        $sum: { $cond: [{ $in: ["$statusId", closedPipelineIds] }, 0, { $ifNull: ["$expectedDealValue", 0] }] }
                    }
                }
            },
            { $sort: { total: -1, _id: 1 } }
        ]),
        leadModel.aggregate([
            { $match: leadFilter },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$leadDate", timezone: TIME_ZONE } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),
        leadModel.aggregate([
            { $match: leadFilter },
            { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$leadDate", timezone: TIME_ZONE } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]),
        leadModel.aggregate([
            { $match: leadFilter },
            {
                $group: {
                    _id: { employee: { $ifNull: ["$assignedEmployee", ""] }, statusId: "$statusId" },
                    total: { $sum: 1 }
                }
            }
        ]),
        leadFollowUpModel.aggregate([
            { $match: { userId: ownerId, scheduledAt: { $gte: range.from, $lt: range.endExclusive } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        leadModel.aggregate([
            {
                $match: {
                    userId: ownerId,
                    isMerged: { $ne: true },
                    statusId: { $in: lostIds },
                    $or: [
                        { lostAt: { $gte: range.from, $lt: range.endExclusive } },
                        { lostAt: null, updatedAt: { $gte: range.from, $lt: range.endExclusive } }
                    ]
                }
            },
            { $group: { _id: { $ifNull: ["$lostReason", "Unspecified"] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }
        ]),
        leadModel.find({
            userId: ownerId,
            isMerged: { $ne: true },
            statusId: { $in: lostIds },
            $or: [
                { lostAt: { $gte: range.from, $lt: range.endExclusive } },
                { lostAt: null, updatedAt: { $gte: range.from, $lt: range.endExclusive } }
            ]
        }).select("customerName title source assignedEmployee lostReason lostRemarks lostAt updatedAt leadDate")
            .sort({ lostAt: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        leadModel.countDocuments({
            userId: ownerId,
            isMerged: { $ne: true },
            statusId: { $in: lostIds },
            $or: [
                { lostAt: { $gte: range.from, $lt: range.endExclusive } },
                { lostAt: null, updatedAt: { $gte: range.from, $lt: range.endExclusive } }
            ]
        }),
        expenseTransactionModel.aggregate([
            {
                $match: {
                    userId: ownerId,
                    type: "income",
                    transactionDate: { $gte: range.from, $lt: range.endExclusive }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$amount" },
                    crmTotal: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$sourceConversionId", null] }, null] }, "$amount", 0] } },
                    count: { $sum: 1 }
                }
            }
        ])
    ]);

    if (exportAll && (conversionReport.summary[0]?.count > limit || lostTotal > limit)) {
        return { error: "This report exceeds the 10,000-row export limit. Narrow the date range and try again." };
    }

    const leadTotal = statusCounts.reduce((sum, item) => sum + item.count, 0);
    const countForKey = (key) => statusCounts.reduce((sum, item) =>
        statusById.get(String(item._id))?.systemKey === key ? sum + item.count : sum, 0);
    const convertedCount = countForKey("converted_won");
    const lostCount = countForKey("lost");
    const completedCount = countForKey("completed");
    const expectedPipelineRevenue = statusCounts.reduce((sum, item) =>
        closedPipelineIds.some((id) => String(id) === String(item._id)) ? sum : sum + item.expected, 0);

    const sourceRowByName = new Map(sourceRows.map((row) => [row._id, row]));
    const sourceNames = [...new Set([
        ...settings.sources,
        ...sourceRows.map((row) => row._id).filter(Boolean)
    ])];
    const sources = sourceNames.map((name) => {
        const row = sourceRowByName.get(name) || { total: 0, converted: 0, lost: 0, expectedPipelineRevenue: 0 };
        const revenue = conversionReport.bySource.find((item) => item._id === name)?.convertedDealValue || 0;
        return {
            source: name,
            totalLeads: row.total,
            convertedLeads: row.converted,
            lostLeads: row.lost,
            conversionRate: row.total ? row.converted / row.total * 100 : 0,
            expectedPipelineRevenue: row.expectedPipelineRevenue,
            convertedDealValue: revenue
        };
    });

    const employeeMap = new Map();
    for (const row of teamRows) {
        const name = row._id.employee || "Unassigned";
        const employee = employeeMap.get(name) || {
            employee: name, totalAssignedLeads: 0, contacted: 0, qualified: 0,
            converted: 0, lost: 0, completed: 0, pendingFollowUps: 0, convertedDealValue: 0
        };
        const status = statusById.get(String(row._id.statusId));
        employee.totalAssignedLeads += row.total;
        if (status?.systemKey === "contacted") employee.contacted += row.total;
        if (status?.systemKey === "qualified") employee.qualified += row.total;
        if (status?.systemKey === "converted_won") employee.converted += row.total;
        if (status?.systemKey === "lost") employee.lost += row.total;
        if (status?.systemKey === "completed") employee.completed += row.total;
        employeeMap.set(name, employee);
    }
    for (const conversion of conversionReport.byEmployee) {
        const name = conversion._id || "Unassigned";
        const employee = employeeMap.get(name) || {
            employee: name, totalAssignedLeads: 0, contacted: 0, qualified: 0,
            converted: 0, lost: 0, completed: 0, pendingFollowUps: 0, convertedDealValue: 0
        };
        employee.convertedDealValue += conversion.convertedDealValue;
        employeeMap.set(name, employee);
    }
    const pendingFollowUpEmployees = await leadFollowUpModel.aggregate([
        { $match: { userId: ownerId, status: "Pending", scheduledAt: { $gte: range.from, $lt: range.endExclusive } } },
        { $group: { _id: { $ifNull: ["$assignedEmployee", "Unassigned"] }, count: { $sum: 1 } } }
    ]);
    for (const item of pendingFollowUpEmployees) {
        const name = item._id || "Unassigned";
        const employee = employeeMap.get(name) || {
            employee: name, totalAssignedLeads: 0, contacted: 0, qualified: 0,
            converted: 0, lost: 0, completed: 0, pendingFollowUps: 0, convertedDealValue: 0
        };
        employee.pendingFollowUps = item.count;
        employeeMap.set(name, employee);
    }
    const employeePerformance = [...employeeMap.values()].map((employee) => ({
        ...employee,
        pending: employee.totalAssignedLeads - employee.converted - employee.lost - employee.completed,
        conversionRate: employee.totalAssignedLeads
            ? employee.converted / employee.totalAssignedLeads * 100
            : 0
    })).sort((a, b) => b.totalAssignedLeads - a.totalAssignedLeads || a.employee.localeCompare(b.employee));

    const completedFollowUps = followupRows.find((item) => item._id === "Completed")?.count || 0;
    const scheduledFollowUps = followupRows.reduce((sum, item) => sum + item.count, 0);
    const dailyStart = new Date(Math.max(range.from.getTime(), range.endExclusive.getTime() - 32 * DAY_MS));
    const conversionSummary = conversionReport.summary[0] || { count: 0, totalDealValue: 0, averageDays: 0 };

    return {
        range: { period: range.period, from: range.from, to: range.to },
        summary: {
            totalLeads: leadTotal,
            newLeads: countForKey("new_lead"),
            convertedLeads: convertedCount,
            lostLeads: lostCount,
            completedLeads: completedCount,
            conversionRate: leadTotal ? convertedCount / leadTotal * 100 : 0,
            expectedPipelineRevenue,
            convertedDealValue: conversionSummary.totalDealValue || 0,
            confirmedIncome: confirmedIncomeRows[0]?.total || 0,
            crmConfirmedIncome: confirmedIncomeRows[0]?.crmTotal || 0,
            confirmedIncomeTransactions: confirmedIncomeRows[0]?.count || 0,
            pendingFollowUps: followupRows.find((item) => item._id === "Pending")?.count || 0,
            overdueFollowUps: await leadFollowUpModel.countDocuments({
                userId: ownerId, status: "Pending",
                scheduledAt: { $gte: range.from, $lt: new Date(Math.min(range.endExclusive.getTime(), Date.now())) }
            }),
            averageConversionDays: conversionSummary.averageDays || 0,
            totalConversionsInRange: conversionSummary.count
        },
        dailyLeadGeneration: dailyRows.filter((item) => new Date(`${item._id}T00:00:00.000Z`) >= dailyStart),
        monthlyLeadGeneration: monthlyRows,
        sourceAnalytics: sources,
        statusReports: statusCounts.map((item) => ({
            status: statusById.get(String(item._id))?.name || "Unknown",
            color: statusById.get(String(item._id))?.color || "#64748b",
            count: item.count,
            expectedPipelineRevenue: closedPipelineIds.some((id) => String(id) === String(item._id)) ? 0 : item.expected
        })).sort((a, b) => b.count - a.count),
        employeePerformance,
        conversions: conversionReport.items,
        conversionPage: { page, limit, total: conversionSummary.count, hasMore: page * limit < conversionSummary.count },
        lostReasons,
        lostLeads: lostRows,
        lostPage: { page, limit, total: lostTotal, hasMore: page * limit < lostTotal },
        followUpPerformance: {
            scheduled: scheduledFollowUps,
            completed: completedFollowUps,
            pending: followupRows.find((item) => item._id === "Pending")?.count || 0,
            cancelled: followupRows.find((item) => item._id === "Cancelled")?.count || 0,
            completionRate: scheduledFollowUps ? completedFollowUps / scheduledFollowUps * 100 : 0
        },
        settings
    };
};

export const buildLeadReportData = reportData;

export const getLeadReports = async (req, res) => {
    try {
        const report = await reportData(req.user.id, req.query);
        if (report.error) return res.status(400).json({ message: report.error });
        return res.status(200).json(report);
    } catch (error) {
        console.error("Get lead reports error:", error);
        return res.status(500).json({ message: "Could not load CRM reports" });
    }
};

export const exportLeadReports = async (req, res) => {
    try {
        const report = await reportData(req.user.id, req.query, { exportAll: true });
        if (report.error) return res.status(400).json({ message: report.error });
        const rows = [
            ["Section", "Name", "Leads", "Converted", "Lost", "Conversion rate (%)", "Expected pipeline revenue", "Converted deal value", "Confirmed income", "Lost reason"],
            ...report.dailyLeadGeneration.map((item) => ["Daily lead generation", item._id, item.count]),
            ...report.monthlyLeadGeneration.map((item) => ["Monthly lead generation", item._id, item.count]),
            ...report.sourceAnalytics.map((item) => [
                "Lead source", item.source, item.totalLeads, item.convertedLeads, item.lostLeads,
                item.conversionRate.toFixed(2), item.expectedPipelineRevenue, item.convertedDealValue, ""
            ]),
            ...report.statusReports.map((item) => ["Lead status", item.status, item.count, "", "", "", item.expectedPipelineRevenue]),
            ...report.employeePerformance.map((item) => [
                "Employee performance", item.employee, item.totalAssignedLeads, item.converted, item.lost,
                item.conversionRate.toFixed(2), "", item.convertedDealValue, ""
            ]),
            ...report.lostReasons.map((item) => ["Lost reason", item._id, item.count]),
            ...report.conversions.map((item) => ["Converted lead", item.customerName, "", 1, "", "", "", item.finalDealAmount]),
            ...report.lostLeads.map((item) => ["Lost lead", item.customerName, "", "", 1, "", "", "", "", item.lostReason]),
            ["Summary", "Confirmed income transactions", "", "", "", "", "", "", report.summary.confirmedIncome, ""]
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="crm-report.csv"');
        return res.status(200).send(rows.map((row) => row.map(csvCell).join(",")).join("\r\n"));
    } catch (error) {
        console.error("Export lead reports error:", error);
        return res.status(500).json({ message: "Could not export CRM reports" });
    }
};
