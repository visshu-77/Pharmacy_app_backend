import mongoose from "mongoose";

const supplierSchema = new mongoose.Schema({
    supplierName: {
        type: String,
        required: true,
        trim: true
    },

    phone: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        trim: true,
        lowercase: true
    },

    address: {
        type: String,
        default: ""
    },

    city: {
        type: String,
        default: ""
    },

    state: {
        type: String,
        default: ""
    },

    gstNumber: {
        type: String,
        default: ""
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "dashboard/userData",
        required: true
    }
}, {
    timestamps: true
}
)

const supplierModel = mongoose.model(
    "dashboard/suppliers",
    supplierSchema
);

export default supplierModel;
