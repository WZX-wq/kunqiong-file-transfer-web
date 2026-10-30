CREATE TABLE IF NOT EXISTS `kq_upload_session` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  `session_digest` CHAR(64) COLLATE utf8mb4_bin NOT NULL COMMENT '上传会话ID的HMAC摘要',
  `manifest_ciphertext` LONGTEXT COLLATE utf8mb4_bin NOT NULL COMMENT 'AES-GCM加密的会话JSON清单',
  `expires_at` DATETIME(3) NOT NULL COMMENT '会话过期时间',
  `gmt_create` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `gmt_modified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_upload_session_digest` (`session_digest`),
  KEY `idx_upload_session_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='可恢复上传会话';
