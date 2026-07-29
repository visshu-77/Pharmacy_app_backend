import categoryModel  from "../model/category.js";

export const addCategory = async (req, res) => {
    try{
        const {
            categoryName,
            description
        } = req.body;

        if(!categoryName){
            return res.status(401).json({
                message:"category name is required"
            })
        }

        const existingCategory = await categoryModel.findOne({
            categoryName,
            userId: req.user.id
        })

        if(existingCategory){
            return res.status(400).json({
                message:"Category is already exist"
            })
        }

        const category = await categoryModel.create({
            categoryName,
            description,
            userId: req.user.id
        });

        res.status(200).json({
            message:"Category Added Successfully",
            category
        });

    }catch(error){
        console.log("server error", error);
    }
}

export const getCategory = async (req,res) => {
    try{
        const result = await categoryModel.find({
            userId:req.user.id
        })

        if(!result){
            return res.status(401).json({
                message:"No category found"
            })
        }

        res.status(200).json({
            message:"Category fetched successfully",
            result
        });
    }catch(err){
        console.log("server error ", err);
    }
}
