import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// ===== AI 语音合成 =====
// POST /api/audio/generate
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { text, voice, speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: '请输入合成文本' });

    // 读取音频生成板块配置
    const db = getDb();
    const section = db.prepare('SELECT * FROM section_config WHERE section_id = ?').get('audio_gen');
    if (!section || !section.is_enabled) {
      return res.status(400).json({ error: '音频生成功能未启用，请在管理后台配置' });
    }

    const provider = section.provider || 'doubao';
    let apiKey = section.api_key;
    let baseUrl = section.base_url;

    // 回退到全局平台配置
    if (!apiKey) {
      const platform = db.prepare('SELECT * FROM platform_config WHERE id = 1').get();
      apiKey = platform?.api_key || '';
    }
    if (!baseUrl) {
      baseUrl = provider === 'doubao' ? 'https://ark.cn-beijing.volces.com/api/v3'
        : provider === 'openai' ? 'https://api.openai.com/v1'
        : 'https://ark.cn-beijing.volces.com/api/v3';
    }

    if (!apiKey) return res.status(400).json({ error: '未配置 API Key，请先在管理后台设置' });

    const model = section.model || 'doubao-tts-1.5';
    const selectedVoice = voice || 'zh_female_qingxin';

    console.log(`[audio-gen] provider=${provider} model=${model} voice=${selectedVoice}`);

    // 调用 TTS API
    const ttsRes = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice: selectedVoice,
        speed,
        response_format: 'mp3',
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      throw new Error(`TTS API ${ttsRes.status}: ${errText.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    if (audioBuffer.length === 0) throw new Error('未返回音频数据');

    // 保存到 uploads
    const uploadsDir = join(__dirname, '..', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const filename = `audio_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp3`;
    writeFileSync(join(uploadsDir, filename), audioBuffer);

    // base64 编码
    const base64 = audioBuffer.toString('base64');

    // 保存记录
    const userId = req.admin?.id || 1;
    db.prepare(`
      INSERT INTO records (user_id, type, model, prompt, result, created_at)
      VALUES (?, 'audio_gen', ?, ?, ?, datetime('now'))
    `).run(userId, model, text, JSON.stringify({ filename, voice: selectedVoice, duration: audioBuffer.length }));

    res.json({
      success: true,
      data: {
        audioUrl: `/uploads/${filename}`,
        base64: `data:audio/mp3;base64,${base64}`,
        size: audioBuffer.length,
        provider,
        model,
        voice: selectedVoice,
      },
    });
  } catch (err) {
    console.error('[audio-gen] error:', err);
    res.status(500).json({ error: '音频生成失败', message: err.message });
  }
});

// 可选音色列表
router.get('/voices', (req, res) => {
  res.json({
    voices: [
      { id: 'zh_female_qingxin', label: '清新女声 (默认)', gender: 'female' },
      { id: 'zh_male_qingse', label: '青涩男声', gender: 'male' },
      { id: 'zh_female_wenrou', label: '温柔女声', gender: 'female' },
      { id: 'zh_male_wenzhong', label: '稳重男声', gender: 'male' },
      { id: 'zh_female_tianmei', label: '甜美女声', gender: 'female' },
      { id: 'zh_male_jingying', label: '精英男声', gender: 'male' },
    ],
  });
});

export default router;
