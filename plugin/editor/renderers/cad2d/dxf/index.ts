/** DXF entry point: bytes → Scene. */
import type { Scene } from '../scene.ts'
import { buildScene } from './build.ts'
import { DxfError, parseDoc, readTags } from './reader.ts'

export function readDxf(bytes: Uint8Array): Scene {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64))
  if (/^\s*\(DWF V|^PK\x03\x04|^%PDF|^AC10\d\d/.test(head)) throw new DxfError(head.startsWith('AC10') ? 'this is a DWG file, not DXF' : 'not a DXF file')
  const tags = readTags(bytes)
  if (tags.n < 2) throw new DxfError('no group codes')
  return buildScene(parseDoc(tags))
}
