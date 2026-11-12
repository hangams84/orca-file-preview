// Generates the extra PDF fixtures for the media renderers (no dependencies):
//   samples/sample-large.pdf     300 pages (one landscape) to exercise lazy page drawing
//   samples/sample-password.pdf  RC4-40 (Standard security handler R2), user password "1234"
// Run: node docs/evidence/media/make-pdf-fixtures.mjs
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const samples = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'samples')

/** Serialises objects (strings or Buffers) into a PDF with a valid xref table. */
function pdf(objects, trailerExtra = '') {
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let offset = parts[0].length
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(offset)
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n')])
    parts.push(chunk)
    offset += chunk.length
  })
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('')
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${offset}\n%%EOF\n`))
  return Buffer.concat(parts)
}
const stream = (data, dict = '') => Buffer.concat([Buffer.from(`<< /Length ${data.length} ${dict}>>\nstream\n`), data, Buffer.from('\nendstream')])

// ---- large ----
{
  const N = 300
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const kids = []
  for (let n = 1; n <= N; n++) {
    const landscape = n === 5
    const [w, h] = landscape ? [842, 595] : [595, 842]
    const lines = [`BT /F1 40 Tf 60 ${h - 110} Td (Page ${n} of ${N}) Tj ET`]
    for (let i = 0; i < 8; i++) lines.push(`BT /F1 12 Tf 60 ${h - 160 - i * 22} Td (Line ${i + 1}: lazy rendering fixture, page ${n}${landscape ? ' (landscape)' : ''}.) Tj ET`)
    lines.push(`0.15 0.39 0.92 rg 60 40 ${w - 120} 8 re f`)
    const content = objs.push(stream(Buffer.from(lines.join('\n')))) // content object number
    const page = objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`)
    kids.push(`${page} 0 R`)
  }
  objs[1] = `<< /Type /Pages /Count ${N} /Kids [${kids.join(' ')}] >>`
  writeFileSync(join(samples, 'sample-large.pdf'), pdf(objs))
}

// ---- password (RC4 40-bit, R2) ----
{
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
  const pad = (s) => Buffer.concat([Buffer.from(s, 'latin1'), PAD]).subarray(0, 32)
  const md5 = (...b) => createHash('md5').update(Buffer.concat(b)).digest()
  const rc4 = (key, data) => {
    const S = [...Array(256).keys()]
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255
      ;[S[i], S[j]] = [S[j], S[i]]
    }
    const out = Buffer.alloc(data.length)
    for (let n = 0, i = 0, j = 0; n < data.length; n++) {
      i = (i + 1) & 255
      j = (j + S[i]) & 255
      ;[S[i], S[j]] = [S[j], S[i]]
      out[n] = data[n] ^ S[(S[i] + S[j]) & 255]
    }
    return out
  }
  const user = '1234'
  const owner = 'owner-5678'
  const P = -4
  const id = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex')
  const O = rc4(md5(pad(owner)).subarray(0, 5), pad(user))
  const pBytes = Buffer.alloc(4)
  pBytes.writeInt32LE(P)
  const key = md5(pad(user), O, pBytes, id).subarray(0, 5)
  const U = rc4(key, PAD)
  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10)
  const content = Buffer.from('BT /F1 32 Tf 60 720 Td (Unlocked: secret PDF) Tj ET\nBT /F1 14 Tf 60 680 Td (The password was 1234.) Tj ET')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(rc4(objKey(4), content)),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`
  ]
  writeFileSync(join(samples, 'sample-password.pdf'), pdf(objs, `/Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] `))
}
console.log('wrote sample-large.pdf, sample-password.pdf')
