import DOMPurify from 'dompurify'

export function sanitizeOfficeHtml(html, purifier = DOMPurify) {
  return purifier.sanitize(String(html || ''), {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'sup', 'sub', 'hr'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'id'],
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:|#)/i,
    ADD_DATA_URI_TAGS: ['img'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
  })
}
