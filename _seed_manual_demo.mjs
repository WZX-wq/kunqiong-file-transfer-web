/**
 * 为「鲲穹文件传输 Web」用户使用手册生成本地演示数据。
 *
 * 设计原则：**元数据从磁盘实际文件反推**，而不是两处各写一遍文件名 ——
 * 否则 Python 生成的文件名与这里写的 storedName 一旦不一致，
 * 预览/下载就会 410「文件已清理」，排查起来很费时间。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'

const PROJ = process.cwd()
const STORAGE = path.join(PROJ, 'storage')
const BASE = 'http://localhost:8045'
const NOW = Date.now()
const D = (days) => new Date(NOW + days * 86400000).toISOString()

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

/** 磁盘上的 storedName 形如 `01-1a2b3c4d-原名.pdf`，还原出用户看到的原始文件名。 */
const originalName = (stored) => stored.replace(/^\d+-[0-9a-f]{8}-/, '')

function scan(dir, folder) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((stored) => {
      const name = originalName(stored)
      return {
        name,
        relativePath: folder ? `${folder}/${name}` : name,
        storedName: stored,
        size: fs.statSync(path.join(dir, stored)).size,
        mimeType: mimeOf(name),
      }
    })
}

// ------------------------------------------------------------------ 用户 / 团队
const U1 = 'u_1001' // 张明远 · 企业版 · 团队所有者（主演示账号）
const U2 = 'u_1002' // 李思颖 · 基础版 · 团队成员
const U3 = 'u_1003' // 王志豪 · 会员版 · 团队成员
const ORG = 'orgkq001'

const mkUser = (id, username, nickname, email, phone, plan, orgRole, days) => ({
  id,
  username,
  nickname,
  email,
  phone,
  avatar: '',
  avatarSource: 'custom',
  providerAvatar: `https://image.kunqiongai.com/avatar/${id}.jpg`,
  provider: 'kunqiong',
  loginMethods: ['oauth'],
  planId: plan,
  planStartedAt: days ? D(-days) : null,
  planExpiresAt: plan === 'free' ? null : D(365 - days),
  organizationId: ORG,
  organizationRole: orgRole,
  status: 'active',
  fileCleanup: { enabled: false, days: 3 },
  createdAt: D(-120),
  updatedAt: D(-1),
})

const users = {
  [U1]: mkUser(U1, 'zhangmingyuan', '张明远', 'zhangmingyuan@kunqiongai.com', '13800001111', 'enterprise', 'owner', 90),
  [U2]: mkUser(U2, 'lisiying', '李思颖', 'lisiying@kunqiongai.com', '13800002222', 'free', 'member', 45),
  [U3]: mkUser(U3, 'wangzhihao', '王志豪', 'wangzhihao@kunqiongai.com', '13800003333', 'member', 'member', 30),
}

const mkMember = (id, userId, role, joinedDays) => ({
  id,
  userId,
  email: users[userId].email,
  phone: users[userId].phone,
  displayName: users[userId].nickname,
  role,
  status: 'active',
  invitationId: role === 'owner' ? '' : 'inv_' + id,
  joinRequestId: '',
  joinSource: '',
  joinMessage: '',
  requestedAt: null,
  reviewedAt: null,
  joinedAt: D(-joinedDays),
  invitedAt: role === 'owner' ? null : D(-joinedDays - 1),
})

const organizations = {
  [ORG]: {
    id: ORG,
    slug: 'kunqiong-product',
    name: '鲲穹产品中心',
    ownerUserId: U1,
    createdAt: D(-90),
    updatedAt: D(-2),
    members: [
      mkMember('mem0001', U1, 'owner', 90),
      mkMember('mem0002', U2, 'member', 45),
      mkMember('mem0003', U3, 'member', 30),
      // 一条待审批的入团申请，用于演示「入团申请」页签
      {
        id: 'mem0004',
        userId: 'u_1009',
        email: 'chenjy@kunqiongai.com',
        phone: '13800004444',
        displayName: '陈静怡',
        role: 'member',
        status: 'requested',
        invitationId: '',
        joinRequestId: 'req0001',
        joinSource: 'invite-link',
        joinMessage: '我是新入职的产品经理陈静怡，申请加入鲲穹产品中心。',
        requestedAt: D(-1),
        reviewedAt: null,
        joinedAt: null,
        invitedAt: null,
      },
    ],
  },
}

