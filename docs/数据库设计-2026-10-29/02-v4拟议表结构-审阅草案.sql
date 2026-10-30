-- 鲲穹文件传输 v4 关系化目标结构草案
-- 版本日期：2026-10-29；MySQL 8.0.16+；UTF-8；时间按 UTC 写入
-- 本文件为设计审阅稿，仅可在新建空白测试库验证。不是当前应用的自动迁移脚本。
-- 不含 CREATE DATABASE / USE / DROP / INSERT，不会搬运现有业务数据。
-- 当前程序仍读写 kunqiong_app_state；仅执行此脚本不会启用 v4 功能。
-- 当前 kunqiong_audit_log 沿用，不在此目标表数中重复计算。
-- 通过后文 ALTER TABLE 添加外键，避免定义顺序和循环引用影响。
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 账号与团队 / 基础规范化 / metadata.users
-- 保留现有外部账号标识，不重新分配用户 ID
CREATE TABLE `kq_users` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '沿用现有用户 ID，区分大小写',
  `username` VARCHAR(160) NOT NULL COMMENT '账号展示名，不作为授权凭据',
  `nickname` VARCHAR(80) NOT NULL COMMENT '昵称',
  `email` VARCHAR(254) NULL COMMENT '规范化邮箱，绑定验证后写入',
  `phone` VARCHAR(40) NULL COMMENT '规范化手机号码',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active / disabled',
  `profile_json` JSON NOT NULL COMMENT '头像、登录来源、登录方式等现有资料',
  `plan_json` JSON NOT NULL COMMENT '个人套餐与起止时间快照，沿用现有权益语义',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间，UTC',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间，UTC',
  INDEX ix_user_email (email),
  INDEX ix_user_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户';

-- 账号与团队 / 基础规范化 / metadata.organizations
-- 组织拥有团队套餐与品牌配置
CREATE TABLE `kq_organizations` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '现有组织 ID',
  `slug` VARCHAR(80) NOT NULL COMMENT '团队专属路径',
  `name` VARCHAR(80) NOT NULL COMMENT '团队名',
  `owner_user_id` VARCHAR(120) NOT NULL COMMENT '当前所有者',
  `plan_json` JSON NOT NULL COMMENT '组织套餐与有效期，不随所有权转让丢失',
  `branding_json` JSON NOT NULL COMMENT '品牌开关、名称、说明、Logo 引用与修订号',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发控制版本',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  UNIQUE KEY uq_org_slug (slug),
  INDEX ix_org_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='团队';

-- 账号与团队 / 基础规范化 / organizations[].members[]
-- 保留邀请、申请、审核和正式成员状态
CREATE TABLE `kq_organization_members` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '成员记录 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '所属组织',
  `user_id` VARCHAR(120) NULL COMMENT '绑定账号，待邀请联系人可为空',
  `identity_key` VARCHAR(200) NOT NULL COMMENT 'user:ID 或已规范化联系人的稳定摘要',
  `role` VARCHAR(20) NOT NULL COMMENT 'owner / admin / member',
  `status` VARCHAR(20) NOT NULL COMMENT 'invited / requested / active / removed',
  `contact_snapshot_json` JSON NOT NULL COMMENT '邀请目标、显示名、来源及申请说明快照',
  `invitation_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '邀请凭据摘要',
  `expires_at` DATETIME(3) NULL COMMENT '邀请到期时间',
  `requested_at` DATETIME(3) NULL COMMENT '申请时间',
  `reviewed_at` DATETIME(3) NULL COMMENT '处理时间',
  `joined_at` DATETIME(3) NULL COMMENT '入团时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '记录创建时间',
  UNIQUE KEY uq_member_identity (organization_id, identity_key),
  INDEX ix_member_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='团队成员与入团状态';

-- 账号与团队 / 基础规范化 / organizations[].ownershipHandovers[]
-- 保存发起、接收、取消和失效记录
CREATE TABLE `kq_ownership_handovers` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '交接 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '组织',
  `from_user_id` VARCHAR(120) NOT NULL COMMENT '原所有者',
  `to_user_id` VARCHAR(120) NOT NULL COMMENT '接收者',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending / accepted / declined / canceled / expired / invalidated',
  `initiated_at` DATETIME(3) NOT NULL COMMENT '发起时间',
  `expires_at` DATETIME(3) NOT NULL COMMENT '待接收有效期',
  `resolved_at` DATETIME(3) NULL COMMENT '处理时间',
  `resolved_by_user_id` VARCHAR(120) NULL COMMENT '操作人',
  `reason` VARCHAR(240) NULL COMMENT '处理原因',
  INDEX ix_handover_pending (organization_id, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='所有权交接';

-- 账号与团队 / 基础规范化 / metadata.sessions
-- 替代全量快照中的登录会话
CREATE TABLE `kq_auth_sessions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '内部会话 ID，不能直接用作 Cookie 凭据',
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Cookie 随机令牌摘要',
  `user_id` VARCHAR(120) NOT NULL COMMENT '账号',
  `provider_credential_ciphertext` MEDIUMTEXT NULL COMMENT '确需保留的上游凭据密文与密钥版本封装',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `expires_at` DATETIME(3) NOT NULL COMMENT '过期时间',
  `revoked_at` DATETIME(3) NULL COMMENT '撤销时间',
  UNIQUE KEY uq_session_token (token_hash),
  INDEX ix_session_user (user_id, expires_at),
  INDEX ix_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='登录会话';

-- 账号与团队 / 基础规范化 / metadata.verificationCodes
-- 保留验证码哈希与尝试次数；新增领取验证按场景隔离
CREATE TABLE `kq_verification_codes` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '挑战 ID',
  `scene` VARCHAR(40) NOT NULL COMMENT 'bind / claim / handoff，当前代码仅 bind',
  `target_type` VARCHAR(20) NOT NULL COMMENT 'email / phone',
  `target_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '规范化目标的带密钥摘要',
  `target_ciphertext` TEXT NULL COMMENT '必要时加密保存发送目标',
  `code_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '验证码摘要',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '验证尝试次数',
  `expires_at` DATETIME(3) NOT NULL COMMENT '有效期',
  `consumed_at` DATETIME(3) NULL COMMENT '消费时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  INDEX ix_challenge_target (target_digest, scene, expires_at),
  INDEX ix_challenge_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='绑定与身份验证挑战';

