import { useEffect, useRef, useState } from 'react'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import * as pdfjs from 'pdfjs-dist'
import '../../lib/capture/pdf' // sets the pdf.js worker
import { Icon, Sheet, useToast } from '../ui/ui'
import { isNativeApp } from '../../lib/core/native'
import { recentReports } from '../../lib/reports/report'

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** Opens a generated PDF report inside the app (opened by tapping its "Report ready" notification). */
export default function ReportViewer({ filename, onClose }: { filename: string | null; onClose: () => void }) {
  const toast = useToast()
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [pages, setPages] = useState(0)
  const blobRef = useRef<Blob | null>(null)

  useEffect(() => {
    if (!filename) return
    let cancelled = false
    setState('loading'); setPages(0)
    ;(async () => {
      try {
        let bytes: Uint8Array | null = null
        const mem = recentReports.get(filename)
        if (mem) { blobRef.current = mem; bytes = new Uint8Array(await mem.arrayBuffer()) }
        else if (isNativeApp()) {
          const r = await Filesystem.readFile({ path: `JustMoney/${filename}`, directory: Directory.Documents })
          const data = typeof r.data === 'string' ? r.data : new Uint8Array(await r.data.arrayBuffer())
          bytes = typeof data === 'string' ? b64ToBytes(data) : data
          blobRef.current = new Blob([bytes as BlobPart], { type: 'application/pdf' })
        }
        if (!bytes) throw new Error('not found')
        const doc = await pdfjs.getDocument({ data: bytes }).promise
        if (cancelled) return
        setPages(doc.numPages)
        const el = box.current
        if (!el) return
        el.replaceChildren()
        const width = el.clientWidth || 340
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (width / base.width) * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.cssText = `width:100%;display:block;margin:0 0 10px;border-radius:6px;background:#fff`
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `Report page ${i} of ${doc.numPages}`)
          el.appendChild(canvas)
          await page.render({ canvas, viewport }).promise
        }
        if (!cancelled) setState('ready')
      } catch (e) {
        console.error('[report] could not open', e)
        if (!cancelled) setState('missing')
      }
    })()
    return () => { cancelled = true }
  }, [filename])

  const share = async () => {
    const blob = blobRef.current
    if (!blob || !filename) return
    if (isNativeApp()) {
      // the phone's own share sheet: the web share API can't send files from inside the app
      try {
        const path = `JustMoney/${filename}`
        // the file normally exists already (it was exported); write it again if it was only in memory
        await Filesystem.stat({ path, directory: Directory.Documents }).catch(async () => {
          const data = await new Promise<string>((res, rej) => {
            const r = new FileReader()
            r.onloadend = () => res(String(r.result).split(',')[1] ?? '')
            r.onerror = () => rej(r.error)
            r.readAsDataURL(blob)
          })
          await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true })
        })
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents })
        await Share.share({ title: filename, dialogTitle: 'Share report', url: uri })
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        if (!/cancel/i.test(msg)) toast('Could not share the report', msg.slice(0, 80))
      }
      return
    }
    const file = new File([blob], filename, { type: 'application/pdf' })
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: filename })
      else {
        const url = URL.createObjectURL(blob)
        Object.assign(document.createElement('a'), { href: url, download: filename }).click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast('Could not share the report')
    }
  }

  return (
    <Sheet open={!!filename} onClose={onClose} full>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="h2">Your report</h2>
          <div className="muted small ellipsis">{filename}{pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}</div>
        </div>
        {state === 'ready' && <button className="icon-btn" onClick={share} aria-label="Share or save report"><Icon name="share" size={18} /></button>}
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {state === 'loading' && <div className="row small muted" style={{ justifyContent: 'center', padding: 24 }}><span className="spinner" /> Opening report…</div>}
      {state === 'missing' && (
        <div className="empty"><b>Report not found</b>It may have been moved or deleted. Look in Documents/JustMoney, or export it again from Settings.</div>
      )}
      <div ref={box} />
    </Sheet>
  )
}
