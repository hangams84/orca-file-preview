import { assert, test } from 'orca/testing'
import { readBorderFillXml, readCharPr, readHeader, readObject, readP, readPagePr, readParaPr } from './hwpx.ts'
import { paperSize } from './model.ts'
import { find, kid, parseXml, text, XmlError } from './xml.ts'

const NS = 'xmlns:hp="p" xmlns:hh="h" xmlns:hc="c"'
const ctx = () => ({ notes: new Set<string>() })

test('xml: elements, attributes, entities, CDATA and prefixes', () => {
  const root = parseXml(`<?xml version="1.0"?><!-- c --><hs:sec ${NS}><hp:p a="1 &amp; 2"><hp:t>x &lt; y<hp:tab/>&#xAC00;</hp:t><![CDATA[<raw>]]></hp:p></hs:sec>`)
  assert.equal(root.name, 'sec')
  const p = kid(root, 'p')!
  assert.equal(p.attrs.a, '1 & 2')
  const t = kid(p, 't')!
  assert.deepEqual(t.kids.map((k) => (typeof k === 'string' ? k : `<${k.name}>`)), ['x < y', '<tab>', '가'])
  assert.equal(text(p), 'x < y가<raw>')
  assert.throws(() => parseXml('<a><b'), (e) => e instanceof XmlError)
  assert.throws(() => parseXml('just text'), (e) => e instanceof XmlError)
})

test('hwpx: paraPr takes HWPUNIT values from <hp:case>, halves <hp:default>', () => {
  const mk = (inner: string) =>
    parseXml(`<hh:paraPr ${NS} id="3"><hh:align horizontal="CENTER"/><hh:heading type="OUTLINE" idRef="0" level="2"/>${inner}</hh:paraPr>`)
  const withCase = readParaPr(
    mk(`<hp:switch><hp:case><hh:margin><hc:intent value="-1310"/><hc:left value="1000"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="400"/></hh:margin><hh:lineSpacing type="PERCENT" value="160"/></hp:case>
       <hp:default><hh:margin><hc:intent value="-2620"/><hc:left value="2000"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="800"/></hh:margin><hh:lineSpacing type="PERCENT" value="160"/></hp:default></hp:switch>`)
  )
  assert.equal(withCase.align, 'center')
  assert.equal(withCase.left, 1000)
  assert.equal(withCase.indent, -1310)
  assert.equal(withCase.after, 400)
  assert.equal(withCase.heading, 'outline')
  assert.equal(withCase.level, 2)
  const onlyDefault = readParaPr(mk(`<hp:switch><hp:default><hh:margin><hc:left value="2000"/></hh:margin><hh:lineSpacing type="FIXED" value="1800"/></hp:default></hp:switch>`))
  assert.equal(onlyDefault.left, 1000)
  assert.equal(onlyDefault.lineSpacingType, 'fixed')
  const plain = readParaPr(mk(`<hh:margin><hc:left value="500"/></hh:margin>`))
  assert.equal(plain.left, 500)
})

test('hwpx: charPr fonts by language, size and attributes', () => {
  const faces = { HANGUL: ['함초롬돋움', '함초롬바탕'], LATIN: ['Arial', 'Times New Roman'] }
  const cp = readCharPr(
    parseXml(
      `<hh:charPr ${NS} id="0" height="1200" textColor="#FF0000" shadeColor="none"><hh:fontRef hangul="1" latin="0"/><hh:ratio hangul="95"/><hh:spacing hangul="-5"/><hh:relSz hangul="110"/><hh:bold/><hh:underline type="BOTTOM" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE"/><hh:supscript/></hh:charPr>`
    ),
    faces
  )
  assert.equal(cp.hangulFace, '함초롬바탕')
  assert.equal(cp.latinFace, 'Arial')
  assert.equal(cp.height, 1200)
  assert.equal(cp.relSize, 110)
  assert.equal(cp.spacing, -5)
  assert.equal(cp.ratio, 95)
  assert.equal(cp.bold, true)
  assert.equal(cp.italic, false)
  assert.equal(cp.underline, 'below')
  assert.equal(cp.strike, false)
  assert.equal(cp.sup, true)
  assert.equal(cp.color, '#ff0000')
  assert.equal(cp.shade, null)
})

test('hwpx: borderFill sides, fill colour and ids (1-based)', () => {
  const bf = readBorderFillXml(
    parseXml(
      `<hh:borderFill ${NS} id="3"><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="DASH" width="0.4 mm" color="#A6A6A6"/><hh:bottomBorder type="DOUBLE_SLIM" width="0.5 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="#FFFF00" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>`
    )
  )
  assert.deepEqual(bf.left, { style: 'solid', width: 0.12, color: '#000000' })
  assert.equal(bf.right.style, 'none')
  assert.deepEqual(bf.top, { style: 'dashed', width: 0.4, color: '#a6a6a6' })
  assert.equal(bf.bottom.style, 'double')
  assert.equal(bf.fill, '#ffff00')
  const head = readHeader(parseXml(`<hh:head ${NS}><hh:refList><hh:borderFills><hh:borderFill id="1"/><hh:borderFill id="2"><hc:fillBrush><hc:winBrush faceColor="#123456"/></hc:fillBrush></hh:borderFill></hh:borderFills></hh:refList></hh:head>`))
  assert.equal(head.borderFills[1].fill, '#123456', 'borderFill id 2 at index 1')
})

