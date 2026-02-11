const router = require("express").Router();

// Controllers
const { logAttendance, getAttendance } = require("../controllers/attendance");

// Middlewares
const verifyUser = require("../middlewares/verifyUser");

// Multer
const multer = require("multer");
const storage = multer.memoryStorage();

// Only allow image files
function mediaFilter(req, file, cb) {
    const allowedMimeTypes = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp",
    ];

    if (
        allowedMimeTypes.includes(file.mimetype) ||
        file.mimetype.startsWith("image/")
    ) {
        cb(null, true);
    } else {
        cb("Please upload a valid Image file.", false);
    }
}

const uploadMedia = multer({ storage, fileFilter: mediaFilter });

// Routes
router.use(verifyUser);

// Accept both body fields and a single image file (field name: "media")
router.route("/log").post(uploadMedia.single("media"), logAttendance);
router.route("/user/get").get(getAttendance);

module.exports = router;