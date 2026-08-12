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