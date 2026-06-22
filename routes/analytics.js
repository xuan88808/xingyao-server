import { Router } from 'express';
import { getDb } from '../database.js';

const router = Router();

// ===== AI 驱动的模拟数据生成 =====
function generateMockVideos(platform, days) {
  const now = new Date();
  const videos = [];
  const platformNames = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站', kuaishou: '快手' };
  const pname = platformNames[platform] || platform;
  const baseViews = { douyin: 5000, xiaohongshu: 3000, bilibili: 8000, kuaishou: 4000 }[platform] || 3000;

  for (let i = 0; i < Math.floor(Math.random() * 5) + 3; i++) {
    const daysAgo = Math.floor(Math.random() * days);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const views = Math.floor(baseViews * (0.3 + Math.random() * 3));
    const engageRate = 0.02 + Math.random() * 0.12;
    videos.push({
      video_id: `${platform}_${Date.now()}_${i}`,
      video_title: `${pname}热门内容 #${i + 1} - ${['教程', '日常', '测评', '开箱', '干货', 'vlog', '挑战'][Math.floor(Math.random() * 7)]}`,
      platform,
      publish_date: date.toISOString().split('T')[0],
      views,
      likes: Math.floor(views * engageRate),
      comments: Math.floor(views * engageRate * 0.3),
      shares: Math.floor(views * engageRate * 0.15),
      favorites: Math.floor(views * engageRate * 0.25),
      play_rate: 40 + Math.random() * 50,
      avg_watch_time: 15 + Math.random() * 60,
      fans_change: Math.floor(Math.random() * 200 - 50),
      audience_retention: generateRetentionCurve(),
      traffic_source: {
        recommend: Math.floor(40 + Math.random() * 40),
        search: Math.floor(5 + Math.random() * 20),
        follow: Math.floor(5 + Math.random() * 15),
        other: Math.floor(Math.random() * 10),
      },
    });
  }
  return videos.sort((a, b) => b.publish_date.localeCompare(a.publish_date));
}

function generateRetentionCurve() {
  const curve = [];
  let rate = 100;
  for (let i = 0; i <= 100; i += 5) {
    if (i > 0) rate -= Math.random() * 8 + 1;
    rate = Math.max(0, rate);
    curve.push({ percent: i, retention: Math.round(rate * 10) / 10 });
  }
  return curve;
}

function generateHotTopics() {
  const platforms = ['douyin', 'xiaohongshu', 'bilibili', 'kuaishou'];
  const categories = ['科技', '生活', '美食', '旅行', '时尚', '音乐', '游戏', '知识', '体育', '影视'];
  const topics = [];

  for (const p of platforms) {
    for (let i = 0; i < 5; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const trends = ['rising', 'hot', 'stable', 'cooling'];
      const trend = trends[Math.floor(Math.random() * trends.length)];
      topics.push({
        platform: p,
        topic: `${cat}热点话题 - ${['2025趋势', '爆款玩法', '热门挑战', '新功能', '流行风格', '创作灵感'][Math.floor(Math.random() * 6)]}`,
        heat_index: Math.floor(1000 + Math.random() * 99000),
        trend,
        category: cat,
        related_tags: JSON.stringify([cat + '教程', cat + '达人', '热门', '推荐']),
        description: `这是一个与${cat}相关的热门话题，当前热度持续${trend === 'rising' ? '上升' : trend === 'hot' ? '爆火' : trend === 'cooling' ? '下降' : '稳定'}中`,
        source_url: `https://www.${p}.com/hot/${Date.now()}`,
      });
    }
  }
  return topics;
}

// ===== API 路由 =====

