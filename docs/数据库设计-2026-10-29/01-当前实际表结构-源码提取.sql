-- 鲲穹文件传输：当前源码定义的物理表结构
-- 核对日期 2026-10-29；从代码原样提取 CREATE TABLE，未读取线上 SHOW CREATE TABLE。
-- 仅当 KUNQIONG_DB_ENABLED 启用时由应用初始化；本文件不证明本机已启用 MySQL。
-- 不含记录、用户资料、连接密码、真实令牌或文件内容。
-- 历史库若缺 revision，运行期代码会补列；此文件仅给出当前完整结构，不做旧库 ALTER。

-- 来源 server/lib/metadata-store.js:266
CREATE TABLE IF NOT EXISTS kunqiong_app_state (
      state_key VARCHAR(64) NOT NULL PRIMARY KEY,
      schema_version INT NOT NULL DEFAULT 1,
      revision BIGINT NOT NULL DEFAULT 0,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 来源 server/lib/audit-store.js:37
CREATE TABLE IF NOT EXISTS kunqiong_audit_log (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      critical TINYINT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      payload LONGTEXT NOT NULL,
      INDEX audit_time (critical, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