// ------------------------------------------------------------------ 分享
const SHARES = [
  {
    id: '7a1c9f30d2', folder: '', title: '2026年度产品路线图', days: 7, limit: null,
    downloads: 3, password: '', recipients: ['zhangmingyuan@kunqiongai.com'], notify: true,
    owner: U1, team: false, status: 'active', created: 1,
  },
  {
    id: 'b4e8c15a96', folder: 'Q4视觉设计稿', title: 'Q4 视觉设计稿', days: 30, limit: null,
    downloads: 12, password: '', recipients: [], notify: false,
    owner: U1, team: false, status: 'active', created: 3,
  },
  {
    id: '3f9d2b7c81', folder: '', title: '2026Q3财务对账单', days: 15, limit: null,
    downloads: 1, password: '8888', recipients: ['caiwu@kunqiongai.com'], notify: true,
    owner: U1, team: false, status: 'active', created: 2,
  },
  {
    id: 'c6a04e93b7', folder: '供应商合作协议', title: '供应商合作协议（含附件）', days: 10, limit: 5,
    downloads: 3, password: 'kq2026', recipients: ['yqq@yqidata.com'], notify: true,
    owner: U1, team: false, status: 'active', created: 5,
  },
  {
    id: '9b3c8da6f2', folder: '', title: '2026Q3经营分析', days: 3, limit: null,
    downloads: 6, password: '', recipients: ['boss@kunqiongai.com', 'ops@kunqiongai.com'], notify: true,
    owner: U1, team: false, status: 'active', created: 0,
  },
  {
    id: '0d5e71fa48', folder: '', title: '鲲穹工具箱安装包', days: 0, limit: 20,
    downloads: 20, password: '', recipients: [], notify: false,
    owner: U1, team: false, status: 'closed', created: 40, closeReason: 'expired',
  },
  {
    id: 'e2f74b19c3', folder: '品牌VI素材包', title: '品牌 VI 素材包', days: 0, limit: null,
    downloads: 27, password: '', recipients: [], notify: false,
    owner: U1, team: true, status: 'active', created: 6,
  },
  {
    id: '5c8b0e47ad', folder: '合同模板库', title: '合同模板库', days: 0, limit: null,
    downloads: 9, password: '', recipients: [], notify: false,
    owner: U3, team: true, status: 'active', created: 4,
  },
]

// 「发给我的」用：由其他成员创建、指向主账号的分享
const INCOMING = [
  {
    id: 'f1e2d3c4b5', folder: '市场物料', title: 'Q4 市场活动物料', days: 14, limit: null,
    downloads: 0, password: '', recipients: [users[U1].email], notify: true,
    owner: U2, team: false, status: 'active', created: 1, incoming: true,
    sourceFiles: ['b4e8c15a96', ['01-首页视觉稿.png', '03-设计规范.pdf']],
  },
  {
    id: 'a9b8c7d6e5', folder: '', title: '供应商资质材料', days: 5, limit: null,
    downloads: 0, password: '', recipients: [users[U1].email], notify: true,
    owner: U3, team: false, status: 'active', created: 2, incoming: true,
    sourceFiles: ['3f9d2b7c81', ['01-' + 'ecdc680e-2026Q3财务对账单.xlsx']],
  },
]

