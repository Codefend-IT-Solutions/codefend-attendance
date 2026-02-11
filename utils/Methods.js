const jwt = require("jsonwebtoken");

// Methods
module.exports.generateToken = (id) => {
  return jwt.sign({ id }, process.env.SECRET);
};

const toRad = (value) => (value * Math.PI) / 180;

module.exports.calculateDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Sanitize file name
module.exports.sanitizeFileName = (name) => {
  const parts = name.split(".");

  // Sanitize the filename part (replace invalid characters with underscores)
  const sanitizedFilename = parts[0].replace(/[^a-zA-Z0-9-_.]/g, "_");

  // Reconstruct the sanitized name with the extension (if it exists)
  const sanitizedName =
    parts.length > 1
      ? `${sanitizedFilename}.${parts[parts.length - 1]}`
      : sanitizedFilename;

  return sanitizedName.substring(0, Math.min(sanitizedName.length, 1024));
};
