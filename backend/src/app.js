import express from 'express';
import cors from 'cors';
import router from './routes/files.routes.js';
import multer from 'multer';
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/v1', router);
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      message: err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      message: err.message,
    });
  }

  next();
});

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
export default app;