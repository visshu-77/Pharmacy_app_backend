import mongoose from 'mongoose';

import { ALL_UNITS } from '../config/businessTypes.js';

/**
 * One sellable line item, whatever the shop sells.
 *
 * Fields are deliberately a superset across business types; the UI only shows
 * the ones the owner's business type profile marks as relevant (a hardware
 * store never sees expiry, a pharmacy always does).
 */
const productSchema = new mongoose.Schema({
    productName: {
        type: String,
        required: true,
        trim: true
    },

    productCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "/dashaboard/categories",
        required: true,
    },

    /** Owner's own code. Unique per shop when present. */
    sku: {
        type: String,
        default: "",
        trim: true
    },

    /** EAN/UPC or any scanner-readable code. */
    barcode: {
        type: String,
        default: "",
        trim: true
    },

    brand: {
        type: String,
        default: "",
        trim: true
    },

    /** Free text so shops can describe size/variant: "500ml", "XL", "12mm". */
    variant: {
        type: String,
        default: "",
        trim: true
    },

    unit: {
        type: String,
        enum: ALL_UNITS,
        default: "piece"
    },

    stock: {
        type: Number,
        required: true,
        default: 0
    },

    /** Per-product override of the shop-wide low stock threshold. */
    lowStockThreshold: {
        type: Number,
        default: null
    },

    purchase: {
        type: Number,
        default: 0
    },

    sellingPrice: {
        type: Number,
        default: 0
    },

    /** Printed/maximum retail price, shown on the invoice as the "you saved". */
    mrp: {
        type: Number,
        default: 0
    },

    /** GST / VAT percentage applied at billing time. */
    taxRate: {
        type: Number,
        default: 0
    },

    hsnCode: {
        type: String,
        default: "",
        trim: true
    },

    /** Perishables and regulated goods only. Null means "does not expire". */
    ExpiryDate: {
        type: Date,
        default: null
    },

    /** Batch / lot number, for business types that track it. */
    batchNumber: {
        type: String,
        default: "",
        trim: true
    },

    /** Months of warranty — electronics, mobile, appliances, auto parts. */
    warrantyMonths: {
        type: Number,
        default: 0
    },

    /**
     * Suppliers are stored by name (what the UI collects) with an optional
     * reference when the owner picked one from their supplier book.
     */
    supplierName: {
        type: String,
        default: "",
        trim: true
    },

    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "dashboard/suppliers",
        default: null
    },

    notes: {
        type: String,
        default: ""
    },

    isActive: {
        type: Boolean,
        default: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "dashboard/userData",
        required: true
    }
}, {
    timestamps: true
});

productSchema.index({ userId: 1, productName: 1 });
productSchema.index({ userId: 1, barcode: 1 });
productSchema.index({ userId: 1, sku: 1 });

const product = mongoose.model("dashboard/products", productSchema);
export default product;
