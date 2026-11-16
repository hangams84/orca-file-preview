/** Subset of docx-preview 0.4.1 used by editor/renderers/docx.ts. */
export interface DocxOptions {
  className?: string
  inWrapper?: boolean
  ignoreWidth?: boolean
  ignoreHeight?: boolean
  ignoreFonts?: boolean
  breakPages?: boolean
  ignoreLastRenderedPageBreak?: boolean
  experimental?: boolean
  trimXmlDeclaration?: boolean
  useBase64URL?: boolean
  renderChanges?: boolean
  renderHeaders?: boolean
  renderFooters?: boolean
  renderFootnotes?: boolean
  renderEndnotes?: boolean
  renderComments?: boolean
  renderAltChunks?: boolean
  debug?: boolean
}
export function renderAsync(
  data: Blob | ArrayBuffer | Uint8Array,
  bodyContainer: HTMLElement,
  styleContainer?: HTMLElement | null,
  options?: DocxOptions
): Promise<unknown>
