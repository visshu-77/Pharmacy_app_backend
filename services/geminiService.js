import { GoogleGenAI } from "@google/genai";

// Created on first use so it picks up GEMINI_API_KEY after .env is loaded.
let ai = null;

const client = () => {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return ai;
};

export const askGemini = async (prompt) => {
    const response = await client().models.generateContent({
        model: "gemini-3.5-flash",
        contents:prompt
    })

    return response.text;
}