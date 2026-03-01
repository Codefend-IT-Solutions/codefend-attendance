/**
 * Discord Service
 * Connects to Discord API to fetch channel messages and track user updates
 */

// Environment Variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Discord API base URL
const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Mapping of Discord User IDs to MongoDB User IDs
 * Format: { discordId: mongoUserId }
 * 
 * Add your team members here:
 */
const DISCORD_TO_MONGO_USER_MAP = {
    "1452568379981566054": "698c88c00ef38ef53c8b679a",      // Abdul Samad
    "1455518860512858206": "698c8b940ef38ef53c8b67b5",      // Asad Ali
    "834049902832255016": "698c8af00ef38ef53c8b67a9",       // Muhammad Ali
    "1452567805433090049": "698c8b1a0ef38ef53c8b67ac",      // Huzaifa Ghani
    "1452963530306224214": "698c89140ef38ef53c8b679d",      // Abdul Malik
    "1452537106004967540": "698c680f1c787deda7fe7d91",      // Faiq Ul Hassan
    "1452528907743133849": "698c8bd10ef38ef53c8b67b8",      // Muhammad Hamza
    "1457694278644928583": "698c67d11c787deda7fe7d8e",      // Bilal Ahmad
    "1460177043399508183": "698c8a820ef38ef53c8b67a3",      // Muhammad Omair
    "942728842353705040": "698c8a390ef38ef53c8b67a0",       // Tanveer Khan
    "1138012841346084966": "698c66df1c787deda7fe7d7e",      // Shahab Ud Din
    "628236259365748736": "698b641a0922545e81da933d",       // Huzaifa Shah
    "763718569569419265": "698c8c3b0ef38ef53c8b67be",       // Muhammad Umar Yousafzai
    "1455136504316690453": "698c8ab80ef38ef53c8b67a6",      // Mudassir Ali
};

/**
 * Get Discord ID from MongoDB user ID
 * @param {string} mongoUserId - MongoDB user ID
 * @returns {string|null} Discord user ID or null if not mapped
 */
const getDiscordIdFromMongoUser = (mongoUserId) => {
    for (const [discordId, mongoId] of Object.entries(DISCORD_TO_MONGO_USER_MAP)) {
        if (mongoId === mongoUserId) {
            return discordId;
        }
    }
    return null;
};

class DiscordService {
    constructor() {
        if (!DISCORD_BOT_TOKEN) {
            console.warn("DISCORD_BOT_TOKEN is not set - Discord features will not work");
        }
        if (!DISCORD_CHANNEL_ID) {
            console.warn("DISCORD_CHANNEL_ID is not set - Discord features will not work");
        }
    }

