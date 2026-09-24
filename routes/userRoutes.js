import express from 'express';
import { authMiddleware } from '../middleware/authmiddleware.js';

import {
    registeruser,
    getProfile,
    loginUser,
    updateProfile,
    changePassword,
    updateNotifcationSettings,
    getNotificationSettings,
    getPreference,
    updatePreference,
    getBillingDetails,
    listBusinessTypes
} from '../controllers/userControllers.js';

import {
    sendSignupOtp,
    resendSignupOtp,
    verifySignupOtp,
    emailStatus
} from '../controllers/signupOtpController.js';

import users from '../model/users.js';

const router = express.Router();

// Static configuration — the registration screen needs it before sign-in.
router.get('/business-types', listBusinessTypes);

// Signup with email verification: send a code, then verify it to create
// the account. /register itself is closed (see the controller).
// Setup check (development only): GET /api/email-status[?to=you@example.com]
router.get('/email-status', emailStatus);

router.post('/register/send-otp', sendSignupOtp);
router.post('/register/resend-otp', resendSignupOtp);
router.post('/register/verify-otp', verifySignupOtp);

router.post('/register', registeruser);
router.get('/profile', authMiddleware, getProfile);
router.post('/login', loginUser);                                                                                                                               
router.get('/verify', authMiddleware,
    (req, res) => {
        res.status(200).json({
            message: "Token Valid",
        });
    }
)

router.put("/update-profile", authMiddleware, updateProfile);
router.post('/change-password', authMiddleware, changePassword);

router.put("/notification-setting", authMiddleware, updateNotifcationSettings);
router.get("/notification-settings", authMiddleware, getNotificationSettings)

router.get("/preferences", authMiddleware, getPreference);
router.put("/preferences", authMiddleware, updatePreference);

router.get("/billing-details", authMiddleware, getBillingDetails);


export default router;