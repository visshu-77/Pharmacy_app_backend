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
    getBillingDetails
} from '../controllers/userControllers.js';

import users from '../model/users.js';

const router = express();

router.post('/register', registeruser);
router.get('/profile', authMiddleware, getProfile);
router.post('/login', loginUser);                                                                                                                               
router.get('/verify', authMiddleware,
    (req, res) => {
        res.status(200).json({
            message: "Token Valid",
            users: req.users
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