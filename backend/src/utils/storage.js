/**
 * PR #27 — Centralized Multi-Tenant Storage Utilities
 *
 * Enforces organization-scoped directory partitioning and robust path traversal defenses
 * for uploaded documents and generated reports.
 *
 * Structure:
 *   backend/src/uploads/<organizationId>/<filename>
 *   backend/generated/<organizationId>/<filename>
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UPLOADS_ROOT = path.resolve(
    process.env.UPLOADS_DIR || path.resolve(__dirname, "../uploads")
);

export const GENERATED_ROOT = path.resolve(
    process.env.GENERATED_DIR || path.resolve(__dirname, "../../generated")
);

export class StorageSecurityError extends Error {
    constructor(message, statusCode = 403) {
        super(message);
        this.name = "StorageSecurityError";
        this.statusCode = statusCode;
        this.status = statusCode;
    }
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-.:]{1,128}$/;

/**
 * Validates an organization identifier strictly.
 * Rejects path traversal characters (/ \ .. % null bytes).
 *
 * @param {string} organizationId
 * @returns {string} Cleaned organizationId
 */
export function validateOrganizationId(organizationId) {
    if (!organizationId || typeof organizationId !== "string") {
        throw new StorageSecurityError("organizationId must be a non-empty string", 400);
    }

    const trimmed = organizationId.trim();

    if (
        !SAFE_ID_REGEX.test(trimmed) ||
        trimmed.includes("..") ||
        trimmed.includes("/") ||
        trimmed.includes("\\") ||
        trimmed.includes("\0") ||
        trimmed.includes("%2e") ||
        trimmed.includes("%2f")
    ) {
        throw new StorageSecurityError(
            `Access Denied: Invalid organizationId '${organizationId}'. Path traversal characters detected.`,
            400
        );
    }

    return trimmed;
}

/**
 * Validates a filename strictly.
 * Ensures the filename does not escape the expected directory via path traversal.
 *
 * @param {string} filename
 * @returns {string} Sanitized filename basename
 */
export function validateFilename(filename) {
    if (!filename || typeof filename !== "string") {
        throw new StorageSecurityError("Filename must be a non-empty string", 400);
    }

    const trimmed = filename.trim();

    if (
        trimmed.includes("\0") ||
        trimmed.includes("/") ||
        trimmed.includes("\\") ||
        trimmed.includes("..") ||
        trimmed.toLowerCase().includes("%2e") ||
        trimmed.toLowerCase().includes("%2f") ||
        trimmed.toLowerCase().includes("%5c")
    ) {
        throw new StorageSecurityError(
            `Access Denied: Invalid filename '${filename}'. Path traversal sequences are strictly prohibited.`,
            400
        );
    }

    const base = path.basename(trimmed);
    if (base !== trimmed || !base) {
        throw new StorageSecurityError(
            `Access Denied: Filename '${filename}' must not contain directory components.`,
            400
        );
    }

    return base;
}

/**
 * Verifies that targetPath is strictly inside parentDir.
 *
 * @param {string} targetPath
 * @param {string} parentDir
 */
export function assertPathContained(targetPath, parentDir) {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedParent = path.resolve(parentDir);

    const rel = path.relative(resolvedParent, resolvedTarget);

    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes("\0")) {
        throw new StorageSecurityError(
            `Access Denied: Path '${targetPath}' escapes allowed storage directory '${parentDir}'.`,
            403
        );
    }
}

/**
 * Resolves the tenant-scoped uploads directory:
 *   backend/src/uploads/<organizationId>
 *
 * @param {string} organizationId
 * @param {object} [options]
 * @param {boolean} [options.create=true]
 * @returns {string} Absolute directory path
 */
