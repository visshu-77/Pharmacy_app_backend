import category from "../model/category.js";
import categoryModel from "../model/category.js";
import productModel from "../model/product.js";
import mongoose from "mongoose";

export const addCategory = async (req, res) => {
    try {
        const {
            categoryName,
            description
        } = req.body;

        if (!categoryName) {
            return res.status(401).json({
                message: "category name is required"
            })
        }

        const existingCategory = await categoryModel.findOne({
            categoryName: {
                $regex: `^${categoryName.trim()}$`,
                $options: "i"
            },
            userId: req.user.id
        })

        if (existingCategory) {
            return res.status(400).json({
                message: "Category is already exist"
            })
        }

        const category = await categoryModel.create({
            categoryName,
            description,
            userId: req.user.id
        });

        res.status(200).json({
            message: "Category Added Successfully",
            category
        });

    } catch (error) {
        console.log("server error", error);
    }
}

export const getCategory = async (req, res) => {
    try {
        const result = await categoryModel.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(req.user.id)
                }
            },
            {
                $lookup: {
                    from: "dashboard/products",
                    localField: "_id",
                    foreignField: "productCategory",
                    as: "products"
                }
            },
            {
                $addFields: {
                    productCount: {
                        $size: "$products"
                    }
                }
            },
            {
                $project: {
                    products: 0
                }
            }
        ]);

        if (!result) {
            return res.status(401).json({
                message: "No category found"
            })
        }

        res.status(200).json({
            message: "Category fetched successfully",
            result
        });
    } catch (err) {
        console.log("server error ", err);
    }
}

export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const deleteCategory = await categoryModel.find({
            userId: req.user.id
        })

        if (!deleteCategory) {
            return res.status(404).json({
                message: "Category not found"
            })
        }

        await categoryModel.deleteOne({
            _id: id
        })

        res.status(200).json({
            message: "Category delete successfully"
        })


    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "Server error"
        })
    }
}

export const updatecategory = async (req, res) => {
    try {

        const { id } = req.params;

        const { categoryName, description } = req.body;

        const updatedCategory = await categoryModel.findOneAndUpdate(
            {
                _id: id,
                userId: req.user.id
            },
            {
                categoryName,
                description
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedCategory) {
            return res.status(404).json({
                message: "Category not found"
            })
        }

        res.status(200).json({
            message: "Category updated successfully",
            category: updatedCategory
        })

    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "server error"
        })
    }
}

export const viewCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const category = await categoryModel.findOne({
            _id: id,
            userId: req.user.id
        });

        if (!category) {
            return res.status(401).json({
                message: "Category not found"
            })
        }

        const products = await productModel.find({
            productCategory: id,
            userId: req.user.id
        });

        res.status(200).json({
            category,
            totalProducts: products.length,
            products
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "Server Error"
        })
    }
}