const router = require("express").Router();

// Paths
const user = require("./user");
const attendance = require("./attandance");
const admin = require("./admin");

// Routes
router.use("/user", user);
router.use("/attendance", attendance);
router.use("/admin", admin);

module.exports = router;