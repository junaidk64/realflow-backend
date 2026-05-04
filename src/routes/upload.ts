import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import { getPresignedUploadUrl } from "../lib/r2";

const router = Router();
router.use(verifyFirebaseToken);
router.use(rateLimiter);

// POST /api/upload
router.post("/", async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: "filename and contentType are required" });
    }

    const key = `uploads/${req.user!.uid}/${Date.now()}-${filename}`;
    const result = await getPresignedUploadUrl(key, contentType);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
