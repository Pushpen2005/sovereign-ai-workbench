/**
 * API LAYER — client.js
 *
 * Axios instance shared across all API modules.
 *
 * Responsibilities:
 * - Base URL from VITE_API_BASE_URL environment variable
 * - Default headers (Accept: application/json)
 * - Normalized ApiError thrown on non-2xx responses
 * - Convenience helpers: get(), post(), postForm()
 *
 * NO React state. NO UI logic.
 */

import axios from 'axios';

// ─── Base URL ─────────────────────────────────────────────────────────────────

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';

// ─── Axios instance ───────────────────────────────────────────────────────────

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/json',
  },
});

// ─── Error normalisation ──────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Axios response interceptor — converts axios errors into ApiError so all
 * callers can catch a consistent error shape regardless of HTTP status.
 */
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with a non-2xx status
      const { status, data } = error.response;
      const message =
        data?.message ||
        data?.error ||
        `HTTP ${status}: ${error.response.statusText}`;
      return Promise.reject(new ApiError(message, status, data));
    }
    if (error.request) {
      // Request was made but no response received (network error, CORS, timeout)
      return Promise.reject(
        new ApiError('Network error — no response received from server.', 0, null),
      );
    }
    // Something else went wrong (bad request setup)
    return Promise.reject(new ApiError(error.message, 0, null));
  },
);

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * GET request — returns parsed response data.
 * @param {string} path - e.g. "/api/v1/documents"
 * @returns {Promise<any>}
 */
export function get(path) {
  return axiosInstance.get(path).then((res) => res.data);
}

/**
 * POST JSON request — returns parsed response data.
 * @param {string} path
 * @param {object} body
 * @returns {Promise<any>}
 */
export function post(path, body) {
  return axiosInstance.post(path, body).then((res) => res.data);
}

/**
 * POST multipart/form-data — returns parsed response data.
 * axios automatically sets the correct Content-Type with boundary when
 * given a FormData object. Do NOT manually set Content-Type here.
 * @param {string} path
 * @param {FormData} formData
 * @returns {Promise<any>}
 */
export function postForm(path, formData) {
  return axiosInstance
    .post(path, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((res) => res.data);
}

export default axiosInstance;
