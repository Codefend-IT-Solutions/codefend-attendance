const jwt = require("jsonwebtoken");
const userModel = require("../models/User");

module.exports = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        try {
            token = req.headers.authorization.split(" ")[1];
            const decoded = jwt.verify(token.trim(), process.env.SECRET);
            const user = await userModel.findById(decoded.id).select("-password");
            if (user.role !== "admin") {
                return res.status(401).json({ status: false, msg: "Not authorized, you are not an admin" });
            } else {
                req.admin = user;
                next();
            }
        } catch (error) {
            console.error(error);
            res.status(401).send("Not authorized, token failed");
        }
    }
    if (!token) {
        res.status(401).send("Not authorized, no token");
    }
};
