function participantKey(submission) {
  if (submission?.submitter?.id) return `user:${submission.submitter.id}`
  const name = String(submission?.participantName || '').trim()
  return name ? `name:${name}` : `submission:${submission?.id || Math.random()}`
}

export function buildCollectionMaterialMatrix(materials = [], submissions = []) {
  const activeMaterials = materials.filter((material) => material && material.id)
  if (!activeMaterials.length || !submissions.length) {
    return {
      materials: activeMaterials,
      groups: [],
      participantCount: 0,
      completeCount: 0,
      incompleteCount: 0,
      requiredCount: activeMaterials.filter((material) => material.required).length,
    }
  }
  const byKey = new Map()
  for (const submission of submissions) {
    const key = participantKey(submission)
    const current = byKey.get(key) || {
      key,
      name: String(submission?.participantName || '').trim() || '匿名提交',
      accountName: submission?.submitter?.displayName || '',
      submissionCount: 0,
      fileCount: 0,
      submittedMaterialIds: new Set(),
      lastSubmittedAt: '',
    }
    current.submissionCount += 1
    current.fileCount += (submission.files || []).length
    for (const id of submission.materialIds || []) current.submittedMaterialIds.add(id)
    if (!current.lastSubmittedAt || new Date(submission.submittedAt || 0).getTime() > new Date(current.lastSubmittedAt || 0).getTime()) {
      current.lastSubmittedAt = submission.submittedAt || ''
    }
    byKey.set(key, current)
  }

  const groups = [...byKey.values()].map((group) => {
    const cells = activeMaterials.map((material) => {
      if (group.submittedMaterialIds.has(material.id)) return { material, status: 'submitted' }
      return { material, status: material.required ? 'missing' : 'optional' }
    })
    const missingCount = cells.filter((cell) => cell.status === 'missing').length
    return {
      ...group,
      cells,
      missingCount,
      complete: missingCount === 0,
      displayName: group.accountName && group.accountName !== group.name ? `${group.name}（${group.accountName}）` : group.name,
    }
  }).sort((a, b) => (Number(a.complete) - Number(b.complete)) || a.displayName.localeCompare(b.displayName, 'zh-CN'))

  return {
    materials: activeMaterials,
    groups,
    participantCount: groups.length,
    completeCount: groups.filter((group) => group.complete).length,
    incompleteCount: groups.filter((group) => !group.complete).length,
    requiredCount: activeMaterials.filter((material) => material.required).length,
  }
}
