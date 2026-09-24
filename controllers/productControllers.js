import productModel from '../model/product.js';
import categoryModel from "../model/category.js";
import userModel from "../model/users.js";
import { Parser } from 'json2csv';
import { Readable } from "stream";
import csv from "csv-parser";

import { getBusinessType } from "../config/businessTypes.js";

/**
 * Fields the client may set on a product. Anything else in the body is
 * ignored, so a business type that does not use (say) batch numbers simply
 * never sends one.
 */
const EDITABLE_FIELDS = [
    "productName",
    "productCategory",
    "sku",
    "barcode",
    "brand",
    "variant",
    "unit",
    "stock",
    "lowStockThreshold",
    "purchase",
    "sellingPrice",
    "mrp",
    "taxRate",
    "hsnCode",
    "ExpiryDate",
    "batchNumber",
    "warrantyMonths",
    "supplierName",
    "supplierId",
    "notes"
];

const NUMERIC_FIELDS = [
    "stock",
    "lowStockThreshold",
    "purchase",
    "sellingPrice",
    "mrp",
    "taxRate",
    "warrantyMonths"
];

const pickProductFields = (body) => {
    const data = {};

    for (const field of EDITABLE_FIELDS) {
        if (body[field] === undefined) continue;

        let value = body[field];

        if (NUMERIC_FIELDS.includes(field)) {
            if (value === "" || value === null) {
                value = field === "lowStockThreshold" ? null : 0;
            } else {
                value = Number(value);
                if (Number.isNaN(value)) continue;
            }
        }

        if (field === "ExpiryDate") {
            value = value ? new Date(value) : null;
            if (value && Number.isNaN(value.getTime())) value = null;
        }

        if (field === "supplierId" && !value) {
            value = null;
        }

        data[field] = value;
    }

    return data;
};

const validateProduct = (data, { partial = false } = {}) => {
    if (!partial || data.productName !== undefined) {
        if (!data.productName || !String(data.productName).trim()) {
            return "Product name is required";
        }
    }

    if (!partial || data.productCategory !== undefined) {
        if (!data.productCategory) {
            return "Category is required";
        }
    }

    if (!partial || data.stock !== undefined) {
        if (data.stock === undefined || data.stock === null) {
            return "Stock is required";
        }
        if (data.stock < 0) {
            return "Stock cannot be negative";
        }
    }

    if (data.sellingPrice !== undefined && data.sellingPrice < 0) {
        return "Selling price cannot be negative";
    }

    if (data.purchase !== undefined && data.purchase < 0) {
        return "Purchase price cannot be negative";
    }

    return "";
};

/** Resolve the shop's business profile so defaults match the kind of store. */
const getUserBusinessProfile = async (userId) => {
    const user = await userModel
        .findById(userId)
        .select("businessType preferences");

    return {
        profile: getBusinessType(user?.businessType),
        lowStockThreshold:
            user?.preferences?.lowStockThreshold ??
            getBusinessType(user?.businessType).lowStockThreshold
    };
};

