import userModel from '../model/users.js';

export const registeruser = async (req,res) => {
    try{

        const {
            Shopname,
            ownerName,
            mobileNumber,
            email,
            Password,
            shopAddress,
            city,
            state,
            gstNumber,
            licenseNumber
        } = req.body;

        if(!( Shopname && ownerName && mobileNumber && email && Password && shopAddress && city && state && gstNumber && licenseNumber )){
            res.status(401).json({message:"All fields are required"});
        }

        if(email || mobileNumber){
            res.status(401).json({mesg:"Email/Mobile Number is already register"})
        }

        const user = await userModel.create({
            Shopname,
            ownerName,
            mobileNumber,
            email,
            Password,
            shopAddress,
            city,
            state,
            gstNumber,
            licenseNumber
        });

        res.status(201).json({
            msg:"user Created Successfully", user
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
