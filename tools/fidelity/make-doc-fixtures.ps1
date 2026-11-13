# Uses Microsoft Word (COM, invisible, no dialogs) to
#  1. generate spec-driven .doc fixtures (Word 97-2003 format) with known page sizes, margins, spacing,
#     line spacing, indents, alignment and font sizes in Korean and English -> samples/fidelity/doc/word-*.doc
#  2. export every .doc in samples/fidelity/doc and samples/ to PDF -> samples/fidelity/truth/<name>.pdf,
#     Word's own layout, used as ground truth by tools/fidelity/compare.mjs.
#   powershell -ExecutionPolicy Bypass -File tools\fidelity\make-doc-fixtures.ps1 [-SkipGenerate]
param([switch]$SkipGenerate)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DocDir = Join-Path $Root 'samples\fidelity\doc'
$Truth = Join-Path $Root 'samples\fidelity\truth'
New-Item -ItemType Directory -Force $DocDir, $Truth | Out-Null
$mm = 72 / 25.4 # points per millimetre

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0 # wdAlertsNone
$word.Options.CheckGrammarAsYouType = $false
$word.Options.CheckSpellingAsYouType = $false

function New-Doc([double]$WidthMm, [double]$HeightMm, [double]$Top, [double]$Bottom, [double]$Left, [double]$Right) {
  $d = $word.Documents.Add()
  $ps = $d.PageSetup
  $ps.PageWidth = [single]($WidthMm * $mm); $ps.PageHeight = [single]($HeightMm * $mm)
  $ps.TopMargin = [single]($Top * $mm); $ps.BottomMargin = [single]($Bottom * $mm); $ps.LeftMargin = [single]($Left * $mm); $ps.RightMargin = [single]($Right * $mm)
  return $d
}
# Appends one paragraph with explicit formatting. Units: points.
function Add-Para($d, [string]$Text, [hashtable]$Opt = @{}) {
  $r = $d.Content
  $r.InsertParagraphAfter()
  $p = $d.Paragraphs.Item($d.Paragraphs.Count)
  $p.Range.Text = $Text
  $p = $d.Paragraphs.Item($d.Paragraphs.Count - 1)
  $fnt = $p.Range.Font
  $fnt.Name = $(if ($Opt.font) { $Opt.font } else { '맑은 고딕' })
  $fnt.Size = [single]$(if ($Opt.size) { $Opt.size } else { 10 })
  $fnt.Bold = [int][bool]$Opt.bold
  $fnt.Italic = [int][bool]$Opt.italic
  $pf = $p.Format
  $pf.SpaceBefore = [single]$(if ($Opt.before) { $Opt.before } else { 0 })
  $pf.SpaceAfter = [single]$(if ($Opt.after) { $Opt.after } else { 0 })
  if ($Opt.lineRule -ne $null) { $pf.LineSpacingRule = $Opt.lineRule } else { $pf.LineSpacingRule = 0 } # 0 single,1 1.5,2 double,4 exact,5 multiple
  if ($Opt.line) { $pf.LineSpacing = [single]$Opt.line }
  $pf.LeftIndent = [single]$(if ($Opt.left) { $Opt.left } else { 0 })
  $pf.RightIndent = [single]$(if ($Opt.right) { $Opt.right } else { 0 })
  $pf.FirstLineIndent = [single]$(if ($Opt.first) { $Opt.first } else { 0 })
  $pf.Alignment = $(if ($Opt.align -ne $null) { $Opt.align } else { 0 }) # 0 left,1 center,2 right,3 justify
}
function Save-Doc($d, [string]$Name) {
  # Remove the empty first paragraph left by Documents.Add
  if ($d.Paragraphs.Item(1).Range.Text.Trim().Length -eq 0) { $d.Paragraphs.Item(1).Range.Delete() | Out-Null }
  $path = Join-Path $DocDir $Name
  $d.SaveAs2([string]$path, 0) # wdFormatDocument97 (.doc)
  $d.Close(0)
  Write-Host "generated $Name"
}

$ko = '한글 미리보기 품질 검증을 위한 문단입니다. 줄 간격과 글자 크기, 들여쓰기가 원본과 같은지 확인합니다.'
$en = 'The quick brown fox jumps over the lazy dog. Spacing, sizes and indents must match the original layout.'

