import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        Shopname:{
            type: String,
            required:true,
        },
        ownerName:{
            type: String,
            required:true
        },
        mobileNumber:{
            type: Number,
            required:true,
            unique:true
        },
        email:{
            type: String,
            required:true,
            unique:true
        },
        Password:{
            type: String,
            required: true
        },
        shopAddress:{
            type:String,
            required:true
        },
        city:{
            type:String,
            required:true
        },
        state:{
            type:String,
            required:true
        },
        gstNumber:{
            type:String,
            required:true
        },
        licenseNumber:{
            type:String,
            required:true
        },
    }
)

const users = mongoose.model("dashboard/userData", userSchema)

export default users;