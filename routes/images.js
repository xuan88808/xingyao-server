import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/images — 图片列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const source = req.query.source || '';

    let where = 'WHERE 1=1';
    const params = [];
    if (source) { where += ' AND i.source = ?'; params.push(source); }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM images i ${where}`).get(...params);

    const images = db.prepare(`
      SELECT i.*, u.nickname as user_nickname, u.uid as user_uid
      FROM images i LEFT JOIN users u ON i.user_id = u.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: images,
      total: countRow.total,
      page,
      limit,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (err) {
    console.error('Images list error:', err);
    res.status(500).json({ error: '获取图片列表失败' });
  }
});

// DELETE /api/images/:id
router.delete('/:id', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM images WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除图片失败' });
  }
});

export default router;
