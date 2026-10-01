-- AI_learning 学习进度表结构（在 Turso SQL Console 执行一次）
-- 兼容 SQLite / libSQL 语法

CREATE TABLE IF NOT EXISTS progress (
  user_id     TEXT    NOT NULL DEFAULT 'default',
  concept_id  TEXT    NOT NULL,
  box         INTEGER NOT NULL DEFAULT 0,  -- Leitner 盒子 0~5（0=未学）
  due         INTEGER NOT NULL DEFAULT 0,  -- 下次复习到期时间戳(ms)
  updated_at  INTEGER NOT NULL,            -- LWW 冲突裁决依据(ms)
  PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE IF NOT EXISTS review_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT    NOT NULL DEFAULT 'default',
  concept_id      TEXT    NOT NULL,
  grade           TEXT    NOT NULL,        -- 'yes' | 'no' | 'mark' | 'unmark'
  box             INTEGER NOT NULL DEFAULT 0,
  ts              INTEGER NOT NULL,        -- 事件发生时间戳(ms)
  client_event_id TEXT UNIQUE,             -- 客户端 UUID，INSERT OR IGNORE 防重试重复
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_review_events_user_ts
  ON review_events(user_id, ts);
