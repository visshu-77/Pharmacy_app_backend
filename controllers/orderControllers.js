import mongoose from "mongoose";
import orderModel from "../model/order.js";
import productModel from "../model/product.js";

export const createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const {
            items,
            customerName,
            customerPhone,
            discount = 0,
            tax = 0,
            paymentMethod
        } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({
                message: "Cart is empty"
            });
        }

        if (!paymentMethod) {
            return res.status(400).json({
                message: "Payment method is required"
            });
        }
        const orderItems = [];
        let subtotal = 0;
        for (const item of items) {

            if (!mongoose.Types.ObjectId.isValid(item.productId)) {
                return res.status(400).json({
                    message: "Invalid product ID"
                });
            }

            const product = await productModel.findOne({
                _id: item.productId,
                userId: req.user.id
            }).session(session);

            if (!product) {
                return res.status(404).json({
                    message: `Product not found`
                });
            }


            // Quantities can be fractional for loose goods (1.5 kg, 2.5 m).
            if (!(Number(item.quantity) > 0)) {
                return res.status(400).json({
                    message: "Invalid quantity"
                });
            }

            if (product.stock < item.quantity) {
                return res.status(400).json({
                    message: `${product.productName} has only ${product.stock} ${product.unit || "units"} in stock`
                });
            }

            const price = product.sellingPrice;
            const total = Math.round(price * item.quantity * 100) / 100;
            subtotal += total;
            orderItems.push({
                productId: product._id,
                productName: product.productName,
                price,
                quantity: item.quantity,
                unit: product.unit || "piece",
                total
            });
        }

        const discountAmount = Number(discount) || 0;
        const taxAmount = Number(tax) || 0;

        const grandTotal =
            subtotal -
            discountAmount +
            taxAmount;

        if (grandTotal < 0) {
            return res.status(400).json({
                message: "Invalid total amount"
            });
        }

        const invoiceNumber =
            `INV-${Date.now()}`;

        const order = await orderModel.create([{
            invoiceNumber,
            userId: req.user.id,
            // Most counter sales are walk-ins; a name is optional.
            customerName: (customerName || "").trim() || "Walk-in customer",
            customerPhone: (customerPhone || "").trim(),
            items: orderItems,
            subtotal,
            discount: discountAmount,
            tax: taxAmount,
            grandTotal,
            paymentMethod,
            paymentStatus: "Paid"
        }],
        {
            session
        }
        );
        for (const item of items) {

            const updatedProduct = await productModel.findOneAndUpdate(
                {
                    _id: item.productId,
                    userId: req.user.id,
                    stock: {
                        $gte: item.quantity
                    }
                },
                {
                    $inc: {
                        stock: -item.quantity
                    }
                },
                {
                    new: true,
                    session
                }
            );
            if (!updatedProduct) {
                throw new Error(
                    "Product does not have enough stock"
                );
            }
        }

        await session.commitTransaction();
        return res.status(201).json({
            message: "Order created successfully",
            order: order[0]
        });
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        console.log("Create order error:", error);

        // Stock ran out between the check and the decrement (another bill).
        if (error.message === "Product does not have enough stock") {
            return res.status(409).json({
                message: "Stock changed while billing. Please review quantities and try again."
            });
        }

        return res.status(500).json({
            message: "Server error"
        });
    } finally {
       await session.endSession();
    }
};