test('hwpx: paragraph text positions count controls and tabs as 8, like HWP 5', () => {
  const p = readP(
    parseXml(
      `<hp:p ${NS} paraPrIDRef="4" pageBreak="1"><hp:run charPrIDRef="2"><hp:ctrl><hp:colPr colCount="1"/></hp:ctrl><hp:t>가나<hp:tab width="4000"/>다<hp:fwSpace/>라</hp:t></hp:run><hp:run charPrIDRef="5"><hp:t>마바</hp:t></hp:run>
       <hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/><hp:lineseg textpos="21" vertpos="1600" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray></hp:p>`
    ),
    ctx()
  )
  assert.equal(p.text, '￼가나\t다 라마바')
  assert.equal(p.ps, 4)
  assert.equal(p.pageBreak, true)
  assert.deepEqual(p.runs, [{ start: 0, cs: 2 }, { start: 7, cs: 5 }])
  // units: ctrl 0-7, 가 8, 나 9, tab 10-17, 다 18, fwSpace 19, 라 20, 마 21
  assert.equal(p.lines.length, 2)
  assert.equal(p.lines[1].start, 7, 'textpos 21 is 마')
  assert.equal(p.lines[1].y, 1600)
  assert.equal(p.ctrls[0]?.kind, 'columns')
})

test('hwpx: page size, margins and landscape (NARROWLY)', () => {
  const sec = parseXml(`<hp:secPr ${NS}><hp:pagePr landscape="NARROWLY" width="72852" height="103180"><hp:margin header="4251" footer="4251" gutter="0" left="8503" right="8503" top="5669" bottom="4251"/></hp:pagePr></hp:secPr>`)
  const pd = readPagePr(sec)
  assert.equal(pd.landscape, true)
  assert.equal(pd.left, 8503)
  assert.deepEqual(paperSize(pd), { width: 103180, height: 72852 })
  const portrait = readPagePr(parseXml(`<hp:secPr ${NS}><hp:pagePr landscape="WIDELY" width="59528" height="84188"><hp:margin/></hp:pagePr></hp:secPr>`))
  assert.deepEqual(paperSize(portrait), { width: 59528, height: 84188 })
})

test('hwpx: table cells, spans, sizes and margins', () => {
  const tbl = parseXml(
    `<hp:tbl ${NS} rowCnt="2" colCnt="2" borderFillIDRef="3" textWrap="TOP_AND_BOTTOM"><hp:sz width="20000" height="4000"/><hp:pos treatAsChar="0" vertRelTo="PARA" horzRelTo="COLUMN" vertOffset="10" horzOffset="20"/><hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>
      <hp:tr><hp:tc borderFillIDRef="4" hasMargin="0"><hp:subList vertAlign="BOTTOM"><hp:p><hp:run charPrIDRef="0"><hp:t>A</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/><hp:cellSz width="20000" height="2000"/><hp:cellMargin left="1" right="1" top="1" bottom="1"/></hp:tc></hp:tr>
      <hp:tr><hp:tc borderFillIDRef="4" hasMargin="1"><hp:subList><hp:p><hp:run charPrIDRef="0"><hp:t>B</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="10000" height="2000"/><hp:cellMargin left="100" right="100" top="50" bottom="50"/></hp:tc></hp:tr></hp:tbl>`
  )
  const t = readObject(tbl, ctx())
  assert.ok(t && t.kind === 'table')
  assert.equal(t.pos.inline, false)
  assert.equal(t.pos.vertRel, 'para')
  assert.equal(t.pos.horzRel, 'column')
  assert.equal(t.pos.y, 10)
  assert.equal(t.pos.wrap, 'topbottom')
  assert.equal(t.cells.length, 2)
  assert.equal(t.cells[0].colSpan, 2)
  assert.equal(t.cells[0].vAlign, 'bottom')
  assert.deepEqual(t.cells[0].margin, [510, 510, 141, 141], 'table inner margin unless the cell has its own')
  assert.deepEqual(t.cells[1].margin, [100, 100, 50, 50])
  assert.equal(t.cells[1].paras[0].text, 'B')
})

test('hwpx: pictures, equations and drawing text', () => {
  const pic = readObject(parseXml(`<hp:pic ${NS} textWrap="SQUARE"><hc:img binaryItemIDRef="image1"/><hp:sz width="100" height="50"/><hp:pos treatAsChar="1"/></hp:pic>`), ctx())
  assert.ok(pic && pic.kind === 'picture')
  assert.equal(pic.bin, 'image1')
  assert.equal(pic.pos.inline, true)
  const c = ctx()
  const eq = readObject(parseXml(`<hp:equation ${NS}><hp:sz width="3825" height="3311"/><hp:script>a over b</hp:script></hp:equation>`), c)
  assert.ok(eq && eq.kind === 'placeholder')
  assert.equal(eq.what, 'equation')
  assert.equal(eq.label, 'a over b')
  assert.ok(c.notes.has('equation'))
  const rect = readObject(
    parseXml(`<hp:rect ${NS}><hp:lineShape color="#000000" width="33" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#86AFDC"/></hc:fillBrush><hp:drawText><hp:subList vertAlign="CENTER"><hp:p><hp:run><hp:t>ABC</hp:t></hp:run></hp:p></hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText><hp:sz width="20925" height="14175"/></hp:rect>`),
    ctx()
  )
  assert.ok(rect && rect.kind === 'shape')
  assert.equal(rect.shape, 'rect')
  assert.equal(rect.fill, '#86afdc')
  assert.equal(rect.text?.paras[0].text, 'ABC')
  assert.equal(rect.text?.vAlign, 'center')
  assert.ok(find(parseXml(`<a><b><c x="1"/></b></a>`), 'c'))
})