    /**
     * @description Make an authenticated request to Discord API
     * @param {string} endpoint - API endpoint (without base URL)
     * @param {object} options - Fetch options
     * @returns {Promise<object>} Response data
     */
    async _request(endpoint, options = {}) {
        const url = `${DISCORD_API_BASE}${endpoint}`;
        const headers = {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
            ...options.headers,
        };

        const response = await fetch(url, { ...options, headers });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Discord API error: ${response.status} - ${errorText}`);
        }

        return response.json();
    }

    /**
     * @description Fetch messages from the configured channel
     * @param {Date} startDate - Start of date range
     * @param {Date} endDate - End of date range
     * @param {number} limit - Max messages to fetch (Discord max is 100 per request)
     * @returns {Promise<Array>} Array of messages
     */
    async fetchChannelMessages(startDate, endDate, limit = 100) {
        if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
            throw new Error("Discord configuration is incomplete");
        }

        const allMessages = [];
        let lastMessageId = null;
        let hasMore = true;

        // Discord API returns messages in reverse chronological order
        // We need to paginate through all messages in the date range
        while (hasMore) {
            let endpoint = `/channels/${DISCORD_CHANNEL_ID}/messages?limit=${limit}`;
            if (lastMessageId) {
                endpoint += `&before=${lastMessageId}`;
            }

            const messages = await this._request(endpoint);

            if (!messages || messages.length === 0) {
                hasMore = false;
                break;
            }

            // Filter messages within date range
            for (const msg of messages) {
                const msgDate = new Date(msg.timestamp);

                // Stop if we've gone past the start date
                if (msgDate < startDate) {
                    hasMore = false;
                    break;
                }

                // Only include messages within range
                if (msgDate >= startDate && msgDate < endDate) {
                    allMessages.push({
                        id: msg.id,
                        authorId: msg.author.id,
                        authorUsername: msg.author.username,
                        content: msg.content,
                        timestamp: msg.timestamp,
                        date: msgDate.toISOString().slice(0, 10), // YYYY-MM-DD
                    });
                }
            }

            lastMessageId = messages[messages.length - 1].id;

            // If we got fewer messages than requested, we've reached the end
            if (messages.length < limit) {
                hasMore = false;
            }

            // Rate limiting: wait a bit between requests
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return allMessages;
    }

    /**
     * @description Get Discord attendance and sync with MongoDB in a single call
     * - Fetches Discord messages for the month
     * - Discovers all authors and their posting dates
     * - Updates MongoDB attendance records: if user is "present"/"late" but didn't post on Discord, mark as "discord-absent"
     * 
     * @param {number} year - Year (e.g., 2026)
     * @param {number} month - Month (1-12)
     * @param {object} attendanceModel - Mongoose Attendance model
     * @returns {Promise<object>} Combined attendance data and sync results
     */
    async getAndSyncMonthlyAttendance(year, month, attendanceModel) {
        // Calculate date range for the month
        const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

        // Get all messages for the month
        const messages = await this.fetchChannelMessages(startDate, endDate);

        // Discover unique authors and track which dates each user posted on
        const authorsMap = new Map(); // discordId -> { id, username }
        const userDatesMap = new Map(); // discordId -> Set of dates they posted

        for (const msg of messages) {
            // Track author
            if (!authorsMap.has(msg.authorId)) {
                authorsMap.set(msg.authorId, {
                    id: msg.authorId,
                    username: msg.authorUsername,
                });
            }

            // Track dates user posted on
            if (!userDatesMap.has(msg.authorId)) {
                userDatesMap.set(msg.authorId, new Set());
            }
            userDatesMap.get(msg.authorId).add(msg.date);
        }

        const members = Array.from(authorsMap.values());

        // Build attendance: for each user -> Map of date -> true (only dates they posted)
        const attendance = {};
        for (const [discordId, datesSet] of userDatesMap) {
            attendance[discordId] = {};
            for (const dateStr of datesSet) {
                attendance[discordId][dateStr] = true;
            }
        }

        // --- Sync with MongoDB ---
        // Get all attendance records for the month that are "present" or "late"
        const attendanceRecords = await attendanceModel.find({
            createdAt: { $gte: startDate, $lt: endDate },
            status: { $in: ["present", "late"] },
        });

        const updateOps = [];
        const affectedRecords = [];

        for (const record of attendanceRecords) {
            const mongoUserId = record.user.toString();
            const discordId = getDiscordIdFromMongoUser(mongoUserId);

            // Skip if user is not mapped to Discord
            if (!discordId) continue;

            // Get the date of this attendance record (YYYY-MM-DD)
            const recordDate = record.checkIn || record.createdAt;
            if (!recordDate) continue;

            const dateStr = new Date(recordDate).toISOString().slice(0, 10);

            // Check if user posted on Discord on this date
            const userDiscordDates = userDatesMap.get(discordId);
            const postedOnDiscord = userDiscordDates && userDiscordDates.has(dateStr);

            // If user was present/late but did NOT post on Discord, mark as discord-absent
            if (!postedOnDiscord) {
                updateOps.push({
                    updateOne: {
                        filter: { _id: record._id },
                        update: { status: "discord-absent" },
                    },
                });

                affectedRecords.push({
                    recordId: record._id,
                    userId: mongoUserId,
                    discordId,
                    date: dateStr,
                    previousStatus: record.status,
                    newStatus: "discord-absent",
                });
            }
        }

        // Execute bulk update
        if (updateOps.length > 0) {
            await attendanceModel.bulkWrite(updateOps);
        }

        return {
            month: `${year}-${String(month).padStart(2, "0")}`,
            members,
            attendance,
            sync: {
                totalChecked: attendanceRecords.length,
                totalUpdated: updateOps.length,
                affectedRecords,
            },
        };
    }
}

module.exports = new DiscordService();

