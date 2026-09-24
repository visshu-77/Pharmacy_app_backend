import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import userModel from "../model/users.js";
import pendingSignupModel from "../model/pendingSignup.js";

import { sendAppEmail, isMailConfigured, describeMail, activeMailProvider } from "../services/mailer.js";
import { otpEmailTemplate } from "../templates/otpEmail.js";
import { seedStarterCategories } from "../services/categorySeedService.js";
import {
    BUSINESS_TYPE_IDS,
    DEFAULT_BUSINESS_TYPE,
    getBusinessType
} from "../config/businessTypes.js";

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_SIGNUP = 5;
const MAX_ATTEMPTS = 5;

/** Cryptographically random 6-digit code (never Math.random for secrets). */
const generateOtp = () =>
    String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();

/**
 * Checks the registration form. Shared by "send code" and re-checked at
 * "verify", so a stale pending signup can't slip past a rule.
 */
const validateSignup = async ({
    Shopname, ownerName, mobileNumber, email, Password, confirmPassword,
    shopAddress, city, state, licenseNumber, businessType
}) => {
    const required = { Shopname, ownerName, mobileNumber, email, Password, confirmPassword, shopAddress, city, state };
    const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);

    if (missing.length) {
        return { error: "Please fill in all the required fields", missing };
    }

    if (Password !== confirmPassword) {
        return { error: "Password and confirm password do not match" };
    }

    if (String(Password).length < 8) {
        return { error: "Password should be at least 8 characters long" };
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
        return { error: "Please enter a valid email address" };
    }

    if (!/^[6-9]\d{9}$/.test(String(mobileNumber))) {
        return { error: "Please enter a valid 10-digit mobile number" };
    }

    const resolvedType = BUSINESS_TYPE_IDS.includes(businessType) ? businessType : DEFAULT_BUSINESS_TYPE;
    const profile = getBusinessType(resolvedType);

    if (profile.licence?.required && !licenseNumber) {
        return { error: `${profile.licence.label} is required for a ${profile.label}` };
    }

    const takenEmail = await userModel.findOne({ email: normalizeEmail(email) });

    if (takenEmail) {
        return { error: "This email is already registered. Try signing in instead." };
    }

    const takenMobile = await userModel.findOne({ mobileNumber: Number(mobileNumber) });

    if (takenMobile) {
        return { error: "This mobile number is already registered" };
    }

    return { resolvedType, profile };
};

const deliverOtp = async ({ email, ownerName, shopName, otp }) => {
    const { html, text } = otpEmailTemplate({
        ownerName,
        shopName,
        otp,
        minutes: OTP_TTL_MINUTES
    });

    if (!isMailConfigured()) {
        // No API key: in development print the code so signup can be tested.
        // In production this is a hard failure — we must not pretend to send.
        if (process.env.NODE_ENV === "production") {
            throw new Error("Email is not configured (no RESEND_API_KEY or SMTP credentials)");
        }

        console.log(`\n[dev] Verification code for ${email}: ${otp}\n`);
        return { devMode: true };
    }

    try {
        await sendAppEmail({
            to: email,
            subject: `${otp} is your StoreFlow verification code`,
            html,
            text
        });

        return { devMode: false };

    } catch (error) {
        // Resend's shared sender (onboarding@resend.dev) only delivers to the
        // address that owns the Resend account. While developing, fall back to
        // printing the code so signup can be tested with any email. In
        // production this stays a hard failure — verify a domain instead.
        const isTestSenderLimit =
            error.status === 403 && /testing emails|own email address/i.test(error.message);

        if (isTestSenderLimit && process.env.NODE_ENV !== "production") {
            console.log(
                `\n[dev] Resend won't deliver to ${email} with the shared test sender.` +
                `\n[dev] Verification code for ${email}: ${otp}\n`
            );

            return { devMode: true };
        }

        throw error;
    }
};

/**
 * One place to report a failed send. The exact reason is always logged; it is
 * also returned to the caller outside production, where hiding it just makes
 * setup harder to debug.
 */
