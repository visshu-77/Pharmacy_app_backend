import multer from "multer";

/**
 * CSV uploads (product import). Files stay in memory — they are parsed and
 * discarded, never written to disk.
 */
const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024,   // 5 MB — plenty for tens of thousands of rows
        files: 1
    },

    fileFilter(req, file, callback) {
        const isCsv =
            /\.csv$/i.test(file.originalname || "") ||
            [
                "text/csv",
                "application/csv",
                "text/plain",
                "application/vnd.ms-excel",      // what Windows/Excel often sends
                "application/octet-stream"
            ].includes(file.mimetype);

        if (!isCsv) {
            return callback(new Error("Only .csv files can be imported"));
        }

        return callback(null, true);
    }
});

/**
 * Wraps a multer handler so upload problems come back as a readable 400
 * instead of crashing into the generic 500 handler.
 */
export const handleUpload = (handler) => (req, res, next) =>
    handler(req, res, (error) => {
        if (!error) return next();

        const message =
            error.code === "LIMIT_FILE_SIZE"
                ? "That file is larger than 5 MB"
                : error.message || "Could not read the uploaded file";

        return res.status(400).json({ message });
    });

export default upload;
