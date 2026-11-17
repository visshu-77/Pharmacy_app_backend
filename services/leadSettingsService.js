import leadSettingsModel from "../model/leadSettings.js";

export const DEFAULT_LEAD_SETTINGS = {
    sources: [
        "Website", "Google Ads", "Facebook Ads", "Facebook", "Instagram",
        "WhatsApp", "Referral", "Direct Call", "Walk-in", "LinkedIn", "Email", "Other"
    ],
    categories: [],
    lostReasons: [
        "Budget Issue", "Competitor Selected", "Customer Not Interested", "No Response",
        "Price Too High", "Service Not Available", "Project Cancelled", "Other"
    ],
    priorities: ["Low", "Medium", "High", "Urgent"],
    followUpTypes: ["Phone Call", "WhatsApp", "Email", "Online Meeting", "Physical Meeting", "Other"]
};

const normalizeList = (values, { allowEmpty = false } = {}) => {
    if (!Array.isArray(values) || values.length > 50) return null;
    const list = [];
    const seen = new Set();
    for (const rawValue of values) {
        if (typeof rawValue !== "string") return null;
        const value = rawValue.trim();
        if (!value || value.length > 60) return null;
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        list.push(value);
    }
    return !allowEmpty && !list.length ? null : list;
};

export const validateLeadSettingList = (key, values) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LEAD_SETTINGS, key)) return null;
    return normalizeList(values, { allowEmpty: key === "categories" });
};

export const getLeadSettings = async (userId) => {
    const defaults = { ...DEFAULT_LEAD_SETTINGS, userId };
    return leadSettingsModel.findOneAndUpdate(
        { userId },
        { $setOnInsert: defaults },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
};

export const isAllowedLeadSetting = async (userId, key, value) => {
    const settings = await getLeadSettings(userId);
    return settings[key].includes(value);
};