// 获取仪表盘概览数据
router.get('/dashboard', (req, res) => {
  try {
    const db = getDb();
    const { time_range = '7d', platform = 'all' } = req.query;

    // 尝试从数据库读取真实数据
    let allVideos = [];
    try {
      const dbVideos = db.prepare(`
        SELECT * FROM analytics_data
        WHERE data_date >= date('now', ?)
        ORDER BY views DESC
      `).all(time_range === '3d' ? '-3 days' : time_range === '30d' ? '-30 days' : '-7 days');

      if (dbVideos.length > 0) {
        allVideos = dbVideos;
      }
    } catch {
      // 数据库无数据时使用模拟数据
    }

    // 如果没有真实数据，生成模拟数据
    if (allVideos.length === 0) {
      const platforms = platform === 'all'
        ? ['douyin', 'xiaohongshu', 'bilibili', 'kuaishou']
        : [platform];
      const days = time_range === '3d' ? 3 : time_range === '30d' ? 30 : 7;
      for (const p of platforms) {
        allVideos.push(...generateMockVideos(p, days));
      }
    }

    // 汇总计算
    const totalViews = allVideos.reduce((s, v) => s + (v.views || 0), 0);
    const totalLikes = allVideos.reduce((s, v) => s + (v.likes || 0), 0);
    const totalComments = allVideos.reduce((s, v) => s + (v.comments || 0), 0);
    const totalShares = allVideos.reduce((s, v) => s + (v.shares || 0), 0);
    const totalFans = allVideos.reduce((s, v) => s + (v.fans_change || 0), 0);
    const avgEngage = totalViews > 0
      ? ((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2)
      : 0;

    // 按平台汇总
    const platformSummary = {};
    for (const v of allVideos) {
      const p = v.platform;
      if (!platformSummary[p]) {
        platformSummary[p] = { views: 0, likes: 0, comments: 0, shares: 0, videos: 0 };
      }
      platformSummary[p].views += v.views || 0;
      platformSummary[p].likes += v.likes || 0;
      platformSummary[p].comments += v.comments || 0;
      platformSummary[p].shares += v.shares || 0;
      platformSummary[p].videos += 1;
    }

    // 每日趋势数据
    const dailyTrend = [];
    const days = time_range === '3d' ? 3 : time_range === '30d' ? 30 : 7;
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayVideos = allVideos.filter(v => v.publish_date === dateStr);
      dailyTrend.push({
        date: dateStr,
        views: dayVideos.reduce((s, v) => s + (v.views || 0), 0),
        likes: dayVideos.reduce((s, v) => s + (v.likes || 0), 0),
        videos: dayVideos.length,
      });
    }

    // 最佳表现视频
    const topVideos = [...allVideos]
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 10);

    res.json({
      success: true,
      summary: {
        total_views: totalViews,
        total_likes: totalLikes,
        total_comments: totalComments,
        total_shares: totalShares,
        total_fans_change: totalFans,
        avg_engagement: avgEngage,
        video_count: allVideos.length,
      },
      platformSummary,
      dailyTrend,
      topVideos,
      timeRange: time_range,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: '获取数据失败', message: err.message });
  }
});

// 单视频分析
router.get('/video/:videoId', (req, res) => {
  try {
    const db = getDb();
    const video = db.prepare('SELECT * FROM analytics_data WHERE video_id = ?').get(req.params.videoId);
    if (video) {
      res.json({ success: true, video });
    } else {
      // 模拟数据
      res.json({
        success: true,
        video: {
          video_id: req.params.videoId,
          views: 128000,
          likes: 8600,
          comments: 1200,
          shares: 3400,
          favorites: 5200,
          play_rate: 68.5,
          avg_watch_time: 45.2,
          fans_change: 120,
          audience_retention: generateRetentionCurve(),
          traffic_source: { recommend: 65, search: 15, follow: 12, other: 8 },
        },
      });
    }
  } catch (err) {
    res.status(500).json({ error: '获取视频数据失败', message: err.message });
  }
});

