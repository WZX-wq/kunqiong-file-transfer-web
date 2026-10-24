import { normalizeAvatarData } from './avatar-validation.js'
import { httpError } from './http.js'

export const TEAM_BRAND_NAME_MAX = 80
export const TEAM_BRAND_INTRO_MAX = 160
export const TEAM_BRAND_LOGO_MAX_BYTES = 400 * 1024

export function normalizeStoredTeamBranding(value) {
  const source = value && typeof value === 'object' ? value : {}
  const text = (input, max) => typeof input === 'string' && input.isWellFormed()
    ? input.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
  return {
    enabled: source.enabled === true,
    name: text(source.name, TEAM_BRAND_NAME_MAX),
    introduction: text(source.introduction, TEAM_BRAND_INTRO_MAX),
    logo: typeof source.logo === 'string' && source.logo.length <= 600000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(source.logo) ? source.logo : '',
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    updatedAt: typeof source.updatedAt === 'string' && Number.isFinite(Date.parse(source.updatedAt)) ? source.updatedAt : null,
  }
}

export function teamBrandConfiguration(organization) {
  const brand = normalizeStoredTeamBranding(organization.branding)
  return {
    enabled: brand.enabled, name: brand.name || organization.name,
    introduction: brand.introduction, revision: brand.revision, updatedAt: brand.updatedAt,
    logoUrl: brand.logo ? `/api/organizations/${encodeURIComponent(organization.slug)}/brand-logo?v=${brand.revision}` : '',
  }
}

export function publicTeamBrand(organization) {
  if (!organization?.branding?.enabled) return null
  const { name, introduction, logoUrl } = teamBrandConfiguration(organization)
  return { name, introduction, logoUrl }
}

export async function normalizeTeamBrandLogo(value) {
  if (value === '' || value === null) return ''
  if (typeof value !== 'string' || value.length > 600000) throw httpError(400, 'Logo 过大，请选择 400 KB 以内的图片')
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value)
  if (!match) throw httpError(400, 'Logo 仅支持静态 PNG、JPEG 或 WebP 图片')
  if (Buffer.from(match[2], 'base64').length > TEAM_BRAND_LOGO_MAX_BYTES) throw httpError(400, 'Logo 不能超过 400 KB')
  try { return await normalizeAvatarData(value) }
  catch (error) {
    if (error.status === 400) throw httpError(400, error.message.replaceAll('头像', 'Logo'))
    throw error
  }
}
