// Expands a .xacro file with File Preview's processor and prints the URDF (for comparisons).
//   node --experimental-transform-types tools/urdf/expand.mjs file.xacro [name:=value ...]
import { readFileSync } from 'node:fs'
import { parseXml, serializeXml } from '../../plugin/editor/renderers/urdf/xml.ts'
import { processXacro } from '../../plugin/editor/renderers/urdf/xacro.ts'
const [file, ...rest] = process.argv.slice(2)
const args = Object.fromEntries(rest.map((a) => a.split(':=')))
const res = processXacro(parseXml(readFileSync(file, 'utf8')), { args })
process.stdout.write(serializeXml(res.root))
for (const n of res.notes) process.stderr.write(`${n.level}: ${n.message}${n.line ? ` (line ${n.line})` : ''}\n`)
for (const i of res.includes) process.stderr.write(`include not loaded: ${i.filename}\n`)
