import { askGemini } from "../services/geminiService.js";
import {
    getSalesData,
    getProductData,
    getTopSellingProducts,
    getCategoryPerformance,
    getSubscriptionData,
    getTransactionData
} from "../services/reportDataService.js";

import { detectQueryType } from "../services/aiQueryRouter.js";
import productModel from "../model/product.js";

export const askCustomerQuery = async (req, res) => {

    try {

        const { question } = req.body;

        if (!question || !question.trim()) {
            return res.status(400).json({
                message: "Question is required"
            });
        }
        const { queryTypes, range } = detectQueryType(question);

        console.log("Question:", question);
        console.log("Query Types:", queryTypes);


        const data = {};

        if (queryTypes.includes("products")) {

            const products = await productModel.find({
                userId: req.user.id
            }).select(
                "productName stock sellingPrice productCategory"
            );

            const totalProducts = products.length;

            const availableProducts = products.filter(
                product => product.stock > 0
            ).length;

            const outOfStockProducts = products.filter(
                product => product.stock === 0
            ).length;

            const totalStock = products.reduce(
                (total, product) => total + (product.stock || 0),
                0
            );

            data.products = {
                totalProducts,
                availableProducts,
                outOfStockProducts,
                totalStock,
                list: products
            };

            console.log("PRODUCT DATA:", data.products);
        }

        if (queryTypes.includes("sales")) {
            data.sales = await getSalesData(
                req.user.id
            );
        }

        // if (queryTypes.includes("products")) {
        //     data.products = await getProductData(
        //         req.user.id
        //     );
        // }

        if (queryTypes.includes("topProducts")) {
            data.topProducts = await getTopSellingProducts(
                req.user.id
            );
        }

        if (queryTypes.includes("category")) {
            data.category = await getCategoryPerformance(
                req.user.id
            );
        }

        if (queryTypes.includes("subscription")) {
            data.subscription = await getSubscriptionData(
                req.user.id
            );
        }

        if (queryTypes.includes("transactions")) {
            data.transactions = await getTransactionData(
                req.user.id
            );
        }

        const prompt = `
            You are an AI assistant for a shop management dashboard.

            Use ONLY the following shop data to answer the user's question.

            SHOP DATA:
            ${JSON.stringify(data, null, 2)}

            USER QUESTION:
            ${question}

            Rules:
            - Do not invent information.
            - Do not invent numbers.
            - Do not invent product names.
            - Do not invent customer names.
            - Use only the provided shop data.
            - If the answer cannot be determined from the provided data, say that the information is not available.
            - Keep the answer concise and easy to understand.
            `;

        const answer = await askGemini(prompt);

        return res.status(200).json({
            message: "AI response generated successfully",
            answer
        });

    } catch (error) {

        console.log("AI customer query error:", error);

        return res.status(500).json({
            message: "Failed to generate AI response"
        });
    }
};