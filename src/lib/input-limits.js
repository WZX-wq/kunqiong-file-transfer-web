// Keep team form limits aligned with server/config.js.
export const TEAM_NAME_MAX = 80
export const TEAM_QUERY_MAX = 160

// HTML maxLength uses UTF-16 units. Guard controlled values too, without
// leaving half of an emoji when a pasted value crosses the boundary.
export function limitInputText(value, maxLength) {
  return String(value).slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, '')
}
