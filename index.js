import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import userRoutes from './routes/users.js';
import recordRoutes from './routes/records.js';
import imageRoutes from './routes/images.js';
import trainingRoutes from './routes/training.js';
import quotaRoutes from './routes/quota.js';
import platformRoutes from './routes/platform.js';
import promptsRoutes from './routes/prompts.js';
import sectionsRoutes from './routes/sections.js';
import paymentRoutes from './routes/payment.js';
import publishRoutes from './routes/publish.js';
import analyticsRoutes from './routes/analytics.js';
import crawlRoutes from './routes/crawl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 确保 data 目录存在
mkdirSync(join(__dirname, 'data'), { recursive: true });
mkdirSync(join(__dirname, 'uploads'), { recursive: true });

// 初始化数据库
getDb();

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
    // 允许无 origin 的请求（服务端调用 / 健康检查）
    if (!origin) return callback(null, true);
    // 检查白名单
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // 允许 Railway 域名（生产环境自动匹配）
    if (origin.endsWith('.up.railway.app')) return callback(null, true);
    // 允许自定义 CORS_ORIGIN（通过环境变量追加）
    if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) return callback(null, true);
    callback(new Error('CORS not allowed'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== 健康检查 =====
app.get('/api/health', (req, res) => {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'connected',
    users: userCount,
  });
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
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ===== 优雅关闭 =====
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║    星曜AI 管理后台 API Server         ║
║    Port: ${PORT}                       ║
║    Env:  ${process.env.NODE_ENV || 'production'}                        ║
║    URL:  http://localhost:${PORT}        ║
╚═══════════════════════════════════════╝
  `);
});
