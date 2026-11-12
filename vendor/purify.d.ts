// Minimal typings for vendor/purify.js (DOMPurify 3): only what editor/renderers/html.ts uses.
export interface PurifyConfig {
  WHOLE_DOCUMENT?: boolean
  RETURN_DOM?: boolean
  FORBID_TAGS?: string[]
  FORBID_ATTR?: string[]
  ADD_TAGS?: string[]
  ADD_ATTR?: string[]
  ALLOW_UNKNOWN_PROTOCOLS?: boolean
}
export interface HookData {
  attrName: string
  attrValue: string
  keepAttr: boolean
  forceKeepAttr?: boolean
}
export interface Purifier {
  sanitize(dirty: string, cfg: PurifyConfig & { RETURN_DOM: true }): HTMLElement
  sanitize(dirty: string, cfg?: PurifyConfig): string
  addHook(entry: 'uponSanitizeAttribute', hook: (node: Element, data: HookData) => void): void
  addHook(entry: 'afterSanitizeAttributes' | 'uponSanitizeElement', hook: (node: Element) => void): void
  removeAllHooks(): void
  removed: unknown[]
  isSupported: boolean
}
export const DOMPurify: Purifier
