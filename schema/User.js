const Joi = require("joi");

module.exports.signupSchema = (payload) => {
    const schema = Joi.object({
        fullname: Joi.string().required().messages({
            "string.empty": "Fullname is required",
            "any.required": "Fullname is required",
        }),
        empId: Joi.string().required().messages({
            "string.empty": "Employee ID is required",
            "any.required": "Employee ID is required",
        }),
        role: Joi.string().valid("admin", "user").required().messages({
            "string.empty": "Role is required",
            "any.required": "Role is required",
        }).default("user"),
        position: Joi.string().required().messages({
            "string.empty": "Position is required",
            "any.required": "Position is required",
        }),
        email: Joi.string().email().required().messages({
            "string.email": "Email must be a valid email address",
            "any.required": "Email is required",
        }),
        password: Joi.string().min(8).max(1024).required().messages({
            "string.empty": "Password is required",
            "string.min": "Password must be at least {#limit} characters long",
            "string.max": "Password cannot exceed {#limit} characters",
            "any.required": "Password is required",
        }),
    });

    const validationResult = schema.validate(payload);
    return validationResult;
};

module.exports.loginSchema = (payload) => {
    const schema = Joi.object({
        email: Joi.string().email().required().messages({
            "string.email": "Email must be a valid email address",
            "any.required": "Email is required",
        }),
        password: Joi.string().min(8).max(1024).required().messages({
            "string.empty": "Password is required",
            "string.min": "Invalid password. Please try again or reset.",
            "string.max": "Invalid password. Please try again or reset.",
            "any.required": "Password is required",
        }),
    }).unknown(false);

    const validationResult = schema.validate(payload);
    return validationResult;
};

module.exports.profileSchema = (payload) => {
    const schema = Joi.object({
        fullname: Joi.string().required().messages({
            "string.empty": "Fullname is required",
            "any.required": "Fullname is required",
        }),
        empId: Joi.string().required().messages({
            "string.empty": "Employee ID is required",
            "any.required": "Employee ID is required",
        }),
        role: Joi.string().valid("admin", "user").required().messages({
            "string.empty": "Role is required",
            "any.required": "Role is required",
        }).default("user"),
        position: Joi.string().required().messages({
            "string.empty": "Position is required",
            "any.required": "Position is required",
        }),
    }).unknown(false);

    const validationResult = schema.validate(payload);
    return validationResult;
};

module.exports.passwordSchema = (payload) => {
    const schema = Joi.object({
        newPassword: Joi.string().min(8).max(1024).required().messages({
            "string.empty": "New password is required",
            "string.min": "New password must be at least {#limit} characters long",
            "string.max": "New password cannot exceed {#limit} characters",
            "any.required": "New password is required",
        }),
        confirmNewPassword: Joi.string()
            .valid(Joi.ref("newPassword"))
            .required()
            .messages({
                "any.only": "New password and confirm new password must match",
                "any.required": "Confirm new password is required",
            }),
    }).unknown(false);

    const validationResult = schema.validate(payload);
    return validationResult;
};
