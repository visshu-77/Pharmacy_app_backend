/** Branded verification email containing the one-time code. */
export const otpEmailTemplate = ({ ownerName, shopName, otp, minutes }) => {
    const greeting = ownerName ? `Hi ${ownerName},` : "Hi,";

    const html = `
<div style="margin:0;padding:32px 16px;background:#f4f6fa;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb 55%,#4f46e5);padding:28px 32px;">
      <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">StoreFlow</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">Run your store, end to end.</p>
    </div>

    <div style="padding:32px;">
      <p style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:600;">${greeting}</p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:22px;">
        Use this code to verify your email${shopName ? ` and finish setting up <strong>${shopName}</strong>` : ""}.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center;">
        <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Verification code</p>
        <p style="margin:0;color:#0f172a;font-size:36px;font-weight:700;letter-spacing:10px;font-family:'Courier New',monospace;">${otp}</p>
      </div>

      <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:21px;">
        This code expires in ${minutes} minutes and can be used once.
      </p>
      <p style="margin:12px 0 0;color:#64748b;font-size:13px;line-height:21px;">
        If you didn't try to create a StoreFlow account, you can ignore this email — nothing has been created.
      </p>
    </div>

    <div style="padding:18px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
      <p style="margin:0;color:#94a3b8;font-size:12px;">This is an automated message, please don't reply.</p>
    </div>
  </div>
</div>`;

    const text = [
        greeting,
        "",
        `Your StoreFlow verification code is ${otp}.`,
        `It expires in ${minutes} minutes and can be used once.`,
        "",
        "If you didn't try to create a StoreFlow account, ignore this email."
    ].join("\n");

    return { html, text };
};
