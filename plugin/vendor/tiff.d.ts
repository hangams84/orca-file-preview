/** Subset of UTIF.js 3.1.0 used by editor/renderers/office/images.ts. */
export interface IFD {
  width?: number
  height?: number
  t256?: number[]
  t257?: number[]
  [tag: string]: unknown
}
export function decode(buffer: ArrayBuffer): IFD[]
export function decodeImage(buffer: ArrayBuffer, ifd: IFD): void
export function toRGBA8(ifd: IFD): Uint8Array
