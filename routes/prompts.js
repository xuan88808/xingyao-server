import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/prompts — 提示词列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const category = req.query.category || '';
    const active = req.query.active;

    let where = 'WHERE 1=1';
    const params = [];
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (active !== undefined) { where += ' AND is_active = ?'; params.push(parseInt(active)); }

    const prompts = db.prepare(`
      SELECT * FROM prompt_templates ${where} ORDER BY sort_order, updated_at DESC
    `).all(...params);

    res.json(prompts);
  } catch (err) {
    console.error('Prompts list error:', err);
    res.status(500).json({ error: '获取提示词失败' });
  }
});

// POST /api/prompts — 创建
router.post('/', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { title, content, category, tags, sort_order } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO prompt_templates (title, content, category, tags, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, content, category || '通用', JSON.stringify(tags || []), sort_order || 0);

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Prompt create error:', err);
    res.status(500).json({ error: '创建提示词失败' });
  }
});

// PUT /api/prompts/:id — 更新
router.put('/:id', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { title, content, category, tags, sort_order, is_active } = req.body;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM prompt_templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: '提示词不存在' });

    db.prepare(`
      UPDATE prompt_templates SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title || null, content || null, category || null,
      tags !== undefined ? JSON.stringify(tags) : null,
      sort_order !== undefined ? sort_order : null,
      is_active !== undefined ? is_active : null,
      req.params.id
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Prompt update error:', err);
    res.status(500).json({ error: '更新提示词失败' });
  }
});

// DELETE /api/prompts/:id — 删除
router.delete('/:id', roleMiddleware('superadmin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除提示词失败' });
  }
});

// POST /api/prompts/batch-import — 批量导入
router.post('/batch-import', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { prompts } = req.body; // [{ title, content, category, tags }]
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: '请提供提示词数组' });
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO prompt_templates (title, content, category, tags) VALUES (?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      let count = 0;
      for (const p of items) {
        if (p.title && p.content) {
          stmt.run(p.title, p.content, p.category || '通用', JSON.stringify(p.tags || []));
          count++;
        }
      }
      return count;
    });

    const inserted = insertMany(prompts);
    res.json({ success: true, inserted });
  } catch (err) {
    console.error('Batch import error:', err);
    res.status(500).json({ error: '批量导入失败' });
  }
});

export default router;
