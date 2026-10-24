import { metadata, persistMetadata } from '../lib/metadata-store.js'
import { httpError } from '../lib/http.js'
import { integerInput, objectInput, textInput } from '../lib/input-validation.js'
import { normalizeStoredTeamBranding, normalizeTeamBrandLogo, teamBrandConfiguration, TEAM_BRAND_INTRO_MAX, TEAM_BRAND_NAME_MAX } from '../lib/team-branding.js'
import { accountOrganizationForUser, accountUserById, isOrganizationManager, organizationBySlug, organizationTeamPlanForOrganization, recordAuditLog, requireAuthSession } from '../services/account.js'

const attempts = new Map()
function manager(req, res) {
  const session = requireAuthSession(req, res)
  if (!session) return null
  const account = accountUserById(session.user.id)
  if (!account || ['disabled', 'banned'].includes(account.status)) throw httpError(403, '当前账号不能修改团队品牌')
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization || !isOrganizationManager(organization, session.user.id)) throw httpError(403, '只有有效团队的所有者或管理员可以设置团队品牌')
  return { organization, userId: session.user.id }
}
function expectedRevision(body, organization) {
  const revision = integerInput(body.revision, '品牌版本', 0, Number.MAX_SAFE_INTEGER, { string: false })
  if (revision !== normalizeStoredTeamBranding(organization.branding).revision) throw httpError(409, '团队品牌已被其他管理员修改，请重新加载后再保存')
  return revision
}
function limitAttempt(userId) {
  const now = Date.now()
  for (const [key, value] of attempts) if (now - value.start >= 60000) attempts.delete(key)
  const entry = attempts.get(userId) || { start: now, count: 0 }
  if (entry.count >= 12) throw httpError(429, '品牌修改过于频繁，请稍后再试')
  entry.count++
  attempts.set(userId, entry)
}

export function registerTeamBrandingRoutes(app) {
  app.get('/api/account/workspace/branding', (req, res) => {
    const current = manager(req, res)
    if (current) res.set('Cache-Control', 'no-store').json({ branding: teamBrandConfiguration(current.organization) })
  })
  app.patch('/api/account/workspace/branding', async (req, res, next) => {
    try {
      const current = manager(req, res)
      if (!current) return
      const body = objectInput(req.body, ['revision', 'name', 'introduction', 'logo'], { nonempty: true })
      const revision = expectedRevision(body, current.organization)
      const name = textInput(body.name, '对外展示名称', TEAM_BRAND_NAME_MAX)
      const introduction = textInput(body.introduction, '品牌简介', TEAM_BRAND_INTRO_MAX, { optional: true })
      limitAttempt(current.userId)
      const logo = Object.hasOwn(body, 'logo') ? await normalizeTeamBrandLogo(body.logo) : current.organization.branding?.logo || ''
      // 图片解码有 await：在写入前重新校验账号、成员、角色、组织及版本。
      const latest = manager(req, res)
      if (!latest) return
      if (latest.organization !== current.organization || metadata.organizations[current.organization.id] !== current.organization) throw httpError(409, '团队归属已变化，请重新加载')
      expectedRevision(body, current.organization)
      current.organization.branding = { enabled: true, name, introduction, logo, revision: revision + 1, updatedAt: new Date().toISOString() }
      current.organization.updatedAt = current.organization.branding.updatedAt
      persistMetadata()
      recordAuditLog({ type: 'team', action: '更新团队品牌', userId: current.userId, targetId: current.organization.id, details: { revision: revision + 1, hasLogo: Boolean(logo) } })
      res.json({ branding: teamBrandConfiguration(current.organization) })
    } catch (error) { next(error) }
  })
  app.delete('/api/account/workspace/branding', (req, res) => {
    const current = manager(req, res)
    if (!current) return
    const body = objectInput(req.body, ['revision'], { nonempty: true })
    const revision = expectedRevision(body, current.organization)
    current.organization.branding = { enabled: false, name: '', introduction: '', logo: '', revision: revision + 1, updatedAt: new Date().toISOString() }
    current.organization.updatedAt = current.organization.branding.updatedAt
    persistMetadata()
    recordAuditLog({ type: 'team', action: '恢复默认团队品牌', userId: current.userId, targetId: current.organization.id, details: { revision: revision + 1 } })
    res.json({ branding: teamBrandConfiguration(current.organization) })
  })
  // Logo 属于对外展示内容；不公开团队成员、管理凭证或原始图片元数据。
  app.get('/api/organizations/:slug/brand-logo', (req, res) => {
    const organization = organizationBySlug(req.params.slug)
    if (!organization?.branding?.enabled || !organization.branding.logo || !organizationTeamPlanForOrganization(organization).team) return res.sendStatus(404)
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'image/webp' })
      .send(Buffer.from(organization.branding.logo.slice('data:image/webp;base64,'.length), 'base64'))
  })
}
