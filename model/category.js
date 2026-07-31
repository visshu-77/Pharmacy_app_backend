import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
    {
        categoryName: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: ""
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "dashboard/userData",
            required: true,
        }
    },
    {
        timestamps: true,
    }
);

const category = mongoose.model("/dashaboard/categories", categorySchema);

export default category;    