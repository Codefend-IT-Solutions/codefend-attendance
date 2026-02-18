/**
 * FaceService - Face descriptor utilities for Node.js
 * 
 * Note: Face descriptor computation is done on the frontend using face-api.js
 * The backend only stores and compares descriptors
 */

/**
 * Validate that a descriptor is a valid 128-dimension array
 * @param {any} descriptor - The descriptor to validate
 * @returns {boolean}
 */
function isValidDescriptor(descriptor) {
    if (!Array.isArray(descriptor)) return false;
    if (descriptor.length !== 128) return false;
    return descriptor.every(val => typeof val === 'number' && !isNaN(val));
}

/**
 * Compare two face descriptors using Euclidean distance
 * @param {number[]} descriptor1 - First descriptor (128 values)
 * @param {number[]} descriptor2 - Second descriptor (128 values)
 * @param {number} threshold - Maximum distance to consider a match (default 0.6)
 * @returns {{match: boolean, distance: number}}
 */
function compareDescriptors(descriptor1, descriptor2, threshold = 0.6) {
    if (!isValidDescriptor(descriptor1) || !isValidDescriptor(descriptor2)) {
        return { match: false, distance: Infinity };
    }

    // Calculate Euclidean distance
    let sum = 0;
    for (let i = 0; i < 128; i++) {
        const diff = descriptor1[i] - descriptor2[i];
        sum += diff * diff;
    }
    const distance = Math.sqrt(sum);

    return {
        match: distance <= threshold,
        distance: Math.round(distance * 1000) / 1000,
    };
}

module.exports = {
    isValidDescriptor,
    compareDescriptors,
};