function copyIncoming(spec) {
  const [srcId, names] = spec.sourceFiles
  const srcDir = path.join(STORAGE, 'files', srcId)
  const dstDir = path.join(STORAGE, 'files', spec.id)
  fs.mkdirSync(dstDir, { recursive: true })
  const out = []
  names.forEach((stored0, i) => {
    // 允许用 `01-` 前缀 + 真实 storedName 混写
    const stored = fs.existsSync(path.join(srcDir, stored0))
      ? stored0
      : fs.readdirSync(srcDir).find((f) => f.startsWith(stored0)) || fs.readdirSync(srcDir)[i]
    const dst = `${String(i + 1).padStart(2, '0')}-${sha256(stored).slice(0, 8)}-${originalName(stored)}`
    fs.copyFileSync(path.join(srcDir, stored), path.join(dstDir, dst))
    const name = originalName(dst)
    out.push({
      name,
      relativePath: spec.folder ? `${spec.folder}/${name}` : name,
      storedName: dst,
      size: fs.statSync(path.join(dstDir, dst)).size,
      mimeType: mimeOf(name),
    })
  })
  return out
}

// ------------------------------------------------------------------ 收集任务
const COLLECTIONS = [
  {
    id: 'd1a73f60c9', manageToken: 'mt1a73f60c9supplier',
    title: '2026 Q4 供应商资质材料收集',
    description: '请各供应商于 10 月 15 日前提交最新营业执照、开户许可证与报价单，逾期视为放弃本季度合作。',
    deadline: '2026-10-15T15:59:59.999Z', allowedTypes: ['文档', '图片', '压缩包'],
    maxFileSizeMb: 200, status: 'active', created: 6, owner: U1,
    participants: ['深圳市云启数据有限公司', '北京星辰网络科技有限公司', '杭州云图信息技术有限公司'],
  },
  {
    id: '8e4b25c7f0', manageToken: 'mt8e4b25c7f0onboard',
    title: '新员工入职材料收集',
    description: '请于入职前 3 个工作日提交身份证、学历证明与体检报告，材料仅用于人事建档。',
    deadline: '2026-10-08T15:59:59.999Z', allowedTypes: ['文档', '图片'],
    maxFileSizeMb: 50, status: 'active', created: 12, owner: U1,
    participants: ['陈静怡', '刘子豪'],
  },
  {
    id: '6a9f31d8b4', manageToken: 'mt6a9f31d8b4contest',
    title: 'Q4 设计大赛作品提交',
    description: '按「智能家居 / 健康管理」两个方向提交作品图与设计说明，图片请提交 2 倍图。',
    deadline: '2026-10-31T15:59:59.999Z', allowedTypes: ['图片', '文档'],
    maxFileSizeMb: 500, status: 'active', created: 8, owner: U1,
    participants: ['设计部-王睿', '设计部-赵敏'],
  },
  {
    id: '2c7e94b0a5', manageToken: 'mt2c7e94b0a5survey',
    title: '2026 员工满意度调研材料收集',
    description: '各部门汇总满意度调研结果后统一提交，任务已结束。',
    deadline: '2026-09-10T15:59:59.999Z', allowedTypes: ['文档'],
    maxFileSizeMb: 20, status: 'closed', created: 25, owner: U1,
    participants: ['行政部-周晓'],
  },
]

// 由团队成员发起、主账号需要提交的收集任务（用于「向我收集的」）
const COLLECT_INCOMING = {
  id: 'e5f6a7b8c9', manageToken: 'mte5f6a7b8c9design',
  title: '部门周报与设计素材收集',
  description: '请每位成员每周五 18:00 前提交本周产出与素材。',
  deadline: D(6), allowedTypes: ['全部格式'], maxFileSizeMb: 100,
  status: 'active', created: 4, owner: U2, participants: ['张明远'],
}

