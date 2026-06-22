import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 启动时异常捕获（让 Railway 日志可见） ──
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

async function main() {
  // 确保目录存在
  console.log('[init] creating data directories...');
  mkdirSync(join(__dirname, 'data'), { recursive: true });
  mkdirSync(join(__dirname, 'uploads'), { recursive: true });

  // 初始化数据库（延迟 import 以便先输出日志）
  console.log('[init] loading database...');
  let getDb;
  try {
    const dbModule = await import('./database.js');
    getDb = dbModule.getDb;
    const db = getDb();
    console.log('[init] database ready');

    // 自动创建默认管理员（如果没有）
    const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
    if (adminCount === 0) {
      const { hashPassword } = dbModule;
      db.prepare(`
        INSERT INTO admins (username, password_hash, nickname, role)
        VALUES (?, ?, ?, 'superadmin')
      `).run('admin', hashPassword('admin123'), '管理员');
      console.log('[init] 默认管理员已创建: admin / admin123');
    }
  } catch (err) {
    console.error('[FATAL] database init failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  // 动态加载路由（延迟 import 避免循环依赖）
  const [
    { default: authRoutes },
    { default: dashboardRoutes },
    { default: userRoutes },
    { default: recordRoutes },
    { default: imageRoutes },
    { default: trainingRoutes },
    { default: quotaRoutes },
    { default: platformRoutes },
    { default: promptsRoutes },
    { default: sectionsRoutes },
    { default: paymentRoutes },
    { default: publishRoutes },
    { default: analyticsRoutes },
    { default: crawlRoutes },
  ] = await Promise.all([
    import('./routes/auth.js'),
    import('./routes/dashboard.js'),
    import('./routes/users.js'),
    import('./routes/records.js'),
    import('./routes/images.js'),
    import('./routes/training.js'),
    import('./routes/quota.js'),
    import('./routes/platform.js'),
    import('./routes/prompts.js'),
    import('./routes/sections.js'),
    import('./routes/payment.js'),
    import('./routes/publish.js'),
    import('./routes/analytics.js'),
    import('./routes/crawl.js'),
  ]);

  const app = express();
  const PORT = process.env.PORT || 3001;

  // ===== 安全中间件 =====
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));

  // ===== CORS =====
  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:4173', 'https://xuan88808.github.io'];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (origin.endsWith('.up.railway.app')) return callback(null, true);
      if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) return callback(null, true);
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ===== 健康检查 =====
  app.get('/api/health', (req, res) => {
    try {
      const db = getDb();
      const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected',
        users: userCount,
      });
    } catch (e) {
      res.status(500).json({ status: 'error', message: e.message });
    }
  });

  // ===== 根路径 — API 状态页 =====
  app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>星曜AI API</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0f0a2e;color:#f1f0f7}
.card{text-align:center;padding:40px;border-radius:20px;background:rgba(22,14,56,0.95);border:1px solid rgba(255,255,255,0.1)}
h1{background:linear-gradient(135deg,#7c3aed,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.green{color:#22c55e}</style></head>
<body><div class="card">
<h1>🌟 星曜AI API</h1>
<p class="green">● 运行中</p>
<p style="color:#7b7799;font-size:14px">前端访问：<a href="https://xuan88808.github.io" style="color:#a78bfa">xuan88808.github.io</a></p>
<p style="color:#7b7799;font-size:12px;margin-top:20px">健康检查：<code style="background:rgba(255,255,255,0.04);padding:4px 8px;border-radius:6px">/api/health</code></p>
</div></body></html>`);
  });

  // ===== API 路由 =====
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/training', trainingRoutes);
  app.use('/api/quota', quotaRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/prompts', promptsRoutes);
  app.use('/api/sections', sectionsRoutes);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/publish', publishRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/crawl', crawlRoutes);

  // ===== 全局错误处理 =====
  app.use((err, req, res, _next) => {
    console.error('[error]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  });

  // ===== 优雅关闭 =====
  process.on('SIGTERM', () => { console.log('SIGTERM'); process.exit(0); });
  process.on('SIGINT', () => { console.log('SIGINT'); process.exit(0); });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ready] Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('[FATAL] startup failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
