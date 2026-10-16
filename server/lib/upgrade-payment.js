export const UPGRADE_PAYMENT_TTL_MS = 15 * 60 * 1000

// Derive the deadline from creation so retries and legacy orders share the same limit.
export function upgradePaymentDeadline(order) {
  const createdAt = new Date(order?.createdAt).getTime()
  return Number.isFinite(createdAt) ? createdAt + UPGRADE_PAYMENT_TTL_MS : 0
}

export function upgradePaymentExpired(order, now = Date.now()) {
  return now >= upgradePaymentDeadline(order)
}
