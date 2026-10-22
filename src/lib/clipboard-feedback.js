import { copyTextToClipboard } from './api.js'
import { copyImageToClipboard } from './transfer.js'

export async function copyTextWithFeedback(value, notify, successMessage = '已复制到剪贴板') {
  try {
    if (!value) throw new Error('empty-clipboard-value')
    await copyTextToClipboard(value)
    notify(successMessage, 'success')
    return true
  } catch {
    notify('复制失败，请允许剪贴板权限后重试，或手动选中内容复制', 'error')
    return false
  }
}

export async function copyImageWithFeedback(dataUrl, fallbackText, notify) {
  try {
    if (!dataUrl) throw new Error('empty-clipboard-image')
    await copyImageToClipboard(dataUrl)
    notify('二维码图片已复制', 'success')
    return true
  } catch {
    if (fallbackText) {
      return copyTextWithFeedback(fallbackText, notify, '图片复制未成功，已改为复制链接')
    }
    notify('图片复制失败，请允许剪贴板权限后重试', 'error')
    return false
  }
}
