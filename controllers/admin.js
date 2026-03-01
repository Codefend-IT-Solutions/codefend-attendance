// Models
const userModel = require("../models/User");
const attendanceModel = require("../models/Attendance");

// Services
const UploadService = require("../services/UploadService");
const FaceService = require("../services/FaceService");
const DiscordService = require("../services/DiscordService");

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parseMonthParam = (monthStr) => {
    // Expected format: YYYY-MM
    const match = /^(\d{4})-(\d{2})$/.exec(monthStr || "");
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1; // JS Date month is 0-based
    if (monthIndex < 0 || monthIndex > 11) return null;

    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
    return { year, monthIndex, start, end };
};

const computeWorkingDaysByWeek = (year, monthIndex) => {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const workingDaysPerWeek = [0, 0, 0, 0];
    let totalWorkingDays = 0;

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, monthIndex, day);
        const dow = date.getDay(); // 0 = Sun, 6 = Sat
        if (dow === 0 || dow === 6) continue; // skip weekends

        const weekIndex =
            day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;

        workingDaysPerWeek[weekIndex] += 1;
        totalWorkingDays += 1;
    }

    return { totalWorkingDays, workingDaysPerWeek };
};

/**
 * @description Get All Users
 * @route GET /api/admin/users/get
 * @access Private
 */
module.exports.getAllUsers = async (req, res) => {
    try {
        const users = await userModel.find({ role: "user" }).sort({ empId: 1 });

        //Response
        return res.status(200).json({ status: true, users });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ status: false, error: error.message });
    }
};

/**
 * @description Get User's Attendance
 * @route GET /api/admin/attendance/get/:id
 * @access Private
 */
