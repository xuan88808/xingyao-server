import { Router } from 'express';
import { getDb } from '../database.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/training — 训练数据列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || '';

    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM training_data t ${where}`).get(...params);

    const data = db.prepare(`
      SELECT t.*, r.type as record_type, r.prompt, u.nickname as user_nickname
      FROM training_data t
      LEFT JOIN records r ON t.record_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data,
      total: countRow.total,
      page,
      limit,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (err) {
    console.error('Training list error:', err);
    res.status(500).json({ error: '获取训练数据失败' });
  }
});

// POST /api/training — 从记录创建训练数据
router.post('/', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { record_id, instruction, output, quality_score, labels, notes } = req.body;
    if (!record_id) return res.status(400).json({ error: '缺少记录ID' });

    const db = getDb();

    // 获取原记录内容
    const record = db.prepare('SELECT * FROM records WHERE id = ?').get(record_id);
    if (!record) return res.status(404).json({ error: '记录不存在' });

    const curated_content = record.result || record.prompt || '';
    const labelsJson = JSON.stringify(labels || []);
    const finalInstruction = instruction || record.prompt || '';
    const finalOutput = output || record.result || '';

    const result = db.prepare(`
      INSERT INTO training_data (record_id, curated_content, instruction, output, labels, quality_score, curator, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record_id, curated_content, finalInstruction, finalOutput, labelsJson,
      quality_score || 70, req.admin.username, notes || '');

    // 更新原记录的标记
    db.prepare('UPDATE records SET flagged_training = 2 WHERE id = ?').run(record_id);

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    console.error('Create training error:', err);
    res.status(500).json({ error: '创建训练数据失败' });
  }
});

// PATCH /api/training/:id/status
router.patch('/:id/status', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected', 'archived'].includes(status)) {
      return res.status(400).json({ error: '无效状态' });
    }

    const db = getDb();
    db.prepare("UPDATE training_data SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '更新状态失败' });
  }
});

// DELETE /api/training/:id
router.delete('/:id', roleMiddleware('superadmin'), (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT record_id FROM training_data WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM training_data WHERE id = ?').run(req.params.id);
    // 恢复记录标记
    if (item) db.prepare('UPDATE records SET flagged_training = 1 WHERE id = ?').run(item.record_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// GET /api/training/export — 导出训练数据 JSON
router.get('/export', roleMiddleware('superadmin', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT t.*, r.type as record_type
      FROM training_data t LEFT JOIN records r ON t.record_id = r.id
      WHERE t.status IN ('approved','archived')
      ORDER BY t.quality_score DESC
    `).all();

    const formatted = data.map(d => ({
      instruction: d.instruction,
      output: d.output,
      labels: JSON.parse(d.labels || '[]'),
      quality_score: d.quality_score,
      type: d.record_type,
    }));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="training-export-${Date.now()}.json"`);
    res.json({ exported_at: new Date().toISOString(), count: formatted.length, data: formatted });
  } catch (err) {
    res.status(500).json({ error: '导出失败' });
  }
});

export default router;
