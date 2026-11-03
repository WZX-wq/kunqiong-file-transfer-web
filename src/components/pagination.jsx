import { ActionButton } from './action-button.jsx'
import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function AdminPagination({ page, pageCount, total, pageSize, onPageChange }) {
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return <div className="admin-pagination"><span>显示 {start}-{end} / {total}</span><div><ActionButton className="secondary-button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft size={14} /> 上一页</ActionButton><ActionButton className="secondary-button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>下一页 <ChevronRight size={14} /></ActionButton></div></div>
}