if (-not $SkipGenerate) {
  # 1. A4, Korean, 1.5 line spacing, spacing before/after, first-line indent, heading sizes
  $d = New-Doc 210 297 30 25 30 20
  Add-Para $d '문서 제목 (16pt 굵게, 가운데)' @{ size = 16; bold = $true; align = 1; after = 12 }
  Add-Para $d '1. 개요 (13pt, 앞 12pt 뒤 6pt)' @{ size = 13; bold = $true; before = 12; after = 6 }
  for ($i = 1; $i -le 4; $i++) { Add-Para $d "$i) $ko $ko" @{ size = 10; lineRule = 1; first = 10 * $mm; after = 6; align = 3 } }
  Add-Para $d '2. 표 앞 문단 (11pt, 내어쓰기)' @{ size = 11; bold = $true; before = 12; after = 6 }
  Add-Para $d "내어쓰기 문단: $ko" @{ size = 11; left = 15 * $mm; first = -8 * $mm; after = 6 }
  Save-Doc $d 'word-a4-korean.doc'

  # 2. US Letter, Times New Roman 12, double / exact / multiple line spacing, all alignments
  $d = New-Doc 215.9 279.4 25.4 25.4 25.4 25.4
  Add-Para $d 'Letter page, Times New Roman 12 pt' @{ font = 'Times New Roman'; size = 18; bold = $true; after = 12 }
  Add-Para $d "Double spaced: $en $en" @{ font = 'Times New Roman'; size = 12; lineRule = 2; after = 12 }
  Add-Para $d "Exactly 18 pt: $en $en" @{ font = 'Times New Roman'; size = 12; lineRule = 4; line = 18; after = 12 }
  Add-Para $d "Multiple 1.15: $en $en" @{ font = 'Times New Roman'; size = 12; lineRule = 5; line = 13.8; after = 12 }
  Add-Para $d "Right aligned: $en" @{ font = 'Times New Roman'; size = 12; align = 2; after = 12 }
  Add-Para $d "Centered: $en" @{ font = 'Times New Roman'; size = 12; align = 1; after = 12 }
  Add-Para $d "Hanging indent 0.5 in: $en $en" @{ font = 'Times New Roman'; size = 12; left = 36; first = -36; after = 12 }
  Add-Para $d "Indented both sides 1 in: $en $en" @{ font = 'Times New Roman'; size = 12; left = 72; right = 72; align = 3 }
  Save-Doc $d 'word-letter-spacing.doc'

  # 3. A4 landscape, font size ladder 8..28 pt, Batang and Arial
  $d = New-Doc 297 210 20 20 25 25
  foreach ($s in 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28) {
    Add-Para $d "$s pt 바탕 글자 크기 Size ladder" @{ font = '바탕'; size = $s; after = 4 }
  }
  Add-Para $d 'Arial 11 pt line for comparison' @{ font = 'Arial'; size = 11 }
  Save-Doc $d 'word-landscape-sizes.doc'

  # 4. B5 (JIS) small margins, dense 9 pt text with 0 spacing, a page break, then a second page
  $d = New-Doc 182 257 12.7 12.7 12.7 12.7
  for ($i = 1; $i -le 12; $i++) { Add-Para $d "$i. $ko $en" @{ size = 9; lineRule = 0 } }
  $d.Content.InsertParagraphAfter()
  $end = $d.Content; $end.Collapse(0); $end.InsertBreak(7) # wdPageBreak
  Add-Para $d '두 번째 쪽 첫 문단 (12pt, 앞 0)' @{ size = 12; bold = $true }
  for ($i = 1; $i -le 3; $i++) { Add-Para $d "$ko" @{ size = 10; lineRule = 1 } }
  Save-Doc $d 'word-b5-dense.doc'
}

$word.Quit()
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)

# Ground truth: Word's own rendering of every .doc as PDF. One Word per file with a watchdog, because
# some old files (Word 6/95 converters, repair prompts) can block on an invisible dialog.
$docs = @(Get-ChildItem $DocDir -Filter *.doc) + @(Get-ChildItem (Join-Path $Root 'samples') -Filter *.doc |
    Where-Object { $_.Name -notmatch '^(broken|xss)' })
foreach ($doc in $docs) {
  $pdf = Join-Path $Truth ([IO.Path]::GetFileNameWithoutExtension($doc.Name) + '.pdf')
  if ((Test-Path $pdf) -and (Get-Item $pdf).LastWriteTime -gt $doc.LastWriteTime) { Write-Host "keep   $($doc.Name)"; continue }
  $job = Start-Job -ArgumentList $doc.FullName, $pdf {
    param($src, $dst)
    $w = New-Object -ComObject Word.Application
    $w.Visible = $false; $w.DisplayAlerts = 0
    try {
      $w.Options.ConfirmConversions = $false
      $d = $w.Documents.Open($src, $false, $true, $false)
      $d.ExportAsFixedFormat($dst, 17)
      $d.Close(0)
      'ok'
    } catch { "error: $($_.Exception.Message.Split("`n")[0])" } finally { $w.Quit() }
  }
  if (Wait-Job $job -Timeout 60) { $r = Receive-Job $job } else { $r = 'timeout (blocked by a dialog)'; Stop-Job $job }
  Remove-Job $job -Force
  Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host ("{0,-7} {1}" -f $(if ($r -eq 'ok') { 'truth' } else { 'skip' }), "$($doc.Name) $(if ($r -ne 'ok') { $r })")
}