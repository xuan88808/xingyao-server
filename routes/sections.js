import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const SECTIONS = {
  text_create: { label: '文本创作区', icon: 'FileText' },
  image_reverse: { label: '图片反推区', icon: 'ImageSearch' },
  image_gen: { label: '图片生成区', icon: 'ImagePlus' },
  audio_gen: { label: '音频生成区', icon: 'AudioLines' },
};

const PROVIDER_DEFAULTS = {
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  openai: { baseUrl: 'https://api.openai.com/v1' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1' },
};

// GET /api/sections — 获取所有板块配置
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const configs = db.prepare('SELECT * FROM section_config ORDER BY id').all();

    // 补充板块标签和默认 URL
    const result = configs.map(c => ({
      ...c,
      label: SECTIONS[c.section_id]?.label || c.section_id,
      icon: SECTIONS[c.section_id]?.icon || '',
    }));

    res.json(result);
  } catch (err) {
    console.error('Sections list error:', err);
    res.status(500).json({ error: '获取板块配置失败' });
  }
});

// GET /api/sections/:sectionId — 单个板块配置（供前端调用，无需 admin 权限）
router.get('/:sectionId', (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM section_config WHERE section_id = ?').get(req.params.sectionId);
    if (!config) return res.status(404).json({ error: '板块不存在' });

    // 如果板块未启用且未配置独立 API Key，返回 null
    if (!config.is_enabled) return res.json(null);

    // 如果板块有自己的 api_key，用它；否则返回只含 provider 的配置（前端会用全局 key）
    res.json({
      provider: config.provider,
      api_key: config.api_key || null,
      base_url: config.base_url || PROVIDER_DEFAULTS[config.provider]?.baseUrl || '',
      model: config.model,
      system_prompt: config.system_prompt || '',
    });
  } catch (err) {
    res.status(500).json({ error: '获取板块配置失败' });
  }
});

// PUT /api/sections/:sectionId — 更新单个板块配置
router.put('/:sectionId', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { provider, api_key, base_url, model, is_enabled, system_prompt, text_api_provider, text_api_key, text_api_base_url, text_api_model } = req.body;
    const db = getDb();

    // 自动补充 base_url
    let effectiveBaseUrl = base_url;
    if (!effectiveBaseUrl && provider) {
      effectiveBaseUrl = PROVIDER_DEFAULTS[provider]?.baseUrl || '';
    }
    // 反推文本 API base_url
    let effectiveTextBaseUrl = text_api_base_url;
    if (!effectiveTextBaseUrl && text_api_provider) {
      effectiveTextBaseUrl = PROVIDER_DEFAULTS[text_api_provider]?.baseUrl || '';
    }

    db.prepare(`
      UPDATE section_config SET
        provider = COALESCE(?, provider),
        api_key = COALESCE(?, api_key),
        base_url = COALESCE(?, base_url),
        model = COALESCE(?, model),
        system_prompt = COALESCE(?, system_prompt),
        text_api_provider = COALESCE(?, text_api_provider),
        text_api_key = COALESCE(?, text_api_key),
        text_api_base_url = COALESCE(?, text_api_base_url),
        text_api_model = COALESCE(?, text_api_model),
        is_enabled = COALESCE(?, is_enabled),
        updated_at = datetime('now')
      WHERE section_id = ?
    `).run(
      provider || null, api_key || null, effectiveBaseUrl || null,
      model || null, system_prompt !== undefined ? system_prompt : null,
      text_api_provider || null, text_api_key || null, effectiveTextBaseUrl || null,
      text_api_model || null,
      is_enabled !== undefined ? is_enabled : null,
      req.params.sectionId
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Section update error:', err);
    res.status(500).json({ error: '更新板块配置失败' });
  }
});

export { SECTIONS, PROVIDER_DEFAULTS };
export default router;
