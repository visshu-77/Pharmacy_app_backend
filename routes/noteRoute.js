import express from "express";

import {
    getDayNote,
    addNoteEntry,
    updateNoteEntry,
    deleteNoteEntry
} from "../controllers/noteController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";
import { checkSubscription } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, checkSubscription, getDayNote);
router.post("/", authMiddleware, checkSubscription, addNoteEntry);
router.patch("/:id", authMiddleware, checkSubscription, updateNoteEntry);
router.delete("/:id", authMiddleware, checkSubscription, deleteNoteEntry);

export default router;
