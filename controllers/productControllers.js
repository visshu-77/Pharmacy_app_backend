import productModel from '../model/product.js';
import categoryModel from "../model/category.js";
import { Parser } from 'json2csv';
import { Readable } from "stream";
import csv from "csv-parser";

export const addProduct = async (req, res) => {
    try {

        const {
            productName,
            productCategory,
            stock,
            purchase,
            sellingPrice,
            ExpiryDate,
            supplierName,
        } = req.body;

        let message = "";

        if(!productName){
            message = "Product Name is required";
        }else if(!productCategory){
            message = "Product Category is required";
        }else if (stock === undefined || stock === null || stock === ""){
            message = "Stock is required";
        }else if(!sellingPrice){
            message = "Selling Price is required";
        }else if(!supplierName){
            message = "Supplier Name is required"
        }else if(stock < 0){
            message = "Stock should be greater then 0"
        }

        if (message) {
            return res.status(400).json({
                message
            });
        }

        const product = await productModel.create({
            productName,
            productCategory,
            stock,
            purchase,
            sellingPrice,
            ExpiryDate,
            supplierName,
            userId: req.user.id,
        });

        res.status(200).json({
            message: "Product Added Successfully",
            product
        })

    } catch (err) {
        console.log("server error", err);
    }
}

export const getProduct = async (req, res) => {
    try {
        const products = await productModel.find({
            userId: req.user.id
        }).populate("productCategory", "categoryName");

        if (!products) {
            return res.status(401).json({
                message: "No product Found"
            })
        }

        return res.status(200).json({
            message: "Product fatched Successfully",
            products
        });
    } catch (err) {
        console.log("Server error", err);
    }
}

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const deleteProduct = await productModel.findOne({
            _id: id,
            userId: req.user.id
        })

        if (!deleteProduct) {
            return res.status(404).json({
                message: "product not found"
            })
        }

        await productModel.deleteOne({
            _id: id
        });

        res.status(200).json({
            message: "Product delete successfully"
        });

    } catch (err) {
        console.log(err);

        res.status(500).json({
            message: "Server error"
        })
    }
}

export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            productName,
            productCategory,
            stock,
            purchase,
            sellingPrice,
            ExpiryDate,
            supplierName,
        } = req.body;

        const newProductdetails = await productModel.findOneAndUpdate(
            {
                _id: id,
                userId: req.user.id
            },
            {
                productName,
                productCategory,
                stock,
                purchase,
                sellingPrice,
                ExpiryDate,
                supplierName
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!newProductdetails) {
            return res.status(404).json({
                message: "product not found"
            })
        }

        res.status(200).json({
            message: "Product Updated successfully"
        })

    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "Server error"
        })
    }
}

export const exportproducts = async (req, res) => {
    try {
        const products = await productModel.find({
            userId: req.user.id
        }).populate("productCategory", "categoryName");

        const exportData = products.map(product => ({
            Product: product.productName,
            Category: product.productCategory?.categoryName,
            Stock: product.stock,
            Purchase: product.purchase,
            Selling: product.sellingPrice,
            Supplier: product.supplierName,
            Expiry: product.ExpiryDate
        }))

        const parser = new Parser();
        const csv = parser.parse(exportData);

        res.header(
            "Content-Type",
            "text/csv"
        );
        res.attachment("product.csv")
        res.send(csv);
        console.log(csv);


    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "server error"
        })
    }
}

export const importProducts = async (req, res) => {
    try {
        const buffer = req.file.buffer;
        const results = [];

        Readable.from(buffer)
            .pipe(csv())
            .on("data", (row) => {
                results.push(row);
            })
            .on("end", async () => {

                try {

                    for (const item of results) {

                        // -----------------------------
                        // Find existing category
                        // -----------------------------
                        let category = await categoryModel.findOne({
                            categoryName: item.Category?.trim(),
                            userId: req.user.id
                        });

                        // -----------------------------
                        // Create category if not found
                        // -----------------------------
                        if (!category) {

                            category = await categoryModel.create({
                                categoryName: item.Category?.trim(),
                                userId: req.user.id
                            });

                            console.log(
                                "New category created:",
                                category.categoryName
                            );
                        }

                        // -----------------------------
                        // Create product
                        // -----------------------------
                        await productModel.create({
                            productName: item.Product?.trim(),
                            productCategory: category._id,
                            stock: Number(item.Stock) || 0,
                            purchase: Number(item.Purchase) || 0,
                            sellingPrice: Number(item.Selling) || 0,
                            supplierName: item.Supplier?.trim() || "",
                            ExpiryDate:
                                item.Expiry &&
                                    item.Expiry.trim() !== "" &&
                                    item.Expiry.trim().toLowerCase() !== "n/a"
                                    ? new Date(item.Expiry)
                                    : null,
                            userId: req.user.id
                        });
                    }

                    return res.status(200).json({
                        message: "Products imported successfully",
                        importedCount: results.length
                    });

                } catch (error) {

                    console.log("Import processing error:", error);

                    return res.status(500).json({
                        message: "Failed to import products"
                    });
                }
            });

    } catch (err) {

        console.log("Import error:", err);

        return res.status(500).json({
            message: "Server Error"
        });
    }
};

export const singleProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await productModel.findOne({
            _id: id,
            userId: req.user.id
        }).populate("productCategory", "categoryName");

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            })
        }

        res.status(200).json({
            message: "Product fetch successfully",
            product: product,
        })


    } catch (err) {
        console.log(err)
        res.status(500).json({
            message: "Server error"
        })
    }
}

export const searchProducts = async (req, res) => {
    try {

        const { search } = req.query;

        if (!search || !search.trim()) {
            return res.status(400).json({
                message: "Search product name is required"
            });
        }

        const products = await productModel.find({
            userId: req.user.id,
            productName: {
                $regex: search.trim(),
                $options: "i"
            }
        }).select(
            "productName stock sellingPrice purchase ExpiryDate supplierName productCategory"
        );

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