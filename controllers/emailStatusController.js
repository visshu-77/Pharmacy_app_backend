import { sendAppEmail, isMailConfigured, describeMail, activeMailProvider } from "../services/mailer.js";

// ---------------------------------------------------------------------------
// GET /api/email-status — is email set up? Optionally ?to=you@example.com to
// send a real test message. In production it needs ?key=<DIAGNOSTICS_KEY>.
// ---------------------------------------------------------------------------
export const emailStatus = async (req, res) => {
    // Open in development. On a live server it needs ?key=<DIAGNOSTICS_KEY>,
    // so email settings can be checked without exposing them to everyone.
    if (process.env.NODE_ENV === "production") {
        const expected = process.env.DIAGNOSTICS_KEY;

        if (!expected || req.query.key !== expected) {
            return res.status(404).json({ message: "Not available" });
        }
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
