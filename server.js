import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

import connectDb from './config/db.js';

import userRoutes from './routes/userRoutes.js';

connectDb();

const app = express();

app.use(express.json());
app.use(cors());

//Routes
app.use('/api', userRoutes);

app.get('/',(req,res)=>{
    res.send("backed is running")
});

const PORT = process.env.PORT || 5000;

app.listen(5000, ()=>{
    console.log(` Server is running on port ${PORT}`)
})