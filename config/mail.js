import nodemailer from "nodemailer";

/**
 * Gmail transport, created on first use.
 *
 * Building it lazily matters: ES modules evaluate imports before any code in
 * server.js runs, so a transport created at import time would capture empty
 * credentials and fail with "Missing credentials for PLAIN".
 */
let transporter = null;

export const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            },
            // Many hosts (Render, Heroku and similar) block outbound SMTP.
            // Without these the connection hangs for ~2 minutes before failing.
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
    }

    return transporter;
};

// Proxy so existing `transporter.sendMail(...)` calls keep working while still
// building the real transport lazily.
export default {
    sendMail: (...args) => getTransporter().sendMail(...args),
    verify: (...args) => getTransporter().verify(...args)
};
