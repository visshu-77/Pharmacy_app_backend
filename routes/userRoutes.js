import express from 'express';
import { authMiddleware } from '../middleware/authmiddleware.js';
    
import { registeruser, getUser, loginUser }  from '../controllers/userControllers.js';
import users from '../model/users.js';

const router = express();

router.post('/register', registeruser);
router.get('/getUsers', getUser);
router.post('/login', loginUser);
router.get('/verify', authMiddleware,
    (req, res) => {
        res.status(200).json({
            message:"Token Valid",
            users:req.users
        });
    }
)

export default router;