-- 账号与团队 / 基础规范化 / metadata.upgradeOrders
-- 业务订单独立保存，支付成功处理保持幂等
CREATE TABLE `kq_upgrade_orders` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '订单内部 ID',
  `order_no` VARCHAR(80) NOT NULL COMMENT '本地业务订单号',
  `user_id` VARCHAR(120) NOT NULL COMMENT '购买账号',
  `organization_id` VARCHAR(120) NULL COMMENT '若订单直接对应团队',
  `plan_id` VARCHAR(40) NOT NULL COMMENT '套餐标识',
  `amount_minor` BIGINT UNSIGNED NULL COMMENT '金额最小货币单位；未确定价格为空',
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY' COMMENT '币种',
  `status` VARCHAR(30) NOT NULL COMMENT '沿用现有订单状态；迁移时明确状态映射',
  `provider` VARCHAR(40) NOT NULL COMMENT '支付提供方',
  `provider_order_no` VARCHAR(120) NULL COMMENT '第三方订单号',
  `plan_snapshot_json` JSON NOT NULL COMMENT '套餐、权益天数与来源快照',
  `provider_payload_json` JSON NULL COMMENT '脱敏支付响应，不保存支付密码',
  `query_credential_ciphertext` TEXT NULL COMMENT '有保留期限的查单凭据密文',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  `paid_at` DATETIME(3) NULL COMMENT '支付成功时间',
  UNIQUE KEY uq_order_no (order_no),
  UNIQUE KEY uq_provider_order (provider, provider_order_no),
  INDEX ix_order_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='套餐订单';

