-- ============================================================
-- W1 占位迁移：仅建 extensions 与 schema 框架
-- 真实表（families / members / assets / snapshots 等）将在 W2-W3 提交
-- 见《数据模型设计.md》v1.0 §9
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- RLS 默认开启（技术方案 §16 安全清单）
alter database postgres set row_security = on;