import { Router } from 'express';
import { getDb } from '../database.js';

const router = Router();

// ===== 通用 URL → Markdown 抓取（Jina AI Reader，免费，无需 API Key） =====
async function crawlWithJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    headers: {
      'Accept': 'text/markdown',
      'X-Timeout': '30',
    },
  });
  if (!res.ok) {
    throw new Error(`Jina AI 返回错误: HTTP ${res.status}`);
  }
  const markdown = await res.text();
  return {
    markdown,
    title: extractTitle(markdown),
    source: 'jina',
    url,
  };
}

// ===== Firecrawl 风格抓取（需要 API Key） =====
async function crawlWithFirecrawl(url, apiKey) {
  const res = await fetch('https://api.firecrawl.com/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Firecrawl 返回错误: HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    markdown: data.data?.markdown || '',
    title: data.data?.metadata?.title || extractTitle(data.data?.markdown || ''),
    source: 'firecrawl',
    url,
  };
}

// ===== 本地简易抓取（fallback） =====
async function crawlLocal(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  if (!res.ok) throw new Error(`网页返回错误: HTTP ${res.status}`);
  const html = await res.text();
  const markdown = htmlToMarkdown(html);
  return {
    markdown,
    title: extractTitleFromHtml(html),
    source: 'local',
    url,
  };
}

// 简单的 HTML → Markdown 转换
function htmlToMarkdown(html) {
  let md = html;
  // Remove scripts, styles, comments
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  md = md.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
  // Bold, italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  // Links
  md = md.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  // Images
  md = md.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![$1]($2)');
  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
  md = md.replace(/<\/(ul|ol)>/gi, '\n');
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  // Remove all remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');
  // Decode entities
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();
  return md;
}

function extractTitle(md) {
  const match = md.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : '';
}

function extractTitleFromHtml(html) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? match[1].trim() : '';
}

// ===== API 路由 =====

// 抓取单个 URL
router.post('/scrape', async (req, res) => {
  try {
    const { url, engine = 'auto' } = req.body; // engine: auto | jina | firecrawl | local
    if (!url) {
      return res.status(400).json({ error: '请提供 URL' });
    }

    let result;
    let usedEngine = engine;

    if (engine === 'firecrawl') {
      const apiKey = process.env.FIRECRAWL_API_KEY || req.body.apiKey;
      if (!apiKey) {
        return res.status(400).json({ error: 'Firecrawl 需要 API Key，请在设置中配置' });
      }
      result = await crawlWithFirecrawl(url, apiKey);
      usedEngine = 'firecrawl';
    } else if (engine === 'jina') {
      result = await crawlWithJina(url);
      usedEngine = 'jina';
    } else if (engine === 'local') {
      result = await crawlLocal(url);
      usedEngine = 'local';
    } else {
      // auto: try Jina first, fallback to local
      try {
        result = await crawlWithJina(url);
        usedEngine = 'jina';
      } catch (jinaErr) {
        try {
          result = await crawlLocal(url);
          usedEngine = 'local';
        } catch (localErr) {
          throw new Error(`抓取失败: Jina=${jinaErr.message}, Local=${localErr.message}`);
        }
      }
    }

    // 保存到数据库
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO crawl_records (user_id, url, title, engine, content, status)
        VALUES (?, ?, ?, ?, ?, 'completed')
      `).run(1, url, result.title, usedEngine, result.markdown);
    } catch (dbErr) {
      console.warn('Save crawl record failed:', dbErr.message);
    }

    res.json({
      success: true,
      data: {
        url: result.url,
        title: result.title,
        markdown: result.markdown,
        engine: usedEngine,
        length: result.markdown.length,
      },
    });
  } catch (err) {
    console.error('Crawl error:', err);
    res.status(500).json({ error: '抓取失败', message: err.message });
  }
});

// 批量抓取
router.post('/scrape-batch', async (req, res) => {
  try {
    const { urls, engine = 'auto' } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: '请提供 URL 列表' });
    }
    if (urls.length > 20) {
      return res.status(400).json({ error: '单次最多抓取 20 个 URL' });
    }

    const results = [];
    for (const url of urls) {
      try {
        let result;
        try {
          result = await crawlWithJina(url);
        } catch {
          result = await crawlLocal(url);
        }
        results.push({
          url,
          title: result.title,
          markdown: result.markdown,
          status: 'success',
          length: result.markdown.length,
        });
      } catch (err) {
        results.push({ url, status: 'failed', error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: '批量抓取失败', message: err.message });
  }
});

// 获取抓取历史
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const records = db.prepare(`
      SELECT id, url, title, engine, status, created_at
      FROM crawl_records WHERE status = 'completed'
      ORDER BY created_at DESC LIMIT 50
    `).all();
    res.json({ records });
  } catch {
    res.json({ records: [] });
  }
});

// AI 搜索 - 调用 LLM 分析抓取内容
router.post('/ai-search', async (req, res) => {
  try {
    const { query, urls } = req.body;
    if (!query) return res.status(400).json({ error: '请输入搜索内容' });

    // 抓取目标 URL
    const results = [];
    if (urls && urls.length > 0) {
      for (const url of urls) {
        try {
          let result;
          try {
            result = await crawlWithJina(url);
          } catch {
            result = await crawlLocal(url);
          }
          results.push(result);
        } catch (err) {
          results.push({ url, markdown: '', title: url, error: err.message });
        }
      }
    }

    // 构建分析提示
    const context = results
      .map(r => `## ${r.title || r.url}\n${r.markdown?.slice(0, 3000) || ''}`)
      .join('\n\n');

    res.json({
      success: true,
      query,
      crawled: results.length,
      context,
      summary: results.length > 0
        ? `已抓取 ${results.length} 个页面，内容已整理。您可以基于以上内容进行提问。`
        : '未抓取到内容',
    });
  } catch (err) {
    res.status(500).json({ error: 'AI 搜索失败', message: err.message });
  }
});

export default router;
