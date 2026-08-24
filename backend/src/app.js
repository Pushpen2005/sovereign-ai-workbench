import express from 'express';
import cors from 'cors';
import router from './routes/files.routes.js';
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/v1', router);

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Sovereign AI Workbench Backend Running 🚀"
    });
});

export default app;