import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import chatRouter from "./routes/chat.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../ai-service/.env') });

import express from 'express';
import cors from 'cors';
import router from './routes/files.routes.js';
import multer from 'multer';
import inspectionRouter from "./routes/inspection.routes.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/v1', router);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/inspection", inspectionRouter);
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to the File Upload API"
    });
});

app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
        status: "ok"
    });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: err.message,
    });
  }

  if (err) {
    const status = err.status || err.statusCode || (err.message && err.message.includes("not found") ? 404 : 400);
    return res.status(status).json({
      success: false,
      message: err.message,
    });
  }

  next();
});

export default app;