module.exports.getUserAttendance = async (req, res) => {
    const { id } = req.params;
    const { month } = req.query;

    const monthInfo = parseMonthParam(month);
    if (!monthInfo) {
        return res.status(400).json({
            msg: "Invalid or missing month. Expected format: YYYY-MM",
            status: false,
        });
    }

    const { year, monthIndex, start, end } = monthInfo;

    const { totalWorkingDays, workingDaysPerWeek } =
        computeWorkingDaysByWeek(year, monthIndex);

    // Determine how many days we should consider for auto-absent backfill
    const now = new Date();
    let maxDayToFill = 0;
    if (
        year < now.getFullYear() ||
        (year === now.getFullYear() && monthIndex < now.getMonth())
    ) {
        // Past month: consider entire month
        const lastDay = new Date(year, monthIndex + 1, 0).getDate();
        maxDayToFill = lastDay;
    } else if (
        year === now.getFullYear() &&
        monthIndex === now.getMonth()
    ) {
        // Current month: only days strictly before today
        maxDayToFill = now.getDate() - 1;
    }

    try {
        // Load all attendance records for that user and month (by createdAt)
        let attendance = await attendanceModel
            .find({
                user: id,
                createdAt: { $gte: start, $lt: end },
            })
            .sort({ createdAt: 1 });

        // Build a set of dates (YYYY-MM-DD) that already have records
        const existingDayKeys = new Set();
        attendance.forEach((record) => {
            const d = record.checkIn || record.createdAt;
            if (!d) return;
            const dt = new Date(d);
            const dateKey = dt.toISOString().slice(0, 10); // YYYY-MM-DD
            existingDayKeys.add(dateKey);
        });

        // Create absent records for missing working days up to maxDayToFill
        const docsToInsert = [];
        if (maxDayToFill > 0) {
            for (let day = 1; day <= maxDayToFill; day++) {
                const date = new Date(year, monthIndex, day);
                const dow = date.getDay(); // 0 = Sun, 6 = Sat
                if (dow === 0 || dow === 6) continue; // skip weekends

                const dateKey = date.toISOString().slice(0, 10); // YYYY-MM-DD
                if (existingDayKeys.has(dateKey)) continue;

                const displayDate = date.toLocaleDateString("en-GB"); // dd/mm/yyyy

                docsToInsert.push({
                    user: id,
                    displayDate,
                    status: "absent",
                    checkIn: null,
                    checkOut: null,
                    createdAt: date,
                    updatedAt: date,
                });
            }
        }

        if (docsToInsert.length > 0) {
            const inserted = await attendanceModel.insertMany(docsToInsert);
            attendance = attendance.concat(inserted);
        }

        // Deduplicate: if multiple records exist for the same date, keep the one that is NOT "absent"
        // Priority: present/late/discord-absent > absent (auto-created)
        // Use displayDate for comparison since it represents the actual local date
        const recordsByDate = new Map();
        for (const record of attendance) {
            // Normalize displayDate to a consistent format for comparison
            // displayDate can be "16/02/2026" (DD/MM/YYYY) or "2/16/2026" (M/D/YYYY)
            let dateKey = record.displayDate;
            if (!dateKey) continue;

            // Convert to YYYY-MM-DD for consistent comparison
            const parts = dateKey.split("/");
            if (parts.length === 3) {
                // Check if first part is day (DD/MM/YYYY) or month (M/D/YYYY)
                if (parts[2].length === 4) {
                    // Year is last, could be DD/MM/YYYY or M/D/YYYY
                    const first = parseInt(parts[0], 10);
                    const second = parseInt(parts[1], 10);
                    const third = parseInt(parts[2], 10);
                    
                    // If first > 12, it's definitely DD/MM/YYYY
                    // Otherwise assume M/D/YYYY (US format from frontend)
                    if (first > 12) {
                        // DD/MM/YYYY
                        dateKey = `${third}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
                    } else {
                        // M/D/YYYY
                        dateKey = `${third}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
                    }
                }
            }

            const existing = recordsByDate.get(dateKey);
            if (!existing) {
                recordsByDate.set(dateKey, record);
            } else {
                // Prefer record with status other than "absent"
                const existingIsAbsent = existing.status === "absent";
                const currentIsAbsent = record.status === "absent";

                if (existingIsAbsent && !currentIsAbsent) {
                    // Current record has real status, replace the absent one
                    recordsByDate.set(dateKey, record);
                }
                // If both are absent or both are not absent, keep the first one
            }
        }

        // Replace attendance array with deduplicated records
        attendance = Array.from(recordsByDate.values());

        // Sort by effective date
        attendance.sort((a, b) => {
            const da = new Date(a.checkIn || a.createdAt);
            const db = new Date(b.checkIn || b.createdAt);
            return da - db;
        });

        // For all past working days in this month, if there is a record with
        // check-in but no check-out, mark it as "late".
        const lateUpdateOps = [];
        attendance.forEach((record) => {
            const d = record.checkIn || record.createdAt;
            if (!d) return;
            const date = new Date(d);
            const dow = date.getDay(); // 0 = Sun, 6 = Sat
            const dayNum = date.getDate();

            if (dayNum > maxDayToFill) return; // only days before today (or full month for past months)
            if (dow === 0 || dow === 6) return; // skip weekends

            if (record.checkIn && !record.checkOut && record.status !== "late") {
                record.status = "late";
                lateUpdateOps.push({
                    updateOne: {
                        filter: { _id: record._id },
                        update: { status: "late" },
                    },
                });
            }
        });

        if (lateUpdateOps.length > 0) {
            await attendanceModel.bulkWrite(lateUpdateOps);
        }

        let presents = 0;
        let lates = 0;
        let absents = 0;
        let discordAbsents = 0;

        const presentLikePerWeek = [0, 0, 0, 0];

        attendance.forEach((record) => {
            const d = record.checkIn || record.createdAt;
            if (!d) return;

            const date = new Date(d);
            const dow = date.getDay();

            // Count statuses
            switch (record.status) {
                case "present":
                    presents += 1;
                    break;
                case "late":
                    lates += 1;
                    break;
                case "absent":
                    absents += 1;
                    break;
                case "discord-absent":
                    discordAbsents += 1;
                    break;
                default:
                    break;
            }

            // Only consider weekdays for weekly presence ratios
            if (dow === 0 || dow === 6) return;

            const dayNum = date.getDate();
            const weekIndex =
                dayNum <= 7 ? 0 : dayNum <= 14 ? 1 : dayNum <= 21 ? 2 : 3;

            if (
                record.status === "present" ||
                record.status === "late"
            ) {
                presentLikePerWeek[weekIndex] += 1;
            }
        });

        const presenceSeries = workingDaysPerWeek.map((workingDays, idx) => {
            if (!workingDays) return 0;
            return presentLikePerWeek[idx] / workingDays;
        });

        const days = attendance.map((record) => {
            const d = record.checkIn || record.createdAt;
            const date = new Date(d);
            // Derive date parts in local time so they match the original check-in/check-out
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD in local time
            const weekday = WEEKDAY_LABELS[date.getDay()];

            let statusLabel = "Unknown";
            if (record.status === "present") statusLabel = "Present";
            else if (record.status === "late") statusLabel = "Late";
            else if (record.status === "absent") statusLabel = "Absent";
            else if (record.status === "discord-absent") statusLabel = "Discord Absent";

            // Send raw ISO timestamps for check-in / check-out.
            // Frontend is responsible for rendering them in the user's local timezone.
            const checkIn = record.checkIn ? record.checkIn.toISOString() : null;
            const checkOut = record.checkOut ? record.checkOut.toISOString() : null;

            const hasLocation = !!record.location;
            const locationLabel = hasLocation ? "Office" : null;

            const imageLabel = record.image ? UploadService.generateUrl(`${record.image}`)
                : "—";

            const deviceLabel = record.device?.userAgent
                ? record.device?.userAgent.split(" ")[0]
                : null;

            return {
                date: dateStr,
                weekday,
                status: statusLabel,
                checkIn,
                checkOut,
                checkInLocation: locationLabel,
                checkOutLocation: locationLabel,
                imageLabel,
                device: deviceLabel,
            };
        });

        const stats = {
            presents,
            lates,
            absents: absents + discordAbsents,
            daysInMonth: totalWorkingDays,
            presenceSeries,
            days,
        };

        //Response
        return res.status(200).json({
            msg: "User's monthly attendance stats",
            status: true,
            data: stats,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error, status: false });
    }
};

