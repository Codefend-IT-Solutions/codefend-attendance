const router = require("express").Router();

// Paths
const user = require("./user");
const attendance = require("./attandance");

// Routes
router.use("/user", user);
router.use("/attendance", attendance);

module.exports = router;