const router = require("express").Router();

// Controllers
const {
  signup,
  login,
  getUserInfo,
  editProfile,
  changePassword,
} = require("../controllers/user");

// Middlewares
const verifyUser = require("../middlewares/verifyUser");

// Routes
router.route("/signup").post(signup);
router.route("/login").post(login);

// Auth Routes
router.use(verifyUser);

router.route("/whoami").get(getUserInfo);
router.route("/edit").put(editProfile);
router.route("/change-password/:id").put(changePassword);

module.exports = router;
