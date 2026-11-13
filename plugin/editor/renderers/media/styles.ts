/** Renderer stylesheets go into document.head once (deduplicated by id), the way core/ui.ts
 *  installStyles does, instead of an in-body <style> inside the content area: in Orca's frame a
 *  renderer's in-body <style> did not take effect. Class names are renderer-scoped, so the sheets can
 *  stay installed across re-renders. Layout that must never break is additionally set inline. */
export function adoptStyle(id: string, css: string): void {
  const key = `fp-style-${id}`
  const existing = document.getElementById(key)
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const el = document.createElement('style')
  el.id = key
  el.dataset.fpRenderer = id
  el.textContent = css
  document.head.append(el)
}
