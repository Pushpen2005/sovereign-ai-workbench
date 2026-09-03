import { registerUser, loginUser, getCurrentUser } from "../services/auth.service.js";

/**
 * Auth Controller
 * Express request handlers for user registration, authentication, and profile lookup.
 */

export async function register(req, res, next) {
  try {
    const { name, email, password, organizationId, organizationName, role } = req.body || {};

    const result = await registerUser({
      name,
      email,
      password,
      organizationId,
      organizationName,
      role,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    const result = await loginUser({ email, password });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
}

export async function getMe(req, res, next) {
  try {
    const userId = req.user?.id;
    const user = await getCurrentUser(userId);

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
}
