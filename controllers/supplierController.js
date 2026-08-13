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

        if (!supplierName || !phone) {

            return res.status(400).json({
                message: "Supplier name and phone are required"
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