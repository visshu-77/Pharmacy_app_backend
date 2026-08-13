import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    productName: {
        type: String,
        required: true,
    },
    productCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "/dashaboard/categories",
        required: true,
    },
    stock: {
        type: Number,
        required: true
    },
    purchase: {
        type: Number
    },
    sellingPrice: {
        type: Number
    },
    ExpiryDate: {
        type: Date,
        default:null
    },
    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "dashboard/suppliers"
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "dashboard/userData",
        required: true
    }
})

const product = mongoose.model("dashboard/products", productSchema);
export default product;