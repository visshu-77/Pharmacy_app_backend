import { getLeadSettings, validateLeadSettingList } from "../services/leadSettingsService.js";

export const getCrmSettings = async (req, res) => {
    try {
        const settings = await getLeadSettings(req.user.id);
        return res.status(200).json({ settings });
    } catch (error) {
        console.error("Get CRM settings error:", error);
        return res.status(500).json({ message: "Could not load CRM settings" });
    }
};

export const updateCrmSettings = async (req, res) => {
    try {
        const key = String(req.params.key || "");
        const values = validateLeadSettingList(key, req.body.values);
        if (!values) {
            return res.status(400).json({
                message: "Choose a supported setting and provide up to 50 unique values (categories may be empty; other lists need at least one)."
            });
        }
        const current = await getLeadSettings(req.user.id);
        current[key] = values;
        await current.save();
        return res.status(200).json({ settings: current });
    } catch (error) {
        console.error("Update CRM settings error:", error);
        return res.status(500).json({ message: "Could not update CRM settings" });
    }
};
