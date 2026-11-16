import CashReceipt from "../model/cashReceipt.js";

export const createCashReceipt = async (req, res) => {
    const recipient = typeof req.body?.recipient === "string"
        ? req.body.recipient.trim()
        : "";
    const totalAmount = Number(req.body?.totalAmount);
    const cashReceived = Number(req.body?.cashReceived);

    if (!recipient) {
        return res.status(400).json({ message: "Name is required" });
    }

    if (recipient.length > 120) {
        return res.status(400).json({ message: "Name must be 120 characters or fewer" });
    }

    const roundedTotal = Math.round(totalAmount * 100) / 100;
    const roundedCashReceived = Math.round(cashReceived * 100) / 100;
    if (
        !Number.isFinite(totalAmount) ||
        !Number.isFinite(cashReceived) ||
        !Number.isFinite(roundedTotal) ||
        !Number.isFinite(roundedCashReceived) ||
        roundedTotal < 0.01 ||
        roundedCashReceived < 0.01
    ) {
        return res.status(400).json({ message: "Total amount and cash received must be at least 0.01" });
    }

    if (roundedCashReceived > roundedTotal) {
        return res.status(400).json({ message: "Cash received cannot exceed the total amount" });
    }

    try {
        const receipt = new CashReceipt({
            userId: req.user.id,
            recipient,
            totalAmount: roundedTotal,
            cashReceived: roundedCashReceived,
            remainingAmount: Math.round((roundedTotal - roundedCashReceived) * 100) / 100
        });
        const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        receipt.receiptNumber = `CR-${datePart}-${receipt._id.toString().slice(-8).toUpperCase()}`;
        await receipt.save();

        return res.status(201).json({
            message: "Cash receipt saved",
            receipt
        });
    } catch (error) {
        console.log("Create cash receipt error:", error);
        return res.status(500).json({ message: "Could not save cash receipt" });
    }
};

export const getCashReceiptHistory = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const filter = { userId: req.user.id };
        const [receipts, total] = await Promise.all([
            CashReceipt
                .find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            CashReceipt.countDocuments(filter)
        ]);

        return res.status(200).json({
            receipts,
            page,
            hasMore: page * limit < total
        });
    } catch (error) {
        console.log("Get cash receipt history error:", error);
        return res.status(500).json({ message: "Could not load cash receipt history" });
    }
};