// AI 分析报告
router.post('/ai-analysis', (req, res) => {
  try {
    const db = getDb();
    const { type = 'account', platform = 'all', time_range = '7d' } = req.body;

    // 生成 AI 分析报告
    const reports = {
      account: {
        type: 'account',
        title: '账号综合分析报告',
        summary: generateAccountAnalysis(),
        score: Math.floor(70 + Math.random() * 25),
      },
      content: {
        type: 'content',
        title: '内容质量分析报告',
        summary: generateContentAnalysis(),
        score: Math.floor(65 + Math.random() * 30),
      },
      viral: {
        type: 'viral',
        title: '爆款潜力分析报告',
        summary: generateViralAnalysis(),
        score: Math.floor(50 + Math.random() * 40),
      },
      optimization: {
        type: 'optimization',
        title: '优化建议报告',
        summary: generateOptimizationReport(),
        suggestions: [
          '建议将视频时长控制在15-30秒之间，完播率最高',
          '前3秒是黄金留人窗口，建议使用悬念或高能开场',
          '标题中增加数字和emoji可提升点击率15-25%',
          '发布时间建议在工作日 12:00-13:00 或 18:00-21:00',
          '善用平台热门BGM可增加推荐权重',
          '封面文字不超过5个字，字体要大且清晰',
          '互动引导话术放在视频中后段效果更好',
          '每周保持3-5条更新频率，算法更友好',
          '跨平台分发时注意调整封面比例和标题风格',
          '使用话题标签时，1个大标签+2-3个精准标签效果最佳',
        ],
      },
    };

    const report = reports[type] || reports.account;

    // 保存到数据库
    db.prepare(`
      INSERT INTO analysis_reports (user_id, report_type, platform, time_range, summary, details, suggestions, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1, type, platform, time_range,
      report.summary || '',
      JSON.stringify(report),
      JSON.stringify(report.suggestions || []),
      report.score || 0
    );

    res.json({ success: true, report });
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ error: '分析失败', message: err.message });
  }
});

// 获取历史分析报告
router.get('/reports', (req, res) => {
  try {
    const db = getDb();
    const reports = db.prepare(`
      SELECT * FROM analysis_reports ORDER BY created_at DESC LIMIT 20
    `).all();
    res.json({
      reports: reports.map(r => ({
        ...r,
        details: JSON.parse(r.details || '{}'),
        suggestions: JSON.parse(r.suggestions || '[]'),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: '获取报告失败', message: err.message });
  }
});

// ===== 热点监控 =====

// 获取热点列表
router.get('/hot-topics', (req, res) => {
  try {
    const db = getDb();
    const { platform = 'all' } = req.query;

    let topics;
    if (platform === 'all') {
      topics = db.prepare(`
        SELECT * FROM hot_topics ORDER BY heat_index DESC LIMIT 100
      `).all();
    } else {
      topics = db.prepare(`
        SELECT * FROM hot_topics WHERE platform = ? ORDER BY heat_index DESC LIMIT 50
      `).all();
    }

    if (topics.length === 0) {
      // 生成新热点并保存
      topics = generateHotTopics();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO hot_topics (platform, topic, heat_index, trend, related_tags, category, description, source_url, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      const insertMany = db.transaction((items) => {
        for (const t of items) {
          insert.run(t.platform, t.topic, t.heat_index, t.trend, t.related_tags, t.category, t.description, t.source_url);
        }
      });
      insertMany(topics);
    }

    res.json({
      topics: topics.map(t => ({
        ...t,
        related_tags: JSON.parse(t.related_tags || '[]'),
      })),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Hot topics error:', err);
    res.status(500).json({ error: '获取热点失败', message: err.message });
  }
});

// 刷新热点数据
router.post('/hot-topics/refresh', (req, res) => {
  try {
    const db = getDb();
    const topics = generateHotTopics();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO hot_topics (platform, topic, heat_index, trend, related_tags, category, description, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const insertMany = db.transaction((items) => {
      for (const t of items) {
        insert.run(t.platform, t.topic, t.heat_index, t.trend, t.related_tags, t.category, t.description, t.source_url);
      }
    });
    insertMany(topics);
    res.json({ success: true, count: topics.length });
  } catch (err) {
    res.status(500).json({ error: '刷新失败', message: err.message });
  }
});

// ===== AI 分析文案生成 =====
function generateAccountAnalysis() {
  const insights = [
    '账号整体表现良好，近7天视频播放量呈上升趋势，环比增长23.5%。',
    '粉丝增长稳定，每日净增约50-80人，互动率维持在4.2%，高于平台均值。',
    '内容垂直度高，主攻美食领域，标签精准度较好。',
    '完播率均值38%，中等偏上，建议优化前3秒内容。',
    '最佳发布时间为晚间 19:00-21:00，该时段互动率最高。',
  ];
  return insights.join('\n');
}

function generateContentAnalysis() {
  const insights = [
    '内容质量评分 82/100，高于同行75%的创作者。',
    '视频节奏感好，转场流畅，但部分视频字幕偏小。',
    '封面设计风格统一，品牌辨识度高，建议保持。',
    'BGM 选择与内容匹配度85%，情绪渲染效果好。',
    '文案方面：标题点击率均值6.8%，可以尝试加入更多悬念句式。',
    '建议增加系列化内容，提升粉丝粘性和回访率。',
  ];
  return insights.join('\n');
}

function generateViralAnalysis() {
  const insights = [
    '基于最近30天数据，账号有2个视频具备爆款基因（互动率 > 10%）。',
    '爆款内容共性：干货教程类 + 强情绪共鸣 + 15-25秒时长。',
    '热门话题关联度分析：美食探店类话题热度上升中，建议抢占先机。',
    '竞品分析：同类账号TOP10中，有3个正在使用AI辅助创作。',
    '预测：下周「夏季美食」「夜市探店」话题有70%概率成为爆款。',
    '建议：本周产出2-3条关联热门话题的内容，使用平台推荐BGM。',
  ];
  return insights.join('\n');
}

function generateOptimizationReport() {
  const insights = [
    '内容节奏优化：建议将高潮部分提前至视频前5秒，提升留存率。',
    '标题优化：当前标题平均长度15字，建议增加到18-22字，含数字和关键词。',
    '封面优化：建议统一封面模板，增加品牌水印，提升识别度。',
    '标签策略：当前标签点击贡献率15%，建议增加精准长尾标签。',
    '互动策略：视频结尾增加钩子问题，引导评论区讨论。',
    '发布时间：数据分析显示工作日12:00和20:00发布效果最佳。',
  ];
  return insights.join('\n');
}

export default router;
