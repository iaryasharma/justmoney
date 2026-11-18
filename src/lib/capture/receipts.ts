// Receipt photos: shrunk to a small JPEG and kept as a data URL per transaction id.
// Stored under their own key (not inside the transaction) so lists stay light.
import { read, write, KEYS } from '../core/storage'

export const getReceipts = () => read<Record<string, string>>(KEYS.receipts, {})

export function saveReceipt(txId: string, dataUrl: string) {
  write(KEYS.receipts, { ...getReceipts(), [txId]: dataUrl })
}

export function removeReceipt(txId: string) {
  const { [txId]: _gone, ...rest } = getReceipts()
  write(KEYS.receipts, rest)
}

/** Scales an image file down (longest side ≤ maxSide) and returns a JPEG data URL. */
export function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); return }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image.')) }
    img.src = url
  })
}
