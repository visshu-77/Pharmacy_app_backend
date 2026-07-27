import mongoose from 'mongoose';
import 'dotenv';

const connectDb = async () => {
    try{
        const conn = await mongoose.connect(process.env.MONGODB_URI);

        console.log(`MongoDB Connected: $${conn.connection.host}`);
    }catch(error){
        console.log('Database Connection failed:', error.message);
        process.exit(1);
    }
};

export default connectDb;