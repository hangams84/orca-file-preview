/** Post-processing for docx-preview output (inside the shadow root): fills gaps in what the
 *  library renders without changing the document model. */

/**
 * Table style conditional formatting. docx-preview emits CSS for `tblStylePr` (first row, banded
 * rows/columns, …) but only tags rows/cells with the matching classes when the file carries a
 * per-row `w:cnfStyle`, which Word writes and most generators (python-docx, scripts, exporters) do
 * not. Derive the classes from the table's look (`first-row`, `no-hband`, … on the <table>) instead.
 */
export function applyTableLook(container: ParentNode): void {
  for (const table of container.querySelectorAll('table')) {
    const look = table.classList
    const rows = Array.from(table.rows)
    if (!rows.length) continue
    // Respect classes docx-preview already set from cnfStyle.
    const tagged = rows.some((r) => /\b(first|last|odd|even)-row\b/.test(r.className))
    if (tagged) continue
    const firstRow = look.contains('first-row')
    const lastRow = look.contains('last-row')
    const hband = !look.contains('no-hband')
    const vband = !look.contains('no-vband')
    const firstCol = look.contains('first-col')
    const lastCol = look.contains('last-col')
    let band = 0
    rows.forEach((row, i) => {
      if (firstRow && i === 0) row.classList.add('first-row')
      else if (lastRow && i === rows.length - 1 && rows.length > 1) row.classList.add('last-row')
      else if (hband) row.classList.add(band++ % 2 === 0 ? 'odd-row' : 'even-row')
      const cells = Array.from(row.cells)
      let vb = 0
      cells.forEach((cell, j) => {
        if (/\b(first|last|odd|even)-col\b/.test(cell.className)) return
        if (firstCol && j === 0) cell.classList.add('first-col')
        else if (lastCol && j === cells.length - 1 && cells.length > 1) cell.classList.add('last-col')
        else if (vband) cell.classList.add(vb++ % 2 === 0 ? 'odd-col' : 'even-col')
      })
    })
  }
}

/**
 * Cell margins: Word's defaults are 0 top/bottom and 0.08" left/right, and its line box leaves
 * room above the text; docx-preview sets `line-height: 1` in many table styles so text touches the
 * top border. Give cells that ended up with no vertical padding a small one. Reads first, then
 * writes, so the style is resolved once.
 */
export function padTableCells(container: ParentNode, limit = 20000): void {
  const cells = Array.from(container.querySelectorAll('td')).slice(0, limit)
  const fixes: [HTMLElement, boolean, boolean][] = []
  for (const td of cells) {
    const cs = getComputedStyle(td)
    const noV = parseFloat(cs.paddingTop) < 1 && parseFloat(cs.paddingBottom) < 1
    const noH = parseFloat(cs.paddingLeft) < 1 && parseFloat(cs.paddingRight) < 1
    if (noV || noH) fixes.push([td, noV, noH])
  }
  for (const [td, noV, noH] of fixes) {
    if (noV) {
      td.style.paddingTop = '1.5pt'
      td.style.paddingBottom = '1.5pt'
    }
    if (noH) {
      td.style.paddingLeft = '5.4pt'
      td.style.paddingRight = '5.4pt'
    }
  }
}

/**
 * Numbered and bulleted paragraphs: docx-preview draws the marker in `::before` followed by a tab
 * (`\9`), which collapses to a space, so the text does not line up at the hanging indent. Size
 * the marker box to the hanging indent of each numbering level instead.
 */
export function listIndentCss(css: string): string {
  const out: string[] = []
  const re = /p\.(docx-num-\d+-\d+)\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    const indent = /text-indent\s*:\s*(-[\d.]+)(pt|px)/.exec(m[2])
    if (!indent) continue
    const hang = Math.abs(Number(indent[1]))
    if (!hang) continue
    out.push(
      `p.${m[1]}::before { display: inline-block; min-width: ${hang}${indent[2]}; text-indent: 0; white-space: pre; box-sizing: border-box; padding-right: 2pt; }`
    )
  }
  return out.join('\n')
}

/** Wraps each top-level table in a horizontally scrolling box (for the reading layout). */
export function wrapTables(container: ParentNode): void {
  for (const table of container.querySelectorAll('table')) {
    if (table.parentElement?.closest('table')) continue
    if (table.parentElement?.classList.contains('fp-docx-tscroll')) continue
    const box = document.createElement('div')
    box.className = 'fp-docx-tscroll'
    table.replaceWith(box)
    box.append(table)
  }
}
