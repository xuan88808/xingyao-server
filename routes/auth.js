import { Router } from 'express';
import { getDb, verifyPassword, hashPassword } from '../database.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过于频繁，请15分钟后再试' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: '注册过于频繁，请1小时后再试' },
});

// ===== 用户注册 =====
// POST /api/auth/register
router.post('/register', registerLimiter, (req, res) => {
  const { username, password, nickname } = req.body;

  // 验证
  if (!username || !password) {
    return res.status(400).json({ error: '请填写用户名和密码' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }

  try {
    const db = getDb();

    // 检查用户名是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: '该用户名已被注册' });
    }

    const uid = 'u_' + crypto.randomBytes(12).toString('hex');
    const hash = hashPassword(password);
    const displayName = nickname || username;

    const result = db.prepare(`
      INSERT INTO users (uid, email, password_hash, nickname, api_mode, plan, daily_quota, usage_date)
      VALUES (?, ?, ?, ?, 'platform', 'free', 50, date('now'))
    `).run(uid, username, hash, displayName);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    const token = generateToken({
      id: user.id,
      uid: user.uid,
      email: user.email,
      nickname: user.nickname,
      plan: user.plan,
      api_mode: user.api_mode,
      role: 'user',
    });

    res.json({
      token,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        nickname: user.nickname,
        plan: user.plan,
        api_mode: user.api_mode,
        daily_quota: user.daily_quota,
        usage_today: user.usage_today,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// ===== 用户登录 =====
// POST /api/auth/user-login
router.post('/user-login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND status != ?').get(username, 'deleted');

    if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ error: '账号已被封禁' });
    }

    // 更新活跃时间
    db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(user.id);

    // 重置每日用量（如果跨天）
    const today = new Date().toISOString().slice(0, 10);
    if (user.usage_date !== today) {
      db.prepare("UPDATE users SET usage_today = 0, usage_date = ? WHERE id = ?").run(today, user.id);
      user.usage_today = 0;
    }

    const token = generateToken({
      id: user.id,
      uid: user.uid,
      email: user.email,
      nickname: user.nickname,
      plan: user.plan,
      api_mode: user.api_mode,
      custom_api_enabled: !!user.custom_api_enabled,
      role: 'user',
    });

    res.json({
      token,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        nickname: user.nickname,
        plan: user.plan,
        api_mode: user.api_mode,
        custom_api_enabled: !!user.custom_api_enabled,
        daily_quota: user.daily_quota,
        usage_today: user.usage_today || 0,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('User login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  try {
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 更新最后登录时间
    db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);

    const token = generateToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      nickname: admin.nickname,
    });

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        nickname: admin.nickname,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /api/auth/me — 验证 token 有效性
router.get('/me', authMiddleware, (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
