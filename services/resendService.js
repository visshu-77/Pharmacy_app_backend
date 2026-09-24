/**
 * Email sending through Resend (https://resend.com).
 *
 * Uses Resend's HTTP API directly with Node's built-in fetch, so there is no
 * extra dependency to install or keep updated.
 *
 * Environment:
 *   RESEND_API_KEY   from resend.com -> API Keys        (required in production)
 *   MAIL_FROM        e.g. "StoreFlow <noreply@yourdomain.com>"
 *                    Until you verify your own domain, Resend allows
 *                    "onboarding@resend.dev" — but that can only send to the
 *                    address that owns the Resend account.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

const FROM = process.env.MAIL_FROM || "StoreFlow <onboarding@resend.dev>";

export const isEmailConfigured = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Send one email. Returns { id } from Resend.
 * Throws an Error with a readable message when Resend refuses.
 */
export const sendEmail = async ({ to, subject, html, text, replyTo }) => {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        throw new Error("RESEND_API_KEY is not set");
    }

    const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: FROM,
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            ...(text ? { text } : {}),
            ...(replyTo ? { reply_to: replyTo } : {})
        })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        // Resend returns { name, message } on failure. Turn the common ones
        // into something that says what to actually change.
        const reason = payload?.message || payload?.error || response.statusText;

        const hint =
            response.status === 401 || response.status === 403
                ? /testing emails|own email address/i.test(reason)
                    ? `Resend only delivers to your own account address while you use "${FROM}". Verify a domain at resend.com → Domains, then set MAIL_FROM to an address on it.`
                    : "Check RESEND_API_KEY — it may be wrong, revoked, or missing send permission."
                : response.status === 422
                    ? `Check MAIL_FROM ("${FROM}"). It must be a verified sender, formatted like: StoreFlow <noreply@yourdomain.com>.`
                    : "";

        const error = new Error(`Resend ${response.status}: ${reason}${hint ? ` — ${hint}` : ""}`);
        error.isEmailError = true;
        error.status = response.status;

        throw error;
    }

    return payload;
};