export function getOrganizationUploadDir(organizationId, { create = true } = {}) {
    const cleanOrgId = validateOrganizationId(organizationId);
    const targetDir = path.resolve(UPLOADS_ROOT, cleanOrgId);

    assertPathContained(targetDir, UPLOADS_ROOT);

    if (create && !fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    return targetDir;
}

/**
 * Resolves the tenant-scoped generated reports directory:
 *   backend/generated/<organizationId>
 *
 * @param {string} organizationId
 * @param {object} [options]
 * @param {boolean} [options.create=true]
 * @returns {string} Absolute directory path
 */
export function getOrganizationGeneratedDir(organizationId, { create = true } = {}) {
    const cleanOrgId = validateOrganizationId(organizationId);
    const targetDir = path.resolve(GENERATED_ROOT, cleanOrgId);

    assertPathContained(targetDir, GENERATED_ROOT);

    if (create && !fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    return targetDir;
}

/**
 * Derives and validates the absolute path for an uploaded document.
 *
 * @param {string} organizationId
 * @param {string} filename
 * @returns {string} Absolute file path
 */
export function getDocumentStoragePath(organizationId, filename) {
    const dir = getOrganizationUploadDir(organizationId, { create: false });
    const cleanFilename = validateFilename(filename);
    const targetPath = path.resolve(dir, cleanFilename);

    assertPathContained(targetPath, dir);
    return targetPath;
}

/**
 * Derives and validates the absolute path for a generated report.
 *
 * @param {string} organizationId
 * @param {string} filename
 * @returns {string} Absolute file path
 */
export function getReportStoragePath(organizationId, filename) {
    const dir = getOrganizationGeneratedDir(organizationId, { create: true });
    const cleanFilename = validateFilename(filename);
    const targetPath = path.resolve(dir, cleanFilename);

    assertPathContained(targetPath, dir);
    return targetPath;
}

/**
 * Safely unlinks a file, guaranteeing it resides inside the tenant's directory.
 *
 * @param {string} filePath
 * @param {string} allowedDir
 */
export function safeDeleteFile(filePath, allowedDir) {
    if (!filePath || !fs.existsSync(filePath)) {
        return false;
    }

    assertPathContained(filePath, allowedDir);
    fs.unlinkSync(filePath);
    return true;
}

/**
 * Migrates known legacy files whose ownership is clearly established in PostgreSQL.
 * Ambiguous/unmapped files in the root uploads or generated folders are quarantined
 * (left in place but inaccessible to any tenant).
 *
 * @param {Function} queryFn - Database query function
 */
export async function migrateKnownStorageFiles(queryFn) {
    try {
        // 1. Migrate known documents
        const docsRes = await queryFn("SELECT filename, organization_id FROM documents WHERE filename IS NOT NULL AND organization_id IS NOT NULL");
        let migratedDocs = 0;
        for (const row of docsRes.rows) {
            try {
                const legacyPath = path.resolve(UPLOADS_ROOT, row.filename);
                if (fs.existsSync(legacyPath)) {
                    assertPathContained(legacyPath, UPLOADS_ROOT);
                    const tenantDir = getOrganizationUploadDir(row.organization_id, { create: true });
                    const tenantFilePath = path.resolve(tenantDir, row.filename);
                    if (!fs.existsSync(tenantFilePath)) {
                        fs.copyFileSync(legacyPath, tenantFilePath);
                        migratedDocs++;
                    }
                }
            } catch (err) {
                console.warn(`[storage] Warning: could not migrate document ${row.filename}: ${err.message}`);
            }
        }

        // 2. Migrate known reports
        const reportsRes = await queryFn("SELECT filename, organization_id FROM reports WHERE filename IS NOT NULL AND organization_id IS NOT NULL");
        let migratedReports = 0;
        for (const row of reportsRes.rows) {
            try {
                const legacyPath = path.resolve(GENERATED_ROOT, row.filename);
                if (fs.existsSync(legacyPath)) {
                    assertPathContained(legacyPath, GENERATED_ROOT);
                    const tenantDir = getOrganizationGeneratedDir(row.organization_id, { create: true });
                    const tenantFilePath = path.resolve(tenantDir, row.filename);
                    if (!fs.existsSync(tenantFilePath)) {
                        fs.copyFileSync(legacyPath, tenantFilePath);
                        migratedReports++;
                    }
                }
            } catch (err) {
                console.warn(`[storage] Warning: could not migrate report ${row.filename}: ${err.message}`);
            }
        }

        if (migratedDocs > 0 || migratedReports > 0) {
            console.log(`✓ Migrated ${migratedDocs} known documents and ${migratedReports} known reports into tenant-isolated storage.`);
        }
    } catch (err) {
        console.warn(`[storage] Notice: storage migration check skipped or failed: ${err.message}`);
    }
}

