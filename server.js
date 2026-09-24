// MUST be first: in ES modules every import is evaluated before the code
// below it, so loading .env here is what lets config/* read process.env.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';

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
 * FRONTEND_URL holds one URL or several separated by commas:
 *   FRONTEND_URL=https://,http://localhost:3000
 *
 * A "*" wildcard is allowed in the host, which covers Vercel preview
 * deployments that get a new URL every push:
 *   FRONTEND_URL=https://*.vercel.app
 *
 * Trailing slashes and letter case are ignored, so
 * "https://my-app.vercel.app/" still matches "https://my-app.vercel.app".
 *
 * If FRONTEND_URL is not set at all, every origin is allowed and a warning is
 * logged — a fresh deployment works, but it should be set in production.
 */
const normalizeOrigin = (url = "") => url.trim().replace(/\/+$/, "").toLowerCase();

const configuredOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

// Localhost is always allowed so local development keeps working.
const allowedOrigins = [
    ...new Set([...configuredOrigins, "http://localhost:3000"])
];

const allowEveryOrigin = configuredOrigins.length === 0;

/** Does this origin match an allowed entry (wildcards included)? */
const isAllowedOrigin = (origin) => {
    const candidate = normalizeOrigin(origin);

    return allowedOrigins.some((allowed) => {
        if (!allowed.includes("*")) return allowed === candidate;

        const pattern = new RegExp(
            `^${allowed.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`
        );

        return pattern.test(candidate);
    });
};

const corsOptions = {
    origin(origin, callback) {
        // Same-origin requests, curl, health checks and mobile apps send no Origin.
        if (!origin || allowEveryOrigin || isAllowedOrigin(origin)) {
            return callback(null, true);
        }

        // Shows up in the Render logs, so a mismatch is obvious.
        console.warn(
            `CORS blocked origin "${origin}". Allowed: ${allowedOrigins.join(", ")}. ` +
            "Add it to the FRONTEND_URL environment variable."
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

if (allowEveryOrigin) {
    console.warn(
        "FRONTEND_URL is not set — allowing every origin. Set it to your site's URL in production."
    );
} else {
    console.log("CORS allowed origins:", allowedOrigins.join(", "));
}

/**
 * Open this in a browser (or curl it) to see exactly what the deployed server
 * allows. Handy when the browser reports a CORS error.
 */
app.get("/cors-check", (req, res) => {
    const origin = req.headers.origin || null;

    res.json({
        yourOrigin: origin,
        allowed: Boolean(!origin || allowEveryOrigin || isAllowedOrigin(origin)),
        allowEveryOrigin,
        allowedOrigins,
        frontendUrlSet: Boolean(process.env.FRONTEND_URL),
        serverTime: new Date()
    });
});


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