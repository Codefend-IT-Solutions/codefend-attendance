const router = require("express").Router();

// Controllers
const { getAllUsers, getUserAttendance } = require("../controllers/admin");

// Middlewares
const verifyAdmin = require("../middlewares/verifyAdmin");

// Routes
router.use(verifyAdmin);

router.route("/users/get").get(getAllUsers);
router.route("/attendance/get/:id").get(getUserAttendance);

module.exports = router;