-- 账号与团队 / 基础规范化 / metadata.messages[userId][]
-- 保留现有消息分类、动作与已读状态
CREATE TABLE `kq_messages` (
  `id` VARCHAR(120) NOT NULL COMMENT '现有消息 ID，可能在不同账号重复',
  `user_id` VARCHAR(120) NOT NULL COMMENT '接收人',
  `category` VARCHAR(30) NOT NULL COMMENT 'system / official / 业务分类',
  `event_type` VARCHAR(80) NULL COMMENT '事件类型',
  `title` VARCHAR(160) NOT NULL COMMENT '标题',
  `body` TEXT NOT NULL COMMENT '正文',
  `action_json` JSON NULL COMMENT 'actionUrl / actionType / actionId',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `read_at` DATETIME(3) NULL COMMENT '已读时间',
  PRIMARY KEY (user_id, id),
  INDEX ix_message_unread (user_id, read_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='站内消息';

-- 账号与团队 / 基础规范化 / notificationSettings / users[].fileCleanup / systemConfig
-- 小规模可变配置保留 JSON；系统配置与用户配置使用不同作用域
CREATE TABLE `kq_settings` (
  `scope_key` VARCHAR(160) NOT NULL COMMENT 'system 或 user:ID，服务端构造',
  `setting_key` VARCHAR(80) NOT NULL COMMENT 'notification / cleanup / runtime_config 等',
  `user_id` VARCHAR(120) NULL COMMENT '用户配置所属账号，系统配置为空',
  `value_json` JSON NOT NULL COMMENT '配置值，沿用默认值与规范化规则',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发版本',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  PRIMARY KEY (scope_key, setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='用户与系统配置';

-- 账号与团队 / 基础规范化 / metadata.records[userId][]
-- 保留别名与历史入口，作为可重建列表投影
CREATE TABLE `kq_account_records` (
  `user_id` VARCHAR(120) NOT NULL COMMENT '记录所属人',
  `record_id` VARCHAR(180) NOT NULL COMMENT '沿用现有记录 ID',
  `resource_id` VARCHAR(120) NULL COMMENT '可关联的业务资源',
  `scope` VARCHAR(40) NOT NULL COMMENT 'my_sent / my_collections 等现有视图范围',
  `alias` VARCHAR(160) NULL COMMENT '个人别名',
  `snapshot_json` JSON NOT NULL COMMENT '旧记录展示快照；管理令牌须脱敏或加密封装',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  PRIMARY KEY (user_id, record_id),
  INDEX ix_record_view (user_id, scope, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='账号收发记录投影';

-- 账号与团队 / 基础规范化 / metadata.guestUsage
-- 保留游客额度累计，独立于登录账号
CREATE TABLE `kq_guest_usage` (
  `guest_key_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY COMMENT '游客稳定标识摘要',
  `bytes_used` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计字节数',
  `uploads` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计上传次数',
  `first_at` DATETIME(3) NOT NULL COMMENT '首次记录时间',
  `last_at` DATETIME(3) NOT NULL COMMENT '最近记录时间',
  INDEX ix_guest_last (last_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='游客使用量';

-- 文件与交付 / 基础规范化 / metadata.shares / metadata.collections
-- 分享、收集和团队文件统一所有权、项目、状态与回收站
CREATE TABLE `kq_resources` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '保留原资源 ID',
  `kind` VARCHAR(30) NOT NULL COMMENT 'share / collection / team_file',
  `title` VARCHAR(200) NOT NULL COMMENT '资源标题',
  `owner_user_id` VARCHAR(120) NULL COMMENT '登录所有者',
  `owner_guest_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '匿名所有者摘要，与账号所有者二选一',
  `organization_id` VARCHAR(120) NULL COMMENT '资源归属团队；品牌团队不等于归属团队',
  `branding_organization_id` VARCHAR(120) NULL COMMENT '展示品牌的团队',
  `project_id` VARCHAR(120) NULL COMMENT '后续所属项目',
  `status` VARCHAR(20) NOT NULL COMMENT 'active / closed / deleted',
  `close_reason` VARCHAR(60) NULL COMMENT 'expired / manual / trash / trash_restore 等',
  `access_policy_json` JSON NULL COMMENT '域名、组织范围、预览类型、水印等声明；服务端实施',
  `manage_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '匿名管理凭据摘要；账号资源仍需登录鉴权',
  `retention_until` DATETIME(3) NULL COMMENT '物理文件保留截止，与分享有效期分开',
  `deleted_at` DATETIME(3) NULL COMMENT '手动移入回收站时间',
  `deleted_by_user_id` VARCHAR(120) NULL COMMENT '删除操作者',
  `trash_expires_at` DATETIME(3) NULL COMMENT '可恢复窗口截止',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '资源并发版本',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  INDEX ix_resource_owner (owner_user_id, status, updated_at),
  INDEX ix_resource_org (organization_id, status, updated_at),
  INDEX ix_resource_trash (status, trash_expires_at),
  UNIQUE KEY uq_manage_token (manage_token_hash),
  CHECK ((owner_user_id IS NOT NULL AND owner_guest_hash IS NULL) OR (owner_user_id IS NULL AND owner_guest_hash IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='统一业务资源';

-- 文件与交付 / 基础规范化 / shares[].files[] / collections[].submissions[].files[]
-- 分离用户看到的文件与物理版本，支持换稿
CREATE TABLE `kq_files` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '新增稳定逻辑文件 ID，现有数组索引需建立映射',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '所属业务资源',
  `display_name` VARCHAR(512) NOT NULL COMMENT '展示名称',
  `relative_path` TEXT NOT NULL COMMENT '安全相对路径，仅用于展示与整理',
  `latest_version_no` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已成功发布的最新版本号缓存',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_file_resource (id, resource_id),
  INDEX ix_file_resource (resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='逻辑文件';

-- 文件与交付 / 基础规范化 / 嵌套文件对象；版本号为拟新增
-- 每个版本对应一份物理内容，原版本不被新稿覆盖
CREATE TABLE `kq_file_versions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '版本 ID',
  `file_id` VARCHAR(120) NOT NULL COMMENT '逻辑文件 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '资源 ID，用组合外键防止串资源',
  `version_no` INT UNSIGNED NOT NULL COMMENT '同一逻辑文件递增版本',
  `storage_backend` VARCHAR(30) NOT NULL DEFAULT 'local' COMMENT 'local 或后续对象存储适配器',
  `storage_key` TEXT NOT NULL COMMENT '后端内部位置，不作为公开 URL',
  `storage_fingerprint` BINARY(32) NOT NULL COMMENT 'SHA256(backend + 分隔符 + storage_key)，应用计算',
  `storage_owner_key` VARCHAR(200) NOT NULL COMMENT '保留当前物理存储所有者语义',
  `original_name` VARCHAR(512) NOT NULL COMMENT '原文件名',
  `byte_size` BIGINT UNSIGNED NOT NULL COMMENT '实际字节数，按保留版本计容量',
  `mime_type` VARCHAR(160) NOT NULL COMMENT '检测或声明的 MIME',
  `content_sha256` BINARY(32) NULL COMMENT '内容完整性校验，不默认全局去重',
  `scan_status` VARCHAR(20) NOT NULL COMMENT 'unscanned / approved / blocked / failed，安全扫描专用',
  `scan_meta_json` JSON NULL COMMENT '扫描引擎、时间与结果',
  `storage_state` VARCHAR(20) NOT NULL DEFAULT 'present' COMMENT 'present / purge_pending / purged',
  `uploaded_by_user_id` VARCHAR(120) NULL COMMENT '上传账号，匿名为空',
  `created_at` DATETIME(3) NOT NULL COMMENT '版本创建时间',
  `purged_at` DATETIME(3) NULL COMMENT '实际删除字节时间',
  UNIQUE KEY uq_file_version (file_id, version_no),
  UNIQUE KEY uq_version_resource (id, resource_id),
  UNIQUE KEY uq_storage_key (storage_fingerprint),
  INDEX ix_version_purge (storage_state, created_at),
  CHECK (version_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='不可变文件版本';

-- 文件与交付 / 基础规范化 / metadata.shares
-- 保留原分享链接，后续切换交付发布版本
CREATE TABLE `kq_share_links` (
  `resource_id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '分享资源',
  `public_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '公开入口令牌摘要',
  `pickup_code_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '取件码带密钥摘要，输入限流仍需保留',
  `password_hash` VARCHAR(255) NULL COMMENT '提取密码的慢哈希封装',
  `access_mode` VARCHAR(30) NOT NULL COMMENT 'public / recipients / organization',
  `expires_at` DATETIME(3) NULL COMMENT '链接过期时间',
  `download_limit` BIGINT UNSIGNED NULL COMMENT '下载总次数上限，空表示不限',
  `download_count` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '成功下载计数',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '修改与次数控制版本',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_share_token (public_token_hash),
  UNIQUE KEY uq_pickup_code (pickup_code_hash),
  INDEX ix_share_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='分享入口与访问策略';

-- 文件与交付 / 交付闭环 / D03；原分享文件集合深化
-- 整包文件发布快照，回执绑定此版本
CREATE TABLE `kq_delivery_releases` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '交付版本 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '分享资源',
  `release_no` INT UNSIGNED NOT NULL COMMENT '整包版本号',
  `status` VARCHAR(20) NOT NULL COMMENT 'draft / published / superseded / revoked',
  `manifest_digest` BINARY(32) NULL COMMENT '排序后的文件版本清单摘要',
  `created_by_user_id` VARCHAR(120) NULL COMMENT '发起人',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `published_at` DATETIME(3) NULL COMMENT '发布时间',
  `revoked_at` DATETIME(3) NULL COMMENT '撤销时间',
  UNIQUE KEY uq_release_no (resource_id, release_no),
  UNIQUE KEY uq_release_resource (id, resource_id),
  INDEX ix_release_current (resource_id, status),
  CHECK (release_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='一次对外交付的版本';

-- 文件与交付 / 交付闭环 / D03 / D01
-- 固定整包版本包含哪些不可变文件版本
CREATE TABLE `kq_delivery_release_files` (
  `release_id` VARCHAR(120) NOT NULL COMMENT '交付版本',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '分享资源',
  `file_version_id` VARCHAR(120) NOT NULL COMMENT '固定文件版本',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '显示顺序',
  PRIMARY KEY (release_id, file_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='交付版本文件清单';

-- 文件与交付 / 基础规范化 / shares[].recipientUserIds / recipientContacts
-- 定向授权身份，可绑定账号或经验证外部身份
CREATE TABLE `kq_delivery_recipients` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '收件授权 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '分享资源',
  `principal_key` VARCHAR(200) NOT NULL COMMENT 'user:ID 或 external:摘要；姓名不能作为此键',
  `user_id` VARCHAR(120) NULL COMMENT '已绑定账号',
  `external_identity_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部身份带密钥摘要',
  `contact_ciphertext` TEXT NULL COMMENT '必要的联系方式密文',
  `display_name` VARCHAR(160) NULL COMMENT '发布时展示名快照',
  `verified_at` DATETIME(3) NULL COMMENT '外部身份验证时间；每次访问仍查会话',
  `revoked_at` DATETIME(3) NULL COMMENT '授权撤销时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_recipient_principal (resource_id, principal_key),
  UNIQUE KEY uq_recipient_resource (id, resource_id),
  INDEX ix_recipient_user (user_id, revoked_at),
  CHECK ((user_id IS NOT NULL AND external_identity_digest IS NULL) OR (user_id IS NULL AND external_identity_digest IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='资源收件身份';

-- 收集工作流 / 收集闭环 / collectionTemplates；当前前端还使用 localStorage 结构复用
-- 版本化保存表单、材料清单、条件与整理规则
CREATE TABLE `kq_collection_templates` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '模板版本 ID',
  `template_key` VARCHAR(120) NOT NULL COMMENT '跨版本稳定模板标识',
  `owner_user_id` VARCHAR(120) NOT NULL COMMENT '模板所有者',
  `organization_id` VARCHAR(120) NULL COMMENT '团队模板范围',
  `version_no` INT UNSIGNED NOT NULL COMMENT '模板版本号',
  `name` VARCHAR(160) NOT NULL COMMENT '模板名称',
  `schema_json` JSON NOT NULL COMMENT '字段、材料项、样例、简单条件与命名规则，保留稳定 item key',
  `created_at` DATETIME(3) NOT NULL COMMENT '版本创建时间',
  `archived_at` DATETIME(3) NULL COMMENT '停用时间',
  UNIQUE KEY uq_template_version (template_key, version_no),
  INDEX ix_template_owner (owner_user_id, created_at),
  CHECK (version_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='收集模板版本';

-- 收集工作流 / 收集闭环 / metadata.collections
-- 承接现有任务，并固定要求快照
CREATE TABLE `kq_collection_tasks` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '等于所属 collection 资源 ID',
  `template_version_id` VARCHAR(120) NULL COMMENT '来源模板版本',
  `public_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '提交入口凭据摘要',
  `description` TEXT NOT NULL COMMENT '收集说明',
  `requirements_json` JSON NOT NULL COMMENT '材料项、表单字段、条件与命名要求快照',
  `requirements_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '任务要求修订号',
  `allowed_types_json` JSON NOT NULL COMMENT '允许格式集合',
  `max_file_bytes` BIGINT UNSIGNED NOT NULL COMMENT '单文件限制',
  `capacity_bytes` BIGINT UNSIGNED NULL COMMENT '任务实际容量限制',
  `deadline` DATETIME(3) NOT NULL COMMENT '提交截止时间',
  `roster_mode` VARCHAR(20) NOT NULL DEFAULT 'open' COMMENT 'open / roster',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_collection_token (public_token_hash),
  INDEX ix_collection_deadline (deadline),
  CHECK (requirements_version > 0),
  CHECK (max_file_bytes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='收集任务';

-- 收集工作流 / 收集闭环 / C03 新增名单；现有 participantKey / submitterUserId 可迁移
-- 按稳定身份汇总进度，匿名按独立凭据绑定
CREATE TABLE `kq_collection_participants` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '参与身份 ID',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `principal_key` VARCHAR(200) NOT NULL COMMENT '账号 ID 或游客稳定摘要，不使用姓名去重',
  `business_key` VARCHAR(120) NULL COMMENT '名单业务编号，空代表开放收集的非名单项',
  `user_id` VARCHAR(120) NULL COMMENT '登录参与者',
  `display_name` VARCHAR(160) NOT NULL COMMENT '姓名或展示名',
  `contact_ciphertext` TEXT NULL COMMENT '用于提醒的联系方式密文',
  `entry_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '个人入口凭据摘要',
  `assignee_json` JSON NULL COMMENT '外部角色供材分工，仅存受控的材料 key 与身份范围',
  `requirements_snapshot_json` JSON NULL COMMENT '按本人答案计算后的本轮要求，可重算核对',
  `completion_state` VARCHAR(30) NOT NULL DEFAULT 'not_submitted' COMMENT 'not_submitted / incomplete / pending_review / returned / approved 缓存',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '防并发覆盖',
  `created_at` DATETIME(3) NOT NULL COMMENT '加入任务时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '最近变化',
  UNIQUE KEY uq_participant_principal (task_id, principal_key),
  UNIQUE KEY uq_participant_business (task_id, business_key),
  UNIQUE KEY uq_participant_task (id, task_id),
  UNIQUE KEY uq_participant_entry (entry_token_hash),
  INDEX ix_participant_progress (task_id, completion_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='应交名单与参与身份';

-- 收集工作流 / 收集闭环 / collections[].submissions[]；跨端草稿和轮次为扩展
-- 草稿可修改，正式提交固定轮次，退回补交新建下一轮
CREATE TABLE `kq_collection_submissions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '提交或草稿 ID',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `participant_id` VARCHAR(120) NOT NULL COMMENT '当前任务参与者',
  `round_no` INT UNSIGNED NOT NULL COMMENT '个人提交轮次',
  `status` VARCHAR(20) NOT NULL COMMENT 'draft / submitted / returned / approved / superseded',
  `answers_json` JSON NOT NULL COMMENT '本轮表单答案',
  `requirements_snapshot_json` JSON NOT NULL COMMENT '采用时的完整定义与实际适用项',
  `idempotency_key` VARCHAR(200) NOT NULL COMMENT '提交幂等键',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '双端保存 CAS 版本',
  `submitted_at` DATETIME(3) NULL COMMENT '正式提交时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  UNIQUE KEY uq_submission_round (participant_id, round_no),
  UNIQUE KEY uq_submission_retry (task_id, participant_id, idempotency_key),
  UNIQUE KEY uq_submission_task (id, task_id),
  INDEX ix_submission_state (task_id, status, submitted_at),
  CHECK (round_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='个人草稿与提交轮次';

-- 收集工作流 / 收集闭环 / C02 / C04 / C05
-- 材料清单项与业务审核状态独立于文件安全扫描
CREATE TABLE `kq_submission_items` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '本轮材料项 ID',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `submission_id` VARCHAR(120) NOT NULL COMMENT '提交轮次',
  `material_key` VARCHAR(64) NOT NULL COMMENT '任务快照内材料项 key',
  `requirement_snapshot_json` JSON NOT NULL COMMENT '本项名称、必交、数量、格式、样例与条件快照',
  `completeness_state` VARCHAR(20) NOT NULL DEFAULT 'missing' COMMENT 'missing / partial / complete',
  `review_state` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending / approved / returned',
  `review_due_at` DATETIME(3) NULL COMMENT '退回补交期限',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_submission_material (submission_id, material_key),
  UNIQUE KEY uq_item_task (id, task_id),
  INDEX ix_item_review (task_id, review_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='本轮逐项材料结果';

-- 收集工作流 / 收集闭环 / collections[].submissions[].files[].materialId
-- 一个材料项可含多个固定文件版本
CREATE TABLE `kq_submission_files` (
  `item_id` VARCHAR(120) NOT NULL COMMENT '本轮材料项',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务，亦为文件 resource_id',
  `file_version_id` VARCHAR(120) NOT NULL COMMENT '不可变文件版本',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '文件顺序',
  `source_kind` VARCHAR(30) NOT NULL DEFAULT 'upload' COMMENT 'upload / handoff / library',
  PRIMARY KEY (item_id, file_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='材料项文件关联';

-- 收集工作流 / 收集闭环 / C05 拟新增业务审核日志
-- 追加式保存每次通过或退回及当时文件快照
CREATE TABLE `kq_review_actions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '验收动作 ID',
  `item_id` VARCHAR(120) NOT NULL COMMENT '本轮材料项',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `reviewer_user_id` VARCHAR(120) NOT NULL COMMENT '审核人',
  `decision` VARCHAR(20) NOT NULL COMMENT 'approved / returned',
  `reason` TEXT NULL COMMENT '退回原因，通过时可选备注',
  `reviewed_files_digest` BINARY(32) NOT NULL COMMENT '当时文件版本集合摘要',
  `due_at` DATETIME(3) NULL COMMENT '补交截止',
  `idempotency_key` VARCHAR(200) NOT NULL COMMENT '防重复审核请求',
  `created_at` DATETIME(3) NOT NULL COMMENT '动作时间',
  UNIQUE KEY uq_review_retry (item_id, idempotency_key),
  INDEX ix_review_item (item_id, created_at),
  CHECK (decision IN ('approved','returned')),
  CHECK (decision <> 'returned' OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='材料验收历史';

-- 收集工作流 / 收集闭环 / C03 / C07 拟新增
-- 先落库再发送，发送前重新核对未完成状态
CREATE TABLE `kq_reminder_jobs` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '催办任务 ID',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `participant_id` VARCHAR(120) NOT NULL COMMENT '应催对象',
  `channel` VARCHAR(30) NOT NULL COMMENT 'in_app / email / 后续已接入渠道',
  `reason` VARCHAR(40) NOT NULL COMMENT 'missing / returned / approaching_deadline',
  `payload_json` JSON NOT NULL COMMENT '文案与欠交项快照，不作为最终状态依据',
  `scheduled_at` DATETIME(3) NOT NULL COMMENT '计划发送时间',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending / sending / sent / skipped / failed',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '尝试次数',
  `lease_until` DATETIME(3) NULL COMMENT '工作进程租约',
  `dedupe_key` VARCHAR(200) NOT NULL COMMENT '规则、对象与提醒周期组成的幂等键',
  `sent_at` DATETIME(3) NULL COMMENT '已发送时间',
  `last_error` TEXT NULL COMMENT '最近错误',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_reminder_dedupe (dedupe_key),
  INDEX ix_reminder_schedule (status, scheduled_at),
  INDEX ix_reminder_person (task_id, participant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='精准催办队列';

-- 文件与交付 / 交付闭环 / metadata.distributions 已有基础
-- 逐人映射、发布与撤销的批次记录
CREATE TABLE `kq_distribution_batches` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '沿用现有分发批次 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '对应分享资源',
  `release_id` VARCHAR(120) NULL COMMENT '发布后固定交付版本',
  `owner_user_id` VARCHAR(120) NOT NULL COMMENT '发布者',
  `idempotency_key` VARCHAR(200) NOT NULL COMMENT '沿用当前请求幂等键',
  `status` VARCHAR(20) NOT NULL COMMENT 'draft / published / revoked',
  `mapping_digest` BINARY(32) NULL COMMENT '经确认配对的摘要',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `frozen_at` DATETIME(3) NULL COMMENT '映射冻结时间',
  `revoked_at` DATETIME(3) NULL COMMENT '撤销时间',
  UNIQUE KEY uq_distribution_retry (owner_user_id, idempotency_key),
  UNIQUE KEY uq_distribution_resource (id, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='批量分发批次';

-- 文件与交付 / 交付闭环 / distributions[].rows[] / files[].distributionRecipientUserId
-- 按文件版本授权给具体收件身份，支持一人多份
CREATE TABLE `kq_distribution_assignments` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '映射 ID',
  `batch_id` VARCHAR(120) NOT NULL COMMENT '批次',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '分享资源',
  `recipient_id` VARCHAR(120) NOT NULL COMMENT '此资源下的收件身份',
  `file_version_id` VARCHAR(120) NOT NULL COMMENT '具体文件版本',
  `business_key` VARCHAR(120) NOT NULL COMMENT '映射业务编号；不作为访问凭据',
  `source_snapshot_json` JSON NOT NULL COMMENT '原名单行、文件名与人工修正结果',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `revoked_at` DATETIME(3) NULL COMMENT '授权撤销时间',
  UNIQUE KEY uq_assignment_file (batch_id, recipient_id, file_version_id),
  INDEX ix_assignment_recipient (resource_id, recipient_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='逐人文件授权映射';

-- 文件与交付 / 交付闭环 / 现有下载计数；D01 / D02 增量
-- 逐事件保存，已下载与主动确认分开统计
CREATE TABLE `kq_delivery_events` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '事件 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '分享资源',
  `release_id` VARCHAR(120) NOT NULL COMMENT '事件对应的交付版本',
  `recipient_id` VARCHAR(120) NULL COMMENT '匿名访问可空；确认必须有经验证身份',
  `actor_user_id` VARCHAR(120) NULL COMMENT '已登录操作人',
  `event_type` VARCHAR(30) NOT NULL COMMENT 'access / download_started / download_completed / confirmed',
  `identity_level` VARCHAR(30) NOT NULL COMMENT 'anonymous / account / verified_external',
  `dedupe_key` VARCHAR(200) NULL COMMENT '确认重试与下载结算幂等键',
  `details_json` JSON NULL COMMENT '请求级事件资料，敏感字段按保留期脱敏',
  `created_at` DATETIME(3) NOT NULL COMMENT '事件时间',
  UNIQUE KEY uq_delivery_dedupe (dedupe_key),
  INDEX ix_delivery_timeline (resource_id, created_at),
  INDEX ix_delivery_receipt (recipient_id, release_id, event_type),
  CHECK (event_type <> 'confirmed' OR (recipient_id IS NOT NULL AND identity_level IN ('account','verified_external')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='访问、下载与主动回执';

-- 团队与扩展 / 第二期及储备 / T01 新增实体
-- 个人或团队项目归类，不自动扩大已有资源权限
CREATE TABLE `kq_projects` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '项目 ID',
  `owner_user_id` VARCHAR(120) NOT NULL COMMENT '创建或负责人',
  `organization_id` VARCHAR(120) NULL COMMENT '团队范围',
  `name` VARCHAR(160) NOT NULL COMMENT '项目名',
  `client_key` VARCHAR(120) NULL COMMENT '同团队内稳定客户编号，不使用姓名做身份',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active / archived',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  INDEX ix_project_org (organization_id, status),
  INDEX ix_project_owner (owner_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='项目分组';

-- 团队与扩展 / 第二期及储备 / T01
-- 标签在个人或团队作用域内唯一
CREATE TABLE `kq_tags` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '标签 ID',
  `scope_key` VARCHAR(160) NOT NULL COMMENT 'user:ID 或 org:ID，由服务端生成',
  `name` VARCHAR(80) NOT NULL COMMENT '标签名',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_tag_name (scope_key, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='标签';

-- 团队与扩展 / 第二期及储备 / T01
-- 同一资源可有多个标签
CREATE TABLE `kq_resource_tags` (
  `resource_id` VARCHAR(120) NOT NULL COMMENT '资源',
  `tag_id` VARCHAR(120) NOT NULL COMMENT '标签',
  `created_at` DATETIME(3) NOT NULL COMMENT '关联时间',
  PRIMARY KEY (resource_id, tag_id),
  INDEX ix_tag_resources (tag_id, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='资源标签关联';

-- 团队与扩展 / 第二期及储备 / T05 / C01 深化 / F01
-- 针对资源与材料范围授权，撤权即时生效
CREATE TABLE `kq_resource_permissions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '授权 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '业务资源',
  `principal_key` VARCHAR(200) NOT NULL COMMENT 'user:ID / participant:ID / verified_external:摘要',
  `user_id` VARCHAR(120) NULL COMMENT '内部账号授权可关联',
  `permission` VARCHAR(40) NOT NULL COMMENT 'view / submit / review / download / manage',
  `scope_json` JSON NOT NULL COMMENT 'all 或限定的材料 key；空不代表全部',
  `granted_by_user_id` VARCHAR(120) NOT NULL COMMENT '授权人',
  `expires_at` DATETIME(3) NULL COMMENT '授权有效期',
  `revoked_at` DATETIME(3) NULL COMMENT '撤权时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '授予时间',
  UNIQUE KEY uq_permission (resource_id, principal_key, permission),
  INDEX ix_permission_user (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='内部审核与外部供材授权';

-- 团队与扩展 / 第二期及储备 / T03
-- 长期 URL 路由到当前模板、项目与接收人
CREATE TABLE `kq_intake_portals` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '入口 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '团队',
  `slug` VARCHAR(100) NOT NULL COMMENT '团队内固定入口路径',
  `template_version_id` VARCHAR(120) NOT NULL COMMENT '默认模板版本',
  `project_id` VARCHAR(120) NULL COMMENT '默认项目',
  `assignee_user_id` VARCHAR(120) NOT NULL COMMENT '接收负责人',
  `routing_json` JSON NULL COMMENT '字段路由、开放方式与容量策略',
  `status` VARCHAR(20) NOT NULL COMMENT 'active / closed',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  UNIQUE KEY uq_portal_slug (organization_id, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='固定团队收件入口';

-- 团队与扩展 / 第二期及储备 / C07
-- 周期调度保存时区与每期独立任务
CREATE TABLE `kq_recurrence_rules` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '周期规则 ID',
  `owner_user_id` VARCHAR(120) NOT NULL COMMENT '负责人',
  `organization_id` VARCHAR(120) NULL COMMENT '团队',
  `template_version_id` VARCHAR(120) NOT NULL COMMENT '模板版本',
  `timezone` VARCHAR(80) NOT NULL DEFAULT 'Asia/Shanghai' COMMENT '业务时区',
  `schedule_json` JSON NOT NULL COMMENT '周/月规则、截止偏移与名单来源',
  `status` VARCHAR(20) NOT NULL COMMENT 'active / paused / retired',
  `next_run_at` DATETIME(3) NULL COMMENT '下一次 UTC 触发时间',
  `last_period_key` VARCHAR(80) NULL COMMENT '上次生成的业务周期',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  INDEX ix_recurrence_due (status, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='周期收集规则';

-- 团队与扩展 / 第二期及储备 / C08
-- 只授权指定草稿/材料项，上传后经确认合并
CREATE TABLE `kq_handoff_sessions` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '接力 ID',
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '短期接力码摘要',
  `task_id` VARCHAR(120) NOT NULL COMMENT '任务',
  `submission_id` VARCHAR(120) NOT NULL COMMENT '当前草稿',
  `item_id` VARCHAR(120) NULL COMMENT '指定材料项，可空表示草稿授权范围',
  `expected_row_version` BIGINT UNSIGNED NOT NULL COMMENT '发起时草稿 CAS 版本',
  `status` VARCHAR(30) NOT NULL COMMENT 'pending / uploaded / merged / canceled / expired',
  `staged_files_json` JSON NULL COMMENT '待确认的临时文件引用；不含永久公开地址',
  `expires_at` DATETIME(3) NOT NULL COMMENT '短有效期',
  `revoked_at` DATETIME(3) NULL COMMENT '撤销时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_handoff_token (token_hash),
  INDEX ix_handoff_expiry (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='电脑手机接力会话';

-- 团队与扩展 / 第二期及储备 / T06
-- 同一团队与客户范围内的可复用材料版本
CREATE TABLE `kq_material_library_entries` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '材料库版本 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '所属团队',
  `client_key` VARCHAR(120) NOT NULL COMMENT '团队内稳定客户标识',
  `material_key` VARCHAR(80) NOT NULL COMMENT '材料类型',
  `source_resource_id` VARCHAR(120) NOT NULL COMMENT '来源资源',
  `source_file_version_id` VARCHAR(120) NOT NULL COMMENT '来源固定版本',
  `business_valid_from` DATETIME(3) NULL COMMENT '业务生效时间',
  `business_valid_until` DATETIME(3) NULL COMMENT '业务到期时间',
  `authorized_by_user_id` VARCHAR(120) NOT NULL COMMENT '确认复用授权的人',
  `status` VARCHAR(20) NOT NULL COMMENT 'active / revoked / retired',
  `created_at` DATETIME(3) NOT NULL COMMENT '登记时间',
  INDEX ix_library_client (organization_id, client_key, material_key),
  INDEX ix_library_expiry (status, business_valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='客户材料库版本';

-- 团队与扩展 / 第二期及储备 / T06
-- 历史任务固定当时采用的材料版本
CREATE TABLE `kq_material_reuses` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '复用记录 ID',
  `library_entry_id` VARCHAR(120) NOT NULL COMMENT '所采用材料库版本',
  `task_id` VARCHAR(120) NOT NULL COMMENT '目标任务',
  `item_id` VARCHAR(120) NOT NULL COMMENT '目标材料项',
  `target_file_version_id` VARCHAR(120) NOT NULL COMMENT '复制到目标资源的独立不可变版本',
  `confirmed_by_user_id` VARCHAR(120) NOT NULL COMMENT '本次采用确认人',
  `authorization_snapshot_json` JSON NOT NULL COMMENT '团队、客户、有效期与授权确认快照',
  `created_at` DATETIME(3) NOT NULL COMMENT '采用时间',
  UNIQUE KEY uq_reuse_target (item_id, target_file_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='材料复用采用记录';

-- 团队与扩展 / 第二期及储备 / D03 深化
-- 批注始终归属具体文件版本与可见范围
CREATE TABLE `kq_file_annotations` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '批注 ID',
  `resource_id` VARCHAR(120) NOT NULL COMMENT '资源',
  `file_version_id` VARCHAR(120) NOT NULL COMMENT '不可变版本',
  `reply_to_id` VARCHAR(120) NULL COMMENT '回复目标，同一文件版本',
  `author_user_id` VARCHAR(120) NOT NULL COMMENT '作者',
  `visibility` VARCHAR(20) NOT NULL COMMENT 'internal / external',
  `anchor_json` JSON NOT NULL COMMENT 'PDF 页码与坐标、图片相对坐标等',
  `body` TEXT NOT NULL COMMENT '批注正文',
  `status` VARCHAR(20) NOT NULL COMMENT 'open / resolved',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `resolved_at` DATETIME(3) NULL COMMENT '解决时间',
  UNIQUE KEY uq_annotation_version (id, file_version_id),
  INDEX ix_annotation_file (file_version_id, visibility, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='定位批注';

-- 团队与扩展 / 第二期及储备 / C02 / C06 / C08 / F04
-- 统一可重试作业外壳；结果带输入版本与规则版本
CREATE TABLE `kq_background_jobs` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '作业 ID',
  `resource_id` VARCHAR(120) NULL COMMENT '业务资源',
  `requested_by_user_id` VARCHAR(120) NULL COMMENT '发起人',
  `job_type` VARCHAR(40) NOT NULL COMMENT 'export / precheck / ocr / scan_pdf / summary / naming / search_index',
  `input_json` JSON NOT NULL COMMENT '固定文件版本、规则与模型版本、输入摘要、外部处理许可依据',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending / running / succeeded / failed / canceled',
  `result_json` JSON NULL COMMENT '按项实际值、要求值、置信度或导出存储引用',
  `dedupe_key` VARCHAR(200) NOT NULL COMMENT '输入版本与作业规则组合幂等键',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '重试次数',
  `lease_until` DATETIME(3) NULL COMMENT '工作进程租约',
  `expires_at` DATETIME(3) NULL COMMENT '临时结果保留截止',
  `last_error` TEXT NULL COMMENT '失败原因',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间',
  UNIQUE KEY uq_job_dedupe (dedupe_key),
  INDEX ix_job_worker (status, lease_until),
  INDEX ix_job_resource (resource_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='导出、预检、扫描与 AI 作业';

-- 团队与扩展 / 第二期及储备 / F03
-- 订阅业务事件与签名密钥版本
CREATE TABLE `kq_webhook_endpoints` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '订阅 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '所属团队',
  `url` TEXT NOT NULL COMMENT '经过服务端校验的 HTTPS 接收地址',
  `events_json` JSON NOT NULL COMMENT '订阅事件类型集合',
  `signing_secret_ciphertext` TEXT NOT NULL COMMENT '签名密钥密文及密钥版本',
  `status` VARCHAR(20) NOT NULL COMMENT 'active / paused / revoked',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  `updated_at` DATETIME(3) NOT NULL COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='Webhook 订阅配置';

-- 团队与扩展 / 第二期及储备 / F03 / 周期任务 / 通知可靠性
-- 业务提交与事件写入同一 MySQL 事务，避免提交后漏通知
CREATE TABLE `kq_outbox_events` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '事件 ID',
  `organization_id` VARCHAR(120) NULL COMMENT '所属团队',
  `resource_id` VARCHAR(120) NULL COMMENT '业务资源',
  `event_type` VARCHAR(80) NOT NULL COMMENT 'submission.created / review.approved / delivery.confirmed 等',
  `aggregate_version` BIGINT UNSIGNED NOT NULL COMMENT '对象状态版本',
  `payload_json` JSON NOT NULL COMMENT '受控事件快照，不嵌入管理令牌',
  `dedupe_key` VARCHAR(200) NOT NULL COMMENT '业务操作幂等键',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending / expanded / failed',
  `created_at` DATETIME(3) NOT NULL COMMENT '事件创建时间',
  `processed_at` DATETIME(3) NULL COMMENT '已生成投递记录时间',
  UNIQUE KEY uq_outbox_dedupe (dedupe_key),
  INDEX ix_outbox_pending (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='事务事件发件箱';

-- 团队与扩展 / 第二期及储备 / F03
-- 按事件与订阅去重，保留重试与人工处理依据
CREATE TABLE `kq_webhook_deliveries` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '投递 ID',
  `event_id` VARCHAR(120) NOT NULL COMMENT '事务事件',
  `endpoint_id` VARCHAR(120) NOT NULL COMMENT '接收订阅',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending / sending / succeeded / failed / dead_letter',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '总尝试次数',
  `attempt_log_json` JSON NULL COMMENT '受大小和保留期限制的响应摘要与历史尝试',
  `next_attempt_at` DATETIME(3) NOT NULL COMMENT '下一次尝试时间',
  `lease_until` DATETIME(3) NULL COMMENT '工作进程租约',
  `last_http_status` SMALLINT UNSIGNED NULL COMMENT '最后响应码',
  `last_error` TEXT NULL COMMENT '最近错误摘要',
  `delivered_at` DATETIME(3) NULL COMMENT '成功时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_webhook_event (event_id, endpoint_id),
  INDEX ix_webhook_retry (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='Webhook 投递尝试';

-- 团队与扩展 / 第二期及储备 / F03
-- 团队作用域、资源权限与配额边界
CREATE TABLE `kq_api_credentials` (
  `id` VARCHAR(120) NOT NULL PRIMARY KEY COMMENT '凭据 ID',
  `organization_id` VARCHAR(120) NOT NULL COMMENT '团队',
  `created_by_user_id` VARCHAR(120) NOT NULL COMMENT '创建人',
  `name` VARCHAR(120) NOT NULL COMMENT '凭据名称',
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '高熵令牌摘要，原值仅首次展示',
  `scopes_json` JSON NOT NULL COMMENT '允许的操作和项目/资源范围',
  `expires_at` DATETIME(3) NULL COMMENT '到期时间',
  `revoked_at` DATETIME(3) NULL COMMENT '撤销时间',
  `last_used_at` DATETIME(3) NULL COMMENT '最近调用时间',
  `created_at` DATETIME(3) NOT NULL COMMENT '创建时间',
  UNIQUE KEY uq_api_token (token_hash),
  INDEX ix_api_org (organization_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='开放 API 凭据';

-- 外键默认 RESTRICT：删除字节和业务资源前须通过生命周期服务显式处理
ALTER TABLE `kq_organizations` ADD CONSTRAINT `fk_kq_001` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_organization_members` ADD CONSTRAINT `fk_kq_002` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_organization_members` ADD CONSTRAINT `fk_kq_003` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_ownership_handovers` ADD CONSTRAINT `fk_kq_004` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_ownership_handovers` ADD CONSTRAINT `fk_kq_005` FOREIGN KEY (`from_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_ownership_handovers` ADD CONSTRAINT `fk_kq_006` FOREIGN KEY (`to_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_ownership_handovers` ADD CONSTRAINT `fk_kq_007` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_auth_sessions` ADD CONSTRAINT `fk_kq_008` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_upgrade_orders` ADD CONSTRAINT `fk_kq_009` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_upgrade_orders` ADD CONSTRAINT `fk_kq_010` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_messages` ADD CONSTRAINT `fk_kq_011` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_settings` ADD CONSTRAINT `fk_kq_012` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_account_records` ADD CONSTRAINT `fk_kq_013` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_account_records` ADD CONSTRAINT `fk_kq_014` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resources` ADD CONSTRAINT `fk_kq_015` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resources` ADD CONSTRAINT `fk_kq_016` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resources` ADD CONSTRAINT `fk_kq_017` FOREIGN KEY (`branding_organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resources` ADD CONSTRAINT `fk_kq_018` FOREIGN KEY (`project_id`) REFERENCES `kq_projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resources` ADD CONSTRAINT `fk_kq_019` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_files` ADD CONSTRAINT `fk_kq_020` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_file_versions` ADD CONSTRAINT `fk_kq_021` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_share_links` ADD CONSTRAINT `fk_kq_022` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_releases` ADD CONSTRAINT `fk_kq_023` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_releases` ADD CONSTRAINT `fk_kq_024` FOREIGN KEY (`created_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_recipients` ADD CONSTRAINT `fk_kq_025` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_recipients` ADD CONSTRAINT `fk_kq_026` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_templates` ADD CONSTRAINT `fk_kq_027` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_templates` ADD CONSTRAINT `fk_kq_028` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_tasks` ADD CONSTRAINT `fk_kq_029` FOREIGN KEY (`id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_tasks` ADD CONSTRAINT `fk_kq_030` FOREIGN KEY (`template_version_id`) REFERENCES `kq_collection_templates` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_participants` ADD CONSTRAINT `fk_kq_031` FOREIGN KEY (`task_id`) REFERENCES `kq_collection_tasks` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_participants` ADD CONSTRAINT `fk_kq_032` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_review_actions` ADD CONSTRAINT `fk_kq_033` FOREIGN KEY (`reviewer_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_batches` ADD CONSTRAINT `fk_kq_034` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_batches` ADD CONSTRAINT `fk_kq_035` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_events` ADD CONSTRAINT `fk_kq_036` FOREIGN KEY (`actor_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_projects` ADD CONSTRAINT `fk_kq_037` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_projects` ADD CONSTRAINT `fk_kq_038` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resource_tags` ADD CONSTRAINT `fk_kq_039` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resource_tags` ADD CONSTRAINT `fk_kq_040` FOREIGN KEY (`tag_id`) REFERENCES `kq_tags` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resource_permissions` ADD CONSTRAINT `fk_kq_041` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resource_permissions` ADD CONSTRAINT `fk_kq_042` FOREIGN KEY (`user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_resource_permissions` ADD CONSTRAINT `fk_kq_043` FOREIGN KEY (`granted_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_intake_portals` ADD CONSTRAINT `fk_kq_044` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_intake_portals` ADD CONSTRAINT `fk_kq_045` FOREIGN KEY (`template_version_id`) REFERENCES `kq_collection_templates` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_intake_portals` ADD CONSTRAINT `fk_kq_046` FOREIGN KEY (`project_id`) REFERENCES `kq_projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_intake_portals` ADD CONSTRAINT `fk_kq_047` FOREIGN KEY (`assignee_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_recurrence_rules` ADD CONSTRAINT `fk_kq_048` FOREIGN KEY (`owner_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_recurrence_rules` ADD CONSTRAINT `fk_kq_049` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_recurrence_rules` ADD CONSTRAINT `fk_kq_050` FOREIGN KEY (`template_version_id`) REFERENCES `kq_collection_templates` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_library_entries` ADD CONSTRAINT `fk_kq_051` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_library_entries` ADD CONSTRAINT `fk_kq_052` FOREIGN KEY (`authorized_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_reuses` ADD CONSTRAINT `fk_kq_053` FOREIGN KEY (`library_entry_id`) REFERENCES `kq_material_library_entries` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_reuses` ADD CONSTRAINT `fk_kq_054` FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_file_annotations` ADD CONSTRAINT `fk_kq_055` FOREIGN KEY (`author_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_background_jobs` ADD CONSTRAINT `fk_kq_056` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_background_jobs` ADD CONSTRAINT `fk_kq_057` FOREIGN KEY (`requested_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_webhook_endpoints` ADD CONSTRAINT `fk_kq_058` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_outbox_events` ADD CONSTRAINT `fk_kq_059` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_outbox_events` ADD CONSTRAINT `fk_kq_060` FOREIGN KEY (`resource_id`) REFERENCES `kq_resources` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_webhook_deliveries` ADD CONSTRAINT `fk_kq_061` FOREIGN KEY (`event_id`) REFERENCES `kq_outbox_events` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_webhook_deliveries` ADD CONSTRAINT `fk_kq_062` FOREIGN KEY (`endpoint_id`) REFERENCES `kq_webhook_endpoints` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_api_credentials` ADD CONSTRAINT `fk_kq_063` FOREIGN KEY (`organization_id`) REFERENCES `kq_organizations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_api_credentials` ADD CONSTRAINT `fk_kq_064` FOREIGN KEY (`created_by_user_id`) REFERENCES `kq_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_file_versions` ADD CONSTRAINT `fk_kq_065` FOREIGN KEY (`file_id`, `resource_id`) REFERENCES `kq_files` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_release_files` ADD CONSTRAINT `fk_kq_066` FOREIGN KEY (`release_id`, `resource_id`) REFERENCES `kq_delivery_releases` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_release_files` ADD CONSTRAINT `fk_kq_067` FOREIGN KEY (`file_version_id`, `resource_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_collection_submissions` ADD CONSTRAINT `fk_kq_068` FOREIGN KEY (`participant_id`, `task_id`) REFERENCES `kq_collection_participants` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_submission_items` ADD CONSTRAINT `fk_kq_069` FOREIGN KEY (`submission_id`, `task_id`) REFERENCES `kq_collection_submissions` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_submission_files` ADD CONSTRAINT `fk_kq_070` FOREIGN KEY (`item_id`, `task_id`) REFERENCES `kq_submission_items` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_submission_files` ADD CONSTRAINT `fk_kq_071` FOREIGN KEY (`file_version_id`, `task_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_review_actions` ADD CONSTRAINT `fk_kq_072` FOREIGN KEY (`item_id`, `task_id`) REFERENCES `kq_submission_items` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_reminder_jobs` ADD CONSTRAINT `fk_kq_073` FOREIGN KEY (`participant_id`, `task_id`) REFERENCES `kq_collection_participants` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_batches` ADD CONSTRAINT `fk_kq_074` FOREIGN KEY (`release_id`, `resource_id`) REFERENCES `kq_delivery_releases` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_assignments` ADD CONSTRAINT `fk_kq_075` FOREIGN KEY (`batch_id`, `resource_id`) REFERENCES `kq_distribution_batches` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_assignments` ADD CONSTRAINT `fk_kq_076` FOREIGN KEY (`recipient_id`, `resource_id`) REFERENCES `kq_delivery_recipients` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_distribution_assignments` ADD CONSTRAINT `fk_kq_077` FOREIGN KEY (`file_version_id`, `resource_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_events` ADD CONSTRAINT `fk_kq_078` FOREIGN KEY (`release_id`, `resource_id`) REFERENCES `kq_delivery_releases` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_delivery_events` ADD CONSTRAINT `fk_kq_079` FOREIGN KEY (`recipient_id`, `resource_id`) REFERENCES `kq_delivery_recipients` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_handoff_sessions` ADD CONSTRAINT `fk_kq_080` FOREIGN KEY (`submission_id`, `task_id`) REFERENCES `kq_collection_submissions` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_handoff_sessions` ADD CONSTRAINT `fk_kq_081` FOREIGN KEY (`item_id`, `task_id`) REFERENCES `kq_submission_items` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_library_entries` ADD CONSTRAINT `fk_kq_082` FOREIGN KEY (`source_file_version_id`, `source_resource_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_reuses` ADD CONSTRAINT `fk_kq_083` FOREIGN KEY (`item_id`, `task_id`) REFERENCES `kq_submission_items` (`id`, `task_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_material_reuses` ADD CONSTRAINT `fk_kq_084` FOREIGN KEY (`target_file_version_id`, `task_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_file_annotations` ADD CONSTRAINT `fk_kq_085` FOREIGN KEY (`file_version_id`, `resource_id`) REFERENCES `kq_file_versions` (`id`, `resource_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `kq_file_annotations` ADD CONSTRAINT `fk_kq_086` FOREIGN KEY (`reply_to_id`, `file_version_id`) REFERENCES `kq_file_annotations` (`id`, `file_version_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
