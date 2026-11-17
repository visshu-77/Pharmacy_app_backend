import leadActivityModel from "../model/leadActivity.js";
import leadNotificationModel from "../model/leadNotification.js";

export const activityActor = (user) => String(
    user.ownerName || user.name || user.email || "Account user"
).slice(0, 120);

export const recordLeadActivity = ({
    lead,
    user,
    type,
    message,
    description = "",
    previousStatus = "",
    newStatus = "",
    session = null
}) => {
    const activity = new leadActivityModel({
        userId: user.id,
        leadId: lead._id,
        type,
        message,
        description,
        previousStatus,
        newStatus,
        changedBy: activityActor(user),
        changedByUserId: user.id
    });
    return activity.save(session ? { session } : {});
};

export const createLeadNotification = async ({
    userId,
    leadId = null,
    followUpId = null,
    kind,
    title,
    message,
    eventKey
}) => {
    try {
        return await leadNotificationModel.findOneAndUpdate(
            { userId, eventKey },
            { $setOnInsert: { userId, leadId, followUpId, kind, title, message, eventKey } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (error?.code === 11000) {
            return leadNotificationModel.findOne({ userId, eventKey });
        }
        throw error;
    }
};
