/** What a diagram reader hands the viewer: named pages that draw themselves as SVG on demand. */

export interface BuiltPage {
  svg: SVGSVGElement
  /** Natural size in CSS pixels (the viewBox size). */
  width: number
  height: number
  /** Shapes drawn and shapes that fell back to a labelled box (unknown stencils). */
  stats: { shapes: number; fallbacks: number; links: number }
}

export interface DiagramPage {
  name: string
  /** The format's page id (draw.io page links point at it). */
  id: string
  /** A Visio background page (listed after the foreground pages). */
  background?: boolean
  build(): Promise<BuiltPage>
}

export interface DiagramDoc {
  pages: DiagramPage[]
  /** Short format label for the toolbar, e.g. `draw.io` or `Visio`. */
  format: string
}

/** Attribute on an <a> that switches to another page of the same diagram. */
export const PAGE_LINK_ATTR = 'data-dg-page'
