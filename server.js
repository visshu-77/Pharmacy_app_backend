import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

import connectDb from './config/db.js';

import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoute.js';
import categoryRoutes from "./routes/categoryRoute.js";
import orderRoutes from "./routes/orderRoute.js";

connectDb();

const app = express();

app.use(express.json());
app.use(cors());

//Routes
app.use('/api', userRoutes);
app.use('/product', productRoutes)
app.use('/category', categoryRoutes)
app.use('/order', orderRoutes)

app.get('/',(req,res)=>{
    res.send("backed is running")
});

const PORT = process.env.PORT || 5000;

app.listen(5000, ()=>{
    console.log(` Server is running on port ${PORT}`)
})