import React from 'react'
import { AlertCircle, Check, Minus } from 'lucide-react'
import { buildCollectionMaterialMatrix } from '../lib/collection-manage.js'

export function CollectionMaterialMatrix({ materials = [], submissions = [], className = '', title = '按提交人汇总材料' }) {
  const matrix = buildCollectionMaterialMatrix(materials, submissions)
  if (!matrix.materials.length || !matrix.groups.length) return null
  return (
    <section className={`collection-material-matrix ${className}`.trim()} aria-label={title}>
      <div className="collection-material-matrix-heading">
        <div>
          <strong>{title}</strong>
          <small>{matrix.participantCount} 位提交人 · {matrix.requiredCount} 项必交 · {matrix.completeCount} 位已交齐</small>
        </div>
        {matrix.incompleteCount > 0
          ? <span className="collection-matrix-summary missing"><AlertCircle size={13} /> {matrix.incompleteCount} 位还缺材料</span>
          : <span className="collection-matrix-summary complete"><Check size={13} /> 必交材料已全部交齐</span>}
      </div>
      <div className="collection-matrix-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">提交人</th>
              {matrix.materials.map((material) => <th key={material.id} scope="col" title={material.name}>
                <span>{material.name}</span>
                {material.required ? <em>必交</em> : <small>选交</small>}
              </th>)}
              <th scope="col">状态</th>
            </tr>
          </thead>
          <tbody>
            {matrix.groups.map((group) => <tr key={group.key}>
              <th scope="row">
                <span className="collection-matrix-person" title={group.displayName}>{group.displayName}</span>
                <small>{group.submissionCount} 份提交 · {group.fileCount} 个文件</small>
              </th>
              {group.cells.map((cell) => <td key={cell.material.id}>
                {cell.status === 'submitted'
                  ? <span className="collection-matrix-cell submitted" title={`已交：${cell.material.name}`}><Check size={14} /></span>
                  : cell.status === 'missing'
                    ? <span className="collection-matrix-cell missing" title={`缺少必交：${cell.material.name}`}><AlertCircle size={14} /></span>
                    : <span className="collection-matrix-cell optional" title={`选交未交：${cell.material.name}`}><Minus size={13} /></span>}
              </td>)}
              <td>
                {group.complete
                  ? <span className="collection-matrix-status complete"><Check size={12} /> 已交齐</span>
                  : <span className="collection-matrix-status missing"><AlertCircle size={12} /> 缺 {group.missingCount} 项</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="collection-matrix-legend">按提交人跨多次提交汇总；同名匿名提交会合并显示。勾选表示该项材料已在本任务中提交过。</p>
    </section>
  )
}
