import express from "express";
import {
    bulkUpdateLeads,
    changeLeadStatus,
    createLead,
    createLeadStatus,
    deleteLead,
    exportLeads,
    getLead,
    getLeadDashboard,
    getLeadStatuses,
    getLeads,
    updateLead,
    updateLeadStatus
} from "../controllers/leadController.js";
import {
    addLeadActivity
} from "../controllers/leadActivityController.js";
import {
    convertLead,
    getLeadConversion,
    markLeadLost
} from "../controllers/leadOutcomeController.js";
import {
    createLeadFollowUp,
    getLeadFollowUps,
    updateLeadFollowUp
} from "../controllers/leadFollowUpController.js";
import {
    getLeadPipeline,
    getLeadTeamSummary
} from "../controllers/leadWorkspaceController.js";
import {
    getLeadNotifications,
    markAllLeadNotificationsRead,
    markLeadNotificationRead
} from "../controllers/leadNotificationController.js";
import { getCrmSettings, updateCrmSettings } from "../controllers/leadSettingsController.js";
import { exportLeadReports, getLeadReports } from "../controllers/leadReportController.js";
import {
    checkLeadDuplicates,
    getLeadDuplicates,
    mergeDuplicateLead
} from "../controllers/leadDuplicateController.js";
import { recordLeadIncome } from "../controllers/leadIncomeController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

router.use(authMiddleware, checkSubscription);

router.get("/dashboard", getLeadDashboard);
router.get("/reports", getLeadReports);
router.get("/reports/export", exportLeadReports);
router.get("/settings", getCrmSettings);
router.patch("/settings/:key", updateCrmSettings);
router.post("/duplicates/check", checkLeadDuplicates);
router.get("/pipeline", getLeadPipeline);
router.get("/team", getLeadTeamSummary);
router.get("/notifications", getLeadNotifications);
router.patch("/notifications/read-all", markAllLeadNotificationsRead);
router.patch("/notifications/:id/read", markLeadNotificationRead);
router.get("/followups", getLeadFollowUps);
router.post("/followups", createLeadFollowUp);
router.patch("/followups/:id", updateLeadFollowUp);
router.get("/export", exportLeads);
router.get("/statuses", getLeadStatuses);
router.post("/statuses", createLeadStatus);
router.patch("/statuses/:id", updateLeadStatus);

router.patch("/bulk", bulkUpdateLeads);
router.get("/", getLeads);
router.post("/", createLead);
router.post("/:id/merge", mergeDuplicateLead);
router.post("/:id/record-income", recordLeadIncome);
router.get("/:id", getLead);
router.get("/:id/duplicates", getLeadDuplicates);
router.get("/:id/conversion", getLeadConversion);
router.post("/:id/activities", addLeadActivity);
router.post("/:id/convert", convertLead);
router.post("/:id/lost", markLeadLost);
router.patch("/:id/status", changeLeadStatus);
router.patch("/:id", updateLead);
router.delete("/:id", deleteLead);

export default router;