// ------------------------------------------------------------------ 组装
function build() {
  const shares = []

  for (const s of [...SHARES, ...INCOMING]) {
    const files = s.incoming ? copyIncoming(s) : scan(path.join(STORAGE, 'files', s.id), s.folder)
    const qr = `data:image/png;base64,${''}`
    shares.push({
      id: s.id,
      manageToken: 'mt' + sha256(s.id).slice(0, 16),
      code: 'KQ' + sha256(s.id + 'code').slice(0, 4).toUpperCase(),
      files,
      createdAt: D(-s.created),
      expiresAt: s.days === 0 ? null : D(s.days - s.created),
      downloadLimit: s.limit,
      downloadCount: s.downloads,
      passwordHash: s.password ? sha256(s.password) : null,
      deliveryRecipients: s.recipients,
      notificationFlags: { email: Boolean(s.notify), sms: false },
      notificationLog: s.recipients.map((r) => ({
        recipient: r,
        status: '已发送',
        sentAt: D(-s.created),
      })),
      ownerUserId: s.owner,
      status: s.status,
      ...(s.team ? { teamResource: true, teamOrganizationId: ORG } : {}),
      ...(s.closeReason ? { closeReason: s.closeReason } : {}),
      qrDataUrl: qr,
      updatedAt: D(-s.created + 0.2),
    })
  }

  const collections = []
  for (const c of [...COLLECTIONS, COLLECT_INCOMING]) {
    const dir = path.join(STORAGE, 'collections', c.id)
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort() : []
    // 文件名前缀 `NN-` 的十位代表第几个提交者（见 make_transfer_demo_files.py）
    const groups = new Map()
    for (const stored of all) {
      const gi = Math.floor(parseInt(stored.slice(0, 2), 10) / 10)
      if (!groups.has(gi)) groups.set(gi, [])
      const name = originalName(stored)
      groups.get(gi).push({
        name,
        relativePath: name,
        storedName: stored,
        size: fs.statSync(path.join(dir, stored)).size,
        mimeType: mimeOf(name),
      })
    }
    const submissions = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([gi, files], i) => ({
        id: 'sub' + sha256(c.id + gi).slice(0, 10),
        participantName: c.participants[i] || `提交者 ${i + 1}`,
        submitterUserId: i === 0 ? U2 : '',
        submitterName: c.participants[i] || `提交者 ${i + 1}`,
        submittedAt: D(-(c.created - 1) + i * 0.3),
        files,
      }))
    collections.push({
      id: c.id,
      token: c.id,
      manageToken: c.manageToken,
      title: c.title,
      description: c.description,
      deadline: c.deadline,
      allowedTypes: c.allowedTypes,
      maxFileSizeMb: c.maxFileSizeMb,
      createdAt: D(-c.created),
      status: c.status,
      submissions,
      ownerUserId: c.owner,
      qrDataUrl: '',
      updatedAt: D(-Math.max(0, c.created - 1)),
    })
  }

  return { shares, collections }
}

