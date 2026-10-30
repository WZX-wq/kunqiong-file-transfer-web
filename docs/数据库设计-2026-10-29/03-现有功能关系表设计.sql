-- 鲲穹文件传输：已实现功能关系表目标结构
-- 状态：设计评审稿；未接入程序；不得直接用于现有生产库迁移。
-- MySQL 8.0 / InnoDB / utf8mb4；时间统一按 UTC 写入。
-- 当前程序仍以 kunqiong_app_state.payload 为业务权威数据，本文件不修改该行为。
-- 按应用层维护关系，不定义 FOREIGN KEY / ON DELETE CASCADE。

CREATE TABLE `kq_user` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统用户业务ID',
  `username` VARCHAR(160) NOT NULL COMMENT '账号名',
  `nickname` VARCHAR(80) NOT NULL COMMENT '昵称',
  `email` VARCHAR(254) DEFAULT NULL COMMENT '邮箱',
  `phone` VARCHAR(40) DEFAULT NULL COMMENT '手机号',
  `avatar_url` VARCHAR(500) DEFAULT NULL COMMENT '头像地址',
  `provider` VARCHAR(40) DEFAULT NULL COMMENT '登录来源',
  `login_methods_json` JSON DEFAULT NULL COMMENT '已绑定登录方式',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `plan_json` JSON DEFAULT NULL COMMENT '套餐与权益快照',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_legacy_id` (`legacy_id`),
  KEY `idx_user_email` (`email`),
  KEY `idx_user_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户账号';

