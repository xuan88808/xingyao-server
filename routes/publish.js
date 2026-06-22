import { Router } from 'express';
import multer from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { getDb } from '../database.js';

const router = Router();

// 视频上传配置
const uploadsDir = join(import.meta.dirname, '..', 'uploads', 'videos');
mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4GB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm'];
    const ext = extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的视频格式，支持: mp4, mov, avi, mkv, flv, webm'));
    }
  },
});

// ===== 平台上传规范 =====
const PLATFORM_SPECS = {
  douyin: {
    name: '抖音',
    icon: '🎵',
    color: '#000000',
    maxSize: '4GB',
    maxDuration: '15分钟（普通用户）/ 60分钟（认证）',
    ratio: '9:16 竖屏',
    resolution: '1080×1920',
    format: 'MP4/MOV',
    codec: 'H.264',
    tags: { max: 5, maxLength: 10 },
    title: { max: 55 },
    desc: { max: 1000 },
    tips: '建议码率 8-16 Mbps，竖屏视频点击率更高',
  },
  xiaohongshu: {
    name: '小红书',
    icon: '📕',
    color: '#FF2442',
    maxSize: '5GB',
    maxDuration: '15分钟',
    ratio: '3:4 或 9:16',
    resolution: '1080×1920',
    format: 'MP4/MOV',
    codec: 'H.264',
    tags: { max: 10, maxLength: 20 },
    title: { max: 20 },
    desc: { max: 1000 },
    tips: '封面图很重要！3:4比例封面效果最佳，标题要吸引眼球',
  },
  kling: {
    name: '可灵AI',
    icon: '⚡',
    color: '#6C5CE7',
    maxSize: '2GB',
    maxDuration: '10分钟',
    ratio: '16:9 或 9:16',
    resolution: '1920×1080 或 1080×1920',
    format: 'MP4',
    codec: 'H.264/H.265',
    tags: { max: 8, maxLength: 15 },
    title: { max: 50 },
    desc: { max: 500 },
    tips: 'AI 生成内容需添加"AI生成"标识声明',
  },
  bilibili: {
    name: 'B站',
    icon: '📺',
    color: '#FB7299',
    maxSize: '8GB（分P）',
    maxDuration: '10小时',
    ratio: '16:9 横屏',
    resolution: '1920×1080 / 4K',
    format: 'MP4/FLV',
    codec: 'H.264/H.265/AV1',
    tags: { max: 10, maxLength: 20 },
    title: { max: 80 },
    desc: { max: 2000 },
    tips: '支持分P投稿和高码率，横屏 16:9 为最佳比例',
  },
  kuaishou: {
    name: '快手',
    icon: '🎬',
    color: '#FF4906',
    maxSize: '4GB',
    maxDuration: '57分钟',
    ratio: '9:16 竖屏',
    resolution: '1080×1920',
    format: 'MP4/MOV',
    codec: 'H.264',
    tags: { max: 5, maxLength: 10 },
    title: { max: 50 },
    desc: { max: 1000 },
    tips: '竖屏为主，封面自动从视频截取',
  },
  shipinhao: {
    name: '视频号',
    icon: '💬',
    color: '#07C160',
    maxSize: '1GB',
    maxDuration: '60分钟',
    ratio: '9:16 或 16:9',
    resolution: '1080×1920 / 1920×1080',
    format: 'MP4/MOV',
    codec: 'H.264',
    tags: { max: 5, maxLength: 10 },
    title: { max: 50 },
    desc: { max: 1000 },
    tips: '通过微信视频号助手发布，支持定时发布',
  },
  youtube: {
    name: 'YouTube',
    icon: '▶️',
    color: '#FF0000',
    maxSize: '256GB',
    maxDuration: '12小时',
    ratio: '16:9 横屏',
    resolution: '1920×1080 / 4K / 8K',
    format: 'MP4',
    codec: 'H.264',
    tags: { max: 500, maxLength: 30 },
    title: { max: 100 },
    desc: { max: 5000 },
    tips: '支持多语言字幕，SEO 优化标题和描述很重要',
  },
};

// ===== API 路由 =====

