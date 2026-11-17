import leadModel from "../model/lead.js";
import { validObjectId } from "../services/leadService.js";
import { recordLeadActivity } from "../services/leadActivityService.js";

const ACTIVITY_TYPES = {
    call_made: "Call made",
    whatsapp_message: "WhatsApp message",
    email_sent: "Email sent",
    meeting_completed: "Meeting completed",
    notes_added: "Note added"
};

export const addLeadActivity = async (req, res) => {
    try {
        if (!validObjectId(req.params.id)) return res.status(400).json({ message: "Invalid lead ID" });
        const type = String(req.body.type || "");
        const description = String(req.body.description || "").trim();
        if (!ACTIVITY_TYPES[type]) return res.status(400).json({ message: "Choose a valid activity type" });
        if (!description || description.length > 2000) {
            return res.status(400).json({ message: "Activity details are required (up to 2000 characters)" });
        }
        const lead = await leadModel.findOne({
            _id: req.params.id, userId: req.user.id, isMerged: { $ne: true }
        });
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        const activity = await recordLeadActivity({
            lead,
            user: req.user,
            type,
            message: ACTIVITY_TYPES[type],
            description
        });
        return res.status(201).json({ activity });
    } catch (error) {
        console.error("Add lead activity error:", error);
        return res.status(500).json({ message: "Could not record lead activity" });
    }
};
