// Rebuilds one vendor bundle (tools/vendor/<name>.entry.js → plugin/vendor/<name>.js) with the same
// esbuild options as build-vendor.mjs, without touching the copied assets. Usage: node tools/vendor-one.mjs three
import { build } from 'esbuild'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) throw new Error('usage: node tools/vendor-one.mjs <name>')
const outfile = process.argv[3] ?? join(root, 'plugin', 'vendor', `${name}.js`)
await build({
  entryPoints: [join(root, 'tools', 'vendor', `${name}.entry.js`)],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  logLevel: 'warning'
})
console.log(outfile, statSync(outfile).size)
