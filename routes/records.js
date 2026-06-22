import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/records — 记录列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type || '';
    const search = req.query.search || '';
    const training = req.query.training || '';

    let where = 'WHERE 1=1';
    const params = [];

    if (type) { where += ' AND r.type = ?'; params.push(type); }
    if (search) { where += ' AND (r.prompt LIKE ? OR r.result LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (training === 'flagged') { where += ' AND r.flagged_training = 1'; }
    if (training === 'archived') { where += ' AND r.flagged_training = 2'; }
    if (training === 'none') { where += ' AND r.flagged_training = 0'; }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM records r ${where}`).get(...params);

    const records = db.prepare(`
      SELECT r.*, u.nickname as user_nickname, u.uid as user_uid
      FROM records r
      LEFT JOIN users u ON r.user_id = u.id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: records,
      total: countRow.total,
      page,
      limit,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (err) {
    console.error('Records list error:', err);
    res.status(500).json({ error: '获取记录列表失败' });
  }
});

// GET /api/records/:id
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT r.*, u.nickname as user_nickname, u.uid as user_uid
      FROM records r LEFT JOIN users u ON r.user_id = u.id
      WHERE r.id = ?
    `).get(req.params.id);

    if (!record) return res.status(404).json({ error: '记录不存在' });

    res.json(record);
  } catch (err) {
    res.status(500).json({ error: '获取记录详情失败' });
  }
});

// PATCH /api/records/:id/training — 标记为训练数据
router.patch('/:id/training', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { flagged, quality_score } = req.body;
    const db = getDb();
    db.prepare('UPDATE records SET flagged_training = ?, quality_score = ? WHERE id = ?')
      .run(flagged || 1, quality_score || 0, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新训练标记失败' });
  }
});

// DELETE /api/records/:id
router.delete('/:id', roleMiddleware('superadmin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除记录失败' });
  }
});

// GET /api/records/stats/overview
router.get('/stats/overview', (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM records').get().c,
      text_create: db.prepare("SELECT COUNT(*) as c FROM records WHERE type='text_create'").get().c,
      image_reverse: db.prepare("SELECT COUNT(*) as c FROM records WHERE type='image_reverse'").get().c,
      chat: db.prepare("SELECT COUNT(*) as c FROM records WHERE type='chat'").get().c,
      expert: db.prepare("SELECT COUNT(*) as c FROM records WHERE type='expert'").get().c,
      today: db.prepare("SELECT COUNT(*) as c FROM records WHERE date(created_at)=date('now')").get().c,
      week: db.prepare("SELECT COUNT(*) as c FROM records WHERE created_at >= datetime('now','-7 days')").get().c,
      total_tokens: db.prepare('SELECT COALESCE(SUM(tokens_used),0) as c FROM records').get().c,
      flagged_training: db.prepare('SELECT COUNT(*) as c FROM records WHERE flagged_training > 0').get().c,
      by_type: db.prepare(`
        SELECT type, COUNT(*) as count
        FROM records GROUP BY type ORDER BY count DESC
      `).all(),
      by_day: db.prepare(`
        SELECT date(created_at) as day, COUNT(*) as count
        FROM records WHERE created_at >= datetime('now','-30 days')
        GROUP BY day ORDER BY day
      `).all(),
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default router;
