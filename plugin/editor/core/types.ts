/** Shared contract between the preview shell (`editor/main.ts`) and each format renderer. */

export type ThemeName = 'light' | 'dark'

export interface ToolbarButton {
  /** Short visible label (a symbol such as `−` or a word). */
  label: string
  /** Tooltip and accessible name. */
  title: string
  onClick: () => void
}

export interface Toolbar {
  /** A button in the renderer's group, left of the common controls. Returns it so state can change. */
  button(spec: ToolbarButton): HTMLButtonElement
  /** A drop-down (sheet, slide, encoding pickers). */
  select(title: string, options: { value: string; label: string }[], onChange: (value: string) => void): HTMLSelectElement
  /** Free text in the toolbar such as `3 / 12` or `UTF-8 · 1,204 lines`. */
  info(text: string): void
  /** Adds the shared zoom controls (−, %, +, fit) bound to a zoom controller. */
  zoom(controller: ZoomController): void
  /** A thin separator between groups. */
  separator(): void
}

export interface ZoomController {
  get(): number
  set(scale: number): void
  /** Scale that fits the content's natural width into the viewport; omit when not meaningful. */
  fit?: () => void
  onChange(listener: (scale: number) => void): void
}

export interface PreviewContext {
  /** Raw file bytes. Never mutate; the preview is read-only. */
  bytes: Uint8Array
  /** Lower-case suffix without the dot, e.g. `docx`. */
  fileType: string
  /** Scrollable content area that the renderer owns. */
  root: HTMLElement
  toolbar: Toolbar
  /** Picks the Korean or English string from Orca's UI language. */
  tr(ko: string, en: string): string
  /** Aborted when the file changes on disk and the preview re-renders. */
  signal: AbortSignal
  theme(): ThemeName
  onTheme(listener: (theme: ThemeName) => void): void
  /** Small screens (phones): renderers should prefer fit-to-width layouts. */
  compact: boolean
}

/** A renderer module exports `render`. It may return a cleanup function. */
export type Renderer = (ctx: PreviewContext) => Promise<void | (() => void)>

export class PreviewError extends Error {
  constructor(
    message: string,
    /** Optional hint shown under the message. */
    readonly hint?: string
  ) {
    super(message)
    this.name = 'PreviewError'
  }
}
