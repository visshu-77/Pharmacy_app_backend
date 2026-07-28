import userModel from '../model/users.js';
import bcrypt from "bcrypt";

import jwt from "jsonwebtoken";

export const registeruser = async (req,res) => {
    try{

        const {
            Shopname,
            ownerName,
            mobileNumber,
            email,
            Password,
            confirmPassword,
            shopAddress,
            city,
            state,
            gstNumber,
            licenseNumber
        } = req.body;

        if(!( Shopname && ownerName && mobileNumber && email && Password && confirmPassword && shopAddress && city && state && gstNumber && licenseNumber )){
            res.status(401).json({message:"All fields are required"});
        }

        const existinUser = await userModel.findOne({ email })

        if(existinUser){
            return res.status(409).json({
                message:"Email is already register"
            });
        }
        if(Password !== confirmPassword ){
            return res.status(400).json({
                message:"password and confirm password is not matched"
            })
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(Password, salt);

        const user = await userModel.create({
            Shopname,
            ownerName,
            mobileNumber,
            email,
            Password: hashedPassword,
            shopAddress,
            city,
            state,
            gstNumber,
            licenseNumber
        });

        const token = jwt.sign(
            {
                id:user._id,
                email: user.email
            },
            process.env.JWT_SECRET_KEY,
            {
                expiresIn: "1d"
            }
        )

        res.status(201).json({
            msg:"user Created Successfully", 
            token,
            user: {
                id: user._id,
                email: user.email
            }
        });

    }catch(err){
        console.log(err);
    }
}

export const getUser = async (req,res) => {
    try{
        const user = await userModel.find();

        res.status(200).json(user);

    }catch(err){
        res.status(500).json({
            message:err.message
        });
    }
}

export const loginUser = async (req,res) => {
    try{
        const {
            email,
            password
        } = req.body;

        if(!(email && password)){
           return res.status(401).json({message:"Fields are required"})
            console.log("fields are required")
        }

        const user = await userModel.findOne({email});

        if(!user){
            res.status(404).json({message:"User Not found please enter correct credentials"})
            console.log("user not found")
        }

        const isMatch = await bcrypt.compare(
            password,
            user.Password
        )

        if(!isMatch){
            return res.status(401).json({
                message:"Invalid Password"
            });
        }

        const token = jwt.sign(
            {
                id: user._id,
                email: user.email
            },
            process.env.JWT_SECRET_KEY,
            {
                expiresIn: "1d"
            }
        )

        res.status(200).json({
            message:"Login Successfull",
            token,
            user:{
                id:user._id,
                email: user.email
            }
        });

    }catch(err){
        res.status(501).json({message:"server error"})
        console.log(err);
    }
}
