// Models
const userModel = require("../models/User");

//NPM Packages
const bcrypt = require("bcryptjs");

// Utils
const { generateToken } = require("../utils/Methods");

// Schemas
const {
    signupSchema,
    loginSchema,
    profileSchema,
    passwordSchema,
} = require("../schema/User");

/**
 * @description User Signup
 * @route POST /api/user/signup
 * @access Public
 */
module.exports.signup = async (req, res) => {
    const payload = req.body;

    //Error Handling
    const result = signupSchema(payload);
    if (result.error) {
        const errors = result.error.details
            .map((detail) => detail.message)
            .join(",");
        return res.status(400).json({ msg: errors, status: false });
    }

    //Signup
    try {
        const userExists = await userModel.findOne({ email: payload.email });
        if (userExists) {
            return res
                .status(400)
                .json({ status: false, msg: "User already exists" });
        }

        //Preparing Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(payload.password, salt);

        //Creating User
        const user = await userModel.create({ ...payload, password: hash });

        //Generate Token
        const token = generateToken(user._id);

        //Response
        return res.status(200).json({
            msg: "Account Created Successfully",
            id: user._id,
            token,
            status: true,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error });
    }
};

/**
 * @description User Login
 * @route POST /api/user/login
 * @access Public
 */
module.exports.login = async (req, res) => {
    const payload = req.body;

    //Error Handling
    const result = loginSchema(payload);
    if (result.error) {
        const errors = result.error.details
            .map((detail) => detail.message)
            .join(",");
        return res.status(400).json({ msg: errors, status: false });
    }

    //Login
    try {
        const user = await userModel
            .findOne({ email: payload.email })
            .select("+password");
        if (user) {
            const matched = await bcrypt.compare(payload.password, user.password);
            if (matched) {
                //Generate Token
                const token = generateToken(user._id);

                //Response
                return res.status(200).json({
                    msg: "Login Successfully",
                    id: user._id,
                    token,
                    isAdmin: user.role === "admin",
                    status: true,
                });
            } else {
                return res.status(400).json({
                    msg: "Invalid password. Please try again or reset.",
                    status: false,
                });
            }
        } else {
            return res.status(400).json({ msg: "User not found", status: false });
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error });
    }
};

/**
 * @description Get User Information
 * @route GET /api/user/whoami/:id
 * @access Public
 */
module.exports.getUserInfo = async (req, res) => {
    const { _id } = req.user;

    try {
        const user = await userModel.findById(_id);
        if (!user) {
            return res.status(400).json({ msg: "User not found", status: false });
        }

        // Response
        return res.status(200).json({
            msg: "User information",
            status: true,
            data: user,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error });
    }
};

/**
 * @description Edit Profile
 * @route PUT /api/user/edit
 * @access Private
 */
module.exports.editProfile = async (req, res) => {
    const { _id } = req.user;
    const payload = req.body;

    //Error Handling
    const result = profileSchema(payload);
    if (result.error) {
        const errors = result.error.details
            .map((detail) => detail.message)
            .join(",");
        return res.status(400).json({ msg: errors, status: false });
    }

    //Edit Profile
    try {
        const user = await userModel.findByIdAndUpdate(_id, payload, { returnDocument: "after" });
        if (!user) {
            return res.status(400).json({ msg: "User not found", status: false });
        }

        // Response
        return res
            .status(200)
            .json({ msg: "Profile updated successfully", status: true, data: user });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error });
    }
};

/**
 * @description Change Password
 * @route PUT /api/user/change-password/:id
 * @access Private
 */
module.exports.changePassword = async (req, res) => {
    const { id } = req.params;
    const payload = req.body;

    //Error Handling
    const result = passwordSchema(payload);
    if (result.error) {
        const errors = result.error.details
            .map((detail) => detail.message)
            .join(",");
        return res.status(400).json({ msg: errors, status: false });
    }

    try {
        //Find User
        const user = await userModel.findById(id).select("+password");
        if (!user)
            return res.status(404).json({ status: false, msg: "User not found" });

        //Encrypt New Password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(payload.newPassword, salt);

        //Update Password
        await userModel.updateOne({ _id: id }, { password: hash });

        //Response
        return res
            .status(200)
            .json({ status: true, msg: "Password Changed Successfully" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error });
    }
};
