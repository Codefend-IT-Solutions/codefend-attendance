// Models
const attendanceModel = require("../models/Attendance");

// Schemas
const { logAttendanceSchema } = require("../schema/Attendance");

// Services
const UploadService = require("../services/UploadService");

// Utils
const { calculateDistanceMeters } = require("../utils/Methods");

// Helper Variables
const OFFICE_COORDS = { lat: 33.97331944724137, lng: 71.45657513924102 };
const MAX_DISTANCE_FROM_OFFICE_METERS = 500;

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
 * @description Log Attendance
 * @route POST /api/attendance/log
 * @access Private
 */
module.exports.logAttendance = async (req, res) => {
    // If using multipart/form-data, location and device may come as JSON strings.
    if (typeof req.body.location === "string") {
        try {
            req.body.location = JSON.parse(req.body.location);
        } catch (e) {
            // leave as-is; Joi validation will handle invalid format
        }
    }

    if (typeof req.body.device === "string") {
        try {
            req.body.device = JSON.parse(req.body.device);
        } catch (e) {
            // leave as-is; Joi validation will handle invalid format
        }
    }

    // Error Handling
    const { error, value } = logAttendanceSchema(req.body);
    if (error) {
        return res
            .status(400)
            .json({ msg: error.details[0].message, status: false });
    }

    const { _id: userId } = req.user;
    const {
        action,
        timestampIso,
        displayTime,
        displayDate,
        location,
        device,
    } = value;

    const timestamp = new Date(timestampIso);
    if (Number.isNaN(timestamp.getTime())) {
        return res
            .status(400)
            .json({ msg: "Invalid timestampIso", status: false });
    }

    // File must be present 
    if (!req.file) {
        return res.status(400).json({
            msg: "Image file is required.",
            status: false,
        });
    }

    try {
        if (action === "check-in") {
            // Prevent multiple check-ins for the same date
            const existingForDay = await attendanceModel.findOne({
                user: userId,
                displayDate,
            });

            if (existingForDay) {
                return res.status(400).json({
                    msg: "Attendance for this date is already logged",
                    status: false,
                });
            }

            // Calculate distance from office and enforce geofence
            const distanceFromOfficeMeters = calculateDistanceMeters(
                location.lat,
                location.lng,
                OFFICE_COORDS.lat,
                OFFICE_COORDS.lng
            );

            if (distanceFromOfficeMeters > MAX_DISTANCE_FROM_OFFICE_METERS) {
                return res.status(400).json({
                    msg: "You must be within 500 meters of the office to check-in",
                    status: false,
                });
            }

            // Handle image upload (compress + upload to Backblaze, then store URL)
            const file = req.file;
            const filename = `${Date.now()}_${userId}.jpeg`;
            const filepath = `attendance/${filename}`;

            const compressedBuffer = await UploadService.compressImage(
                file.buffer
            );
            const uploadResult = await UploadService.uploadFile(
                compressedBuffer,
                filepath
            );

            if (!uploadResult.status) {
                return res.status(500).json({
                    errors: uploadResult.error,
                    status: false,
                });
            }

            // Build location subdocument (GeoJSON Point)
            const locationDoc = {
                type: "Point",
                coordinates: [location.lng, location.lat], // GeoJSON expects [lng, lat]
                distanceFromOfficeMeters,
            };

            const deviceDoc = {
                userAgent: device?.userAgent,
                cameraDeviceId: device?.selectedCameraDeviceId,
            };

            const attendance = await attendanceModel.create({
                user: userId,
                displayTime,
                displayDate,
                checkIn: timestamp,
                location: locationDoc,
                device: deviceDoc,
                image: filepath,
                status: "present",
            });

            //Response
            return res.status(200).json({
                msg: "Check-in logged successfully",
                status: true,
                data: attendance,
            });
        }

        // action === "check-out"
        // Find the open attendance record for the provided date for this user.
        if (!displayDate) {
            return res.status(400).json({
                msg: "displayDate is required for check-out",
                status: false,
            });
        }

        const existing = await attendanceModel.findOne({
            user: userId,
            displayDate,
            checkOut: null,
        });

        if (!existing) {
            return res.status(404).json({
                msg: "No open attendance record found to check-out",
                status: false,
            });
        }

        // Set check-out time
        existing.checkOut = timestamp;

        // Business rule:
        // If total worked time between checkIn and checkOut is less than 7 hours 45 minutes,
        // mark status as "late", otherwise "present".
        const workDurationMs = existing.checkOut.getTime() - existing.checkIn.getTime();

        if (workDurationMs < 0) {
            return res.status(400).json({
                msg: "check-out time cannot be before check-in time",
                status: false,
            });
        }

        const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        const REQUIRED_MS = (7 * 60 + 45) * 60 * 1000; // 7 hours 45 minutes in milliseconds

        if (workDurationMs < TWO_HOURS_MS) {
            existing.status = "absent";
        } else if (workDurationMs < REQUIRED_MS) {
            existing.status = "late";
        } else {
            existing.status = "present";
        }

        await existing.save();

        //Response
        return res.status(200).json({
            msg: "Check-out logged successfully",
            status: true,
            data: existing,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ errors: error, status: false });
    }
};

/**
 * @description Get User's Attendance
 * @route GET /api/attendance/user/get
 * @access Private
 */
module.exports.getAttendance = async (req, res) => {
    const { _id: userId } = req.user;
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
                user: userId,
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
                    user: userId,
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
            // Re-sort combined array by effective date
            attendance.sort((a, b) => {
                const da = new Date(a.checkIn || a.createdAt);
                const db = new Date(b.checkIn || b.createdAt);
                return da - db;
            });
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
            else if (
                record.status === "absent" ||
                record.status === "discord-absent"
            )
                statusLabel = "Absent";

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