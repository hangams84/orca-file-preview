/** Subset of rtf.js 3.0.9's WMFJS used by editor/renderers/office/images.ts. */
interface MetafileRenderInfo {
  width: string
  height: string
  xExt: number
  yExt: number
  mapMode: number
}
export const WMFJS: {
  loggingEnabled(enabled: boolean): void
  Renderer: new (blob: ArrayBuffer) => { render(info: MetafileRenderInfo): SVGElement }
}
