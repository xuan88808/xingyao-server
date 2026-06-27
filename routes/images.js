import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// POST /api/images/generate — AI 图片生成
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, width = 1024, height = 1024 } = req.body;
    if (!prompt) return res.status(400).json({ error: '请提供提示词' });

    // 读取图片生成板块配置
    const db = getDb();
    let section = db.prepare('SELECT * FROM section_config WHERE section_id = ?').get('image_gen');
    if (!section || !section.is_enabled) {
      return res.status(400).json({ error: '图片生成功能未启用，请在管理后台配置' });
    }

    // 获取 API 配置（板块独立 Key 或全局平台 Key）
    let apiKey = section.api_key;
    let baseUrl = section.base_url;
    const provider = section.provider || 'zhipu';

    // 如果板块没配 Key，回退到全局平台配置
    if (!apiKey) {
      const platform = db.prepare('SELECT * FROM platform_config WHERE id = 1').get();
      apiKey = platform?.api_key || '';
      // 板块 base_url 优先，否则用默认
      if (!baseUrl) {
        baseUrl = provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4'
          : provider === 'openai' ? 'https://api.openai.com/v1'
          : provider === 'doubao' ? 'https://ark.cn-beijing.volces.com/api/v3'
          : 'https://open.bigmodel.cn/api/paas/v4';
      }
    }

    if (!apiKey) return res.status(400).json({ error: '未配置 API Key，请先在管理后台设置' });

    console.log(`[image-gen] provider=${provider} model=${section.model || 'auto'}`);

    let imageUrl, imageBase64, generatedWidth, generatedHeight;

    // ── 智谱 CogView ──
    if (provider === 'zhipu') {
      const model = section.model || 'cogview-3-flash';
      const genRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, size: `${width}x${height}` }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error?.message || `智谱 API ${genRes.status}`);
      imageUrl = genData.data?.[0]?.url;
      if (!imageUrl) throw new Error('智谱未返回图片');

      // 下载图片到本地
      const imgRes = await fetch(imageUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      imageBase64 = buffer.toString('base64');
      generatedWidth = width;
      generatedHeight = height;
    }

    // ── OpenAI DALL-E ──
    else if (provider === 'openai') {
      const model = section.model || 'dall-e-3';
      const genRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error?.message || `OpenAI API ${genRes.status}`);
      imageBase64 = genData.data?.[0]?.b64_json;
      imageUrl = genData.data?.[0]?.url;
      generatedWidth = 1024;
      generatedHeight = 1024;
    }

    // ── 豆包 / 火山 Ark (OpenAI 兼容模式) ──
    else if (provider === 'doubao') {
      // 豆包通过 Ark 平台，用 chat/completions + vision 模型生成图片描述，实际生图需走 Seedream
      // 这里先用 OpenAI 兼容的 images 接口尝试
      const genRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: section.model || 'doubao-seedream-3.0', prompt, n: 1, size: '1024x1024' }),
      });
      // 如果 Ark 不支持 images 接口，回退到智谱
      if (genRes.status === 404 || genRes.status === 405) {
        // 回退：使用智谱 CogView
        const glmKey = apiKey; // try with same key first, then fallback
        const fbRes = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${glmKey}` },
          body: JSON.stringify({ model: 'cogview-3-flash', prompt, size: `${width}x${height}` }),
        });
        const fbData = await fbRes.json();
        if (!fbRes.ok) throw new Error(fbData.error?.message || '生图失败');
        imageUrl = fbData.data?.[0]?.url;
        const imgRes = await fetch(imageUrl);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        imageBase64 = buffer.toString('base64');
        generatedWidth = width;
        generatedHeight = height;
      } else {
        const genData = await genRes.json();
        if (!genRes.ok) throw new Error(genData.error?.message || `豆包 API ${genRes.status}`);
        imageBase64 = genData.data?.[0]?.b64_json;
        imageUrl = genData.data?.[0]?.url;
        generatedWidth = 1024;
        generatedHeight = 1024;
      }
    }

    // ── 其他（OpenAI 兼容） ──
    else {
      const genRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: section.model || 'default', prompt, n: 1, size: '1024x1024' }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error?.message || `API ${genRes.status}`);
      imageBase64 = genData.data?.[0]?.b64_json;
      imageUrl = genData.data?.[0]?.url;
      generatedWidth = 1024;
      generatedHeight = 1024;
    }

    // 如果没有 base64，从 URL 下载
    if (!imageBase64 && imageUrl) {
      const imgRes = await fetch(imageUrl);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      imageBase64 = buffer.toString('base64');
    }

    if (!imageBase64) throw new Error('未能获取生成图片');

    // 保存到 uploads 目录
    const uploadsDir = join(__dirname, '..', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const filename = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    writeFileSync(join(uploadsDir, filename), Buffer.from(imageBase64, 'base64'));

    // 保存记录到数据库
    const userId = req.admin?.id || 1;
    db.prepare(`
      INSERT INTO images (user_id, filename, original_name, mime_type, size, width, height, source, record_id)
      VALUES (?, ?, ?, 'image/jpeg', ?, ?, ?, 'generated', NULL)
    `).run(userId, filename, `生成_${Date.now()}.jpg`, imageBase64.length, generatedWidth, generatedHeight);

    // 保存 AI 调用记录
    db.prepare(`
      INSERT INTO records (user_id, type, model, prompt, result, created_at)
      VALUES (?, 'image_gen', ?, ?, ?, datetime('now'))
    `).run(userId, section.model || provider, prompt, JSON.stringify({ filename, width: generatedWidth, height: generatedHeight }));

    res.json({
      success: true,
      data: {
        imageUrl: `/uploads/${filename}`,
        base64: `data:image/jpeg;base64,${imageBase64}`,
        width: generatedWidth,
        height: generatedHeight,
        provider,
      },
    });
  } catch (err) {
    console.error('[image-gen] error:', err);
    res.status(500).json({ error: '图片生成失败', message: err.message });
  }
});
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
