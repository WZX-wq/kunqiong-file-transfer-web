export function paymentDeadline(order) {
  const explicitDeadline = order?.paymentExpiresAt ? new Date(order.paymentExpiresAt).getTime() : NaN
  if (Number.isFinite(explicitDeadline)) return explicitDeadline
  // Older API responses still use the original order creation time.
  const createdAt = new Date(order?.createdAt).getTime()
  return Number.isFinite(createdAt) ? createdAt + 15 * 60 * 1000 : 0
}

export function paymentOrderView(order, now = Date.now()) {
  return order?.status === 'pending_payment' && now >= paymentDeadline(order)
    ? { ...order, status: 'expired', payment: null } : order
}
