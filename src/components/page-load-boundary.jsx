import { ActionButton } from './action-button.jsx'
import React from 'react'

export function PageLoading({ fullPage = false }) {
  return <div className={`page-loading${fullPage ? ' page-loading-full' : ''}`} role="status" aria-label="正在加载页面">
    <span className="loading-dot" aria-hidden="true" />
  </div>
}

export class PageLoadBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="state-block" role="alert">
      <h1>页面加载失败</h1>
      <p>请检查网络连接后重新加载页面</p>
      <ActionButton className="primary-button" onClick={() => window.location.reload()}>重新加载</ActionButton>
    </div>
  }
}
