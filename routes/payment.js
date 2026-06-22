import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/payment — 获取收款设置（公开，前端打赏卡片使用）
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
    res.json({
      qr_code_url: config?.qr_code_url || '',
      qr_code_updated_at: config?.qr_code_updated_at || '',
    });
  } catch (err) {
    res.status(500).json({ error: '获取收款设置失败' });
  }
});

// PUT /api/payment — 更新收款设置（需管理员权限）
router.put('/', authMiddleware, roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { qr_code_url } = req.body;
    const db = getDb();
    db.prepare(`
      UPDATE payment_settings SET
        qr_code_url = COALESCE(?, qr_code_url),
        qr_code_updated_at = COALESCE(?, qr_code_updated_at),
        updated_at = datetime('now')
      WHERE id = 1
    `).run(qr_code_url || null, qr_code_url ? new Date().toISOString() : null);

    res.json({ success: true });
  } catch (err) {
    console.error('Payment settings update error:', err);
    res.status(500).json({ error: '更新收款设置失败' });
  }
});

export default router;