// 获取平台配置信息
router.get('/platforms', (req, res) => {
  res.json({ platforms: PLATFORM_SPECS });
});

// 上传视频
router.post('/upload', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未选择视频文件' });
    }
    res.json({
      success: true,
      file: {
        name: req.file.originalname,
        path: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    res.status(500).json({ error: '上传失败', message: err.message });
  }
});

// 提交发布任务
router.post('/publish', async (req, res) => {
  try {
    const db = getDb();
    const {
      video_path, video_name, video_size, video_duration,
      title, description, tags, platforms,
      schedule_type, scheduled_at, declaration,
      category, permission_type, cover_path,
    } = req.body;

    // 简单验证（生产环境需要鉴权）
    if (!video_path || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: '请选择视频和目标平台' });
    }

    const result = db.prepare(`
      INSERT INTO publish_records (user_id, video_name, video_path, video_size, video_duration,
        title, description, tags, platforms, schedule_type, scheduled_at, declaration,
        category, permission_type, cover_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1, // 默认用户ID
      video_name, video_path, video_size || 0, video_duration || 0,
      title || '', description || '', JSON.stringify(tags || []), JSON.stringify(platforms),
      schedule_type || 'now', scheduled_at || null, declaration || '',
      category || '', permission_type || 'public', cover_path || ''
    );

    // 模拟发布过程（生产环境会实际调用各平台 API）
    const platformResults = {};
    for (const p of platforms) {
      const spec = PLATFORM_SPECS[p];
      platformResults[p] = {
        platform: p,
        platformName: spec ? spec.name : p,
        status: 'published',
        publishedAt: new Date().toISOString(),
        url: `https://www.${p}.com/video/demo_${result.lastInsertRowid}`,
      };
    }

    db.prepare(`
      UPDATE publish_records SET status = 'completed', results = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(platformResults), result.lastInsertRowid);

    res.json({
      success: true,
      recordId: result.lastInsertRowid,
      results: platformResults,
      message: `成功发布到 ${platforms.length} 个平台`,
    });
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: '发布失败', message: err.message });
  }
});

// 获取发布记录列表
router.get('/records', (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, offset = 0 } = req.query;
    const records = db.prepare(`
      SELECT * FROM publish_records ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(Number(limit), Number(offset));
    const total = db.prepare('SELECT COUNT(*) as total FROM publish_records').get().total;

    const parsed = records.map(r => ({
      ...r,
      tags: JSON.parse(r.tags || '[]'),
      platforms: JSON.parse(r.platforms || '[]'),
      results: JSON.parse(r.results || '{}'),
    }));

    res.json({ records: parsed, total });
  } catch (err) {
    res.status(500).json({ error: '获取记录失败', message: err.message });
  }
});

// 获取单条发布记录
router.get('/record/:id', (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM publish_records WHERE id = ?').get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json({
      ...record,
      tags: JSON.parse(record.tags || '[]'),
      platforms: JSON.parse(record.platforms || '[]'),
      results: JSON.parse(record.results || '{}'),
    });
  } catch (err) {
    res.status(500).json({ error: '获取记录失败', message: err.message });
  }
});

// 删除发布记录
router.delete('/record/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM publish_records WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败', message: err.message });
  }
});

// 平台账号管理
router.get('/accounts', (req, res) => {
  try {
    const db = getDb();
    const accounts = db.prepare(`
      SELECT * FROM platform_accounts ORDER BY platform
    `).all();
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: '获取账号失败', message: err.message });
  }
});

router.post('/accounts/bind', (req, res) => {
  try {
    const db = getDb();
    const { platform, account_name, access_token } = req.body;
    if (!platform || !account_name) {
      return res.status(400).json({ error: '请填写完整信息' });
    }
    db.prepare(`
      INSERT OR REPLACE INTO platform_accounts (user_id, platform, account_name, access_token, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(1, platform, account_name, access_token || '');
    res.json({ success: true, message: `已绑定${platform}账号` });
  } catch (err) {
    res.status(500).json({ error: '绑定失败', message: err.message });
  }
});

export default router;
export { PLATFORM_SPECS };