CREATE TABLE `kq_organization` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统团队业务ID',
  `slug` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL COMMENT '团队专属路径',
  `name` VARCHAR(80) NOT NULL COMMENT '团队名称',
  `owner_user_id` BIGINT UNSIGNED NOT NULL COMMENT '负责人用户内部ID',
  `plan_json` JSON DEFAULT NULL COMMENT '团队套餐与有效期',
  `branding_json` JSON DEFAULT NULL COMMENT '团队品牌配置与修订号',
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发更新版本',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_organization_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_organization_slug` (`slug`),
  KEY `idx_organization_owner` (`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队及品牌';

CREATE TABLE `kq_organization_member` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统成员记录业务ID',
  `organization_id` BIGINT UNSIGNED NOT NULL COMMENT '团队内部ID',
  `user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '已绑定用户内部ID',
  `identity_key` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL COMMENT '账号或已规范化联系人身份键',
  `role` VARCHAR(20) NOT NULL DEFAULT 'member' COMMENT 'owner/admin/member',
  `status` VARCHAR(20) NOT NULL COMMENT 'invited/requested/active/removed',
  `contact_snapshot_json` JSON DEFAULT NULL COMMENT '邀请目标及申请信息快照',
  `invitation_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '邀请令牌摘要',
  `invitation_expires_at` DATETIME(3) DEFAULT NULL,
  `requested_at` DATETIME(3) DEFAULT NULL,
  `reviewed_at` DATETIME(3) DEFAULT NULL,
  `joined_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_member_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_member_identity` (`organization_id`, `identity_key`),
  KEY `idx_member_user_status` (`user_id`, `status`),
  KEY `idx_member_org_status_role` (`organization_id`, `status`, `role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队成员、邀请与申请';

CREATE TABLE `kq_ownership_handover` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统交接记录业务ID',
  `organization_id` BIGINT UNSIGNED NOT NULL COMMENT '团队内部ID',
  `from_user_id` BIGINT UNSIGNED NOT NULL COMMENT '原负责人用户内部ID',
  `to_user_id` BIGINT UNSIGNED NOT NULL COMMENT '接收人用户内部ID',
  `status` VARCHAR(20) NOT NULL COMMENT 'pending/accepted/declined/canceled/expired',
  `initiated_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) DEFAULT NULL,
  `resolved_at` DATETIME(3) DEFAULT NULL,
  `resolved_by_user_id` BIGINT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(240) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_handover_legacy_id` (`legacy_id`),
  KEY `idx_handover_org_status_expiry` (`organization_id`, `status`, `expires_at`),
  KEY `idx_handover_from_user` (`from_user_id`, `gmt_create`),
  KEY `idx_handover_to_user` (`to_user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队负责人交接';

CREATE TABLE `kq_auth_session` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统会话业务ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户内部ID',
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Cookie令牌摘要',
  `provider_credential_ciphertext` VARCHAR(4096) COMMENT '加密后的上游凭据封装',
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_session_token_hash` (`token_hash`),
  KEY `idx_session_user_expiry` (`user_id`, `expires_at`),
  KEY `idx_session_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话';

CREATE TABLE `kq_verification_code` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统验证记录业务ID',
  `scene` VARCHAR(40) NOT NULL COMMENT '当前支持bind场景',
  `target_type` VARCHAR(20) NOT NULL COMMENT 'email/phone',
  `target_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '带密钥的目标摘要',
  `code_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '验证码摘要',
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_verification_legacy_id` (`legacy_id`),
  KEY `idx_verification_target_scene_expiry` (`target_digest`, `scene`, `expires_at`),
  KEY `idx_verification_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邮箱与手机号验证挑战';

CREATE TABLE `kq_upgrade_order` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统订单业务ID',
  `order_no` VARCHAR(40) COLLATE utf8mb4_bin NOT NULL COMMENT '系统订单号',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '下单用户内部ID',
  `plan_id` VARCHAR(40) NOT NULL COMMENT '套餐标识',
  `status` VARCHAR(20) NOT NULL COMMENT '订单状态',
  `amount` DECIMAL(12,2) DEFAULT NULL COMMENT '订单金额',
  `pay_type` SMALLINT UNSIGNED DEFAULT NULL COMMENT '支付渠道类型',
  `remote_order_no` VARCHAR(80) DEFAULT NULL COMMENT '上游订单号',
  `entitlement_json` JSON DEFAULT NULL COMMENT '套餐权益及支付信息快照',
  `paid_at` DATETIME(3) DEFAULT NULL,
  `remote_expire_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_upgrade_order_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_upgrade_order_no` (`order_no`),
  KEY `idx_upgrade_order_user_status` (`user_id`, `status`, `gmt_create`),
  KEY `idx_upgrade_order_remote_no` (`remote_order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐升级订单';

CREATE TABLE `kq_message` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统消息业务ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '所属用户内部ID',
  `category` VARCHAR(40) NOT NULL,
  `event_type` VARCHAR(60) DEFAULT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` VARCHAR(1000) DEFAULT NULL,
  `action_type` VARCHAR(40) DEFAULT NULL,
  `action_id` VARCHAR(120) COLLATE utf8mb4_bin DEFAULT NULL,
  `action_url` VARCHAR(500) DEFAULT NULL,
  `read_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_message_user_legacy_id` (`user_id`, `legacy_id`),
  KEY `idx_message_user_read_time` (`user_id`, `read_at`, `gmt_create`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内消息';

CREATE TABLE `kq_user_setting` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户内部ID',
  `notification_json` JSON DEFAULT NULL COMMENT '站内与邮件通知偏好',
  `file_cleanup_json` JSON DEFAULT NULL COMMENT '用户文件清理设置',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_setting_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户偏好设置';

CREATE TABLE `kq_system_setting` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `setting_key` VARCHAR(100) COLLATE utf8mb4_bin NOT NULL COMMENT '配置键',
  `setting_value_json` JSON NOT NULL COMMENT '配置值',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_system_setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置';

CREATE TABLE `kq_account_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统记录业务ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '记录所属用户内部ID',
  `scope` VARCHAR(30) NOT NULL COMMENT 'my_sent/my_received/my_collections等',
  `resource_kind` VARCHAR(30) DEFAULT NULL COMMENT 'share/collection等',
  `resource_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '可选资源内部ID',
  `resource_legacy_id` VARCHAR(120) COLLATE utf8mb4_bin DEFAULT NULL COMMENT '资源删除后仍保留的原业务ID',
  `status` VARCHAR(40) DEFAULT NULL,
  `record_snapshot_json` JSON NOT NULL COMMENT '列表展示及历史链接快照',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_record_user_legacy_id` (`user_id`, `legacy_id`),
  KEY `idx_account_record_user_scope_time` (`user_id`, `scope`, `gmt_create`),
  KEY `idx_account_record_resource` (`resource_kind`, `resource_legacy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户收发记录投影';

CREATE TABLE `kq_guest_usage` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `identity_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '游客身份带密钥摘要',
  `used_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `upload_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `first_used_at` DATETIME(3) NOT NULL,
  `last_used_at` DATETIME(3) NOT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_guest_usage_identity` (`identity_digest`),
  KEY `idx_guest_usage_last_used` (`last_used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='匿名用户额度汇总';

CREATE TABLE `kq_resource` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统分享或收集任务ID',
  `resource_kind` VARCHAR(20) NOT NULL COMMENT 'share/collection',
  `owner_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '个人所有者用户内部ID',
  `organization_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '团队资源所属团队内部ID',
  `team_resource` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/closed',
  `close_reason` VARCHAR(40) DEFAULT NULL,
  `expires_at` DATETIME(3) DEFAULT NULL COMMENT '分享有效期或收集截止时间',
  `deleted_at` DATETIME(3) DEFAULT NULL COMMENT '移入回收站时间',
  `trash_expires_at` DATETIME(3) DEFAULT NULL COMMENT '回收站到期时间',
  `deleted_by_user_id` BIGINT UNSIGNED DEFAULT NULL,
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发更新版本',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_resource_legacy_id` (`legacy_id`),
  KEY `idx_resource_owner_kind_status` (`owner_user_id`, `resource_kind`, `status`, `deleted_at`),
  KEY `idx_resource_organization_trash` (`organization_id`, `deleted_at`, `trash_expires_at`),
  KEY `idx_resource_expiry` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分享与收集业务资源';

CREATE TABLE `kq_resource_file` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统文件对象业务ID；无ID时迁移生成映射',
  `resource_id` BIGINT UNSIGNED NOT NULL COMMENT '所属分享或收集任务内部ID',
  `owner_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '登录用户内部ID；匿名文件为空',
  `storage_owner_key` VARCHAR(160) COLLATE utf8mb4_bin NOT NULL COMMENT '文件隔离目录所有者键，支持guest摘要',
  `file_name` VARCHAR(240) NOT NULL COMMENT '对外显示文件名',
  `original_file_name` VARCHAR(240) DEFAULT NULL COMMENT '上传原始名称',
  `storage_key` VARCHAR(500) COLLATE utf8mb4_bin NOT NULL COMMENT '用户隔离目录下的相对存储键',
  `size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `mime_type` VARCHAR(160) DEFAULT NULL,
  `content_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '内容校验值，不作为全局唯一键',
  `scan_status` VARCHAR(30) DEFAULT NULL COMMENT '安全扫描结果',
  `scanned_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_resource_file_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_resource_file_storage_key` (`storage_key`),
  KEY `idx_resource_file_resource` (`resource_id`, `gmt_create`),
  KEY `idx_resource_file_owner` (`owner_user_id`, `gmt_create`),
  KEY `idx_resource_file_storage_owner` (`storage_owner_key`),
  KEY `idx_resource_file_sha256` (`content_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务文件元数据';

CREATE TABLE `kq_share_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `resource_id` BIGINT UNSIGNED NOT NULL COMMENT 'share类型资源内部ID',
  `share_code` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  `manage_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `password_hash` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `download_limit` INT UNSIGNED DEFAULT NULL COMMENT 'NULL代表不限次',
  `download_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `recipient_policy_json` JSON DEFAULT NULL COMMENT '收件人列表及访问策略',
  `notification_log_json` JSON DEFAULT NULL COMMENT '已有通知状态快照',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_share_config_resource` (`resource_id`),
  UNIQUE KEY `uk_share_config_code` (`share_code`),
  KEY `idx_share_config_manage_token` (`manage_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分享访问规则';

CREATE TABLE `kq_collection_task` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `resource_id` BIGINT UNSIGNED NOT NULL COMMENT 'collection类型资源内部ID',
  `public_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `manage_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `description` VARCHAR(1000) DEFAULT NULL,
  `allowed_types_json` JSON DEFAULT NULL COMMENT '允许上传的文件类型',
  `materials_json` JSON NOT NULL COMMENT '当前已实现的材料清单与命名规则',
  `custom_fields_json` JSON NOT NULL COMMENT '当前已实现的自定义字段定义',
  `max_file_size_bytes` BIGINT UNSIGNED DEFAULT NULL,
  `capacity_bytes` BIGINT UNSIGNED DEFAULT NULL,
  `branding_organization_id` BIGINT UNSIGNED DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_collection_task_resource` (`resource_id`),
  UNIQUE KEY `uk_collection_task_public_token` (`public_token_hash`),
  UNIQUE KEY `uk_collection_task_manage_token` (`manage_token_hash`),
  KEY `idx_collection_task_branding_org` (`branding_organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件收集任务规则';

CREATE TABLE `kq_collection_submission` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统提交记录业务ID',
  `resource_id` BIGINT UNSIGNED NOT NULL COMMENT '收集任务资源内部ID',
  `participant_key` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL COMMENT '匿名或登录参与者稳定标识',
  `submitter_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '提交用户内部ID',
  `participant_name` VARCHAR(120) DEFAULT NULL,
  `submitter_name` VARCHAR(120) DEFAULT NULL,
  `field_values_json` JSON DEFAULT NULL COMMENT '本次提交的自定义字段答案',
  `submitted_at` DATETIME(3) DEFAULT NULL,
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_submission_legacy_id` (`legacy_id`),
  KEY `idx_submission_resource_time` (`resource_id`, `submitted_at`),
  KEY `idx_submission_participant` (`resource_id`, `participant_key`),
  KEY `idx_submission_user` (`submitter_user_id`, `submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收集任务提交';

CREATE TABLE `kq_submission_file` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `submission_id` BIGINT UNSIGNED NOT NULL COMMENT '提交记录内部ID',
  `resource_file_id` BIGINT UNSIGNED NOT NULL COMMENT '文件元数据内部ID',
  `material_id` VARCHAR(120) COLLATE utf8mb4_bin DEFAULT NULL COMMENT '对应材料项ID',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_submission_file_pair` (`submission_id`, `resource_file_id`),
  UNIQUE KEY `uk_submission_file_resource_file` (`resource_file_id`),
  KEY `idx_submission_file_material` (`submission_id`, `material_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提交材料与文件关联';

CREATE TABLE `kq_distribution_batch` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统分发批次业务ID',
  `owner_user_id` BIGINT UNSIGNED NOT NULL COMMENT '发布人用户内部ID',
  `share_resource_id` BIGINT UNSIGNED NOT NULL COMMENT '承载分发文件的分享资源内部ID',
  `idempotency_key` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL COMMENT '发布幂等键',
  `status` VARCHAR(20) NOT NULL COMMENT 'published',
  `frozen_at` DATETIME(3) NOT NULL COMMENT '收件人与文件映射冻结时间',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_distribution_legacy_id` (`legacy_id`),
  UNIQUE KEY `uk_distribution_idempotency` (`owner_user_id`, `idempotency_key`),
  UNIQUE KEY `uk_distribution_share_resource` (`share_resource_id`),
  KEY `idx_distribution_owner_time` (`owner_user_id`, `gmt_create`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='批量定向分发批次';

CREATE TABLE `kq_distribution_assignment` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `batch_id` BIGINT UNSIGNED NOT NULL COMMENT '分发批次内部ID',
  `resource_file_id` BIGINT UNSIGNED NOT NULL COMMENT '被分发文件内部ID',
  `recipient_user_id` BIGINT UNSIGNED NOT NULL COMMENT '收件人用户内部ID',
  `recipient_snapshot` VARCHAR(160) NOT NULL COMMENT '发布时匹配到的收件人信息快照',
  `file_name_snapshot` VARCHAR(240) NOT NULL COMMENT '发布时文件名快照',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_distribution_assignment_file` (`batch_id`, `resource_file_id`),
  KEY `idx_distribution_assignment_recipient` (`recipient_user_id`, `batch_id`),
  KEY `idx_distribution_assignment_file` (`resource_file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分发文件的收件人授权映射';

CREATE TABLE `kq_audit_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `legacy_id` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL COMMENT '当前系统审计事件ID',
  `event_type` VARCHAR(40) NOT NULL COMMENT 'access/security/business等事件类型',
  `action` VARCHAR(120) NOT NULL,
  `result_status` VARCHAR(30) DEFAULT NULL,
  `duration_ms` INT UNSIGNED DEFAULT NULL,
  `user_legacy_id` VARCHAR(120) COLLATE utf8mb4_bin DEFAULT NULL COMMENT '可选用户原业务ID快照',
  `target_legacy_id` VARCHAR(160) COLLATE utf8mb4_bin DEFAULT NULL COMMENT '目标实体原业务ID',
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `details_json` JSON DEFAULT NULL COMMENT '审计详情；不得记录密码、令牌等凭据',
  `gmt_create` DATETIME(3) NOT NULL COMMENT '事件发生时间，UTC',
  `gmt_modified` DATETIME(3) NOT NULL COMMENT '追加式事件，不更新',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_audit_legacy_id` (`legacy_id`),
  KEY `idx_audit_type_time` (`event_type`, `gmt_create`),
  KEY `idx_audit_user_time` (`user_legacy_id`, `gmt_create`),
  KEY `idx_audit_target_time` (`target_legacy_id`, `gmt_create`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='结构化审计日志';
