import productModel from '../model/product.js';

export const addProduct = async(req,res)=>{
    try{

        const {
            productName,
            productCategory,
            stock,
            purchase,
            sellingPrice,
            ExpiryDate,
            supplierName,
        } = req.body;

        if(!(productName && productCategory && stock && ExpiryDate)){
            return res.status(401).json({
                message:"fields are required"
            });
        }

        if(stock < 0){
            return res.status(404).json({
                message:"Stock should be greater than 0"
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
            message:"Product Added Successfully",
            product
        })

    }catch(err){
        console.log("server error",err);
    }
}

export const getProduct = async(req,res)=>{
    try{
        const products = await productModel.find({
            userId:req.user.id
        })

        if(!products){
            return res.status(401).json({
                message:"No product Found"
            })
        }

        return res.status(200).json({
            message:"Product fatched Successfully",
            products
        });
    }catch(err){
        console.log("Server error", err);
    }
}
