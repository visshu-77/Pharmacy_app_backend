import leadFollowUpModel from "../model/leadFollowUp.js";
import { createLeadNotification } from "./leadActivityService.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_SCHEDULED_LOOKAHEAD_MS = 48 * 60 * 60 * 1000;

export const runLeadNotificationCheck = async (now = new Date()) => {
    const upperBound = new Date(now.getTime() + MAX_SCHEDULED_LOOKAHEAD_MS);
    const followUps = await leadFollowUpModel.find({
        status: "Pending",
        scheduledAt: { $lte: upperBound }
    }).select("_id userId leadId type scheduledAt reminderMinutes").lean();

    for (const followUp of followUps) {
        const scheduledAt = new Date(followUp.scheduledAt);
        const dateText = scheduledAt.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
            timeStyle: "short"
        });

        if (scheduledAt <= now) {
            await createLeadNotification({
                userId: followUp.userId,
                leadId: followUp.leadId,
                followUpId: followUp._id,
                kind: "followup_overdue",
                title: "Overdue follow-up",
                message: `${followUp.type} follow-up is overdue (${dateText}).`,
                eventKey: `followup:${followUp._id}:overdue`
            });
        } else if (scheduledAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) {
            await createLeadNotification({
                userId: followUp.userId,
                leadId: followUp.leadId,
                followUpId: followUp._id,
                kind: "followup_upcoming",
                title: "Upcoming follow-up",
                message: `${followUp.type} follow-up is scheduled for ${dateText}.`,
                eventKey: `followup:${followUp._id}:upcoming`
            });
        }

        if (followUp.reminderMinutes > 0) {
            const reminderAt = new Date(scheduledAt.getTime() - followUp.reminderMinutes * 60000);
            if (reminderAt <= now && scheduledAt > now) {
                await createLeadNotification({
                    userId: followUp.userId,
                    leadId: followUp.leadId,
                    followUpId: followUp._id,
                    kind: "followup_upcoming",
                    title: "Follow-up reminder",
                    message: `${followUp.type} follow-up starts in ${followUp.reminderMinutes} minutes.`,
                    eventKey: `followup:${followUp._id}:reminder`
                });
            }
        }
    }
};

export const startLeadNotificationScheduler = () => {
    const check = () => runLeadNotificationCheck().catch((error) => {
        console.error("Lead follow-up notification check failed:", error);
    });

    check();
    return setInterval(check, CHECK_INTERVAL_MS);
};