const emailFailure = (res, error, label) => {
    console.log(`${label} failed:`, error.message);

    const isProduction = process.env.NODE_ENV === "production";

    if (error.isEmailError && !isProduction) {
        return res.status(502).json({
            message: "Could not send the verification email.",
            reason: error.message
        });
    }

    if (error.message.startsWith("Email is not configured")) {
        return res.status(500).json({
            message: "Email is not set up on the server. Configure Resend or SMTP, then restart."
        });
    }

    return res.status(502).json({
        message: "Could not send the verification code. Please try again."
    });
};

// ---------------------------------------------------------------------------
// POST /api/register/send-otp — validate the form, hold it, email a code
// ---------------------------------------------------------------------------
export const sendSignupOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const check = await validateSignup({ ...req.body, email });

        if (check.error) {
            return res.status(400).json({ message: check.error, missing: check.missing });
        }

        const existing = await pendingSignupModel.findOne({ email });

        if (existing) {
            const sinceLast = (Date.now() - new Date(existing.lastSentAt).getTime()) / 1000;

            if (sinceLast < RESEND_COOLDOWN_SECONDS) {
                return res.status(429).json({
                    message: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast)} seconds before asking for another code`,
                    retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast)
                });
            }

            if (existing.sendCount >= MAX_SENDS_PER_SIGNUP) {
                return res.status(429).json({
                    message: "Too many codes requested. Please try again in a little while."
                });
            }
        }

        const otp = generateOtp();

        // Deliver first: if the email can't be sent there is nothing to undo,
        // and the owner can try again straight away.
        const { devMode } = await deliverOtp({
            email,
            ownerName: req.body.ownerName,
            shopName: req.body.Shopname,
            otp
        });

        const otpHash = await bcrypt.hash(otp, 10);
        const hashedPassword = await bcrypt.hash(req.body.Password, 10);

        const payload = {
            Shopname: req.body.Shopname,
            businessType: check.resolvedType,
            ownerName: req.body.ownerName,
            mobileNumber: req.body.mobileNumber,
            email,
            Password: hashedPassword,
            shopAddress: req.body.shopAddress,
            city: req.body.city,
            state: req.body.state,
            gstNumber: req.body.gstNumber || "",
            licenseNumber: req.body.licenseNumber || ""
        };

        await pendingSignupModel.findOneAndUpdate(
            { email },
            {
                email,
                payload,
                otpHash,
                otpExpiresAt: minutesFromNow(OTP_TTL_MINUTES),
                attempts: 0,
                // Counts every code sent for this signup, so the cap survives
                // the form being submitted again.
                sendCount: existing ? existing.sendCount + 1 : 1,
                lastSentAt: new Date(),
                expiresAt: minutesFromNow(60)
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return res.status(200).json({
            message: `We've sent a ${OTP_LENGTH}-digit code to ${email}`,
            email,
            expiresInMinutes: OTP_TTL_MINUTES,
            resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
            devMode
        });

    } catch (error) {
        return emailFailure(res, error, "Send signup OTP");
    }
};

// ---------------------------------------------------------------------------
// POST /api/register/resend-otp — new code for a signup already in progress
// ---------------------------------------------------------------------------
export const resendSignupOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const pending = await pendingSignupModel.findOne({ email });

        if (!pending) {
            return res.status(404).json({
                message: "That signup has expired. Please enter your details again."
            });
        }

        const sinceLast = (Date.now() - new Date(pending.lastSentAt).getTime()) / 1000;

        if (sinceLast < RESEND_COOLDOWN_SECONDS) {
            const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast);
            return res.status(429).json({
                message: `Please wait ${wait} seconds before asking for another code`,
                retryAfter: wait
            });
        }

        if (pending.sendCount >= MAX_SENDS_PER_SIGNUP) {
            return res.status(429).json({
                message: "Too many codes requested. Please try again in a little while."
            });
        }

        const otp = generateOtp();

        pending.otpHash = await bcrypt.hash(otp, 10);
        pending.otpExpiresAt = minutesFromNow(OTP_TTL_MINUTES);
        pending.attempts = 0;
        pending.sendCount += 1;
        pending.lastSentAt = new Date();

        await pending.save();

        const { devMode } = await deliverOtp({
            email,
            ownerName: pending.payload?.ownerName,
            shopName: pending.payload?.Shopname,
            otp
        });

        return res.status(200).json({
            message: `New code sent to ${email}`,
            expiresInMinutes: OTP_TTL_MINUTES,
            resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
            devMode
        });

    } catch (error) {
        return emailFailure(res, error, "Resend signup OTP");
    }
};

