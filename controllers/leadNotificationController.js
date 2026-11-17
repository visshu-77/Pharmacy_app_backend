import leadNotificationModel from "../model/leadNotification.js";
import { validObjectId } from "../services/leadService.js";

export const getLeadNotifications = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
        const filter = { userId: req.user.id };
        const [notifications, total, unreadCount] = await Promise.all([
            leadNotificationModel.find(filter).sort({ createdAt: -1 })
                .skip((page - 1) * limit).limit(limit).lean(),
            leadNotificationModel.countDocuments(filter),
            leadNotificationModel.countDocuments({ ...filter, readAt: null })
        ]);
        return res.status(200).json({ notifications, total, unreadCount, page, limit, hasMore: page * limit < total });
    } catch (error) {
        console.error("Get lead notifications error:", error);
        return res.status(500).json({ message: "Could not load CRM notifications" });
    }
};

export const markLeadNotificationRead = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid notification ID" });
        const notification = await leadNotificationModel.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: { readAt: new Date() } },
            { new: true }
        );
        if (!notification) return res.status(404).json({ message: "Notification not found" });
        return res.status(200).json({ notification });
    } catch (error) {
        console.error("Mark lead notification read error:", error);
        return res.status(500).json({ message: "Could not update notification" });
    }
};

export const markAllLeadNotificationsRead = async (req, res) => {
    try {
        await leadNotificationModel.updateMany(
            { userId: req.user.id, readAt: null },
            { $set: { readAt: new Date() } }
        );
        return res.status(200).json({ message: "Notifications marked as read" });
    } catch (error) {
        console.error("Mark all lead notifications read error:", error);
        return res.status(500).json({ message: "Could not update notifications" });
    }
};
