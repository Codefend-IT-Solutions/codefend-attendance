const Joi = require("joi");

/**
 * @description Validation schema for logging attendance (check-in / check-out)
 */
module.exports.logAttendanceSchema = (payload) => {
    const schema = Joi.object({
        action: Joi.string()
            .valid("check-in", "check-out")
            .required()
            .messages({
                "any.only": "Action must be either 'check-in' or 'check-out'",
                "any.required": "Action is required",
            }),

        timestampIso: Joi.string()
            .isoDate()
            .required()
            .messages({
                "string.isoDate": "timestampIso must be a valid ISO date string",
                "any.required": "timestampIso is required",
            }),

        displayTime: Joi.when("action", {
            is: "check-in",
            then: Joi.string().required().messages({
                "string.empty": "displayTime is required for check-in",
                "any.required": "displayTime is required for check-in",
            }),
            otherwise: Joi.string().optional(),
        }),

        displayDate: Joi.string().required().messages({
            "string.empty": "displayDate is required",
            "any.required": "displayDate is required",
        }),

        location: Joi.when("action", {
            is: "check-in",
            then: Joi.object({
                lat: Joi.number().required().messages({
                    "any.required": "location.lat is required for check-in",
                }),
                lng: Joi.number().required().messages({
                    "any.required": "location.lng is required for check-in",
                }),
                distanceFromOfficeMeters: Joi.number().optional(),
            })
                .required()
                .messages({
                    "any.required": "location is required for check-in",
                }),
            otherwise: Joi.object().optional(),
        }),

        device: Joi.when("action", {
            is: "check-in",
            then: Joi.object({
                userAgent: Joi.string().required().messages({
                    "string.empty": "device.userAgent is required for check-in",
                    "any.required": "device.userAgent is required for check-in",
                }),
                selectedCameraDeviceId: Joi.string().optional(),
            })
                .required()
                .messages({
                    "any.required": "device is required for check-in",
                }),
            otherwise: Joi.object().optional(),
        }),

        // Kept optional for backward compatibility if body still sends base64 image
        media: Joi.optional().allow(null),
    }).unknown(false);

    return schema.validate(payload);
};


