import transporter from "../config/mail.js";
import { sendEmail as sendViaResend } from "./resendService.js";

/**
 * Chooses how outgoing email is sent.
 *
 * MAIL_PROVIDER = "resend" | "smtp" | "auto" (default "auto")
 *
 * "auto" prefers Resend, but only once MAIL_FROM uses a domain you have
 * verified. Resend's shared sender (onboarding@resend.dev) can only deliver to
 * the Resend account owner, which is useless for real customers — so in that
 * case it falls back to SMTP (the Gmail account in EMAIL_USER), which can send
 * to anybody.
 *
 * Gmail allows roughly 500 messages a day; fine to launch with, worth moving to
 * a verified Resend domain as you grow.
 */
const SHARED_RESEND_SENDER = /@resend\.dev>?\s*$/i;

const smtpReady = () => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

const resendReady = () => Boolean(process.env.RESEND_API_KEY);

const usingSharedResendSender = () =>
    SHARED_RESEND_SENDER.test(process.env.MAIL_FROM || "StoreFlow <onboarding@resend.dev>");

/** Which provider will actually be used: "resend", "smtp" or null. */
export const activeMailProvider = () => {
    const choice = (process.env.MAIL_PROVIDER || "auto").toLowerCase();

    if (choice === "resend") return resendReady() ? "resend" : null;
    if (choice === "smtp") return smtpReady() ? "smtp" : null;

    if (resendReady() && !usingSharedResendSender()) return "resend";
    if (smtpReady()) return "smtp";
    if (resendReady()) return "resend";   // shared sender: works for the owner only

    return null;
};

export const isMailConfigured = () => activeMailProvider() !== null;

/** Human-readable setup summary, used by the /api/email-status check. */
export const describeMail = () => {
    const provider = activeMailProvider();

    return {
        provider: provider || "none",
        mailProviderSetting: process.env.MAIL_PROVIDER || "auto",
        resendApiKeySet: resendReady(),
        resendUsingSharedSender: usingSharedResendSender(),
        smtpConfigured: smtpReady(),
        from:
            provider === "smtp"
                ? `StoreFlow <${process.env.EMAIL_USER}>`
                : process.env.MAIL_FROM || "StoreFlow <onboarding@resend.dev>"
    };
};

/**
 * Send one email through whichever provider is active.
 * Throws with `isEmailError` set so callers can report the reason.
 */
export const sendAppEmail = async ({ to, subject, html, text }) => {
    const provider = activeMailProvider();

    if (!provider) {
        const error = new Error(
            "No email provider configured. Set RESEND_API_KEY (with a verified MAIL_FROM domain) or EMAIL_USER + EMAIL_PASSWORD."
        );
        error.isEmailError = true;
        throw error;
    }

    if (provider === "resend") {
        await sendViaResend({ to, subject, html, text });
        return { provider };
    }

    try {
        await transporter.sendMail({
            from: `"StoreFlow" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
            ...(text ? { text } : {})
        });

        return { provider };

    } catch (cause) {
        const error = new Error(`Gmail SMTP: ${cause.message}`);
        error.isEmailError = true;
        error.status = cause.responseCode || 500;
        throw error;
    }
};
