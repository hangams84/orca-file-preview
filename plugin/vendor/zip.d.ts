/** Subset of fflate 0.8 used by the PPTX renderer. */
export function unzipSync(data: Uint8Array, opts?: { filter?: (file: { name: string; size: number; originalSize: number }) => boolean }): Record<string, Uint8Array>
export function strFromU8(data: Uint8Array, latin1?: boolean): string
export function inflateSync(data: Uint8Array, opts?: { out?: Uint8Array }): Uint8Array
