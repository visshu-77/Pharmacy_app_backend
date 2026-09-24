import mongoose from "mongoose";

/**
 * A signup waiting for its email code.
 *
 * Nothing is written to the users collection until the code is verified, so an
 * abandoned signup never leaves a half-made account or holds an email address
 * hostage. MongoDB deletes these documents automatically at `expiresAt`.
 */
const pendingSignupSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        // The registration form's answers, with the password already hashed.
        payload: {
            type: Object,
            required: true
        },

        // bcrypt hash — the plain code only ever exists in the email.
        otpHash: {
            type: String,
            required: true
        },

        otpExpiresAt: {
            type: Date,
            required: true
        },

        attempts: {
            type: Number,
            default: 0
        },

        sendCount: {
            type: Number,
            default: 1
        },

        lastSentAt: {
            type: Date,
            default: Date.now
        },

        // TTL: Mongo removes the document once this time passes.
        expiresAt: {
            type: Date,
            required: true
        }
    },
    { timestamps: true }
);

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const pendingSignup = mongoose.model(
    "dashboard/pendingSignups",
    pendingSignupSchema
);

export default pendingSignup;
