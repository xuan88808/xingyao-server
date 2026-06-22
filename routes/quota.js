import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/quota/check — 检查用户配额
router.get('/check', authMiddleware, (req, res) => {
  try {
    if (req.admin.role !== 'user') {
      return res.json({ quota: -1, used: 0, unlimited: true });
    }

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const user = db.prepare('SELECT daily_quota, usage_today, usage_date, plan, unlimited_quota FROM users WHERE id = ?').get(req.admin.id);

    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 无限制配额
    if (user.unlimited_quota) {
      return res.json({ quota: -1, used: -1, remaining: -1, unlimited: true, plan: user.plan });
    }

    let used = user.usage_today || 0;
    if (user.usage_date !== today) {
      used = 0;
    }

    res.json({
      quota: user.daily_quota,
      used,
      remaining: Math.max(0, user.daily_quota - used),
      unlimited: user.plan !== 'free' || !!user.unlimited_quota,
      plan: user.plan,
    });
  } catch (err) {
    console.error('Quota check error:', err);
    res.status(500).json({ error: '配额查询失败' });
  }
});

// POST /api/quota/consume — 消耗一次配额
router.post('/consume', authMiddleware, (req, res) => {
  try {
    if (req.admin.role !== 'user') {
      return res.json({ success: true, remaining: -1 });
    }

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const user = db.prepare('SELECT id, daily_quota, usage_today, usage_date, plan, unlimited_quota FROM users WHERE id = ?').get(req.admin.id);

    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 无限制配额：不消耗
    if (user.unlimited_quota) {
      return res.json({ success: true, remaining: -1, unlimited: true });
    }

    let used = user.usage_today || 0;

    // 跨天重置
    if (user.usage_date !== today) {
      used = 0;
    }

    // 免费用户检查配额
    if (user.plan === 'free' && used >= user.daily_quota) {
      return res.status(429).json({ error: `今日配额已用完（${user.daily_quota}次/天），请明天再试或升级套餐`, remaining: 0 });
    }

    // 消耗配额
    const newUsed = used + 1;
    db.prepare('UPDATE users SET usage_today = ?, usage_date = ? WHERE id = ?').run(newUsed, today, user.id);

    // 更新每日用量明细
    db.prepare(`
      INSERT INTO daily_usage (user_id, usage_date, count) VALUES (?, ?, 1)
      ON CONFLICT(user_id, usage_date) DO UPDATE SET count = count + 1
    `).run(user.id, today);

    const remaining = user.plan === 'free' ? Math.max(0, user.daily_quota - newUsed) : -1;

    res.json({ success: true, remaining, used: newUsed });
  } catch (err) {
    console.error('Quota consume error:', err);
    res.status(500).json({ error: '配额扣除失败' });
  }
});

// GET /api/quota/platform-key — 获取平台统一 API Key（仅内部使用）
router.get('/platform-key', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM platform_config WHERE id = 1').get();
    if (!config || !config.api_key) {
      return res.status(503).json({ error: '平台 API 尚未配置' });
    }
    res.json({
      provider: config.provider,
      api_key: config.api_key,
      base_url: config.base_url,
      model: config.model,
      custom_url: config.custom_url,
      custom_model: config.custom_model,
    });
  } catch (err) {
    res.status(500).json({ error: '获取平台配置失败' });
  }
});

export default router;
