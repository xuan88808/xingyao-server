import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/platform
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM platform_config WHERE id = 1').get();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: '获取配置失败' });
  }
});

// PUT /api/platform
router.put('/', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { provider, api_key, base_url, model, custom_url, custom_model } = req.body;
    const db = getDb();
    db.prepare(`
      UPDATE platform_config SET
        provider = COALESCE(?, provider),
        api_key = COALESCE(?, api_key),
        base_url = COALESCE(?, base_url),
        model = COALESCE(?, model),
        custom_url = COALESCE(?, custom_url),
        custom_model = COALESCE(?, custom_model),
        updated_at = datetime('now')
      WHERE id = 1
    `).run(provider || null, api_key || null, base_url || null, model || null, custom_url || null, custom_model || null);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新配置失败' });
  }
});

export default router;
