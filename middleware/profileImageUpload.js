import multer from "multer";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024,
        files: 1
    },
    fileFilter(req, file, callback) {
        if (!IMAGE_TYPES.has(file.mimetype)) {
            return callback(new Error("Upload a PNG, JPEG or WebP image"));
        }

        return callback(null, true);
    }
});

export const handleProfileImageUpload = (handler) => (req, res, next) =>
    handler(req, res, (error) => {
        if (!error) return next();

        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Image must be 2 MB or smaller"
            : error.message || "Could not read the uploaded image";

        return res.status(400).json({ message });
    });

export default upload;
