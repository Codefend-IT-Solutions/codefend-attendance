const mongoose = require("mongoose")

const attendanceSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // For UI display only (filtering should use checkIn/checkOut dates)
        displayTime: { type: String, required: false, default: null },
        displayDate: { type: String, required: true },

        // Core timestamps
        checkIn: {
            type: Date,
            required: false,
            default: null,
        },
        // Will be set later on check‑out, so it cannot be required
        checkOut: {
            type: Date,
            required: false,
            default: null,
        },

        // GeoJSON Point + extra metadata from frontend
        location: {
            type: {
                type: String,
                enum: ["Point"],
            },
            // IMPORTANT: [lng, lat] order when saving
            coordinates: {
                type: [Number],
            },
            distanceFromOfficeMeters: {
                type: Number,
            },
        },

        // Device details sent by frontend
        device: {
            userAgent: { type: String, required: false },
            cameraDeviceId: { type: String },
        },

        // For now we'll store the base64 string or a URL, depending on controller logic
        image: { type: String, required: false },

        status: {
            type: String,
            enum: ["present", "late", "absent", "discord-absent"],
            default: "absent",
        },
    },
    { timestamps: true }
)

// Helpful indexes for querying/filtering
attendanceSchema.index({ user: 1, checkIn: 1 })
attendanceSchema.index({ status: 1 })
attendanceSchema.index({ location: "2dsphere" })

module.exports = mongoose.model("Attendance", attendanceSchema)