export const addProduct = async (req, res) => {
    try {
        const data = pickProductFields(req.body);

        const message = validateProduct(data);

        if (message) {
            return res.status(400).json({ message });
        }

        const { profile } = await getUserBusinessProfile(req.user.id);

        // Shops that do not track expiry never store one, even if a stale
        // client sends the field.
        if (!profile.tracksExpiry) {
            data.ExpiryDate = null;
        }

        if (!profile.tracksBatch) {
            data.batchNumber = "";
        }

        if (!data.unit) {
            data.unit = profile.defaultUnit;
        }

        const product = await productModel.create({
            ...data,
            userId: req.user.id
        });

        const populated = await product.populate(
            "productCategory",
            "categoryName"
        );

        return res.status(201).json({
            message: "Product added successfully",
            product: populated
        });

    } catch (err) {
        console.log("Add product error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const getProduct = async (req, res) => {
    try {
        const products = await productModel
            .find({ userId: req.user.id })
            .populate("productCategory", "categoryName")
            .sort({ createdAt: -1 });

        const { profile, lowStockThreshold } =
            await getUserBusinessProfile(req.user.id);

        return res.status(200).json({
            message: "Products fetched successfully",
            products,
            meta: {
                businessType: profile.id,
                lowStockThreshold
            }
        });

    } catch (err) {
        console.log("Get products error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const deleted = await productModel.findOneAndDelete({
            _id: id,
            userId: req.user.id
        });

        if (!deleted) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product deleted successfully"
        });

    } catch (err) {
        console.log("Delete product error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const data = pickProductFields(req.body);

        const message = validateProduct(data, { partial: true });

        if (message) {
            return res.status(400).json({ message });
        }

        const { profile } = await getUserBusinessProfile(req.user.id);

        if (!profile.tracksExpiry) {
            delete data.ExpiryDate;
        }

        if (!profile.tracksBatch) {
            delete data.batchNumber;
        }

        const updated = await productModel.findOneAndUpdate(
            {
                _id: id,
                userId: req.user.id
            },
            data,
            {
                new: true,
                runValidators: true
            }
        ).populate("productCategory", "categoryName");

        if (!updated) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product updated successfully",
            product: updated
        });

    } catch (err) {
        console.log("Update product error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

/** CSV column order, shared by export and import so a round trip works. */
const CSV_COLUMNS = [
    ["Product", (p) => p.productName],
    ["SKU", (p) => p.sku],
    ["Barcode", (p) => p.barcode],
    ["Brand", (p) => p.brand],
    ["Variant", (p) => p.variant],
    ["Category", (p) => p.productCategory?.categoryName || ""],
    ["Unit", (p) => p.unit],
    ["Stock", (p) => p.stock],
    ["Purchase", (p) => p.purchase],
    ["Selling", (p) => p.sellingPrice],
    ["MRP", (p) => p.mrp],
    ["TaxRate", (p) => p.taxRate],
    ["HSN", (p) => p.hsnCode],
    ["Supplier", (p) => p.supplierName],
    ["Batch", (p) => p.batchNumber],
    [
        "Expiry",
        (p) =>
            p.ExpiryDate
                ? new Date(p.ExpiryDate).toISOString().slice(0, 10)
                : ""
    ],
    ["WarrantyMonths", (p) => p.warrantyMonths]
];

export const exportproducts = async (req, res) => {
    try {
        const products = await productModel
            .find({ userId: req.user.id })
            .populate("productCategory", "categoryName");

        const exportData = products.map((product) =>
            Object.fromEntries(
                CSV_COLUMNS.map(([header, read]) => [
                    header,
                    read(product) ?? ""
                ])
            )
        );

        const parser = new Parser({
            fields: CSV_COLUMNS.map(([header]) => header)
        });

        const csvOutput = parser.parse(exportData);

        res.header("Content-Type", "text/csv");
        res.attachment("products.csv");

        return res.send(csvOutput);

    } catch (err) {
        console.log("Export products error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

const parseCsvNumber = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") {
        return 0;
    }

    const parsed = Number(String(value).replace(/[^\d.-]/g, ""));

    return Number.isNaN(parsed) ? 0 : parsed;
};

const parseCsvDate = (value) => {
    if (!value) return null;

    const text = String(value).trim();

    if (!text || text.toLowerCase() === "n/a" || text === "-") return null;

    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const importProducts = async (req, res) => {
    try {
        if (!req.file) {
            // Either no file was attached, or the request wasn't sent as
            // multipart/form-data (a JSON Content-Type header hides the file).
            return res.status(400).json({
                message: "No CSV file received. Choose a .csv file and try again."
            });
        }

        const rows = [];

        await new Promise((resolve, reject) => {
            Readable.from(req.file.buffer)
                .pipe(csv())
                .on("data", (row) => rows.push(row))
                .on("end", resolve)
                .on("error", reject);
        });

        if (rows.length === 0) {
            return res.status(400).json({
                message: "The CSV file has no rows"
            });
        }

        const { profile } = await getUserBusinessProfile(req.user.id);

        // Cache categories so a 500-row import does not run 500 lookups.
        const categoryCache = new Map();

        const resolveCategory = async (name) => {
            const clean = (name || "").trim() || "Uncategorised";
            const key = clean.toLowerCase();

            if (categoryCache.has(key)) {
                return categoryCache.get(key);
            }

            let category = await categoryModel.findOne({
                categoryName: clean,
                userId: req.user.id
            });

            if (!category) {
                category = await categoryModel.create({
                    categoryName: clean,
                    userId: req.user.id
                });
            }

            categoryCache.set(key, category._id);

            return category._id;
        };

        const documents = [];
        const skipped = [];

        for (const [index, row] of rows.entries()) {
            const productName = (row.Product || row.Name || "").trim();

            if (!productName) {
                skipped.push({
                    row: index + 2,
                    reason: "Missing product name"
                });
                continue;
            }

            const unit = (row.Unit || "").trim();

            documents.push({
                productName,
                productCategory: await resolveCategory(row.Category),
                sku: (row.SKU || "").trim(),
                barcode: (row.Barcode || "").trim(),
                brand: (row.Brand || "").trim(),
                variant: (row.Variant || "").trim(),
                unit: profile.units.includes(unit) ? unit : profile.defaultUnit,
                stock: parseCsvNumber(row.Stock),
                purchase: parseCsvNumber(row.Purchase),
                sellingPrice: parseCsvNumber(row.Selling || row.Price),
                mrp: parseCsvNumber(row.MRP),
                taxRate: parseCsvNumber(row.TaxRate) || profile.defaultTaxRate,
                hsnCode: (row.HSN || "").trim(),
                supplierName: (row.Supplier || "").trim(),
                batchNumber: profile.tracksBatch ? (row.Batch || "").trim() : "",
                ExpiryDate: profile.tracksExpiry ? parseCsvDate(row.Expiry) : null,
                warrantyMonths: parseCsvNumber(row.WarrantyMonths),
                userId: req.user.id
            });
        }

        if (documents.length === 0) {
            return res.status(400).json({
                message: "No valid rows found in the CSV",
                skipped
            });
        }

        await productModel.insertMany(documents, { ordered: false });

        return res.status(200).json({
            message: "Products imported successfully",
            importedCount: documents.length,
            skippedCount: skipped.length,
            skipped
        });

    } catch (err) {
        console.log("Import error:", err);

        return res.status(500).json({
            message: "Failed to import products"
        });
    }
};

export const singleProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await productModel
            .findOne({
                _id: id,
                userId: req.user.id
            })
            .populate("productCategory", "categoryName");

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product fetched successfully",
            product
        });

    } catch (err) {
        console.log("Single product error:", err);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const searchProducts = async (req, res) => {
    try {
        const { search } = req.query;

        if (!search || !search.trim()) {
            return res.status(400).json({
                message: "Search text is required"
            });
        }

        const term = search.trim();

        // Escape regex metacharacters so a barcode with "+" or "." is literal.
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const products = await productModel
            .find({
                userId: req.user.id,
                $or: [
                    { productName: { $regex: safe, $options: "i" } },
                    { sku: { $regex: safe, $options: "i" } },
                    { barcode: { $regex: safe, $options: "i" } },
                    { brand: { $regex: safe, $options: "i" } }
                ]
            })
            .select(
                "productName sku barcode brand variant unit stock sellingPrice mrp purchase taxRate ExpiryDate batchNumber supplierName productCategory"
            )
            .populate("productCategory", "categoryName")
            .limit(25);

        return res.status(200).json({
            message: "Products found successfully",
            products
        });

    } catch (error) {
        console.log("Search product error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const deleteSelectedProducts = async (req, res) => {
    try {
        const { productIds } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({
                message: "No products selected"
            });
        }

        const result = await productModel.deleteMany({
            _id: { $in: productIds },
            userId: req.user.id
        });

        return res.status(200).json({
            message: "Selected products deleted successfully",
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.log("Delete selected products error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const deleteAllProducts = async (req, res) => {
    try {
        const result = await productModel.deleteMany({
            userId: req.user.id
        });

        return res.status(200).json({
            message: "All products deleted successfully",
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.log("Delete all products error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};
