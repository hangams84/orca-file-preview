// Builds the distributable packages in dist/ (each with a .sha256 file):
//   orca-file-preview-<version>.zip      Windows (and anyone): File Preview/{plugin,installer,README.md,LICENSE}
//   orca-file-preview-<version>.tar.gz   the same for macOS/Linux and their updater (tar is always present)
//   file-preview-setup-<version>.run     self-extracting installer for macOS/Linux:
//                                        sh file-preview-setup-<version>.run [install|update|uninstall|status] [--yes]
// Unix permissions are stored so the .command/.sh files stay executable after unpacking.
// The Windows .exe and the macOS .app are built from the zip by tools/build-windows-exe.ps1 and
// tools/build-macos-app.sh (on those systems; the release workflow does both).
//   node tools/package-release.mjs
import { zipSync } from 'fflate'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin', 'orca-plugin.json'), 'utf8'))
const VER = manifest.version
const TOP = 'File Preview'
const SKIP = /(^|\/)(\.orca|node_modules)(\/|$)|\.test\.ts$|(^|\/)\.DS_Store$/
const EXEC = /\.(command|sh)$/
const MTIME = new Date('2026-01-01T00:00:00Z')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const entries = [] // { path, data, mode }
const add = (abs, rel) => {
  const path = `${TOP}/${rel.replace(/\\/g, '/')}`
  if (SKIP.test(path)) return
  entries.push({ path, data: readFileSync(abs), mode: EXEC.test(rel) ? 0o755 : 0o644 })
}
for (const f of walk(join(ROOT, 'plugin'))) add(f, join('plugin', relative(join(ROOT, 'plugin'), f)))
for (const f of walk(join(ROOT, 'installer'))) {
  const rel = relative(join(ROOT, 'installer'), f)
  if (rel === 'README.md') continue
  add(f, join('installer', rel))
}
add(join(ROOT, 'installer', 'README.md'), 'README.md')
add(join(ROOT, 'LICENSE'), 'LICENSE')

// ---- zip ------------------------------------------------------------------------------------------
const files = {}
for (const e of entries) files[e.path] = [e.data, { os: 3, attrs: ((0o100000 | e.mode) << 16) >>> 0, level: 9 }]
const zip = zipSync(files, { mtime: MTIME })

// ---- tar.gz (ustar; long names via GNU-style prefix split) ----------------------------------------
function tarHeader(path, size, mode, type = '0') {
  const h = Buffer.alloc(512)
  let name = path
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const i = path.lastIndexOf('/', 155)
    prefix = path.slice(0, i)
    name = path.slice(i + 1)
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`path too long for tar: ${path}`)
  }
  const put = (s, off, len) => Buffer.from(s).copy(h, off, 0, len)
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'
  put(name, 0, 100)
  put(oct(mode, 8), 100, 8)
  put(oct(0, 8), 108, 8)
  put(oct(0, 8), 116, 8)
  put(oct(size, 12), 124, 12)
  put(oct(Math.floor(MTIME.getTime() / 1000), 12), 136, 12)
  h.fill(' ', 148, 156)
  put(type, 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  put(prefix, 345, 155)
  let sum = 0
  for (const b of h) sum += b
  put(oct(sum, 7) + ' ', 148, 8)
  return h
}
const parts = []
const dirs = new Set()
for (const e of entries) {
  const segs = e.path.split('/')
  for (let i = 1; i < segs.length; i++) {
    const d = segs.slice(0, i).join('/') + '/'
    if (!dirs.has(d)) {
      dirs.add(d)
      parts.push(tarHeader(d, 0, 0o755, '5'))
    }
  }
  parts.push(tarHeader(e.path, e.data.length, e.mode), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512))
}
parts.push(Buffer.alloc(1024))
const tgz = gzipSync(Buffer.concat(parts), { level: 9 })

// ---- self-extracting .run -------------------------------------------------------------------------
const header = `#!/bin/sh
# File Preview for Orca ${VER} - self-extracting installer for macOS and Linux.
#   sh file-preview-setup-${VER}.run [install|update|uninstall|status] [--yes]   (default: install)
# Unpacks to a per-user folder and runs installer/unix/file-preview.sh from there.
case "$(uname -s)" in
  Darwin) HOME_DIR="$HOME/Library/Application Support/FilePreviewForOrca" ;;
  *) HOME_DIR="\${XDG_DATA_HOME:-$HOME/.local/share}/file-preview-orca" ;;
esac
DIR="$HOME_DIR/${VER}"
if [ ! -f "$DIR/.complete" ]; then
  rm -rf "$DIR"; mkdir -p "$DIR" || exit 1
  LINE=$(awk '/^__PAYLOAD_BELOW__$/ { print NR + 1; exit }' "$0")
  tail -n +"$LINE" "$0" | tar -xzf - -C "$DIR" || { echo "ERROR: could not unpack to $DIR" >&2; exit 1; }
  date > "$DIR/.complete"
fi
ACTION=\${1:-install}
[ $# -gt 0 ] && shift
SCRIPT="$DIR/File Preview/installer/unix/file-preview.sh"
# A folder install updates by re-copying its original folder: replace a copy installed from elsewhere.
if [ "$ACTION" = install ] && [ "$(cat "$HOME_DIR/current" 2>/dev/null)" != "$DIR/File Preview/plugin" ]; then
  sh "$SCRIPT" uninstall --yes >/dev/null 2>&1 || true
fi
sh "$SCRIPT" "$ACTION" "$@"
rc=$?
[ "$ACTION" = install ] && [ $rc = 0 ] && printf '%s\\n' "$DIR/File Preview/plugin" > "$HOME_DIR/current"
exit $rc
__PAYLOAD_BELOW__
`
const run = Buffer.concat([Buffer.from(header), tgz])

// ---- write ----------------------------------------------------------------------------------------
const outDir = join(ROOT, 'dist')
mkdirSync(outDir, { recursive: true })
const write = (name, buf) => {
  writeFileSync(join(outDir, name), buf)
  const sha = createHash('sha256').update(buf).digest('hex')
  writeFileSync(join(outDir, `${name}.sha256`), `${sha}  ${name}\n`)
  console.log(`${name.padEnd(36)} ${(buf.length / 1024 / 1024).toFixed(1).padStart(5)} MB  sha256 ${sha}`)
}
write(`orca-file-preview-${VER}.zip`, zip)
write(`orca-file-preview-${VER}.tar.gz`, tgz)
write(`file-preview-setup-${VER}.run`, run)
console.log(`${entries.length} files`)
