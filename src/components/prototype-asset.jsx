import React from 'react'

const fileTypeAssets = {
  doc: 'ft-doc.png',
  docx: 'ft-doc.png',
  jpg: 'ft-jpg.png',
  jpeg: 'ft-jpg.png',
  png: 'ft-jpg.png',
  webp: 'ft-jpg.png',
  mp4: 'ft-mp4.png',
  mov: 'ft-mp4.png',
  pdf: 'ft-pdf.png',
  ppt: 'ft-ppt.png',
  pptx: 'ft-ppt.png',
  xls: 'ft-xls.png',
  xlsx: 'ft-xls.png',
}

const assetUrls = Object.fromEntries(
  Object.entries(fileTypeAssets).map(([extension, fileName]) => [
    extension,
    new URL(`../assets/prototype-icons/${fileName}`, import.meta.url).href,
  ]),
)

export function PrototypeFileIcon({ name, fallback: FallbackIcon, size = 24 }) {
  const extension = String(name || '').split('.').pop().toLowerCase()
  const source = assetUrls[extension]

  if (!source) return FallbackIcon ? <FallbackIcon size={size} /> : null
  return <img className="prototype-file-icon" src={source} width={size} height={size} alt="" aria-hidden="true" />
}
