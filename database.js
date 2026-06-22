import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'data', 'xingyao.db');

let db;

export function getDb() {
  if (!db) {
    // WAL 模式：高并发读写不阻塞
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    -- ===== 管理员 =====
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      role TEXT DEFAULT 'superadmin' CHECK(role IN ('superadmin','admin','viewer')),
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    -- ===== 用户 =====
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      email TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      api_mode TEXT DEFAULT 'platform' CHECK(api_mode IN ('platform','custom')),
      plan TEXT DEFAULT 'free' CHECK(plan IN ('free','pro','enterprise')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active','banned','deleted')),
      daily_quota INTEGER DEFAULT 50,
      usage_today INTEGER DEFAULT 0,
      usage_date TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_active TEXT DEFAULT (datetime('now'))
    );

    -- ===== 平台配置（管理员统一API Key）=====
    CREATE TABLE IF NOT EXISTS platform_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      provider TEXT DEFAULT 'zhipu',
      api_key TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT 'glm-4.6v',
      custom_url TEXT DEFAULT '',
      custom_model TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO platform_config (id) VALUES (1);

    -- ===== 每日用量明细 =====
    CREATE TABLE IF NOT EXISTS daily_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      usage_date TEXT NOT NULL DEFAULT (date('now')),
      count INTEGER DEFAULT 1,
      UNIQUE(user_id, usage_date)
    );

    -- ===== AI 生成记录 =====
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('text_create','image_reverse','image_gen','chat','expert')),
      model TEXT DEFAULT '',
      prompt TEXT DEFAULT '',
      result TEXT DEFAULT '',
      expert_type TEXT DEFAULT '',
      platform TEXT DEFAULT '',           -- 小红书/公众号/抖音
      tokens_used INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      flagged_training INTEGER DEFAULT 0,  -- 0未标记 1已标记优质 2已归档
      quality_score INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== 上传图片 =====
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT DEFAULT '',
      mime_type TEXT DEFAULT 'image/png',
      size INTEGER DEFAULT 0,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
      source TEXT DEFAULT 'upload' CHECK(source IN ('upload','reverse','generated')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== 训练数据 =====
    CREATE TABLE IF NOT EXISTS training_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER REFERENCES records(id) ON DELETE CASCADE,
      curated_content TEXT NOT NULL,
      instruction TEXT DEFAULT '',
      output TEXT DEFAULT '',
      labels TEXT DEFAULT '[]',
      quality_score INTEGER DEFAULT 0 CHECK(quality_score BETWEEN 0 AND 100),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','archived')),
      curator TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== API 调用日志 =====
    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      provider TEXT DEFAULT '',
      model TEXT DEFAULT '',
      tokens_prompt INTEGER DEFAULT 0,
      tokens_completion INTEGER DEFAULT 0,
      tokens_total INTEGER DEFAULT 0,
      cost_estimate REAL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_msg TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== 提示词模板库 =====
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT '通用' CHECK(category IN ('文本创作','图片反推','图片生成','设计创意','音频生成','通用')),
      tags TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== 收款设置 =====
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      qr_code_url TEXT DEFAULT '',
      qr_code_updated_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO payment_settings (id) VALUES (1);

    -- ===== 分板块 API 配置 =====
    CREATE TABLE IF NOT EXISTS section_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id TEXT NOT NULL UNIQUE,
      provider TEXT DEFAULT 'zhipu',
      api_key TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      system_prompt TEXT DEFAULT '',
      -- 反推文本独立 API 配置
      text_api_provider TEXT DEFAULT 'zhipu',
      text_api_key TEXT DEFAULT '',
      text_api_base_url TEXT DEFAULT '',
      text_api_model TEXT DEFAULT '',
      is_enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    -- 预置4个板块配置
    INSERT OR IGNORE INTO section_config (id, section_id, model) VALUES
      (1, 'text_create', 'glm-4.6v'),
      (2, 'image_reverse', 'glm-4.6v'),
      (3, 'image_gen', 'glm-4-flash'),
      (4, 'audio_gen', 'glm-4.6v');

    -- ===== 平台账号绑定 =====
    CREATE TABLE IF NOT EXISTS platform_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('douyin','xiaohongshu','kling','bilibili','kuaishou','shipinhao','youtube')),
      account_name TEXT DEFAULT '',
      account_avatar TEXT DEFAULT '',
      follower_count INTEGER DEFAULT 0,
      access_token TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      token_expires TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, platform)
    );

    -- ===== 一键发布记录 =====
    CREATE TABLE IF NOT EXISTS publish_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      video_name TEXT DEFAULT '',
      video_path TEXT DEFAULT '',
      video_size INTEGER DEFAULT 0,
      video_duration REAL DEFAULT 0,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      platforms TEXT DEFAULT '[]',
      cover_path TEXT DEFAULT '',
      schedule_type TEXT DEFAULT 'now' CHECK(schedule_type IN ('now','scheduled')),
      scheduled_at TEXT,
      declaration TEXT DEFAULT '',
      category TEXT DEFAULT '',
      permission_type TEXT DEFAULT 'public' CHECK(permission_type IN ('public','friends','private')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','partial','failed')),
      results TEXT DEFAULT '{}',
      error_msg TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- ===== 视频数据分析 =====
    CREATE TABLE IF NOT EXISTS analytics_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      video_id TEXT DEFAULT '',
      video_title TEXT DEFAULT '',
      video_cover TEXT DEFAULT '',
      publish_date TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      favorites INTEGER DEFAULT 0,
      play_rate REAL DEFAULT 0,
      avg_watch_time REAL DEFAULT 0,
      fans_change INTEGER DEFAULT 0,
      audience_retention TEXT DEFAULT '[]',
      traffic_source TEXT DEFAULT '{}',
      data_date TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== 热点监控 =====
    CREATE TABLE IF NOT EXISTS hot_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      topic TEXT NOT NULL,
      heat_index INTEGER DEFAULT 0,
      trend TEXT DEFAULT 'stable' CHECK(trend IN ('rising','hot','stable','cooling')),
      related_tags TEXT DEFAULT '[]',
      category TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    -- ===== AI 分析报告 =====
    CREATE TABLE IF NOT EXISTS analysis_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL CHECK(report_type IN ('account','content','viral','optimization')),
      platform TEXT DEFAULT '',
      time_range TEXT DEFAULT '7d',
      summary TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      suggestions TEXT DEFAULT '[]',
      score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);
    CREATE INDEX IF NOT EXISTS idx_prompt_templates_active ON prompt_templates(is_active);
    CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id);
    CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
    CREATE INDEX IF NOT EXISTS idx_records_created ON records(created_at);
    CREATE INDEX IF NOT EXISTS idx_records_training ON records(flagged_training);
    CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
    CREATE INDEX IF NOT EXISTS idx_training_status ON training_data(status);
    CREATE INDEX IF NOT EXISTS idx_api_logs_user ON api_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);
    CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
    CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(usage_date);
    CREATE INDEX IF NOT EXISTS idx_platform_accounts_user ON platform_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_platform_accounts_platform ON platform_accounts(platform);
    CREATE INDEX IF NOT EXISTS idx_publish_records_user ON publish_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_publish_records_status ON publish_records(status);
    CREATE INDEX IF NOT EXISTS idx_analytics_platform ON analytics_data(platform);
    CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_data(user_id);
    CREATE INDEX IF NOT EXISTS idx_hot_topics_platform ON hot_topics(platform);
    CREATE INDEX IF NOT EXISTS idx_hot_topics_fetched ON hot_topics(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_reports_user ON analysis_reports(user_id);

    -- ===== 网页抓取记录 =====
    CREATE TABLE IF NOT EXISTS crawl_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT DEFAULT '',
      engine TEXT DEFAULT 'auto',
      content TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_records_user ON crawl_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_records_created ON crawl_records(created_at);
  `);

  // ===== 增量迁移：兼容旧表（只对已存在的列创建索引）=====
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('email'))       db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
  if (!cols.includes('password_hash')) db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''");
  if (!cols.includes('api_mode'))    db.exec("ALTER TABLE users ADD COLUMN api_mode TEXT DEFAULT 'platform'");
  if (!cols.includes('daily_quota')) db.exec("ALTER TABLE users ADD COLUMN daily_quota INTEGER DEFAULT 50");
  if (!cols.includes('usage_today')) db.exec("ALTER TABLE users ADD COLUMN usage_today INTEGER DEFAULT 0");
  if (!cols.includes('usage_date'))  db.exec("ALTER TABLE users ADD COLUMN usage_date TEXT DEFAULT ''");
  if (!cols.includes('unlimited_quota')) db.exec("ALTER TABLE users ADD COLUMN unlimited_quota INTEGER DEFAULT 0");
  if (!cols.includes('custom_api_enabled')) db.exec("ALTER TABLE users ADD COLUMN custom_api_enabled INTEGER DEFAULT 0");
  // 迁移 section_config 表
  const sectionCols = db.prepare("PRAGMA table_info(section_config)").all().map(c => c.name);
  if (!sectionCols.includes('system_prompt')) db.exec("ALTER TABLE section_config ADD COLUMN system_prompt TEXT DEFAULT ''");
  if (!sectionCols.includes('text_api_provider')) db.exec("ALTER TABLE section_config ADD COLUMN text_api_provider TEXT DEFAULT 'zhipu'");
  if (!sectionCols.includes('text_api_key')) db.exec("ALTER TABLE section_config ADD COLUMN text_api_key TEXT DEFAULT ''");
  if (!sectionCols.includes('text_api_base_url')) db.exec("ALTER TABLE section_config ADD COLUMN text_api_base_url TEXT DEFAULT ''");
  if (!sectionCols.includes('text_api_model')) db.exec("ALTER TABLE section_config ADD COLUMN text_api_model TEXT DEFAULT ''");
  // 迁移后创建索引
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
}

// ===== 工具函数 =====
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}
