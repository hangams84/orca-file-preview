// Builds dwg-plugin/vendor/ (the separate GPL-3.0 "File Preview DWG" plugin):
//   libredwg/libredwg.js    @mlightcad/libredwg-web (GPL-3.0) wrapper + Emscripten glue as one ESM file,
//                           the glue patched by tools/libredwg-patches.mjs (no `new Function`)
//   libredwg/libredwg-web.wasm   LibreDWG compiled to WebAssembly, unmodified
//   libredwg/libredwg-patches.mjs the patch applied to the glue (a copy of tools/libredwg-patches.mjs)
// Run: node tools/build-dwg-vendor.mjs   (after npm install)
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchLibredwg } from './libredwg-patches.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules/@mlightcad/libredwg-web')
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
const out = join(root, 'dwg-plugin/vendor/libredwg')
mkdirSync(out, { recursive: true })

const banner =
  `/* @mlightcad/libredwg-web ${version} (GPL-3.0, https://github.com/mlightcad/libredwg-web), LibreDWG (GPL-3.0-or-later,\n` +
  ' * https://www.gnu.org/software/libredwg/). Bundled by tools/build-dwg-vendor.mjs for File Preview DWG.\n' +
  ' * Modified: the two embind code-generation sites (Function constructor) of wasm/libredwg-web.js are replaced by\n' +
  ' * equivalent closures (libredwg-patches.mjs beside this file) so the engine runs under a Content Security Policy\n' +
  ' * without unsafe-eval. Everything else is unchanged. */'

await build({
  stdin: {
    contents: "export { LibreDwg, Dwg_File_Type, createModule } from '@mlightcad/libredwg-web'",
    resolveDir: root,
    sourcefile: 'libredwg.entry.js'
  },
  outfile: join(out, 'libredwg.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  // not minified: the shipped engine file stays readable and diffable against upstream (GPL-3.0 prefers
  // the form used for modification)
  minify: false,
  legalComments: 'inline',
  banner: { js: banner },
  external: ['node:*'],
  logLevel: 'warning',
  plugins: [
    {
      name: 'patch-libredwg-glue',
      setup(b) {
        b.onLoad({ filter: /libredwg-web[\\/]wasm[\\/]libredwg-web\.js$/ }, (args) => ({
          contents: patchLibredwg(readFileSync(args.path, 'utf8')),
          loader: 'js'
        }))
      }
    }
  ]
})
const bundled = readFileSync(join(out, 'libredwg.js'), 'utf8')
if (/new Function|\beval\(/.test(bundled)) throw new Error('libredwg.js still contains code generation')

copyFileSync(join(pkg, 'wasm/libredwg-web.wasm'), join(out, 'libredwg-web.wasm'))
// the patch that made libredwg.js differ from upstream travels with the plugin (GPL-3.0 section 5a/6)
copyFileSync(join(root, 'tools/libredwg-patches.mjs'), join(out, 'libredwg-patches.mjs'))
for (const f of ['libredwg/libredwg.js', 'libredwg/libredwg-web.wasm']) {
  console.log(`${f.padEnd(28)} ${(statSync(join(root, 'dwg-plugin/vendor', f)).size / 1024).toFixed(0).padStart(6)} KB`)
}
writeFileSync(join(out, 'VERSION'), `@mlightcad/libredwg-web ${version}\n`)
