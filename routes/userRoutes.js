import express from 'express';

    
import { registeruser, getUser }  from '../controllers/userControllers.js';

const router = express();

router.post('/register', registeruser);
router.get('/getUsers', getUser);

export default router;