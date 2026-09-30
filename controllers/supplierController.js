import mongoose from "mongoose";
import supplierModel from "../model/Supplier.js";

export const createSupplier = async (req, res) => {
    try {
        const {
            supplierName,
            phone,
            email,
            address,
            city,
            state,
            gstNumber
        } = req.body;

        let message = "";

        if(!supplierName){
            message = "Supplier Name is Required";
        }else if(!phone){
            message = "Phone number is required";
        }else if(!address){
            message = "Address is required";
        }else if(!city){
            message = "City is required";
        }else if(phone == 10){
            message = "Phone number should be 10 digits"
        }

        if (message) {
            return res.status(400).json({
                message
            });
        }

        const userId = req.user.id;

        const existingSupplier = await supplierModel.findOne({
            userId,
            supplierName
        });

        if (existingSupplier) {

            return res.status(409).json({
                message: "Supplier already exists"
            });

        }

        const supplier = await supplierModel.create({

            supplierName,
            phone,
            email,
            address,
            city,
            state,
            gstNumber,
            userId

        });

        return res.status(201).json({

            message: "Supplier created successfully",

            supplier

        });


    } catch (err) {
        console.log(err)
        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const getSuppliers = async (req, res) => {
    try {

        const userId = req.user.id;

        const suppliers = await supplierModel
            .find({ userId })
            .sort({ createdAt: -1 });

        return res.status(200).json({
            message: "Suppliers fetched successfully",
            suppliers
        });

    } catch (error) {

        console.log("Get suppliers error:", error);

        return res.status(500).json({
            message: "Server Error"
        });

    }
};

export const getSupplierById = async (req, res) => {
    try {

        const { id } = req.params;
        const userId = req.user.id;

        const supplier = await supplierModel.findOne({
            _id: id,
            userId
        });

        if (!supplier) {
            return res.status(404).json({
                message: "Supplier not found"
            });
        }

        return res.status(200).json({
            message: "Supplier fetched successfully",
            supplier
        });

    } catch (error) {

        console.log("Get supplier error:", error);

        return res.status(500).json({
            message: "Server Error"
        });

    }
};

export const updateSupplier = async (req, res) => {
    try {

        const { id } = req.params;
        const userId = req.user.id;

        const {
            supplierName,
            phone,
            email,
            address,
            city,
            state,
            gstNumber
        } = req.body;

        const supplier = await supplierModel.findOne({
            _id: id,
            userId
        });

        if (!supplier) {
            return res.status(404).json({
                message: "Supplier not found"
            });
        }

        supplier.supplierName = supplierName ?? supplier.supplierName;
        supplier.phone = phone ?? supplier.phone;
        supplier.email = email ?? supplier.email;
        supplier.address = address ?? supplier.address;
        supplier.city = city ?? supplier.city;
        supplier.state = state ?? supplier.state;
        supplier.gstNumber = gstNumber ?? supplier.gstNumber;

        await supplier.save();

        return res.status(200).json({
            message: "Supplier updated successfully",
            supplier
        });

    } catch (error) {

        console.log("Update supplier error:", error);

        return res.status(500).json({
            message: "Server Error"
        });

    }
};

export const deleteSupplier = async (req, res) => {
    try {

        const { id } = req.params;
        const userId = req.user.id;

        const supplier = await supplierModel.findOneAndDelete({
            _id: id,
            userId
        });

        if (!supplier) {
            return res.status(404).json({
                message: "Supplier not found"
            });
        }

        return res.status(200).json({
            message: "Supplier deleted successfully"
        });

    } catch (error) {

        console.log("Delete supplier error:", error);

        return res.status(500).json({
            message: "Server Error"
        });

    }
};

export const importSuppliers = async (req, res) => {
    try {
        const suppliers = req.body.suppliers;

        if (!suppliers || !Array.isArray(suppliers)) {
            return res.status(400).json({
                message: "Invalid supplier data"
            });
        }

        if (suppliers.length === 0) {
            return res.status(400).json({
                message: "No suppliers found in CSV"
            });
        }

        const supplierData = suppliers.map((supplier) => ({
            supplierName: supplier.supplierName?.trim() || "",
            phone: supplier.phone?.trim() || "",
            email: supplier.email?.trim() || "",
            address: supplier.address?.trim() || "",
            city: supplier.city?.trim() || "",
            state: supplier.state?.trim() || "",
            gstNumber: supplier.gstNumber?.trim() || "",
            userId: req.user.id
        }));

        // Validate required fields
        const invalidRows = supplierData.filter(
            (supplier) =>
                !supplier.supplierName ||
                !supplier.phone
        );

        if (invalidRows.length > 0) {
            return res.status(400).json({
                message:
                    "Some CSV rows are missing supplier name or phone number"
            });
        }

        const createdSuppliers = await supplierModel.insertMany(
            supplierData
        );

        return res.status(201).json({
            message: "Suppliers imported successfully",
            importedCount: createdSuppliers.length,
            suppliers: createdSuppliers
        });

    } catch (error) {

        console.log("Import suppliers error:", error);

        return res.status(500).json({
            message: "Failed to import suppliers"
        });
    }
};

export const deleteSelectedSuppliers = async (req, res) => {
    try {
        const { supplierIds } = req.body;

        if (!supplierIds || !Array.isArray(supplierIds)) {
            return res.status(400).json({
                message: "Supplier IDs are required"
            });
        }

        if (supplierIds.length === 0) {
            return res.status(400).json({
                message: "Please select at least one supplier"
            });
        }

        const result = await supplierModel.deleteMany({
            _id: { $in: supplierIds },
            userId: req.user.id
        });

        return res.status(200).json({
            message: "Selected suppliers deleted successfully",
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.log("Delete selected suppliers error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const deleteAllSuppliers = async (req, res) => {
    try {

        const result = await supplierModel.deleteMany({
            userId: req.user.id
        });

        return res.status(200).json({
            message: "All suppliers deleted successfully",
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.log("Delete all suppliers error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export const searchSuppliers = async (req, res) => {
    try {
        const { name } = req.query;

        if (!name || !name.trim()) {
            return res.status(200).json({
                suppliers: []
            });
        }

        const suppliers = await supplierModel
            .find({
                userId: req.user.id,
                supplierName: {
                    $regex: name.trim(),
                    $options: "i"
                }
            })
            .select("_id supplierName phone email")
            .limit(10);

        return res.status(200).json({
            suppliers
        });

    } catch (error) {

        console.log("Supplier search error:", error);

        return res.status(500).json({
            message: "Failed to search suppliers"
        });
    }
};

/**
 * POST /supplier/import-batch
 *
 * One chunk of supplier rows already parsed by the browser, so the UI can show
 * real progress. Unlike /import, a bad row is skipped with a reason instead of
 * failing the whole file.
 *
 * Body: { rows: [ {supplierName, phone, ...}, ... ], rowOffset?: number }
 */
export const importSuppliersBatch = async (req, res) => {
    try {
        const { rows, rowOffset = 0 } = req.body;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No rows received" });
        }

        if (rows.length > 200) {
            return res.status(400).json({ message: "Send at most 200 rows per batch" });
        }

        const documents = [];
        const skipped = [];

        rows.forEach((row, index) => {
            // +2: CSV line numbers start at 1 and row 1 is the header.
            const lineNumber = (Number(rowOffset) || 0) + index + 2;

            const supplierName = (row.supplierName || row["Supplier Name"] || "").trim();
            const phone = String(row.phone || row.Phone || "").trim();

            if (!supplierName) {
                skipped.push({ row: lineNumber, reason: "Missing supplier name" });
                return;
            }

            if (!phone) {
                skipped.push({ row: lineNumber, reason: "Missing phone number" });
                return;
            }

            documents.push({
                supplierName,
                phone,
                email: (row.email || row.Email || "").trim(),
                address: (row.address || row.Address || "").trim(),
                city: (row.city || row.City || "").trim(),
                state: (row.state || row.State || "").trim(),
                gstNumber: (row.gstNumber || row["GST Number"] || "").trim(),
                userId: req.user.id,
                line: lineNumber
            });
        });

        // A supplier already on file is the same supplier, not a second one:
        // match on phone first, then name, and refresh their details instead
        // of saving a duplicate.
        const existing = documents.length === 0 ? [] : await supplierModel
            .find({
                userId: req.user.id,
                $or: [
                    { phone: { $in: documents.map((one) => one.phone) } },
                    { supplierName: { $in: documents.map((one) => one.supplierName) } }
                ]
            })
            .select("supplierName phone")
            .collation({ locale: "en", strength: 2 })   // ignore case
            .lean();

        const byKey = new Map();

        const keysOf = (supplier) => [
            supplier.phone ? `phone:${String(supplier.phone).trim()}` : null,
            `name:${(supplier.supplierName || "").trim().toLowerCase()}`
        ].filter(Boolean);

        for (const supplier of existing) {
            for (const key of keysOf(supplier)) {
                if (!byKey.has(key)) byKey.set(key, String(supplier._id));
            }
        }

        const inserts = [];
        const operations = [];
        const claimed = new Set();   // keys taken by a row earlier in this file

        for (const document of documents) {
            const keys = keysOf(document);
            const id = keys.map((key) => byKey.get(key)).find(Boolean);

            if (id) {
                // Blank cells must not wipe details already saved.
                const changes = Object.fromEntries(
                    Object.entries(document).filter(
                        ([field, value]) => !["userId", "line"].includes(field) && value
                    )
                );

                operations.push({
                    updateOne: {
                        filter: { _id: id, userId: req.user.id },
                        update: { $set: changes }
                    }
                });
                continue;
            }

            // Listed twice in the same file: keep the first copy only.
            if (keys.some((key) => claimed.has(key))) {
                skipped.push({ row: document.line, reason: "Listed earlier in this file" });
                continue;
            }

            keys.forEach((key) => claimed.add(key));
            inserts.push(document);
        }

        if (inserts.length > 0) {
            await supplierModel.insertMany(
                inserts.map(({ line, ...supplier }) => supplier),
                { ordered: false }
            );
        }

        if (operations.length > 0) {
            await supplierModel.bulkWrite(operations, { ordered: false });
        }

        return res.status(200).json({
            importedCount: inserts.length,
            updatedCount: operations.length,
            skippedCount: skipped.length,
            skipped: skipped.sort((a, b) => a.row - b.row)
        });

    } catch (error) {
        console.log("Import suppliers batch error:", error);

        return res.status(500).json({ message: "Failed to import this batch" });
    }
};
