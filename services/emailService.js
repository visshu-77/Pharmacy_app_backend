import transporter from "../config/mail.js";

export const sendSubscriptionThankYouEmail = async ({
    email,
    ownerName,
    plan,
    duration,
    price,
    startDate,
    endDate
}) => {

    const mailOptions = {
        from: `"Your Software Name" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Thank You for Your Subscription 🎉",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                background:#f5f7fb;
                padding:40px 20px;
            ">

                <div style="
                    max-width:600px;
                    margin:auto;
                    background:white;
                    border-radius:12px;
                    padding:30px;
                ">

                    <h2 style="color:#2563eb;">
                        Thank You, ${ownerName}! 🎉
                    </h2>

                    <p>
                        Your subscription has been successfully activated.
                    </p>

                    <div style="
                        background:#f8fafc;
                        padding:20px;
                        border-radius:10px;
                        margin:20px 0;
                    ">

                        <p>
                            <strong>Plan:</strong>
                            ${plan}
                        </p>

                        <p>
                            <strong>Duration:</strong>
                            ${duration}
                        </p>

                        <p>
                            <strong>Amount Paid:</strong>
                            ₹${price}
                        </p>

                        <p>
                            <strong>Start Date:</strong>
                            ${new Date(startDate).toLocaleDateString("en-IN")}
                        </p>

                        <p>
                            <strong>End Date:</strong>
                            ${new Date(endDate).toLocaleDateString("en-IN")}
                        </p>

                    </div>

                    <p>
                        You can now access all the features included
                        in your subscription plan.
                    </p>

                    <p style="margin-top:30px;">
                        Thanks for choosing us ❤️
                    </p>

                </div>

            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};