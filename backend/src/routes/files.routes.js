import {Router} from 'express';

const router = Router();

router.post('/upload', (req, res) => {
    // Handle file upload logic here
    res.status(200).json({
        success: true,
        message: "File uploaded successfully"
    });
});

export default router;