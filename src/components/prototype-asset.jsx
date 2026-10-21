import React from 'react'

const prototypeAssets = import.meta.glob('../assets/prototype-icons/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
})

const fileTypeAssets = {
  doc: 'ft-doc.png',
  docx: 'ft-doc.png',
  jpg: 'ft-jpg.png',
  jpeg: 'ft-jpg.png',
  jfif: 'ft-jpg.png',
  png: 'ft-jpg.png',
  webp: 'ft-jpg.png',
  gif: 'ft-jpg.png',
  bmp: 'ft-jpg.png',
  avif: 'ft-jpg.png',
  mp4: 'ft-mp4.png',
  mov: 'ft-mp4.png',
  pdf: 'ft-pdf.png',
  ppt: 'ft-ppt.png',
  pptx: 'ft-ppt.png',
  pptm: 'ft-ppt.png',
  xls: 'ft-xls.png',
  xlsx: 'ft-xls.png',
  xlsm: 'ft-xls.png',
  csv: 'ft-xls.png',
  docm: 'ft-doc.png',
  zip: 'ico-folder.png',
  rar: 'ico-folder.png',
  '7z': 'ico-folder.png',
}

export function PrototypeAsset({ name, size = 24, width = size, height = size, className = '', alt = '', ...props }) {
  const source = prototypeAssets[`../assets/prototype-icons/${name}`]
  if (!source) return null
  return <img className={className} src={source} width={width} height={height} alt={alt} aria-hidden={alt ? undefined : 'true'} draggable={false} {...props} />
}

export function PrototypeFileIcon({ name, fallback: FallbackIcon, size = 24 }) {
  const filename = String(name || '')
  const extension = filename.split('.').pop().toLowerCase()
  const asset = fileTypeAssets[extension] || (filename ? 'ico-file.png' : '')

  if (!asset) return FallbackIcon ? <FallbackIcon size={size} /> : null
  return <PrototypeAsset className="prototype-file-icon" name={asset} size={size} />
}
