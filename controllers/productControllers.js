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

/**
 * Turns raw CSV rows into product documents. Shared by the file upload and the
 * batched import the UI uses to show real progress.
 *
 * Returns { entries, skipped } — an entry is { document, line, provided },
 * where `provided` lists the columns the row actually filled in, so an update
 * never overwrites saved details with blanks. A bad row is skipped with a
 * reason rather than failing the whole file.
 */
const buildProductDocuments = async (rows, userId, profile, rowOffset = 0) => {
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
            userId
        });

        if (!category) {
            category = await categoryModel.create({
                categoryName: clean,
                userId
            });
        }

        categoryCache.set(key, category._id);

        return category._id;
    };

    const entries = [];
    const skipped = [];

    for (const [index, row] of rows.entries()) {
        const productName = (row.Product || row.Name || "").trim();

        // +2: CSV line numbers start at 1 and row 1 is the header.
        const lineNumber = rowOffset + index + 2;

        if (!productName) {
            skipped.push({ row: lineNumber, reason: "Missing product name" });
            continue;
        }

        const unit = (row.Unit || "").trim();

        const document = {
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
            userId
        };

        // Which detail columns this row actually filled in. Used when the
        // product already exists, so an empty cell leaves the saved value be.
        const provided = new Set();
        const mark = (field, value) => {
            if (String(value ?? "").trim()) provided.add(field);
        };

        mark("productCategory", row.Category);
        mark("sku", row.SKU);
        mark("barcode", row.Barcode);
        mark("brand", row.Brand);
        mark("variant", row.Variant);
        mark("unit", row.Unit);
        mark("purchase", row.Purchase);
        mark("sellingPrice", row.Selling || row.Price);
        mark("mrp", row.MRP);
        mark("taxRate", row.TaxRate);
        mark("hsnCode", row.HSN);
        mark("supplierName", row.Supplier);
        if (profile.tracksBatch) mark("batchNumber", row.Batch);
        if (profile.tracksExpiry && document.ExpiryDate) provided.add("ExpiryDate");
        mark("warrantyMonths", row.WarrantyMonths);

        entries.push({ document, line: lineNumber, provided });
    }

    return { entries, skipped };
};

/**
 * Keys a product can be recognised by, strongest first.
 *
 * `forLookup` drops the name-only key when the row names a variant: "Cable
 * 2 m" should not be taken for the "Cable 1 m" already on file. A row with no
 * variant at all just means "the item called X", so it may use that key.
 */
const productMatchKeys = (product, { forLookup = false } = {}) => {
    const keys = [];
    const sku = (product.sku || "").trim().toLowerCase();
    const barcode = (product.barcode || "").trim().toLowerCase();
    const name = (product.productName || "").trim().toLowerCase();
    const variant = (product.variant || "").trim().toLowerCase();

    if (sku) keys.push(`sku:${sku}`);
    if (barcode) keys.push(`barcode:${barcode}`);
    keys.push(`name:${name}|${variant}`);
    if (!forLookup || !variant) keys.push(`title:${name}`);

    return keys;
};

// Details worth refreshing when a row matches a product already on file.
const UPDATABLE_FIELDS = [
    "productCategory", "sku", "barcode", "brand", "variant", "unit",
    "purchase", "sellingPrice", "mrp", "taxRate", "hsnCode",
    "supplierName", "batchNumber", "ExpiryDate", "warrantyMonths"
];

/**
 * Saves built rows, treating a product already on file as the same product
 * instead of creating a second copy of it.
 *
 * A row matches an existing product by SKU, then barcode, then name + variant
 * (all case-insensitive, and only within this shop's own products).
 *
 * `mode` decides what happens on a match:
 *   add     — add the row's stock to what is already there (default; this is
 *             what re-importing a delivery sheet means)
 *   replace — set stock to the row's number
 *   skip    — leave the product completely alone
 *
 * Matching rows *inside* one file are merged the same way, so a CSV listing
 * the same item twice ends up as one product.
 *
 * Returns { insertedCount, updatedCount, skipped }.
 */
