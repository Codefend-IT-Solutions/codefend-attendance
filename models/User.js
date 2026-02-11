const mongoose = require("mongoose")

const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    empId: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ["admin", "user"],
        default: "user",
        required: true,
    },
    position: {type: String, required: true},
    email: {
        type: String,
        max: 50,
        unique: true,
        sparse: true,
    },
    password: {
        type: String,
        minlenght: [6, "Password must be atleast 6 characters"],
        maxlength: [1024, "Password cannot excede 1024 characters"],
        select: false,
    },
}, { timestamps: true })

module.exports = mongoose.model("User", userSchema)