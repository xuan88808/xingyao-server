import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const dashboard = {
      users: {
        total: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        active: db.prepare("SELECT COUNT(*) as c FROM users WHERE status='active'").get().c,
        today_new: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").get().c,
      },
      records: {
        total: db.prepare('SELECT COUNT(*) as c FROM records').get().c,
        today: db.prepare("SELECT COUNT(*) as c FROM records WHERE date(created_at)=date('now')").get().c,
        tokens_total: db.prepare('SELECT COALESCE(SUM(tokens_used),0) as c FROM records').get().c,
      },
      images: {
        total: db.prepare('SELECT COUNT(*) as c FROM images').get().c,
        today: db.prepare("SELECT COUNT(*) as c FROM images WHERE date(created_at)=date('now')").get().c,
      },
      training: {
        total: db.prepare('SELECT COUNT(*) as c FROM training_data').get().c,
        pending: db.prepare("SELECT COUNT(*) as c FROM training_data WHERE status='pending'").get().c,
        approved: db.prepare("SELECT COUNT(*) as c FROM training_data WHERE status='approved'").get().c,
      },
      // 最近 7 天每日统计
      daily: db.prepare(`
        SELECT
          date(dates.day) as day,
          COALESCE(rc.cnt,0) as records,
          COALESCE(ic.cnt,0) as images,
          COALESCE(uc.cnt,0) as new_users
        FROM (
          SELECT date(datetime('now','-6 days')) as day UNION ALL
          SELECT date(datetime('now','-5 days')) UNION ALL
          SELECT date(datetime('now','-4 days')) UNION ALL
          SELECT date(datetime('now','-3 days')) UNION ALL
          SELECT date(datetime('now','-2 days')) UNION ALL
          SELECT date(datetime('now','-1 days')) UNION ALL
          SELECT date(datetime('now'))
        ) dates
        LEFT JOIN (SELECT date(created_at) as d, COUNT(*) as cnt FROM records GROUP BY d) rc ON dates.day=rc.d
        LEFT JOIN (SELECT date(created_at) as d, COUNT(*) as cnt FROM images GROUP BY d) ic ON dates.day=ic.d
        LEFT JOIN (SELECT date(created_at) as d, COUNT(*) as cnt FROM users GROUP BY d) uc ON dates.day=uc.d
        ORDER BY dates.day
      `).all(),

      // 类型分布
      type_dist: db.prepare(`
        SELECT type, COUNT(*) as count FROM records GROUP BY type
      `).all(),

      // 最近活动
      recent: db.prepare(`
        SELECT r.id, r.type, r.model, r.created_at, u.nickname
        FROM records r LEFT JOIN users u ON r.user_id = u.id
        ORDER BY r.created_at DESC LIMIT 10
      `).all(),
    };

    res.json(dashboard);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: '获取仪表盘数据失败' });
  }
});

export default router;
