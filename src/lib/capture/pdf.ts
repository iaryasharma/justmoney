import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfItem, PdfLine } from './statement'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export class PasswordRequiredError extends Error {
  wrong: boolean
  constructor(wrong: boolean) {
    super(wrong ? 'Wrong password' : 'Password required')
    this.wrong = wrong
  }
}

/**
 * Extracts statement text on-device, reconstructing lines from text-item
 * positions. The password is used once to open the file and never stored.
 */
export async function extractPdfText(file: File, password?: string): Promise<string> {
  return (await extractPdf(file, password)).text
}

/** Text plus each line's items with x positions (for reading statement columns). */
export async function extractPdf(file: File, password?: string): Promise<{ text: string; lines: PdfLine[] }> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data, password })
  let doc: pdfjs.PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (e) {
    task.destroy()
    if ((e as { name?: string })?.name === 'PasswordException') {
      // code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw new PasswordRequiredError((e as { code?: number }).code === 2)
    }
    throw e
  }
  const pages: string[] = []
  const lines: PdfLine[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    const rows = new Map<number, PdfItem[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3) * 3
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], w: item.width ?? 0, s: item.str }])
    }
    const pageLines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => ({ items: items.sort((a, b) => a.x - b.x) }))
    lines.push(...pageLines)
    pages.push(pageLines.map((l) => l.items.map((it) => it.s).join(' ')).join('\n'))
  }
  await task.destroy()
  return { text: pages.join('\n'), lines }
}

/** Opens a PDF you made, to count its pages and draw them (the report preview). */
export async function openPdfBlob(blob: Blob): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
}

/** One page drawn to an image, `width` pixels wide. */
export async function renderPdfPage(doc: pdfjs.PDFDocumentProxy, pageNo: number, width: number): Promise<string> {
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise
  return canvas.toDataURL('image/jpeg', 0.9)
}
