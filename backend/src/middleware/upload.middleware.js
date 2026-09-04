import multer from "multer";
import path from "path";
import crypto from "crypto";

import fs from "fs";
import { fileURLToPath } from "url";

import { getOrganizationUploadDir } from "../utils/storage.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const organizationId = resolveAuthenticatedOrganization(req);
      const tenantUploadDir = getOrganizationUploadDir(organizationId, { create: true });
      cb(null, tenantUploadDir);
    } catch (err) {
      cb(err);
    }
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${crypto.randomUUID()}${extension}`;

    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype !== "application/pdf") {
    return cb(new Error("Only PDF files are allowed"));
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

export default upload;