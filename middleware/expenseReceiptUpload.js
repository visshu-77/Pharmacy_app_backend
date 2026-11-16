import multer from "multer";

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter(req, file, callback) {
        if (!MIME_TYPES.has(file.mimetype)) {
            return callback(new Error("Upload a PDF, JPEG, PNG, or WebP receipt"));
        }
        callback(null, true);
    }
});

export const handleExpenseReceiptUpload = (handler) => (req, res, next) =>
    handler(req, res, (error) => {
        if (!error) return next();
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Receipt must be 5 MB or smaller"
            : error.message || "Could not upload receipt";
        return res.status(400).json({ message });
    });

export default upload;
