# PPTX picture corpus, built with Microsoft PowerPoint (COM, no window, no dialogs) so the files and the
# ground truth are PowerPoint's own:
#   1. inputs:  python tools/pptx-images/make-inputs.py            (Pillow; samples/pptx-images/inputs, ignored)
#   2. decks:   samples/pptx-images/pptx-img-{formats,specs,placements}.pptx  (committed, small)
#               samples/perf/pptx-img-large.pptx                    (48 MP pictures, git-ignored)
#               + cases.json (deck, slide, case id, label, PowerPoint status)
#   3. python tools/pptx-images/post-edit.py: what COM cannot express (picture placeholder, duotone,
#      alpha, negative crop) and the metafiles extracted for the Word decks
#   4. Word: samples/pptx-images/docx-img-formats.docx/.doc; PowerPoint: pptx-img-formats.ppt (legacy check)
#   5. truth:   samples/pptx-images/truth/<deck>/sN.png  (PowerPoint's slide export, 1280x720; ignored)
# Each PowerPoint/Word file runs in its own job with a watchdog (an invisible dialog cannot hang the run).
#   powershell -ExecutionPolicy Bypass -File tools\make-pptx-images.ps1 [-Stage all|build|post|word|truth]
param([ValidateSet('all', 'build', 'post', 'word', 'truth')][string]$Stage = 'all', [string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Dir = Join-Path $Root 'samples\pptx-images'
$In = Join-Path $Dir 'inputs'
$Perf = Join-Path $Root 'samples\perf'
New-Item -ItemType Directory -Force $Dir, $In, $Perf | Out-Null

if ($Stage -in 'all', 'build') {
  if (-not (Test-Path (Join-Path $In 'png-rgb.png'))) { & $Python (Join-Path $Root 'tools\pptx-images\make-inputs.py') | Out-Host }

  # The deck builder runs as one job (STA, for the clipboard used by the metafile cases).
  $job = Start-Job -ArgumentList $Dir, $In, $Perf {
    param($Dir, $In, $Perf)
    $ErrorActionPreference = 'Stop'
    $cases = New-Object System.Collections.ArrayList
    $pp = New-Object -ComObject PowerPoint.Application
    $pp.DisplayAlerts = 1 # ppAlertsNone
    function RGB($r, $g, $b) { $r + 256 * $g + 65536 * $b }
    function New-Deck { $d = $pp.Presentations.Add(0); $d.PageSetup.SlideWidth = 960; $d.PageSetup.SlideHeight = 540; $d }
    function Add-CaseSlide($deck, [string]$label, $layout = $null) {
      $i = $deck.Slides.Count + 1
      if ($layout) { $s = $deck.Slides.AddSlide($i, $layout) } else { $s = $deck.Slides.Add($i, 12) } # ppLayoutBlank
      $t = $s.Shapes.AddTextbox(1, 20, 6, 920, 40)
      $t.TextFrame.TextRange.Text = $label
      $t.TextFrame.TextRange.Font.Size = 20
      $t.TextFrame.TextRange.Font.Name = 'Arial'
      $t.Name = 'case-label'
      $s
    }
    # Fits a shape into the picture box (40, 60, 880 x 460), keeping its aspect ratio, centred.
    function Fit($sh, [double]$bw = 880, [double]$bh = 460, [double]$bx = 40, [double]$by = 60) {
      $sh.LockAspectRatio = -1
      $k = [Math]::Min($bw / $sh.Width, $bh / $sh.Height)
      $sh.Width = $sh.Width * $k
      $sh.Left = $bx + ($bw - $sh.Width) / 2; $sh.Top = $by + ($bh - $sh.Height) / 2
    }
    function Note($deck, $s, [string]$id, [string]$label, [string]$status = 'ok', [string]$why = '') {
      [void]$cases.Add([pscustomobject]@{ deck = $script:DeckId; slide = $s.SlideIndex; id = $id; label = $label; status = $status; note = $why })
    }
    function Pic($deck, [string]$id, [string]$label, [string]$file, [scriptblock]$after = $null, [switch]$Backdrop) {
      $s = Add-CaseSlide $deck $label
      if ($Backdrop) { $b = $s.Shapes.AddShape(1, 40, 60, 880, 460); $b.Fill.ForeColor.RGB = (RGB 230 0 200); $b.Line.Visible = 0 }
      try {
        $p = $s.Shapes.AddPicture((Join-Path $In $file), 0, -1, 40, 60)
        if ($after) { & $after $p $s }
        Fit $p
        Note $deck $s $id $label
      } catch {
        $msg = $_.Exception.Message.Split("`n")[0]
        $t = $s.Shapes.AddTextbox(1, 40, 240, 880, 60); $t.TextFrame.TextRange.Text = "PowerPoint refused this file: $msg"
        Note $deck $s $id $label 'refused' $msg
      }
    }
    # Metafile cases: draw shapes (or a picture), cut, paste as EMF (2) or WMF (3).
    function Meta($deck, [string]$id, [string]$label, [int]$kind, [switch]$Bitmap) {
      $s = Add-CaseSlide $deck $label
      try {
        if ($Bitmap) {
          $src = $s.Shapes.AddPicture((Join-Path $In 'png-rgb.png'), 0, -1, 100, 100)
        } else {
          $a = $s.Shapes.AddShape(1, 100, 100, 300, 200); $a.Fill.ForeColor.RGB = (RGB 220 40 40)
          $b = $s.Shapes.AddShape(9, 260, 160, 240, 200); $b.Fill.ForeColor.RGB = (RGB 40 90 220); $b.Line.Weight = 4
          $c = $s.Shapes.AddShape(7, 420, 90, 200, 180); $c.Fill.ForeColor.RGB = (RGB 240 200 30)
          $t = $s.Shapes.AddTextbox(1, 110, 320, 400, 50); $t.TextFrame.TextRange.Text = "$id text"; $t.TextFrame.TextRange.Font.Size = 28
          $src = $s.Shapes.Range([object[]]@($a.Name, $b.Name, $c.Name, $t.Name)).Group()
        }
        $src.Cut()
        Start-Sleep -Milliseconds 300
        $p = $s.Shapes.PasteSpecial($kind).Item(1)
        Fit $p
        Note $deck $s $id $label
      } catch {
        Note $deck $s $id $label 'refused' $_.Exception.Message.Split("`n")[0]
      }
    }

    # ---------------------------------------------------------------- formats
    $d = New-Deck; $script:DeckId = 'pptx-img-formats'
    Pic $d 'png-rgb' 'PNG RGB' 'png-rgb.png'
    Pic $d 'png-rgba' 'PNG RGBA (transparent quadrant over magenta)' 'png-rgba.png' -Backdrop
    Pic $d 'png-16bit' 'PNG 16-bit grayscale gradient' 'png-16bit.png'
    Pic $d 'png-palette' 'PNG palette (16 colours)' 'png-palette.png'
    Pic $d 'jpg-baseline' 'JPEG baseline' 'jpg-baseline.jpg'
    Pic $d 'jpg-progressive' 'JPEG progressive' 'jpg-progressive.jpg'
    Pic $d 'jpg-cmyk' 'JPEG CMYK' 'jpg-cmyk.jpg'
    Pic $d 'jpg-gray' 'JPEG grayscale' 'jpg-gray.jpg'
    Pic $d 'jpg-exif6' 'JPEG EXIF orientation 6 (arrow must point up)' 'jpg-exif6.jpg'
    Pic $d 'gif-static' 'GIF static' 'gif-static.gif'
    Pic $d 'gif-animated' 'GIF animated (3 frames)' 'gif-animated.gif'
    Pic $d 'bmp-24' 'BMP 24-bit' 'bmp-24.bmp'
    Pic $d 'bmp-32' 'BMP 32-bit with alpha (over magenta)' 'bmp-32.bmp' -Backdrop
    Pic $d 'tif-lzw' 'TIFF LZW' 'tif-lzw.tif'
    Pic $d 'tif-multipage' 'TIFF multipage (page 1)' 'tif-multipage.tif'
    Pic $d 'ico' 'ICO' 'ico.ico'
    Pic $d 'webp' 'WebP' 'webp.webp'
    Pic $d 'avif' 'AVIF' 'avif.avif'
    Pic $d 'svg' 'SVG (svgBlip + PNG fallback)' 'svg.svg'
    Meta $d 'emf-shapes' 'EMF: shapes and text (pasted as enhanced metafile)' 2
    Meta $d 'emf-bitmap' 'EMF: bitmap inside a metafile' 2 -Bitmap
    # PowerPoint COM cannot paste as WMF: these two are hand-written by make-inputs.py.
    Pic $d 'wmf-shapes' 'WMF: rectangle, ellipse, polygon and text' 'wmf-shapes.wmf'
    Pic $d 'wmf-bitmap' 'WMF: bitmap (META_STRETCHDIB)' 'wmf-bitmap.wmf'
    $d.SaveAs((Join-Path $Dir 'pptx-img-formats.pptx')); $d.Close()

    # ---------------------------------------------------------------- specs
    $d = New-Deck; $script:DeckId = 'pptx-img-specs'
    Pic $d 'tiny-8x8' 'Tiny 8x8 PNG scaled up' 'tiny-8x8.png'
    Pic $d 'aspect-wide' 'Extreme aspect 50:1' 'aspect-wide.png'
    Pic $d 'aspect-tall' 'Extreme aspect 1:30' 'aspect-tall.png'
    Pic $d 'crop-25' 'Cropped 25% left and top (srcRect)' 'png-rgb.png' { param($p) $p.PictureFormat.CropLeft = $p.Width * 0.25; $p.PictureFormat.CropTop = $p.Height * 0.25 }
    Pic $d 'crop-negative' 'Negative crop (picture smaller than its frame)' 'png-rgb.png'
    Pic $d 'rotate-30' 'Rotated 30 degrees' 'png-rgb.png' { param($p) $p.Rotation = 30 }
    Pic $d 'flip-h' 'Flipped horizontally' 'png-rgb.png' { param($p) $p.Flip(0) }
    Pic $d 'flip-v' 'Flipped vertically' 'png-rgb.png' { param($p) $p.Flip(1) }
    Pic $d 'grayscale' 'Recolour: grayscale' 'png-rgb.png' { param($p) $p.PictureFormat.ColorType = 2 }
    Pic $d 'black-white' 'Recolour: black and white' 'png-rgb.png' { param($p) $p.PictureFormat.ColorType = 3 }
    Pic $d 'washout' 'Recolour: washout' 'png-rgb.png' { param($p) $p.PictureFormat.ColorType = 4 }
    Pic $d 'bright-contrast' 'Brightness 70% / contrast 30%' 'png-rgb.png' { param($p) $p.PictureFormat.Brightness = 0.7; $p.PictureFormat.Contrast = 0.3 }
    Pic $d 'transparent-color' 'Set transparent colour (red quadrant)' 'png-rgb.png' { param($p) $p.PictureFormat.TransparentBackground = -1; $p.PictureFormat.TransparencyColor = (RGB 220 40 40) } -Backdrop
    Pic $d 'duotone' 'Recolour: duotone (blue)' 'png-rgb.png'
    Pic $d 'alpha-50' 'Picture transparency 50% (over magenta)' 'png-rgb.png' -Backdrop
    $d.SaveAs((Join-Path $Dir 'pptx-img-specs.pptx')); $d.Close()

    # ---------------------------------------------------------------- placements
    $d = New-Deck; $script:DeckId = 'pptx-img-placements'
    $s = Add-CaseSlide $d 'Picture placeholder (Picture with Caption layout)' $d.SlideMaster.CustomLayouts.Item(9)
    Note $d $s 'placeholder' 'Picture placeholder'
    $s = Add-CaseSlide $d 'Picture fill of a shape (stretch)'
    $r = $s.Shapes.AddShape(5, 160, 70, 640, 440); $r.Fill.UserPicture((Join-Path $In 'png-rgb.png')); Note $d $s 'fill-stretch' 'Shape picture fill (stretch)'
    $s = Add-CaseSlide $d 'Picture fill of a shape (tile)'
    $r = $s.Shapes.AddShape(1, 60, 70, 840, 440); $r.Fill.UserTextured((Join-Path $In 'jpg-baseline.jpg')); Note $d $s 'fill-tile' 'Shape picture fill (tile)'
    $s = Add-CaseSlide $d 'Slide background picture'
    $s.FollowMasterBackground = 0; $s.Background.Fill.UserPicture((Join-Path $In 'jpg-baseline.jpg')); Note $d $s 'background' 'Slide background picture'
    $s = Add-CaseSlide $d 'Picture in a table cell'
    $tb = $s.Shapes.AddTable(3, 3, 60, 70, 840, 440)
    $tb.Table.Cell(2, 2).Shape.Fill.UserPicture((Join-Path $In 'png-rgb.png')); Note $d $s 'table-cell' 'Picture in a table cell'
    $s = Add-CaseSlide $d 'Pictures inside a group'
    $a = $s.Shapes.AddPicture((Join-Path $In 'png-rgb.png'), 0, -1, 60, 80, 400, 267)
    $b = $s.Shapes.AddPicture((Join-Path $In 'jpg-baseline.jpg'), 0, -1, 500, 220, 400, 267)
    [void]$s.Shapes.Range([object[]]@($a.Name, $b.Name)).Group(); Note $d $s 'group' 'Pictures inside a group'
    $lay = $d.SlideMaster.CustomLayouts.Add($d.SlideMaster.CustomLayouts.Count + 1); $lay.Name = 'Picture on layout'
    [void]$lay.Shapes.AddPicture((Join-Path $In 'png-rgb.png'), 0, -1, 600, 300, 300, 200)
    $s = Add-CaseSlide $d 'Picture on the slide layout' $lay; Note $d $s 'layout-picture' 'Picture on the layout'
    $des = $d.Designs.Add('Second master')
    [void]$des.SlideMaster.Shapes.AddPicture((Join-Path $In 'jpg-baseline.jpg'), 0, -1, 60, 300, 300, 200)
    $s = Add-CaseSlide $d 'Picture on the slide master' $des.SlideMaster.CustomLayouts.Item(7); Note $d $s 'master-picture' 'Picture on the master'
    $s = Add-CaseSlide $d 'Linked picture (external file, not embedded)'
    $p = $s.Shapes.AddPicture((Join-Path $In 'png-rgb.png'), -1, 0, 40, 60); Fit $p; Note $d $s 'linked' 'Linked (external) picture'
    $d.SaveAs((Join-Path $Dir 'pptx-img-placements.pptx')); $d.Close()

    # ---------------------------------------------------------------- large (git-ignored)
    $d = New-Deck; $script:DeckId = 'pptx-img-large'
    Pic $d 'huge-jpg' 'Very large JPEG 8000x6000 (48 MP)' 'huge-8000x6000.jpg'
    Pic $d 'huge-png' 'Very large PNG 8000x6000 (48 MP)' 'huge-8000x6000.png'
    $d.SaveAs((Join-Path $Perf 'pptx-img-large.pptx')); $d.Close()

    $pp.Quit()
    $cases | ConvertTo-Json -Depth 3
  }
  if (Wait-Job $job -Timeout 600) { $json = Receive-Job $job } else { Stop-Job $job; throw 'deck build timed out' }
  Remove-Job $job -Force
  ($json -join "`n") | Set-Content -Encoding utf8 (Join-Path $Dir 'cases.json')
  Write-Host "decks built; cases.json written"
}

if ($Stage -in 'all', 'post') { & $Python (Join-Path $Root 'tools\pptx-images\post-edit.py') | Out-Host }

function Invoke-Watched([string]$What, [scriptblock]$Body, [object[]]$ArgList, [int]$Timeout = 180) {
  $job = Start-Job -ScriptBlock $Body -ArgumentList $ArgList
  if (Wait-Job $job -Timeout $Timeout) { $r = Receive-Job $job } else {
    # A blocked COM call (invisible dialog) never returns: end the Office process, then the job.
    $r = 'timeout (blocked by a dialog?)'
    Get-Process WINWORD, POWERPNT -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-Job $job
  }
  Remove-Job $job -Force
  Write-Host ("{0,-10} {1}" -f $What, ($r -join ' '))
}

if ($Stage -in 'all', 'word') {
  # Same pictures in Word (.docx and .doc) and the formats deck as .ppt: for the legacy/docx check.
  Invoke-Watched 'docx/doc' {
    param($Dir, $In)
    $log = Join-Path $env:TEMP 'make-pptx-images-word.log'; Set-Content $log 'start'
    $w = New-Object -ComObject Word.Application
    $w.Visible = $false; $w.DisplayAlerts = 0
    try {
      $doc = $w.Documents.Add()
      $files = 'png-rgb.png', 'png-rgba.png', 'jpg-baseline.jpg', 'jpg-cmyk.jpg', 'jpg-exif6.jpg', 'gif-static.gif', 'bmp-24.bmp', 'tif-lzw.tif', 'svg.svg', 'webp.webp', 'emf-shapes.emf', 'emf-bitmap.emf', 'wmf-shapes.wmf', 'wmf-bitmap.wmf'
      foreach ($f in $files) {
        $r = $doc.Content; $r.Collapse(0); $r.InsertAfter("$f`r"); $r = $doc.Content; $r.Collapse(0)
        Add-Content $log "insert $f"
        try { $ish = $doc.InlineShapes.AddPicture((Join-Path $In $f), $false, $true, $r); Add-Content $log ' added'; $ish.LockAspectRatio = -1; $ish.Width = 240; $ish.AlternativeText = $f; Add-Content $log ' sized' } catch { $doc.Content.InsertAfter("Word refused $f`r") }
        $r = $doc.Content; $r.Collapse(0); $r.InsertAfter("`r")
      }
      # Save to %TEMP% and copy: saving straight into the repository folder blocked on an invisible prompt.
      $tmp = Join-Path $env:TEMP 'docx-img-formats'
      Add-Content $log 'save docx'
      $doc.SaveAs2("$tmp.docx", 16)
      Copy-Item "$tmp.docx" (Join-Path $Dir 'docx-img-formats.docx') -Force
      Add-Content $log 'save doc'
      # Word 97 cannot hold SVG/WebP: saving them as .doc opens the (invisible) compatibility checker.
      for ($i = $doc.InlineShapes.Count; $i -ge 1; $i--) { if ($doc.InlineShapes.Item($i).AlternativeText -match '\.(svg|webp)$') { $doc.InlineShapes.Item($i).Delete() } }
      $doc.SaveAs2("$tmp.doc", 0)
      Copy-Item "$tmp.doc" (Join-Path $Dir 'docx-img-formats.doc') -Force
      $doc.Close(0); 'ok'
    } catch { "error: $($_.Exception.Message.Split("`n")[0])" } finally { $w.Quit() }
  } @($Dir, $In)
  Invoke-Watched 'ppt' {
    param($Dir)
    $pp = New-Object -ComObject PowerPoint.Application
    $pp.DisplayAlerts = 1
    try {
      $d = $pp.Presentations.Open((Join-Path $Dir 'pptx-img-formats.pptx'), -1, 0, 0)
      $d.SaveAs((Join-Path $Dir 'pptx-img-formats.ppt'), 1); $d.Close(); 'ok'
    } catch { "error: $($_.Exception.Message.Split("`n")[0])" } finally { $pp.Quit() }
  } @($Dir)
}

if ($Stage -in 'all', 'truth') {
  $decks = @(Get-ChildItem $Dir -Filter 'pptx-img-*.pptx') + @(Get-ChildItem $Perf -Filter 'pptx-img-*.pptx' -ErrorAction SilentlyContinue)
  foreach ($deck in $decks) {
    $out = Join-Path $Dir ('truth\' + $deck.BaseName)
    New-Item -ItemType Directory -Force $out | Out-Null
    Invoke-Watched $deck.BaseName {
      param($src, $out)
      $pp = New-Object -ComObject PowerPoint.Application
      $pp.DisplayAlerts = 1
      try {
        $d = $pp.Presentations.Open($src, -1, 0, 0) # read-only, untitled no, no window
        foreach ($s in $d.Slides) { $s.Export((Join-Path $out ("s{0}.png" -f $s.SlideIndex)), 'PNG', 1280, 720) }
        $n = $d.Slides.Count; $d.Close(); "truth: $n slides"
      } catch { "error: $($_.Exception.Message.Split("`n")[0])" } finally { $pp.Quit() }
    } @($deck.FullName, $out) 300
  }
}
