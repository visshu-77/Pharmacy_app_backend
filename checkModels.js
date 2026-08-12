import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function checkModels() {
    try {
        const models = await ai.models.list();

        for await (const model of models) {
            console.log(
                model.name,
                model.supportedActions
            );
        }

    } catch (error) {
        console.error(error);
    }
}

checkModels();