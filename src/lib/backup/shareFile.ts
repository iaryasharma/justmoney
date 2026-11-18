// Save a file and offer to send it on — the one way every export in the app does it.
//  - Android app: the file is written to Documents/JustMoney (or the cache) and the phone's share sheet opens with it.
//  - Browser: the web share sheet if it can send files, otherwise a normal download.
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNativeApp } from '../core/native'

const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onloadend = () => res(String(r.result).split(',')[1] ?? '')
  r.onerror = () => rej(r.error ?? new Error('could not read file'))
  r.readAsDataURL(blob)
})

export interface ShareFileResult { savedTo?: string; shared: boolean; cancelled?: boolean }

/**
 * @param keep  keep a copy in Documents/JustMoney (backups, setup files); otherwise a temporary copy is enough
 */
export async function shareFile(name: string, blob: Blob, opts: { title?: string; keep?: boolean } = {}): Promise<ShareFileResult> {
  const title = opts.title ?? name
  if (isNativeApp()) {
    const directory = opts.keep ? Directory.Documents : Directory.Cache
    const path = opts.keep ? `JustMoney/${name}` : `shared/${name}`
    await Filesystem.writeFile({ path, data: await toBase64(blob), directory, recursive: true })
    const savedTo = opts.keep ? `Documents/JustMoney/${name}` : undefined
    try {
      const { uri } = await Filesystem.getUri({ path, directory })
      await Share.share({ title, dialogTitle: title, url: uri })
      return { savedTo, shared: true }
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return { savedTo, shared: false, cancelled: true }
      throw e
    }
  }
  const file = new File([blob], name, { type: blob.type })
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return { shared: true } }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { shared: false, cancelled: true }
  }
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { shared: false }
}

/**
 * Saves a file for keeps without opening the share sheet: a download in the browser; on the phone, into Pictures/JustMoney so it shows in
 * the gallery (or Documents/JustMoney if the phone will not allow that).
 */
export async function saveFile(name: string, blob: Blob): Promise<{ savedTo: string }> {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: name }).click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { savedTo: 'your downloads' }
  }
  const data = await toBase64(blob)
  try {
    const p = await Filesystem.checkPermissions()
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions()
  } catch { /* not needed on newer Android */ }
  try {
    await Filesystem.writeFile({ path: `Pictures/JustMoney/${name}`, data, directory: Directory.ExternalStorage, recursive: true })
    return { savedTo: `Pictures/JustMoney/${name}` }
  } catch {
    await Filesystem.writeFile({ path: `JustMoney/${name}`, data, directory: Directory.Documents, recursive: true })
    return { savedTo: `Documents/JustMoney/${name}` }
  }
}
