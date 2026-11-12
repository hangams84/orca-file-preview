// Minimal typings for vendor/pdf.js (pdfjs-dist 6.5.438): only what editor/renderers/pdf.ts uses.
export const version: string
export const GlobalWorkerOptions: { workerSrc: string; workerPort: Worker | null }
export const PasswordResponses: { NEED_PASSWORD: 1; INCORRECT_PASSWORD: 2 }

export interface PageViewport {
  width: number
  height: number
  scale: number
  rotation: number
  rawDims: { pageWidth: number; pageHeight: number; pageX: number; pageY: number }
}
export interface RenderTask {
  promise: Promise<void>
  cancel(): void
}
export interface TextContent {
  items: unknown[]
}
export interface PDFPageProxy {
  pageNumber: number
  getViewport(params: { scale: number; rotation?: number }): PageViewport
  render(params: {
    canvas: HTMLCanvasElement
    canvasContext?: CanvasRenderingContext2D
    viewport: PageViewport
    transform?: number[] | null
    background?: string
  }): RenderTask
  streamTextContent(params?: object): ReadableStream
  cleanup(): boolean
}
export interface PDFDocumentProxy {
  numPages: number
  getPage(n: number): Promise<PDFPageProxy>
  destroy(): Promise<void>
}
export interface PDFDocumentLoadingTask {
  promise: Promise<PDFDocumentProxy>
  onPassword: ((update: (password: string) => void, reason: number) => void) | null
  destroy(): Promise<void>
}
export function getDocument(src: {
  data: Uint8Array
  cMapUrl?: string
  cMapPacked?: boolean
  standardFontDataUrl?: string
  wasmUrl?: string
  isEvalSupported?: boolean
  enableXfa?: boolean
  disableAutoFetch?: boolean
  stopAtErrors?: boolean
}): PDFDocumentLoadingTask

export class TextLayer {
  constructor(params: { textContentSource: ReadableStream | TextContent; container: HTMLElement; viewport: PageViewport })
  render(): Promise<void>
  cancel(): void
}
