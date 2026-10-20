// 原型视觉共享层
// 与 src/components/prototype-asset.jsx 的同级素材组件配套使用。
// 只提供纯展示组件，不承载业务据；颜色、圆角、阴影 token 见 src/styles/prototype-ui.css。
import React from 'react'

export function ProtoBadge({ tone = 'neutral', dot = true, children }) {
  return <span className={'proto-badge ' + tone}>{dot && <i aria-hidden="true" />}{children}</span>
}

export function ProtoBanner({ tone = 'info', icon: Icon, children }) {
  return (
    <div className={'proto-banner ' + tone} role={tone === 'danger' ? 'alert' : 'status'}>
      {Icon && <Icon size={17} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  )
}

export function ProtoStateCard({ icon: Icon, tone = 'gray', title, detail, actions = null, children }) {
  return (
    <div className="proto-state-card">
      <div className="proto-state-body">
        {Icon && <div className={'proto-state-icon ' + tone}><Icon size={30} aria-hidden="true" /></div>}
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
        {children}
        {actions && <div className="proto-state-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ProtoStatStrip({ items = [] }) {
  return (
    <div className="proto-stat-strip">
      {items.map((item) => (item.note
        ? <div className="proto-stat-note" key={item.label}>{item.value}{item.label}</div>
        : <div key={item.label}><b>{item.value}</b><span>{item.label}</span></div>))}
    </div>
  )
}

export function ProtoMetaStrip({ items = [] }) {
  return (
    <div className="proto-meta-strip">
      {items.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}
    </div>
  )
}

export function ProtoFileCell({ name, detail, icon }) {
  return (
    <div className="proto-file-cell">
      {icon}
      <span><span className="fname">{name}</span>{detail && <small>{detail}</small>}</span>
    </div>
  )
}