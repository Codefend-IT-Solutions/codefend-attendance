// Models
const userModel = require("../models/User");
const attendanceModel = require("../models/Attendance");

// Services
const UploadService = require("../services/UploadService");

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
            // Re-sort combined array by effective date
            attendance.sort((a, b) => {
                const da = new Date(a.checkIn || a.createdAt);
                const db = new Date(b.checkIn || b.createdAt);
                return da - db;
            });
        }

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