import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

import connectDb from './config/db.js';

import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoute.js';
import categoryRoutes from "./routes/categoryRoute.js";
import orderRoutes from "./routes/orderRoute.js";
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import reportRoutes from "./routes/reportRoute.js";
import aiRoutes from "./routes/aiRoutes.js";
import supplierRoutes from "./routes/supplierRoute.js";
import dashboardRoutes from "./routes/dashboard.js";
import adminRoutes from "./routes/adminRoutes.js";
import noteRoutes from "./routes/noteRoute.js";

connectDb();

const app = express();

/**
 * Allowed browser origins.
 *
 * FRONTEND_URL may hold one URL or several separated by commas, e.g.
 *   FRONTEND_URL=https://pharmacy-app-wheat-nine.vercel.app,http://localhost:3000
 *
 * Trailing slashes and letter case are ignored, so
 * "https://my-app.vercel.app/" still matches "https://my-app.vercel.app".
 */
const normalizeOrigin = (url = "") => url.trim().replace(/\/+$/, "").toLowerCase();

const allowedOrigins = new Set(
    [
        ...(process.env.FRONTEND_URL || "").split(","),
        "http://localhost:3000"
    ]
        .map(normalizeOrigin)
        .filter(Boolean)
);

const corsOptions = {
    origin(origin, callback) {
        // Same-origin requests, curl, health checks and mobile apps send no Origin.
        if (!origin || allowedOrigins.has(normalizeOrigin(origin))) {
            return callback(null, true);
        }

        // Shows up in the Render logs, so a mismatch is obvious.
        console.warn(
            `CORS blocked origin "${origin}". Allowed: ${[...allowedOrigins].join(", ")}. ` +
            "Add it to FRONTEND_URL."
        );

        return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "ngrok-skip-browser-warning"
    ]
};

// Also answers preflight (OPTIONS) requests before they reach any route.
app.use(cors(corsOptions));

console.log("CORS allowed origins:", [...allowedOrigins].join(", "));

app.use(express.json());

//Routes
app.use('/api', userRoutes);
app.use('/product', productRoutes);
app.use('/category', categoryRoutes);
app.use('/order', orderRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/report', reportRoutes);
app.use('/ai', aiRoutes);
app.use('/supplier', supplierRoutes);
app.use('/dashboard', dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/note", noteRoutes);

app.get('/', (req, res) => {
    res.send("backed is running")
});

// Render (and most hosts) assign the port through PORT. parseInt also copes
// with a stray ";" like the local .env's "PORT = 5000;".
const PORT = Number.parseInt(process.env.PORT, 10) || 5000;

app.listen(PORT, () => {
    console.log(` Server is running on port ${PORT}`)
})