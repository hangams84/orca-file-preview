/** Keyboard zoom without modifiers for the media previews: `+`/`=` zoom in, `-` zoom out, `0` actual
 *  size. Ctrl/Cmd variants are handled by core bindZoomGestures; these only fire while focus is in
 *  the content area (or on the page body), never while typing in a toolbar field. */
import type { ZoomController } from '../../core/types.ts'
import { stepZoom } from '../../core/ui.ts'

/** True when a key event should not be taken over (typing in a field, or a modifier is held). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  return !!t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName))
}

export function zoomKeyHandler(zoom: ZoomController): (e: KeyboardEvent) => boolean {
  return (e) => {
    if (isTyping(e)) return false
    if (e.key === '+' || e.key === '=') zoom.set(stepZoom(zoom.get(), 1))
    else if (e.key === '-' || e.key === '_') zoom.set(stepZoom(zoom.get(), -1))
    else if (e.key === '0') zoom.set(1)
    else return false
    e.preventDefault()
    return true
  }
}

/** Binds the plain zoom keys on `target` (the content area, or a preview iframe's document). */
export function bindZoomKeys(target: EventTarget, zoom: ZoomController, signal: AbortSignal): void {
  const handle = zoomKeyHandler(zoom)
  target.addEventListener('keydown', (e) => void handle(e as KeyboardEvent), { signal })
}
