import { body } from 'express-validator';

export const validateUser = [
    body("email").isEmail().withMessage("Please Enter a valid email Address"),
    body("mobileNumber").matches(/^[6-9]\d{9}$/).withMessage("Please enter a valid 10 digit mobile number")
]