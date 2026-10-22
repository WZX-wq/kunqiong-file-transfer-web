import { configuredAccountPlan } from '../lib/metadata-normalizers.js'
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
import { integerInput, objectInput, textInput } from '../lib/input-validation.js'

import {
  normalizeNullablePositiveInteger, normalizePaymentPayload,
  normalizePlanId, normalizeWebMemberPayType, trimRecordString
} from '../lib/metadata-normalizers.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountUserById, accountWorkspacePayload,
  acquireUpgradeLock, canDeleteUpgradeOrder, createWebMemberPaymentOrder, ensurePaymentAssets, expirePendingUpgradeOrders, findUpgradeOrder,
  paymentAmountCents, publicPaymentPayload, reconcileUpgradeOrder, reconcileUserUpgradeOrders,
  remoteUpgradePricing, requireAuthSession, resolveWebMemberPackage,
  retainPaymentQueryCredential, upgradeOrderSummary, upgradeOrdersForUser, upgradePurchaseRestriction
} from '../services/account.js'
export function registerUpgradeRoutes(app) {
  app.get('/api/account/upgrade-orders', async (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    try {
      // Preserve the checkout's legacy response. The order centre uses explicit
      // pagination and read-only queries; payment verification remains a POST.
      if (!Object.keys(req.query).length) {
        await reconcileUserUpgradeOrders(session)
        return res.json({ orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
      }
      objectInput(req.query, ['page', 'limit', 'status', 'q'])
      const requestedPage = integerInput(req.query.page ?? '1', '页码', 1, 1000000)
      const limit = integerInput(req.query.limit ?? '10', '每页条数', 1, 50)
      const status = textInput(req.query.status ?? 'all', '订单状态', 20)
      if (!['all', 'pending_payment', 'paid', 'canceled', 'expired'].includes(status)) return res.status(400).json({ message: '订单状态不支持' })
      const query = textInput(req.query.q ?? '', '订单号', 80, { optional: true })
      if (!/^[a-z0-9_-]*$/i.test(query)) return res.status(400).json({ message: '订单号仅支持字母、数字、短横线和下划线' })
      const all = upgradeOrdersForUser(session.user.id).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(a.id).localeCompare(String(b.id)))
      expirePendingUpgradeOrders(all)
      const counts = { all: all.length, pending_payment: 0, paid: 0, canceled: 0, expired: 0 }
      for (const order of all) if (Object.hasOwn(counts, order.status)) counts[order.status]++
      const filtered = all.filter(order => (status === 'all' || order.status === status)
        && (!query || [order.orderNo, order.remoteOrderNo].some(value => String(value || '').toLowerCase().includes(query.toLowerCase()))))
      const totalPages = Math.max(1, Math.ceil(filtered.length / limit))
      const page = Math.min(requestedPage, totalPages)
      res.json({ orders: filtered.slice((page - 1) * limit, page * limit).map(orderQuerySummary), counts,
        pagination: { page, limit, total: filtered.length, totalPages } })
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status === 400 ? error.message : '订单列表加载失败，请稍后重试' })
    }
  })

  app.get('/api/account/upgrade-orders/:orderId', (req, res) => {
    const session = requireAuthSession(req, res)
    if (!session) return
    const order = findUpgradeOrder(req.params.orderId, session.user.id)
    if (!order) return res.status(404).json({ message: '升级订单不存在' })
    expirePendingUpgradeOrders([order])
    res.json({ order: orderQuerySummary(order) })
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
      const planId = normalizePlanId(req.body?.planId)
      if (configuredAccountPlan(planId).retired) return res.status(410).json({ message: '该套餐已下架，请选择其他套餐' })
      release = await acquireUpgradeLock(`create:${session.user.id}`)
      await reconcileUserUpgradeOrders(session, true)
      const stored = accountUserById(session.user.id) || session.user
      if (planId === 'free') return res.status(400).json({ message: '基础版为默认权益，无需订购' })
      const restriction = upgradePurchaseRestriction(stored, planId)
      if (restriction) return res.status(409).json({ message: restriction })

      expirePendingUpgradeOrders(upgradeOrdersForUser(stored.id))
      const existing = upgradeOrdersForUser(stored.id).find((order) => order.status === 'pending_payment')
      if (existing) {
        return res.status(409).json({ message: '已有一个待支付的升级订单', order: upgradeOrderSummary(existing) })
      }

      const { package: memberPackage } = await resolveWebMemberPackage(session, planId)
      const latestRestriction = upgradePurchaseRestriction(accountUserById(stored.id) || stored, planId)
      if (latestRestriction) return res.status(409).json({ message: latestRestriction })
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
        entitlementDays: configuredAccountPlan(planId).validityDays,
        entitlementSource: Object.hasOwn(metadata.systemConfig.planOverrides?.[planId] || {}, 'validityDays') ? 'local' : 'provider',
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
      expirePendingUpgradeOrders([order])
      if (!['pending_payment', 'canceled'].includes(order.status)) return res.status(409).json({ message: '当前订单状态不可取消', order: upgradeOrderSummary(order) })
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
  app.delete('/api/account/upgrade-orders/:orderId', async (req, res) => {
    let release
    try {
      const session = requireAuthSession(req, res)
      if (!session) return
      const order = findUpgradeOrder(req.params.orderId, session.user.id)
      if (!order) return res.status(404).json({ message: '升级订单不存在' })
      release = await acquireUpgradeLock(order.id)
      expirePendingUpgradeOrders([order])
      if (!canDeleteUpgradeOrder(order)) return res.status(409).json({ message: '当前订单不可删除', order: upgradeOrderSummary(order) })
      const index = metadata.upgradeOrders.indexOf(order)
      if (index < 0) return res.status(404).json({ message: '升级订单不存在' })
      metadata.upgradeOrders.splice(index, 1)
      persistMetadata()
      res.json({ message: '订单已删除', order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
    } catch {
      res.status(500).json({ message: '删除订单失败，请稍后重试' })
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
      expirePendingUpgradeOrders([order])
      if (order.status !== 'pending_payment') return res.status(409).json({ message: order.status === 'expired' ? '支付已超时，请重新创建订单支付' : '当前订单不支持支付确认', order: upgradeOrderSummary(order) })
      if (configuredAccountPlan(order.planId).retired) return res.status(410).json({ message: '该套餐已下架，不能继续支付；如已付款，请核对支付状态', order: upgradeOrderSummary(order) })
      const restriction = upgradePurchaseRestriction(accountUserById(session.user.id) || session.user, order.planId)
      if (restriction) return res.status(409).json({ message: restriction, order: upgradeOrderSummary(order) })
      const payType = req.body?.payType === undefined ? normalizeWebMemberPayType(order.payType || 1) : integerInput(req.body.payType,'支付方式',1,2)
      const payment = order.remoteOrderNo
        ? { order_no: order.remoteOrderNo, pay_type: order.payType || payType, ...(order.payment || {}) }
        : await createWebMemberPaymentOrder(session, order, payType)
      retainPaymentQueryCredential(session, order)
      persistMetadata()
      await ensurePaymentAssets(payment)
      order.payment = normalizePaymentPayload(payment)
      order.payType = normalizeWebMemberPayType(payment.pay_type || order.payType || payType)
      expirePendingUpgradeOrders([order])
      persistMetadata()
      if (order.status !== 'pending_payment') return res.status(409).json({ message: '支付已超时，请重新创建订单支付', order: upgradeOrderSummary(order) })
      // Membership can change while the provider creates the order or QR assets.
      const latestRestriction = upgradePurchaseRestriction(accountUserById(session.user.id) || session.user, order.planId)
      if (latestRestriction) return res.status(409).json({ message: latestRestriction, order: upgradeOrderSummary(order) })
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
      expirePendingUpgradeOrders([order])
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
      res.json({ message: order.status === 'expired' ? '支付已超时，请重新创建订单支付；如已付款，可继续核对支付状态' : '还未支付', order: upgradeOrderSummary(order), paid: false })
    } catch (error) {
      res.status(error.status || 502).json({ message: error.message || '支付状态查询失败' })
    }
  })
}

function orderQuerySummary(order) {
  const { payment: _payment, ...summary } = upgradeOrderSummary(order)
  return { ...summary, paymentRequiresLogin: Boolean(order.paymentRequiresLogin) }
}
