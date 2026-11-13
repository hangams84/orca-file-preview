/** Types for parse.js (plain JavaScript so it runs as a module worker without a transpile step). */
export interface Part {
  type: 'mesh' | 'lines' | 'points'
  name: string
  position: Float32Array
  normal?: Float32Array
  color?: Float32Array
  colorSize?: number
  uv?: Float32Array
  index?: Uint32Array | Uint16Array
  /** One normal per face (OBJ without vn): the smooth toggle welds the corners. */
  unshared?: boolean
}
export function parseGeometry(kind: string, buffer: ArrayBuffer): { parts: Part[]; notes: string[] }
export function parseOFF(text: string): Part
export function transferables(parts: Part[]): ArrayBuffer[]