const saveImportedProducts = async (entries, userId, mode = "add") => {
    const skipped = [];

    if (entries.length === 0) {
        return { insertedCount: 0, updatedCount: 0, skipped };
    }

    const skus = [];
    const barcodes = [];
    const names = [];

    for (const { document } of entries) {
        if (document.sku) skus.push(document.sku);
        if (document.barcode) barcodes.push(document.barcode);
        names.push(document.productName);
    }

    const or = [{ productName: { $in: names } }];
    if (skus.length) or.push({ sku: { $in: skus } });
    if (barcodes.length) or.push({ barcode: { $in: barcodes } });

    const existing = await productModel
        .find({ userId, $or: or })
        .select("productName variant sku barcode")
        // strength 2 = ignore case, so "Basmati Rice" finds "basmati rice".
        .collation({ locale: "en", strength: 2 })
        .lean();

    // key -> "db:<id>" for a product already saved, or "new:<n>" for one this
    // run is about to insert. First writer wins, so a strong key (SKU) is never
    // overwritten by a weak one (name).
    const byKey = new Map();

    // Names held by more than one product (two variants of one item). Matching
    // on the name alone would be a coin toss, so those rows are left to the
    // stronger keys or treated as new.
    const ambiguous = new Set();

    const remember = (keys, token) => {
        for (const key of keys) {
            const held = byKey.get(key);

            if (held === undefined) byKey.set(key, token);
            else if (held !== token && key.startsWith("title:")) ambiguous.add(key);
        }
    };

    for (const product of existing) {
        remember(productMatchKeys(product), `db:${product._id}`);
    }

    const inserts = [];                  // documents to create, in order
    const updates = new Map();           // "db:<id>" -> { id, stockDelta, stockSet, set }

    /** Applies one row onto a target already chosen for it. */
    const merge = (target, { document, provided }) => {
        if (mode === "replace") target.stockSet = document.stock;
        else target.stockDelta += document.stock;

        for (const field of UPDATABLE_FIELDS) {
            if (provided.has(field)) target.set[field] = document[field];
        }
    };

    for (const entry of entries) {
        const { document, line } = entry;
        const keys = productMatchKeys(document);
        const token = productMatchKeys(document, { forLookup: true })
            .map((key) => (ambiguous.has(key) ? undefined : byKey.get(key)))
            .find(Boolean);

        if (token?.startsWith("db:")) {
            if (mode === "skip") {
                skipped.push({ row: line, reason: "Already in your list" });
                continue;
            }

            if (!updates.has(token)) {
                updates.set(token, {
                    id: token.slice(3),
                    stockDelta: 0,
                    stockSet: null,
                    set: {}
                });
            }

            merge(updates.get(token), entry);
            continue;
        }

        if (token?.startsWith("new:")) {
            // The same item listed twice in one file: fold it into the first
            // copy instead of inserting a twin.
            const insert = inserts[Number(token.slice(4))];

            if (mode === "skip") {
                skipped.push({ row: line, reason: "Listed earlier in this file" });
                continue;
            }

            const folded = { stockDelta: 0, stockSet: null, set: {} };
            merge(folded, entry);

            insert.stock = folded.stockSet !== null
                ? folded.stockSet
                : insert.stock + folded.stockDelta;

            Object.assign(insert, folded.set);
            continue;
        }

        remember(keys, `new:${inserts.length}`);
        inserts.push({ ...document });
    }

    let insertedCount = 0;

    if (inserts.length > 0) {
        const saved = await productModel.insertMany(inserts, { ordered: false });
        insertedCount = saved.length;
    }

    const operations = [];

    for (const update of updates.values()) {
        const write = {};

        if (Object.keys(update.set).length > 0) write.$set = { ...update.set };
        if (update.stockSet !== null) write.$set = { ...(write.$set || {}), stock: update.stockSet };
        else if (update.stockDelta) write.$inc = { stock: update.stockDelta };

        if (Object.keys(write).length === 0) continue;

        operations.push({
            updateOne: { filter: { _id: update.id, userId }, update: write }
        });
    }

    if (operations.length > 0) {
        await productModel.bulkWrite(operations, { ordered: false });
    }

    return { insertedCount, updatedCount: operations.length, skipped };
};

/** Only these three are meaningful; anything else falls back to adding stock. */
const readDuplicateMode = (value) =>
    ["add", "replace", "skip"].includes(value) ? value : "add";

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

        const { entries, skipped } = await buildProductDocuments(
            rows,
            req.user.id,
            profile
        );

        if (entries.length === 0) {
            return res.status(400).json({
                message: "No valid rows found in the CSV",
                skipped
            });
        }

        const saved = await saveImportedProducts(
            entries,
            req.user.id,
            readDuplicateMode(req.body?.duplicateMode)
        );

        const allSkipped = [...skipped, ...saved.skipped].sort((a, b) => a.row - b.row);

        return res.status(200).json({
            message: "Products imported successfully",
            importedCount: saved.insertedCount,
            updatedCount: saved.updatedCount,
            skippedCount: allSkipped.length,
            skipped: allSkipped
        });

    } catch (err) {
        console.log("Import error:", err);

        return res.status(500).json({
            message: "Failed to import products"
        });
    }
};

/**
 * POST /product/import-batch
 *
 * Imports one chunk of rows already parsed by the browser. The UI sends the
 * file in small batches so it can show true progress ("120 of 500") and report
 * exactly which rows were skipped.
 *
 * Body: { rows: [...], rowOffset?: number, duplicateMode?: add|replace|skip }
 */
export const importProductsBatch = async (req, res) => {
    try {
        const { rows, rowOffset = 0, duplicateMode } = req.body;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No rows received" });
        }

        if (rows.length > 200) {
            return res.status(400).json({ message: "Send at most 200 rows per batch" });
        }

        const { profile } = await getUserBusinessProfile(req.user.id);

        const { entries, skipped } = await buildProductDocuments(
            rows,
            req.user.id,
            profile,
            Number(rowOffset) || 0
        );

        const saved = await saveImportedProducts(
            entries,
            req.user.id,
            readDuplicateMode(duplicateMode)
        );

        const allSkipped = [...skipped, ...saved.skipped].sort((a, b) => a.row - b.row);

        return res.status(200).json({
            importedCount: saved.insertedCount,
            updatedCount: saved.updatedCount,
            skippedCount: allSkipped.length,
            skipped: allSkipped
        });

    } catch (error) {
        console.log("Import batch error:", error);

        return res.status(500).json({ message: "Failed to import this batch" });
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