/**
 * @description Upload Base Image for User (Face Recognition)
 * @route POST /api/admin/users/:userId/base-image
 * @access Private (Admin only)
 * 
 * Accepts multipart form with:
 * - image: The base image file
 * - descriptor: JSON stringified 128-dimension face descriptor array (computed on frontend)
 */
module.exports.uploadBaseImage = async (req, res) => {
    const { userId } = req.params;

    // Validate userId
    if (!userId) {
        return res.status(400).json({
            msg: "User ID is required",
            status: false,
        });
    }

    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({
            msg: "No image file provided",
            status: false,
        });
    }

    // Parse and validate descriptor from request body
    let descriptor = null;
    if (req.body.descriptor) {
        try {
            descriptor = JSON.parse(req.body.descriptor);
        } catch {
            return res.status(400).json({
                msg: "Invalid descriptor format. Expected JSON array.",
                status: false,
            });
        }
    }

    // Validate descriptor
    if (!descriptor || !FaceService.isValidDescriptor(descriptor)) {
        return res.status(400).json({
            msg: "Invalid face descriptor. Must be an array of 128 numbers.",
            status: false,
        });
    }

    try {
        // Check if user exists
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({
                msg: "User not found",
                status: false,
            });
        }

        // Compress and upload image to Backblaze B2
        const compressedBuffer = await UploadService.compressImage(req.file.buffer);
        const fileName = `base-images/${userId}.jpeg`;
        const uploadResult = await UploadService.uploadFile(compressedBuffer, fileName);

        if (!uploadResult.status) {
            return res.status(500).json({
                msg: "Failed to upload image to storage",
                status: false,
                error: uploadResult.error,
            });
        }

        // Generate URL for the uploaded image
        const baseImageUrl = UploadService.generateUrl(fileName);

        // Update user with base image URL and face descriptor
        await userModel.findByIdAndUpdate(userId, {
            baseImage: baseImageUrl,
            faceDescriptor: descriptor,
        });

        return res.status(200).json({
            msg: "Base image uploaded and face descriptor saved successfully",
            status: true,
            data: {
                baseImage: baseImageUrl,
                hasDescriptor: true,
            },
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            msg: "Internal server error",
            status: false,
            error: error.message,
        });
    }
};

/**
 * @description Get User's Base Image Status
 * @route GET /api/admin/users/:userId/base-image
 * @access Private (Admin only)
 */
module.exports.getBaseImageStatus = async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({
            msg: "User ID is required",
            status: false,
        });
    }

    try {
        const user = await userModel.findById(userId).select("+faceDescriptor");
        if (!user) {
            return res.status(404).json({
                msg: "User not found",
                status: false,
            });
        }

        return res.status(200).json({
            status: true,
            data: {
                hasBaseImage: !!user.baseImage,
                baseImage: user.baseImage || null,
                hasDescriptor: !!(user.faceDescriptor && user.faceDescriptor.length === 128),
            },
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            msg: "Internal server error",
            status: false,
            error: error.message,
        });
    }
};

/**
 * @description Get Discord Channel Attendance for a Month and Sync with MongoDB
 * @route GET /api/admin/discord/attendance
 * @access Private (Admin only)
 *
 * Query params:
 * - month: YYYY-MM format (required)
 *
 * This single API:
 * 1. Fetches Discord channel messages for the month
 * 2. Discovers all unique authors and their posting dates
 * 3. Syncs with MongoDB: marks users as "discord-absent" if they were present/late but didn't post
 *
 * Returns:
 * - members: Array of { id, username } for each discovered author
 * - attendance: { [discordId]: { [date]: boolean } } - true if posted that day
 * - sync: { totalChecked, totalUpdated, affectedRecords } - sync results
 */
module.exports.getDiscordAttendance = async (req, res) => {
    const { month } = req.query;

    // Validate month parameter
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(month || "");
    if (!monthMatch) {
        return res.status(400).json({
            msg: "Invalid or missing month. Expected format: YYYY-MM",
            status: false,
        });
    }

    const year = Number(monthMatch[1]);
    const monthNum = Number(monthMatch[2]);

    if (monthNum < 1 || monthNum > 12) {
        return res.status(400).json({
            msg: "Invalid month value",
            status: false,
        });
    }

    try {
        // Single function that fetches Discord data AND syncs with MongoDB
        const data = await DiscordService.getAndSyncMonthlyAttendance(
            year,
            monthNum,
            attendanceModel
        );

        // Remove userDatesMap from response (internal use only)
        const { userDatesMap, ...responseData } = data;

        return res.status(200).json({
            msg: "Discord attendance fetched and synced successfully",
            status: true,
            data: responseData,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            msg: "Failed to fetch and sync Discord attendance",
            status: false,
            error: error.message,
        });
    }
};
