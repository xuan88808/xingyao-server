import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/users — 用户列表（分页 + 搜索）
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (u.nickname LIKE ? OR u.uid LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      where += ' AND u.status = ?';
      params.push(status);
    }

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM users u ${where}
    `).get(...params);

    const users = db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id) as record_count,
        (SELECT COUNT(*) FROM images i WHERE i.user_id = u.id) as image_count
      FROM users u ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: users,
      total: countRow.total,
      page,
      limit,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id) as record_count,
        (SELECT COUNT(*) FROM images i WHERE i.user_id = u.id) as image_count,
        (SELECT COALESCE(SUM(r.tokens_used),0) FROM records r WHERE r.user_id = u.id) as total_tokens
      FROM users u WHERE u.id = ?
    `).get(req.params.id);

    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 最近记录
    const recentRecords = db.prepare(`
      SELECT id, type, model, expert_type, platform, tokens_used, created_at
      FROM records WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(req.params.id);

    res.json({ ...user, recentRecords });
  } catch (err) {
    console.error('User detail error:', err);
    res.status(500).json({ error: '获取用户详情失败' });
  }
});

// PATCH /api/users/:id/status
router.patch('/:id/status', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'banned', 'deleted'].includes(status)) {
      return res.status(400).json({ error: '无效的状态值' });
    }

    const db = getDb();
    db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, req.params.id);

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: '更新用户状态失败' });
  }
});

// PATCH /api/users/:id/unlimited — 切换无限生成
router.patch('/:id/unlimited', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { unlimited } = req.body; // 1 or 0
    const db = getDb();
    db.prepare("UPDATE users SET unlimited_quota = ?, updated_at = datetime('now') WHERE id = ?")
      .run(unlimited ? 1 : 0, req.params.id);

    res.json({ success: true, unlimited: !!unlimited });
  } catch (err) {
    console.error('Unlimited toggle error:', err);
    res.status(500).json({ error: '切换失败' });
  }
});

// PATCH /api/users/:id/custom-api — 切换自定义API权限
router.patch('/:id/custom-api', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { enabled } = req.body; // 1 or 0
    const db = getDb();
    db.prepare("UPDATE users SET custom_api_enabled = ?, updated_at = datetime('now') WHERE id = ?")
      .run(enabled ? 1 : 0, req.params.id);

    res.json({ success: true, custom_api_enabled: !!enabled });
  } catch (err) {
    console.error('Custom API toggle error:', err);
    res.status(500).json({ error: '切换失败' });
  }
});

// GET /api/users/stats/overview — 用户统计概览
router.get('/stats/overview', (req, res) => {
  try {
    const db = getDb();
    const stats = {
      total: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      active: db.prepare("SELECT COUNT(*) as c FROM users WHERE status='active'").get().c,
      banned: db.prepare("SELECT COUNT(*) as c FROM users WHERE status='banned'").get().c,
      today: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").get().c,
      week: db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").get().c,
      month: db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-30 days')").get().c,
      pro: db.prepare("SELECT COUNT(*) as c FROM users WHERE plan='pro'").get().c,
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default router;
