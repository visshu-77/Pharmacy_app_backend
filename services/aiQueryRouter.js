import productModel from "../model/product.js";

export const detectQueryType = (question) => {

    const text = question.toLowerCase().trim();

    const queryTypes = [];

    // --------------------------------
    // Detect data type
    // --------------------------------

    if (
        text.includes("category") &&
        (
            text.includes("product") ||
            text.includes("sales")
        )
    ) {
        queryTypes.push("category", "topProducts");
    }

    else if (
        text.includes("subscription") ||
        text.includes("plan") ||
        text.includes("expire") ||
        text.includes("renewal") ||
        text.includes("membership")
    ) {
        queryTypes.push("subscription");
    }

    else if (
        text.includes("transaction") ||
        text.includes("payment") ||
        text.includes("cash") ||
        text.includes("upi") ||
        text.includes("razorpay")
    ) {
        queryTypes.push("transactions");
    }

    else if (
        text.includes("category") ||
        text.includes("categories")
    ) {
        queryTypes.push("category");
    }

    else if (
        text.includes("top product") ||
        text.includes("best product") ||
        text.includes("most sold") ||
        text.includes("highest selling") ||
        text.includes("best selling")
    ) {
        queryTypes.push("topProducts");
    }

    else if (
        text.includes("product") ||
        text.includes("products") ||
        text.includes("stock") ||
        text.includes("inventory") ||
        text.includes("out of stock") ||
        text.includes("low stock") ||
        text.includes("running low") ||
        text.includes("available product") ||
        text.includes("available products")
    ) {
        queryTypes.push("products");
    }

    else if (
        text.includes("sales") ||
        text.includes("revenue") ||
        text.includes("orders") ||
        text.includes("order") ||
        text.includes("earned") ||
        text.includes("earn") ||
        text.includes("sold")
    ) {
        queryTypes.push("sales");
    }

    else {
        queryTypes.push("sales");
    }


    // --------------------------------
    // Detect date range
    // --------------------------------

    let range = "allTime";

    if (
        text.includes("today")
    ) {
        range = "today";
    }

    else if (
        text.includes("this week") ||
        text.includes("current week")
    ) {
        range = "thisWeek";
    }

    else if (
        text.includes("this month") ||
        text.includes("current month")
    ) {
        range = "thisMonth";
    }

    else if (
        text.includes("last month") ||
        text.includes("previous month")
    ) {
        range = "lastMonth";
    }

    else if (
        text.includes("last 3 months") ||
        text.includes("last three months")
    ) {
        range = "last3Months";
    }

    else if (
        text.includes("this year") ||
        text.includes("current year")
    ) {
        range = "thisYear";
    }


    return {
        queryTypes: [...new Set(queryTypes)],
        range
    };
};