// ------------------------------------------------------------------ 记录
const ago = (iso) => {
  const m = (NOW - new Date(iso).getTime()) / 60000
  if (m < 1) return '刚刚'
  if (m < 60) return `${Math.floor(m)} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  return `${Math.floor(m / 1440)} 天前`
}
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const dot = (parts) => parts.filter(Boolean).join(' · ')

function shareStatus(s) {
  if (s.status === 'closed') return '已关闭'
  return '有效'
}

function buildRecords(shares, collections) {
  const rec = {}
  const nowIso = new Date(NOW).toISOString()

  for (const uid of [U1, U2, U3]) rec[uid] = []

  for (const s of shares) {
    const total = s.files.reduce((n, f) => n + f.size, 0)
    const base = {
      kind: 'share',
      alias: '',
      code: s.code,
      status: shareStatus(s),
      shareId: s.id,
      shareUrl: `${BASE}/share/${s.id}`,
      manageToken: s.manageToken,
      manageUrl: `${BASE}/share/manage/${s.manageToken}`,
      collectionToken: '',
      expiresAt: s.expiresAt,
      deadline: null,
      downloadLimit: s.downloadLimit,
      downloadCount: s.downloadCount,
      fileCount: s.files.length,
      totalSize: total,
      submissionCount: 0,
      participantName: '',
      submittedAt: null,
      allowedTypes: [],
      maxFileSizeMb: null,
      files: s.files.map(({ name, relativePath, size, mimeType }) => ({ name, relativePath, size, mimeType })),
      submissions: [],
      createdAt: s.createdAt,
      updatedAt: nowIso,
    }
    const owner = s.ownerUserId
    // 发送方视角
    rec[owner].push({
      ...base,
      id: `my_sent:share:${s.id}`,
      scope: 'my_sent',
      type: '发送',
      name: s.files[0]?.name || s.title,
      meta: dot([
        `${s.files.length} 个文件`,
        fmtSize(total),
        s.deliveryRecipients.length ? `通知 ${s.deliveryRecipients.length} 人` : '',
        `${ago(s.createdAt)}创建`,
      ]),
      publicUrl: `${BASE}/share/${s.id}`,
    })
    // 接收方视角（其余团队成员）
    for (const other of [U1, U2, U3]) {
      if (other === owner) continue
      rec[other].push({
        ...base,
        id: `sent_to_me:share:${s.id}`,
        scope: 'sent_to_me',
        type: '收取',
        name: s.files[0]?.name || s.title,
        meta: dot([s.passwordHash ? '文件未解锁' : '待查看', `${s.files.length} 个文件`, `${ago(s.createdAt)}创建`]),
        publicUrl: `${BASE}/share/${s.id}`,
      })
    }
  }

  for (const c of collections) {
    const allFiles = c.submissions.flatMap((s) => s.files)
    const total = allFiles.reduce((n, f) => n + f.size, 0)
    const closed = c.status === 'closed'
    const base = {
      kind: 'collection',
      alias: '',
      code: '收集任务',
      status: closed ? '已结束' : '进行中',
      shareId: '',
      shareUrl: `${BASE}/collect/${c.token}`,
      manageToken: c.manageToken,
      manageUrl: `${BASE}/collect/manage/${c.manageToken}`,
      collectionToken: c.token,
      publicUrl: `${BASE}/collect/${c.token}`,
      expiresAt: null,
      deadline: c.deadline,
      downloadLimit: null,
      downloadCount: 0,
      fileCount: allFiles.length,
      totalSize: total,
      submissionCount: c.submissions.length,
      participantName: '',
      submittedAt: null,
      allowedTypes: c.allowedTypes,
      maxFileSizeMb: c.maxFileSizeMb,
      files: allFiles.map(({ name, relativePath, size, mimeType }) => ({ name, relativePath, size, mimeType })),
      createdAt: c.createdAt,
      updatedAt: nowIso,
    }
    rec[c.ownerUserId].push({
      ...base,
      id: `my_collections:collection:${c.manageToken}`,
      scope: 'my_collections',
      type: '收集',
      name: c.title,
      meta: closed ? `${c.submissions.length} 份提交 · 已结束` : `${c.submissions.length} 份提交 · 已更新`,
      submissions: c.submissions,
    })
    for (const other of [U1, U2, U3]) {
      if (other === c.ownerUserId) continue
      rec[other].push({
        ...base,
        id: `collect_from_me:collection:${c.token}`,
        scope: 'collect_from_me',
        type: '被收集',
        name: c.title,
        meta: `${ago(c.createdAt)}创建打开 · 待提交`,
        code: '提交入口',
        status: closed ? '已结束' : '可提交',
        manageToken: '',
        manageUrl: '',
        submissions: [],
      })
    }
  }
  return rec
}

async function main() {
  const { shares, collections } = build()
  const records = buildRecords(shares, collections)

  // 每个分享/收集生成真实二维码
  for (const s of shares) {
    s.qrDataUrl = await QRCode.toDataURL(`${BASE}/share/${s.id}`, { width: 240, margin: 1 })
  }
  for (const c of collections) {
    c.qrDataUrl = await QRCode.toDataURL(`${BASE}/collect/${c.token}`, { width: 240, margin: 1 })
  }

  const messages = {}
  for (const uid of [U1, U2, U3]) messages[uid] = []
  messages[U1] = [
    { id: 'msg1', type: 'collection', title: '收到新的提交', body: '「2026 Q4 供应商资质材料收集」收到 1 份新提交', read: false, createdAt: D(-0.1) },
    { id: 'msg2', type: 'team', title: '新的入团申请', body: '陈静怡 申请加入「鲲穹产品中心」', read: false, createdAt: D(-1) },
    { id: 'msg3', type: 'share', title: '文件已下载', body: '「2026Q3经营分析」被下载 1 次', read: true, createdAt: D(-1.4) },
  ]
  messages[U2] = [
    { id: 'msg4', type: 'collection', title: '新的收集任务', body: '张明远 邀请你提交「部门周报与设计素材收集」', read: false, createdAt: D(-4) },
  ]
  messages[U3] = []

  const notificationSettings = {}
  for (const uid of [U1, U2, U3]) {
    notificationSettings[uid] = {
      inApp: true, email: true, incomingShare: true, shareExpiring: true,
      shareDownloaded: uid === U1, collectionExpiring: true, collectionSubmitted: true,
    }
  }

  const metadata = {
    shares,
    collections,
    sessions: [],
    records,
    users,
    messages,
    notificationSettings,
    verificationCodes: [],
    auditLogs: [
      { id: 'ad1', type: 'auth', action: '登录', userId: U1, createdAt: D(-0.1) },
      { id: 'ad2', type: 'share', action: '创建分享', userId: U1, targetId: '9b3c8da6f2', createdAt: D(-0.05) },
      { id: 'ad3', type: 'team', action: '审批入团申请', userId: U1, targetId: 'mem0003', createdAt: D(-2) },
      { id: 'ad4', type: 'collection', action: '创建收集任务', userId: U1, targetId: 'd1a73f60c9', createdAt: D(-6) },
      { id: 'ad5', type: 'admin', action: '查看运营概览', userId: 'admin', createdAt: D(-0.2) },
    ],
    organizations,
    systemConfig: {
      maintenanceMode: false,
      defaultShareDays: 7,
      maxShareDays: 30,
      anonymousMaxFileSizeMb: 500,
      maxBatchFiles: 100,
      auditLogRetentionDays: 90,
      orphanGraceHours: 24,
      planOverrides: {},
    },
    upgradeOrders: [
      { id: 'ord5001', userId: U3, planId: 'member', amount: 29900, status: 'paid', createdAt: D(-30) },
      { id: 'ord5002', userId: U1, planId: 'enterprise', amount: 199900, status: 'paid', createdAt: D(-90) },
    ],
  }

  fs.mkdirSync(STORAGE, { recursive: true })
  fs.writeFileSync(path.join(STORAGE, 'metadata.json'), JSON.stringify(metadata, null, 1))

  console.log('=== 演示数据已写入 storage/metadata.json ===')
  console.log('用户:', Object.values(users).map((u) => `${u.id}/${u.nickname}(${u.planId})`).join(', '))
  console.log('团队:', organizations[ORG].name, '成员', organizations[ORG].members.length, '（含 1 条待审批）')
  console.log('分享:', shares.length, '| 团队资源', shares.filter((s) => s.teamResource).length,
              '| 含密码', shares.filter((s) => s.passwordHash).length,
              '| 已关闭', shares.filter((s) => s.status === 'closed').length)
  shares.forEach((s) => console.log('   ', s.id, s.status.padEnd(7), String(s.files.length) + '文件',
    s.teamResource ? '[团队]' : '     ', s.files[0]?.name))
  console.log('收集:', collections.length, '| 提交总数', collections.reduce((n, c) => n + c.submissions.length, 0))
  collections.forEach((c) => console.log('   ', c.id, c.status.padEnd(7), c.submissions.length + '份', c.title))
  console.log('记录:', Object.entries(records).map(([k, v]) => `${k}=${v.length}`).join(', '))
}

main().catch((e) => { console.error('FAILED', e); process.exit(1) })
