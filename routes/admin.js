const router = require("express").Router();
const multer = require("multer");

// Controllers
const { getAllUsers, getUserAttendance, uploadBaseImage, getBaseImageStatus } = require("../controllers/admin");

// Middlewares
const verifyAdmin = require("../middlewares/verifyAdmin");

// Multer config for file uploads (memory storage for processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"), false);
        }
    },
});

// Routes
router.use(verifyAdmin);

router.route("/users/get").get(getAllUsers);
router.route("/attendance/get/:id").get(getUserAttendance);

// Face recognition base image routes
router.route("/users/:userId/base-image")
    .get(getBaseImageStatus)
    .post(upload.single("image"), uploadBaseImage);

module.exports = router;