// upgrade 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，server.mjs 中的调用点顺序不可调整。
import {
  MAX_UPGRADE_ORDERS
} from '../config.js'

import {
  createToken
} from '../lib/http.js'

import {
  normalizeNullablePositiveInteger, normalizePaymentPayload,
  normalizePlanId, normalizeWebMemberPayType, trimRecordString
} from '../lib/metadata-normalizers.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountEffectivePlanForUser, accountPlanRank, accountUserById, accountWorkspacePayload,
  acquireUpgradeLock, createWebMemberPaymentOrder, ensurePaymentAssets, findUpgradeOrder,
  paymentAmountCents, publicPaymentPayload, reconcileUpgradeOrder, reconcileUserUpgradeOrders,
  remoteUpgradePricing, requireAuthSession, resolveWebMemberPackage,
  retainPaymentQueryCredential, upgradeOrderSummary, upgradeOrdersForUser
} from '../services/account.js'
export function registerUpgradeRoutes(app) {
  app.get('/api/account/upgrade-orders', async (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    await reconcileUserUpgradeOrders(session)
    res.json({ orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
  })
  app.get('/api/account/upgrade-pricing', async (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    try {
      const pricing = await remoteUpgradePricing(session)
      res.json({ source: 'remote', pricing })
    } catch {
      res.status(502).json({ message: '套餐价格加载失败，请稍后重试' })
    }
  })
  app.post('/api/account/upgrade-orders', async (req, res) => {
    let release
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      release = await acquireUpgradeLock(`create:${session.user.id}`)
      await reconcileUserUpgradeOrders(session, true)
      const stored = accountUserById(session.user.id) || session.user
      const effective = accountEffectivePlanForUser(stored)
      const planId = normalizePlanId(req.body?.planId)
      if (planId === 'free') return res.status(400).json({ message: '基础版为默认权益，无需订购' })
      if (planId === effective.id && effective.permanent) return res.status(409).json({ message: `当前${effective.label}永久有效，无需续费` })
      if (accountPlanRank(planId) < accountPlanRank(effective.id)) {
        return res.status(409).json({ message: `当前已享有${effective.label}权益，无需订购低等级套餐` })
      }

      const staleBefore = Date.now() - 30 * 60 * 1000
      let expiredChanged = false
      for (const item of upgradeOrdersForUser(stored.id)) {
        if (item.status === 'pending_payment' && new Date(item.createdAt).getTime() < staleBefore) {
          item.status = 'expired'
          item.paymentQueryCredential = null
          item.paymentRequiresLogin = false
          item.updatedAt = new Date().toISOString()
          expiredChanged = true
        }
      }
      if (expiredChanged) persistMetadata()
      const existing = upgradeOrdersForUser(stored.id).find((order) => order.status === 'pending_payment')
      if (existing) {
        return res.status(409).json({ message: '已有一个待支付的升级订单', order: upgradeOrderSummary(existing) })
      }

      const { package: memberPackage } = await resolveWebMemberPackage(session, planId)
      const now = new Date().toISOString()
      const order = {
        id: createToken(12),
        orderNo: `WM1${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${createToken(8).toUpperCase()}`,
        userId: stored.id,
        planId,
        status: 'pending_payment',
        amount: paymentAmountCents(memberPackage.price_yuan),
        payType: 1,
        remoteOrderNo: '',
        remotePackageId: Number(memberPackage.id) || null,
        remotePackageName: trimRecordString(memberPackage.name, 80),
        remotePackageDays: normalizeNullablePositiveInteger(memberPackage.days),
        payment: null,
        createdAt: now,
        updatedAt: now,
        paidAt: null,
      }
      metadata.upgradeOrders.unshift(order)
      // Loaded orders are already normalized. Preserve objects held by in-flight queries.
      metadata.upgradeOrders = metadata.upgradeOrders.slice(0, MAX_UPGRADE_ORDERS)
      persistMetadata()
      res.status(201).json({ order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(stored.id).slice(0, 20).map(upgradeOrderSummary) })
    } catch (error) {
      res.status(error.status || 502).json({ message: error.message || '升级套餐读取失败' })
    } finally {
      release?.()
    }
  })
  app.post('/api/account/upgrade-orders/:orderId/cancel', async (req, res) => {
    let release
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const order = findUpgradeOrder(req.params.orderId, session.user.id)
      if (!order) return res.status(404).json({ message: '升级订单不存在' })
      release = await acquireUpgradeLock(order.id)
      if (!['pending_payment', 'canceled'].includes(order.status)) return res.status(409).json({ message: '当前订单状态不可取消' })
      if (order.status !== 'canceled') {
        order.status = 'canceled'
        order.updatedAt = new Date().toISOString()
        persistMetadata()
      }
      res.json({ order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
    } catch {
      res.status(500).json({ message: '取消订单失败，请稍后重试' })
    } finally { release?.() }
  })
  app.post('/api/account/upgrade-orders/:orderId/confirm', async (req, res) => {
    let release
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const order = findUpgradeOrder(req.params.orderId, session.user.id)
      if (!order) return res.status(404).json({ message: '升级订单不存在' })
      release = await acquireUpgradeLock(order.id)
      if (order.status !== 'pending_payment') return res.status(409).json({ message: '当前订单不支持支付确认' })
      const payType = normalizeWebMemberPayType(req.body?.payType || order.payType || 1)
      const payment = order.remoteOrderNo
        ? { order_no: order.remoteOrderNo, pay_type: order.payType || payType, ...(order.payment || {}) }
        : await createWebMemberPaymentOrder(session, order, payType)
      retainPaymentQueryCredential(session, order)
      persistMetadata()
      await ensurePaymentAssets(payment)
      order.payment = normalizePaymentPayload(payment)
      order.payType = normalizeWebMemberPayType(payment.pay_type || order.payType || payType)
      persistMetadata()
      res.json({
        message: payment.pay_type === 2 ? '支付宝收银台已创建，请在当前弹窗完成支付' : '微信支付二维码已创建，请扫码支付',
        order: upgradeOrderSummary(order),
        payment: publicPaymentPayload(payment),
      })
    } catch (error) {
      res.status(error.status || 502).json({ message: error.message || '支付订单创建失败' })
    } finally {
      release?.()
    }
  })
  app.post('/api/account/upgrade-orders/:orderId/pay-status', async (req, res) => {
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const order = findUpgradeOrder(req.params.orderId, session.user.id)
      if (!order) return res.status(404).json({ message: '升级订单不存在' })
      if (!order.remoteOrderNo) return res.status(409).json({ message: '请先创建支付二维码或支付宝订单' })
      if (order.status === 'paid') {
        return res.json({ message: '支付成功', order: upgradeOrderSummary(order), workspace: accountWorkspacePayload(session.user) })
      }
      const result = await reconcileUpgradeOrder(session, order)
      if (order.status === 'paid') {
        return res.json({ message: '支付成功，会员权益已开通', order: upgradeOrderSummary(order), workspace: accountWorkspacePayload(session.user) })
      }
      order.updatedAt = new Date().toISOString()
      persistMetadata()
      res.json({ message: '还未支付', order: upgradeOrderSummary(order), paid: false })
    } catch (error) {
      res.status(error.status || 502).json({ message: error.message || '支付状态查询失败' })
    }
  })
}
