// workspace 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，server.mjs 中的调用点顺序不可调整。
import {
  createToken
} from '../lib/http.js'

import {
  normalizeEmailValue, normalizePhoneValue, trimRecordString
} from '../lib/metadata-normalizers.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountEffectivePlanForUser, accountMessagesForUser, accountOrganizationForUser,
  accountTeamUsageForOrganization, accountUserById, accountWorkspacePayload, addAccountMessage,
  authSessionFromRequest, createOrganization, currentShareStatus, displayAccountName,
  fileListSize, findAccountUserByInvitationTarget, getOrigin, isJoinRequestRateLimited,
  isOrganizationManager, joinRequestCooldownRemaining, organizationBySlug, publicFile,
  publicJoinRequestsForOrganization, publicOrganization, reconcileUserUpgradeOrders,
  recordAuditLog, recordJoinRequestAttempt, requireAuthSession, syncAccountUserSessions,
  upsertAccountUser, validateShareRecipient
} from '../services/account.js'
export function registerWorkspaceRoutes(app) {
  app.get('/api/account/workspace', async (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    await reconcileUserUpgradeOrders(session)
    res.json(accountWorkspacePayload(session.user))
  })
  app.get('/api/account/team/overview', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '你尚未加入团队空间' })
    // 待审批的入团申请（status='requested'）不是成员，不计入成员观察/成员列表，也不应参与团队资源归属判定。
    const rosterMembers = organization.members.filter((member) => member.status !== 'requested')
    const memberIds = new Set(rosterMembers.map((member) => member.userId).filter(Boolean))
    const memberUsage = rosterMembers.map((member) => {
      const shares = metadata.shares.filter((item) => item.teamResource && item.teamOrganizationId === organization.id && item.ownerUserId === member.userId)
      const shareBytes = shares.reduce((sum, item) => sum + fileListSize(item.files), 0)
      return {
        id: member.id,
        userId: member.userId,
        displayName: member.displayName,
        email: member.email,
        phone: member.phone,
        role: member.role,
        status: member.status,
        shareCount: shares.length,
        collectionCount: 0,
        fileCount: shares.reduce((sum, item) => sum + (item.files?.length || 0), 0),
        usedBytes: shareBytes,
        lastActivityAt: shares.map((item) => item.updatedAt || item.createdAt).filter(Boolean).sort().pop() || null,
      }
    })
    // 团队概览的资源列表：manageToken 是 bearer 管理凭证（可改密/关闭分享，且管理接口
    // 不校验登录身份），只下发给资源所有者本人或团队所有者 —— 普通成员拿不到他人的，
    // 避免越过上传者编辑他人资源（回归见 _verify_team_token_leak.mjs）。
    const canManageTeam = isOrganizationManager(organization, session.user.id)
    const resources = [
      ...metadata.shares.filter((item) => item.teamResource && item.teamOrganizationId === organization.id && memberIds.has(item.ownerUserId) && (canManageTeam || validateShareRecipient(item, session.user).ok)).map((item) => ({
        id: item.id,
        kind: 'share',
        name: item.files?.[0]?.name || '文件分享',
        files: item.files.map(publicFile),
        ownerUserId: item.ownerUserId,
        status: currentShareStatus(item),
        closeReason: item.closeReason || null,
        fileCount: item.files?.length || 0,
        totalSize: fileListSize(item.files),
        downloadCount: item.downloadCount || 0,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt || null,
        ...(item.ownerUserId === session.user.id || canManageTeam ? {
          manageToken: item.manageToken,
          manageUrl: `${getOrigin(req)}/share/manage/${item.manageToken}`,
        } : {}),
      })),
    ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    res.json({
      organization: publicOrganization(organization, session.user.id),
      canManage: canManageTeam,
      plan: accountEffectivePlanForUser(organization.ownerUserId),
      capacity: accountTeamUsageForOrganization(organization),
      memberUsage,
      joinRequests: isOrganizationManager(organization, session.user.id) ? publicJoinRequestsForOrganization(organization) : [],
      resources: resources.slice(0, 200),
    })
  })
  app.get('/api/account/workspace/member-search', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization || !isOrganizationManager(organization, session.user.id)) {
      return res.status(403).json({ message: '只有团队所有者可以检索可邀请成员' })
    }
    const query = trimRecordString(req.query.q, 160).toLowerCase()
    if (!query) return res.json({ users: [] })
    const existingIds = new Set(organization.members.map((member) => String(member.userId || '')))
    const users = Object.values(metadata.users || {})
      .filter((user) => !existingIds.has(String(user.id)))
      .filter((user) => [user.id, user.username, user.nickname, user.email, user.phone].some((value) => String(value || '').toLowerCase().includes(query)))
      .slice(0, 8)
      .map((user) => ({
        id: user.id,
        username: user.username || '',
        nickname: user.nickname || '',
        email: user.email || '',
        phone: user.phone || '',
        displayName: displayAccountName(user),
      }))
    res.json({ users })
  })
  app.post('/api/account/workspace', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '团队空间需要团队版或企业版权益' })
    if (accountOrganizationForUser(session.user.id)) return res.status(409).json({ message: '你已经加入一个团队空间' })
    const name = trimRecordString(req.body?.name, 80)
    if (!name) return res.status(400).json({ message: '请填写团队名称' })
    const organization = createOrganization(session.user, name)
    persistMetadata()
    res.status(201).json(accountWorkspacePayload(session.user))
  })
  app.patch('/api/account/workspace', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
    if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以修改团队空间' })
    const name = trimRecordString(req.body?.name, 80)
    if (!name) return res.status(400).json({ message: '请填写团队名称' })
    organization.name = name
    organization.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json(accountWorkspacePayload(session.user))
  })
  app.post('/api/account/workspace/members', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '成员管理需要团队版或企业版权益' })
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '请先创建团队空间' })
    if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以管理成员' })
    const rawTarget = trimRecordString(req.body?.target, 160)
    const userId = trimRecordString(req.body?.userId, 120)
    const matchedUser = userId ? accountUserById(userId) : findAccountUserByInvitationTarget(rawTarget)
    if (!rawTarget && !userId) return res.status(400).json({ message: '请输入成员邮箱、手机号或登录账号' })
    if (!matchedUser) return res.status(404).json({ message: '未找到对应的鲲穹账号，请确认邮箱、手机号或登录账号正确' })
    if (matchedUser.id === session.user.id) return res.status(409).json({ message: '不能邀请自己加入团队空间' })
    const existingOrganization = accountOrganizationForUser(matchedUser.id)
    if (existingOrganization && existingOrganization.id !== organization.id) return res.status(409).json({ message: '该账号已经加入其他团队空间' })
    if (organization.members.some((member) => member.userId === matchedUser.id || (member.email && matchedUser.email && member.email === matchedUser.email) || (member.phone && matchedUser.phone && member.phone === matchedUser.phone))) {
      return res.status(409).json({ message: '该成员已在团队空间中' })
    }
    const invitationId = createToken(16)
    const member = {
      id: createToken(12),
      userId: matchedUser.id,
      email: normalizeEmailValue(matchedUser.email),
      phone: normalizePhoneValue(matchedUser.phone),
      displayName: displayAccountName(matchedUser),
      role: 'member',
      status: 'invited',
      invitationId,
      joinedAt: null,
      invitedAt: new Date().toISOString(),
    }
    organization.members.push(member)
    addAccountMessage(matchedUser.id, {
      category: 'other',
      eventType: 'teamInvite',
      title: '新的团队空间邀请',
      body: `${displayAccountName(session.user)}邀请你加入团队“${organization.name}”，请在消息中心选择接受或拒绝。`,
      actionType: 'workspace_invite',
      actionId: invitationId,
    })
    organization.updatedAt = new Date().toISOString()
    persistMetadata()
    res.status(201).json(accountWorkspacePayload(session.user))
  })
  app.post('/api/account/workspace/invitations/:invitationId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const decision = req.body?.decision === 'accept' ? 'accept' : req.body?.decision === 'decline' ? 'decline' : ''
    if (!decision) return res.status(400).json({ message: '邀请处理方式无效' })
    const invitationId = trimRecordString(req.params.invitationId, 120)
    const organization = Object.values(metadata.organizations || {}).find((item) => item.members.some((member) => member.invitationId === invitationId && member.userId === session.user.id))
    if (!organization) return res.status(404).json({ message: '团队邀请不存在或已处理' })
    const member = organization.members.find((item) => item.invitationId === invitationId && item.userId === session.user.id)
    if (!member || member.status !== 'invited') return res.status(409).json({ message: '该团队邀请已经处理' })

    const invitationMessages = accountMessagesForUser(session.user.id).filter((item) => item.actionId === invitationId)
    if (decision === 'decline') {
      organization.members = organization.members.filter((item) => item.invitationId !== invitationId)
      invitationMessages.forEach((item) => {
        item.actionType = 'workspace_invite_resolved'
        item.body = `你已拒绝加入团队“${organization.name}”。`
        item.unread = false
        item.readAt = new Date().toISOString()
      })
      addAccountMessage(organization.ownerUserId, {
        category: 'other',
        eventType: 'teamInvite',
        title: '团队邀请已拒绝',
        body: `${displayAccountName(session.user)}拒绝了加入团队“${organization.name}”的邀请。`,
      })
    } else {
      const currentOrganization = accountOrganizationForUser(session.user.id)
      if (currentOrganization && currentOrganization.id !== organization.id) return res.status(409).json({ message: '你已经加入其他团队空间' })
      member.status = 'active'
      member.joinedAt = new Date().toISOString()
      const account = accountUserById(session.user.id) || session.user
      account.organizationId = organization.id
      account.organizationRole = 'member'
      account.updatedAt = new Date().toISOString()
      upsertAccountUser(account)
      syncAccountUserSessions(account)
      invitationMessages.forEach((item) => {
        item.actionType = 'workspace_invite_resolved'
        item.body = `你已加入团队“${organization.name}”。`
        item.unread = false
        item.readAt = new Date().toISOString()
      })
      addAccountMessage(organization.ownerUserId, {
        category: 'other',
        eventType: 'teamInvite',
        title: '成员已加入团队',
        body: `${displayAccountName(session.user)}已接受邀请并加入团队“${organization.name}”。`,
      })
    }
    organization.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ workspace: accountWorkspacePayload(session.user), messages: accountMessagesForUser(session.user.id) })
  })
  app.delete('/api/account/workspace/members/:memberId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '成员管理需要团队版或企业版权益' })
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
    if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以管理成员' })
    const index = organization.members.findIndex((member) => member.id === req.params.memberId)
    if (index < 0) return res.status(404).json({ message: '团队成员不存在' })
    // 先校验再修改：所有者保护必须发生在 splice 之前，否则 400 返回后内存里
    // 成员已被移除，会被后续任意请求的 persistMetadata 落盘，造成团队数据损坏。
    if (organization.members[index].userId === organization.ownerUserId) return res.status(400).json({ message: '团队所有者不能移除' })
    const [removedMember] = organization.members.splice(index, 1)
    const operator = accountUserById(session.user.id) || session.user
    const operatorName = displayAccountName(operator)
    const removedUser = accountUserById(removedMember.userId)
    const notifiedInApp = Boolean(addAccountMessage(removedMember.userId, {
      category: 'other',
      eventType: 'teamRemoved',
      title: '你已被移出团队空间',
      body: `${operatorName}已将你移出团队“${organization.name}”，团队内的共享文件将不再对你展示。如需重新加入，请联系团队所有者重新邀请。`,
    }))
    if (removedUser) {
      removedUser.organizationId = ''
      removedUser.organizationRole = ''
      removedUser.updatedAt = new Date().toISOString()
      upsertAccountUser(removedUser)
      syncAccountUserSessions(removedUser)
    }
    organization.updatedAt = new Date().toISOString()
    persistMetadata()
    recordAuditLog({ type: 'team', action: '移除团队成员', userId: session.user.id, targetId: removedMember.userId, details: { organizationId: organization.id, notifiedInApp } })
    res.json({ ...accountWorkspacePayload(session.user), removedMemberId: removedMember.id, notifiedInApp })
  })
  app.post('/api/account/workspace/leave', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '你当前不在任何团队空间中' })
    if (organization.ownerUserId === session.user.id) {
      return res.status(400).json({ message: '团队所有者不能退出团队空间，请先转让或解散团队' })
    }
    const index = organization.members.findIndex((member) => member.userId === session.user.id && member.status !== 'invited')
    if (index < 0) return res.status(404).json({ message: '你在该团队空间中没有有效的成员记录' })
    const [leftMember] = organization.members.splice(index, 1)
    // 清掉账号上的团队归属，个人套餐与个人空间不受影响（个人套餐从来只取决于 user.planId）。
    const account = accountUserById(session.user.id) || session.user
    account.organizationId = ''
    account.organizationRole = ''
    account.updatedAt = new Date().toISOString()
    upsertAccountUser(account)
    syncAccountUserSessions(account)
    organization.updatedAt = new Date().toISOString()
    persistMetadata()

    const leaverName = displayAccountName(account)
    const notifiedInApp = Boolean(addAccountMessage(organization.ownerUserId, {
      category: 'other',
      eventType: 'teamMemberLeft',
      title: '有成员退出了团队空间',
      body: `${leaverName}已退出团队“${organization.name}”，其团队文件访问权限已收回。`,
    }))
    recordAuditLog({
      type: 'team',
      action: '退出团队空间',
      userId: session.user.id,
      targetId: organization.id,
      details: { organizationId: organization.id, memberId: leftMember.id, notifiedInApp },
    })
    // 退出后已不再是团队上下文，工作台按"无团队"返回即可。
    res.json({ ...accountWorkspacePayload(account), leftOrganizationId: organization.id, notifiedInApp })
  })
  app.post('/api/account/workspace/transfer-ownership', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
    if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以转让团队' })
    const targetMemberId = trimRecordString(req.body?.targetMemberId, 40)
    if (!targetMemberId) return res.status(400).json({ message: '请指定要接管的成员' })
    const targetMember = organization.members.find((member) => member.id === targetMemberId)
    if (!targetMember || targetMember.status !== 'active') return res.status(400).json({ message: '只能转让给已加入团队的正式成员' })
    if (targetMember.userId === session.user.id) return res.status(400).json({ message: '你已经是团队所有者' })
    const previousOwner = accountUserById(session.user.id) || session.user
    const nextOwner = accountUserById(targetMember.userId)
    if (!nextOwner) return res.status(404).json({ message: '接管成员的账号不存在' })
    const now = new Date().toISOString()
    const previousOwnerName = displayAccountName(previousOwner)
    const nextOwnerName = displayAccountName(nextOwner)

    organization.ownerUserId = nextOwner.id
    targetMember.role = 'owner'
    targetMember.displayName = nextOwnerName
    const previousOwnerMember = organization.members.find((member) => member.userId === previousOwner.id)
    if (previousOwnerMember) previousOwnerMember.role = 'member'
    previousOwner.organizationRole = 'member'
    previousOwner.updatedAt = now
    upsertAccountUser(previousOwner)
    syncAccountUserSessions(previousOwner)
    nextOwner.organizationRole = 'owner'
    nextOwner.updatedAt = now
    upsertAccountUser(nextOwner)
    syncAccountUserSessions(nextOwner)
    organization.updatedAt = now
    persistMetadata()

    const nextOwnerCanUseTeamSpace = Boolean(accountEffectivePlanForUser(nextOwner.id).team)
    addAccountMessage(nextOwner.id, {
      category: 'other',
      eventType: 'teamOwnership',
      title: '你已成为团队所有者',
      body: `${previousOwnerName}已将团队“${organization.name}”的所有权转让给你。${nextOwnerCanUseTeamSpace ? '团队空间容量与成员管理由你的套餐权益提供。' : '注意：你当前套餐不含团队版权益，团队空间功能将停用；升级套餐或再次转让后即可恢复。'}`,
    })
    recordAuditLog({
      type: 'team',
      action: '转让团队所有权',
      userId: previousOwner.id,
      targetId: nextOwner.id,
      details: { organizationId: organization.id, nextOwnerCanUseTeamSpace },
    })
    res.json({ ...accountWorkspacePayload(previousOwner), transferred: true, nextOwnerName, nextOwnerCanUseTeamSpace })
  })
  app.post('/api/account/workspace/dissolve', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
    if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以解散团队' })
    const now = new Date().toISOString()
    const ownerName = displayAccountName(accountUserById(session.user.id) || session.user)
    const activeMembers = organization.members.filter((member) => member.status === 'active')
    let notifiedCount = 0
    for (const member of organization.members) {
      const account = accountUserById(member.userId)
      // 归属清理只动「归属就是本团队」的账号，防止脏数据误伤其他团队
      if (account && account.organizationId === organization.id) {
        account.organizationId = ''
        account.organizationRole = ''
        account.updatedAt = now
        upsertAccountUser(account)
        syncAccountUserSessions(account)
      }
      if (member.status === 'active' && member.userId !== session.user.id) {
        if (addAccountMessage(member.userId, {
          category: 'other',
          eventType: 'teamDissolved',
          title: '所在团队空间已解散',
          body: `${ownerName}已解散团队“${organization.name}”，你已自动退出。你个人的文件、空间容量与套餐权益不受任何影响。`,
        })) notifiedCount += 1
      }
    }
    delete metadata.organizations[organization.id]
    recordAuditLog({
      type: 'team',
      action: '解散团队',
      userId: session.user.id,
      targetId: organization.id,
      details: { organizationId: organization.id, organizationName: organization.name, memberCount: activeMembers.length, notifiedCount },
    })
    persistMetadata()
    const self = accountUserById(session.user.id) || session.user
    res.json({ ...accountWorkspacePayload(self), dissolvedOrganizationId: organization.id, notifiedCount })
  })
  app.get('/api/organizations/:slug/join-request', (req, res) => {
    const organization = organizationBySlug(req.params.slug)
    // 团队不存在、或团队版权益已失效时，一律按“不可申请”返回，避免把内部状态暴露给外部访客。
    if (!organization || !accountEffectivePlanForUser(organization.ownerUserId).team) {
      return res.json({ available: false, reason: 'unavailable' })
    }
    const session = authSessionFromRequest(req)
    const viewer = session?.user || null
    const payload = { available: false, organizationName: organization.name }
    if (!viewer) return res.json({ ...payload, reason: 'anonymous' })
    if (viewer.id === organization.ownerUserId) return res.json({ ...payload, reason: 'owner' })
    const currentOrganization = accountOrganizationForUser(viewer.id)
    const existing = organization.members.find((member) => member.userId === viewer.id)
    if (existing?.status === 'active') return res.json({ ...payload, reason: 'member' })
    if (currentOrganization && currentOrganization.id !== organization.id) return res.json({ ...payload, reason: 'other_team' })
    if (existing?.status === 'requested') {
      return res.json({ ...payload, available: false, reason: 'pending', requestedAt: existing.requestedAt || null })
    }
    // 冷却判定必须先于 invited：被拒绝的申请会留下 status='invited' 占位记录用于保存冷却锚点，
    // 若先判 invited 会把「刚被拒绝」误报成「收到邀请」，冷却逻辑永远不可达。
    const cooldownMs = joinRequestCooldownRemaining(organization, viewer.id)
    if (cooldownMs > 0) {
      return res.json({ ...payload, reason: 'cooldown', cooldownUntil: new Date(Date.now() + cooldownMs).toISOString() })
    }
    if (existing?.status === 'invited') return res.json({ ...payload, reason: 'invited' })
    res.json({ ...payload, available: true, reason: 'eligible' })
  })
  app.post('/api/organizations/:slug/join-request', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const organization = organizationBySlug(req.params.slug)
    if (!organization) return res.status(404).json({ message: '团队空间不存在' })
    if (!accountEffectivePlanForUser(organization.ownerUserId).team) {
      return res.status(403).json({ message: '该团队当前未开通团队版权益，暂不接收加入申请' })
    }
    const viewer = session.user
    if (viewer.id === organization.ownerUserId) return res.status(409).json({ message: '你是该团队的所有者，无需申请加入' })
    const currentOrganization = accountOrganizationForUser(viewer.id)
    if (currentOrganization) {
      return res.status(409).json({
        message: currentOrganization.id === organization.id ? '你已经是该团队成员' : `你已加入团队“${currentOrganization.name}”，请先退出后再申请`,
      })
    }
    const existing = organization.members.find((member) => member.userId === viewer.id)
    if (existing?.status === 'active') return res.status(409).json({ message: '你已经是该团队成员' })
    if (existing?.status === 'requested') return res.status(409).json({ message: '你的加入申请已提交，请等待团队所有者处理' })

    // 冷却校验同样要先于 invited 分支，理由与 GET 探测一致。
    const cooldownMs = joinRequestCooldownRemaining(organization, viewer.id)
    if (cooldownMs > 0) {
      const hours = Math.max(1, Math.ceil(cooldownMs / (60 * 60 * 1000)))
      return res.status(429).json({ message: `你的上一次申请已被拒绝，请 ${hours} 小时后再试` })
    }
    if (existing?.status === 'invited') return res.status(409).json({ message: '你已收到该团队的邀请，请先在消息中心处理邀请' })

    // 限流键用真实 socket 地址：trust proxy=true 下 XFF 可伪造，等于没有限流。
    const ip = String(req.socket?.remoteAddress || '').trim() || 'unknown'
    if (isJoinRequestRateLimited(ip, viewer.id)) {
      return res.status(429).json({ message: '申请提交过于频繁，请稍后再试' })
    }

    const joinMessage = trimRecordString(req.body?.message, 120)
    const now = new Date().toISOString()
    const requestId = createToken(16)
    const account = accountUserById(viewer.id) || viewer
    // 复用 member 记录：与「邀请」共用同一套成员表，查重、成员上限、审批流转逻辑无需重写。
    if (existing) {
      Object.assign(existing, {
        displayName: displayAccountName(account),
        email: normalizeEmailValue(account.email),
        phone: normalizePhoneValue(account.phone),
        status: 'requested',
        role: 'member',
        joinSource: 'request',
        joinRequestId: requestId,
        joinMessage,
        requestedAt: now,
        reviewedAt: null,
        invitedAt: null,
        invitationId: '',
      })
    } else {
      organization.members.push({
        id: createToken(12),
        userId: viewer.id,
        email: normalizeEmailValue(account.email),
        phone: normalizePhoneValue(account.phone),
        displayName: displayAccountName(account),
        role: 'member',
        status: 'requested',
        joinSource: 'request',
        joinRequestId: requestId,
        joinMessage,
        requestedAt: now,
        reviewedAt: null,
        joinedAt: null,
        invitedAt: null,
        invitationId: '',
      })
    }
    organization.updatedAt = now
    recordJoinRequestAttempt(ip, viewer.id)
    persistMetadata()
    addAccountMessage(organization.ownerUserId, {
      category: 'other',
      eventType: 'teamJoinRequest',
      title: '新的入团申请',
      body: `${displayAccountName(account)}申请加入团队“${organization.name}”，请前往团队空间选择同意或拒绝。`,
      actionType: 'workspace_join_request',
      actionId: requestId,
    })
    recordAuditLog({ type: 'team', action: '提交入团申请', userId: viewer.id, targetId: organization.id, details: { organizationId: organization.id, slug: organization.slug, ip } })
    res.status(201).json({ requested: true, requestId, organizationName: organization.name, requestedAt: now })
  })
  app.post('/api/account/workspace/join-requests/:requestId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const decision = req.body?.decision === 'approve' ? 'approve' : req.body?.decision === 'reject' ? 'reject' : ''
    if (!decision) return res.status(400).json({ message: '审批方式无效' })
    const organization = accountOrganizationForUser(session.user.id)
    if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
    if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以审批入团申请' })
    if (!accountEffectivePlanForUser(organization.ownerUserId).team) {
      return res.status(403).json({ message: '团队版权益已失效，请续费后再处理成员申请' })
    }
    const requestId = trimRecordString(req.params.requestId, 120)
    const member = organization.members.find((item) => item.status === 'requested' && (item.joinRequestId === requestId || item.id === requestId))
    if (!member) return res.status(404).json({ message: '该入团申请不存在或已处理' })

    const applicantUser = accountUserById(member.userId)
    const applicantName = member.displayName || (applicantUser && displayAccountName(applicantUser)) || '该账号'
    const now = new Date().toISOString()
    const resolvedMessages = accountMessagesForUser(organization.ownerUserId).filter((item) => item.actionId === member.joinRequestId || item.actionId === member.id)
    resolvedMessages.forEach((item) => {
      item.actionType = 'workspace_join_request_resolved'
      item.unread = false
      item.readAt = now
    })

    if (decision === 'reject') {
      // 拒绝时保留一条 status='invited' 的空位记录用于记录冷却时间；申请人再次申请会被覆盖。
      member.status = 'invited'
      member.role = 'member'
      member.reviewedAt = now
      member.invitedAt = null
      member.invitationId = ''
      member.requestedAt = member.requestedAt || now
      organization.updatedAt = now
      persistMetadata()
      const notifiedInApp = Boolean(addAccountMessage(member.userId, {
        category: 'other',
        eventType: 'teamJoinRejected',
        title: '入团申请未通过',
        body: `你申请加入团队“${organization.name}”的请求已被拒绝。24 小时后可再次申请。`,
      }))
      recordAuditLog({ type: 'team', action: '拒绝入团申请', userId: session.user.id, targetId: member.userId, details: { organizationId: organization.id, notifiedInApp } })
      return res.json({ ...accountWorkspacePayload(session.user), joinRequests: publicJoinRequestsForOrganization(organization), decided: 'reject', applicantName, notifiedInApp })
    }

    const currentOrganization = accountOrganizationForUser(member.userId)
    if (currentOrganization && currentOrganization.id !== organization.id) {
      return res.status(409).json({ message: `${applicantName}已加入其他团队空间，无法同意该申请` })
    }
    const matched = applicantUser ? accountUserById(applicantUser.id) : null
    if (matched) {
      matched.organizationId = organization.id
      matched.organizationRole = 'member'
      matched.updatedAt = now
      upsertAccountUser(matched)
      syncAccountUserSessions(matched)
      member.displayName = displayAccountName(matched)
      member.email = normalizeEmailValue(matched.email)
      member.phone = normalizePhoneValue(matched.phone)
    }
    member.status = 'active'
    member.role = 'member'
    member.reviewedAt = now
    member.joinedAt = now
    organization.updatedAt = now
    persistMetadata()
    const notifiedInApp = Boolean(addAccountMessage(member.userId, {
      category: 'other',
      eventType: 'teamJoinApproved',
      title: '入团申请已通过',
      body: `你已加入团队“${organization.name}”，现在可以访问团队空间内的共享文件和专属链接。`,
      actionType: 'workspace_joined',
      actionUrl: '/team',
    }))
    recordAuditLog({ type: 'team', action: '同意入团申请', userId: session.user.id, targetId: member.userId, details: { organizationId: organization.id, notifiedInApp } })
    res.json({ ...accountWorkspacePayload(session.user), joinRequests: publicJoinRequestsForOrganization(organization), decided: 'approve', applicantName, notifiedInApp })
  })
}
