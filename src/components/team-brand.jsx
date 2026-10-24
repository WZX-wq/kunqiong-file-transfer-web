import React, { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import '../styles/team-brand.css'

export function TeamBrand({ branding, className = '' }) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => { setImageFailed(false) }, [branding?.logoUrl])
  if (!branding) return null
  return <section className={`team-brand ${className}`} aria-label="团队品牌">
    <span className="team-brand-logo">{branding.logoUrl && !imageFailed
      ? <img src={branding.logoUrl} alt={`${branding.name} Logo`} onError={() => setImageFailed(true)} />
      : <Building2 size={26} aria-hidden="true" />}</span>
    <div className="team-brand-copy"><span>团队展示</span><strong>{branding.name}</strong>{branding.introduction && <p>{branding.introduction}</p>}</div>
  </section>
}