// ---------------------------------------------------------------------------
// POST /api/register/verify-otp — check the code and create the account
// ---------------------------------------------------------------------------
export const verifySignupOtp = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const otp = String(req.body.otp || "").trim();

        if (!email || !otp) {
            return res.status(400).json({ message: "Email and code are required" });
        }

        const pending = await pendingSignupModel.findOne({ email });

        if (!pending) {
            return res.status(404).json({
                message: "That signup has expired. Please enter your details again."
            });
        }

        if (new Date(pending.otpExpiresAt) < new Date()) {
            return res.status(400).json({
                message: "This code has expired. Ask for a new one.",
                expired: true
            });
        }

        if (pending.attempts >= MAX_ATTEMPTS) {
            await pendingSignupModel.deleteOne({ email });
            return res.status(429).json({
                message: "Too many wrong codes. Please start again."
            });
        }

        const matches = await bcrypt.compare(otp, pending.otpHash);

        if (!matches) {
            pending.attempts += 1;
            await pending.save();

            const left = MAX_ATTEMPTS - pending.attempts;

            return res.status(400).json({
                message: left > 0
                    ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.`
                    : "That code is not correct.",
                attemptsLeft: Math.max(0, left)
            });
        }

        // Someone may have registered this email while the code sat unused.
        const taken = await userModel.findOne({ email });

        if (taken) {
            await pendingSignupModel.deleteOne({ email });
            return res.status(409).json({ message: "This email is already registered" });
        }

        const profile = getBusinessType(pending.payload.businessType);

        const user = await userModel.create({
            ...pending.payload,
            emailVerified: true,
            preferences: {
                lowStockThreshold: profile.lowStockThreshold,
                defaultTaxRate: profile.defaultTaxRate
            }
        });

        await seedStarterCategories(user._id, profile);
        await pendingSignupModel.deleteOne({ email });

        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET_KEY,
            { expiresIn: "1d" }
        );

        return res.status(201).json({
            message: "Email verified — your account is ready",
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                Shopname: user.Shopname,
                businessType: user.businessType
            }
        });

    } catch (error) {
        console.log("Verify signup OTP error:", error.message);

        return res.status(500).json({ message: "Server error" });
    }
};

// ---------------------------------------------------------------------------
// GET /api/email-status — is email set up? Optionally ?to=you@example.com to
// send a real test message. Disabled in production.
// ---------------------------------------------------------------------------
export const emailStatus = async (req, res) => {
    if (process.env.NODE_ENV === "production") {
        return res.status(404).json({ message: "Not available" });
    }

    const mail = describeMail();

    const status = {
        ...mail,
        emailWorking: isMailConfigured(),
        nodeEnv: process.env.NODE_ENV || "(not set)",
        note: !isMailConfigured()
            ? "No provider configured. Set RESEND_API_KEY (verified domain) or EMAIL_USER + EMAIL_PASSWORD, then restart."
            : mail.provider === "resend" && mail.resendUsingSharedSender
                ? "Resend's shared sender only delivers to your own Resend account address. Verify a domain, or set EMAIL_USER/EMAIL_PASSWORD to send via Gmail."
                : `Sending via ${mail.provider}. Add ?to=your@email.com to send a real test email.`
    };

    const to = req.query.to;

    if (!to || !isMailConfigured()) {
        return res.status(200).json(status);
    }

    try {
        const result = await sendAppEmail({
            to,
            subject: "StoreFlow test email",
            html: "<p>If you can read this, Resend is set up correctly.</p>",
            text: "If you can read this, Resend is set up correctly."
        });

        return res.status(200).json({ ...status, sent: true, via: result?.provider || activeMailProvider() });

    } catch (error) {
        return res.status(502).json({ ...status, sent: false, reason: error.message });
    }
};
