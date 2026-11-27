[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Türkçe](README.tr.md)

# File Preview for Orca

[![orca-compat](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml/badge.svg)](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml)

File Preview ist ein [Orca](https://github.com/stablyai/orca)-Plugin, das Office-, Hangul-, PDF-, Text-, Bild-, 3D-, CAD- und
ECAD-Dateien direkt in Orca **schreibgeschützt in einer Vorschau** anzeigt. Es läuft in der Orca-Desktop-App
(Windows · macOS · Linux) sowie in den Browser- und Mobil-Clients.

- Aktuelle Version: **v0.4.0** · erfordert Orca **1.4.248** oder neuer (für die Installation über die Git-URL **1.4.252** oder neuer)
- Läuft ausschließlich als `sandboxed-ui`: keine zusätzlichen Berechtigungen (Capabilities), kein Netzwerkzugriff; Ihre
  Dateien werden nie verändert.

## Unterstützte Formate

| Format | Dateiendungen | Engine · Anzeige |
| --- | --- | --- |
| Word | `.docx` `.doc` | docx-preview · eigener OLE/CFB-Parser (erkennt `.doc`-Dateien, die als RTF, HTML oder DOCX gespeichert wurden) |
| PowerPoint | `.pptx` `.ppt` | Eigener OOXML-Renderer · eigener PPT-Record-Parser |
| Excel | `.xlsx` `.xlsm` `.xls` `.ods` | SheetJS CE (Web Worker, Formelberechnung als Fallback, virtuelles Scrollen) |
| Hangul | `.hwp` `.hwpx` | HWP 5 und HWPX (OWPML), dargestellt mit dem von Hangul gespeicherten Zeilenumbruch. Für verteilungs- und kennwortgeschützte Dokumente sowie HWP 3 erscheint ein verständlicher Hinweis |
| PDF | `.pdf` | pdf.js (verzögertes Rendern, koreanische CMaps, Kennworteingabe) |
| Bilder | `.gif` `.bmp` `.svg` | Browser-Decoder (SVG-Skripte blockiert, Hintergrund wählbar) |
| Web | `.html` `.htm` `.xhtml` | DOMPurify + Sandbox-iframe (Skripte werden nie ausgeführt) |
| Tabellen | `.csv` `.tsv` | Eigener RFC-4180-Parser (Erkennung von Zeichenkodierung und Trennzeichen, Sortieren, Filtern) |
| Text | `.txt` `.log` | Erkennung der Zeichenkodierung (UTF-8/16, EUC-KR u. a.), Zeilennummern, Zeilenumbruch |
| Diagramme | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | Eigener SVG-Renderer: draw.io (komprimierte und mehrseitige Dateien, integrierte Formen, Verbinder, Stile, HTML-Beschriftungen mit DOMPurify bereinigt), Visio (Vererbung von Mastern und Formatvorlagen, alle Geometry-Zeilen, Gruppen, Verbinder, Textformatierung, Füllmuster, Farbverläufe, Designs, EMF/WMF-Grafiken, Hintergrundseiten). Seitenauswahl, Verschieben, Zoomen, Einpassen, dunkle Zeichenfläche, Links |
| 3D-Modelle | `.stl` `.obj` `.ply` `.glb` `.gltf` `.3mf` `.off` `.fbx` `.dae` | three.js (WebGL, Drehen, Zoomen, Verschieben, Touch, Draco und meshopt, Parsen im Web Worker). `.mtl`-Dateien und Texturen zu OBJ, externe `.bin`-Dateien und Bilder zu glTF sowie DAE-/FBX-/3MF-Texturen werden aus Begleitdateien gelesen (📁 oder Ablegen) |
| CAD (B-Rep) | `.step` `.stp` `.stpz` `.iges` `.igs` `.brep` | OpenCascade (occt-import-js, WebAssembly, Web Worker): Baugruppen, Teileliste, Farben, Tessellierungsqualität wählbar. `.stpz` ist gzip-komprimiertes STEP |
| 2D-CAD-Zeichnungen | `.dxf` `.dwf` `.dwfx` | Eigener Canvas-2D-Renderer: DXF (ASCII und binär, R12–2018+, Blöcke, Bemaßungen, Schraffuren, MTEXT, koreanischer Text), DWF (W2D-Streams, Blätter, Miniaturansicht als Ersatz), DWFx (XPS-Seiten, eingebettete Schriftarten). Layerliste, Auswahl von Modell/Layout (Ansichtsfenster)/Blatt, heller/dunkler Hintergrund, Infoleiste. Externe DXF-Referenzen (Xrefs) und IMAGE-Objekte werden aus Begleitdateien gelesen (Xref-Layer erscheinen als `XREF\|Layer`) |
| AutoCAD-Zeichnungen (separates Plugin) | `.dwg` `.dwt` | **File Preview DWG** – [eigenes Repository](https://github.com/hangams84/orca-file-preview-dwg), GPL-3.0-or-later, wird separat installiert (Git-URL `https://github.com/hangams84/orca-file-preview-dwg.git`, Quellcode in [dwg-plugin/](dwg-plugin/README.md)). LibreDWG (WebAssembly, Web Worker) + Canvas: Modell/Layouts, Layer, Blöcke, koreanischer Text, Bemaßungen, Schraffuren |
| Roboterbeschreibungen (ROS) | `.urdf` `.xacro` | Eigener XML-Leser + xacro-Prozessor (nach den Regeln von ROS 2 xacro 2.x, sicherer Ausdrucksauswerter ohne eval) + three.js: Kinematikbaum, Grundkörper, Ursprünge und Materialien, alle sechs Gelenktypen, Gelenkgrenzen, mimic, Gelenkschieberegler, Umschalter für Visual/Collision/Koordinatensysteme/Gelenkachsen. Öffnet auch `.urdf.xacro`. Meshes und `xacro:include`-Dateien werden aus Begleitdateien gelesen |
| KiCad | `.kicad_sch` `.kicad_pcb` `.kicad_mod` `.kicad_sym` `.kicad_pro` `.kicad_wks` | Eigener S-Expression-Parser + SVG-Renderer (KiCad 6–10, KiCad-Strichschrift newstroke): Schaltpläne, Leiterplatten (Layer ein-/ausblenden, Vorder-/Rückseite spiegeln), Footprints, Symbolbibliotheken, Projektübersicht, Tooltips zu Pads, Pins und Netzen. Mit dem Projektordner: Navigation durch hierarchische Schaltplanblätter und benutzerdefinierte Zeichnungsvorlagen |
| SolidWorks | `.sldprt` `.sldasm` `.slddrw` `.slddrt` `.prtdot` `.asmdot` `.drwdot` | Eigener Container-Leser (OLE/CFB bis 2014, Format ab 2015): gespeicherte Vorschaubilder, das Anzeige-Mesh eines Teils in 3D, **3D-Baugruppe** (gespeicherte Platzierungen + Meshes, sonst über 📁 übergebene Teiledateien), Eigenschaften, Konfigurationen, referenzierte Dateien, Feature-Namen, Speicherverlauf |
| EPLAN Electric P8 | `.edz` `.zw1` `.elk` `.ell` `.elr` `.els` `.ela` `.elp` `.elx` `.zx1` `.ema` `.emp` | Eigener Leser für 7z (LZMA/LZMA2) und ZIP: EDZ-Artikeldaten, Bilder und PDF-Dokumente, **Makrografik** (PXF: Linien, Bögen, Kurven, Texte, je Variante), Projektsicherungen mit Eigenschaften, Seitenbeschreibungen, **Artikelliste**, Bildern und Inhaltsbaum, Verknüpfungsdateien + 📁 Projektordner (`.edb`) |
| KI-Modelle (PyTorch) | `.pt` `.pth` `.ckpt` `.chkpt` `.pt2` `.ptl` `.safetensors` | Eigener Pickle-Interpreter, der **nie Code ausführt**: state_dict, komplett gespeicherte Module, TorchScript, torch.export, Lightning-Checkpoints, Legacy-Pickles, safetensors. Sieben Ansichten (**Operatorgraph**, Modulbaum, Layer-Tabelle, Parameterkarte, abgeleitetes Architekturdiagramm, **Tensor-Inspektor**, Checkpoint-Infos) und Export als SVG/PNG/JSON/Markdown. Das File-Preview-Panel liest Dateien abschnittsweise und öffnet daher auch Dateien mit mehreren GB sowie am Inhalt erkannte bin- und pkl-Dateien |
| KI-Modelle (ONNX, TFLite, GGUF, Keras, NumPy) | `.onnx` `.tflite` `.gguf` `.keras` `.h5` `.hdf5` `.npy` `.npz` | Dieselben Ansichten: Operatorgraphen für ONNX, TFLite und Keras, GGUF-Metadaten und Werte quantisierter Tensoren (Q4_K u. a.), HDF5- und NumPy-Arrays. Externe ONNX-Daten über den 📁-Ordner |
| (nicht lesbare Dateien) | Alle oben genannten | Allgemeiner Inspektor: Formaterkennung, Größe, Entropie, Hexdump, Zeichenketten |
| **File-Preview-Panel** | Alle oben genannten | Ein Panel in der rechten Seitenleiste; siehe [File-Preview-Panel](#file-preview-panel) unten |

Für alle Formate: Helles/dunkles Design folgt Orca in Echtzeit, Benutzeroberfläche auf Koreanisch/Englisch, Zoom per Strg+Mausrad, Pinch-Geste
oder Schaltflächen, Anpassung an die Breite auf Smartphones, automatische Aktualisierung bei Dateiänderungen und ein verständlicher
Hinweis bei beschädigten Dateien.

### Textformate öffnen direkt in der Vorschau (0.4.0)

Orca behandelt URDF, xacro, KiCad, draw.io, ASCII-DXF, STEP/IGES/BREP, OBJ und die anderen textbasierten 3D-Formate sowie als
RTF/HTML gespeicherte `.doc`-Dateien und XML-`.xls`-Dateien als Text. Das Plugin registriert dafür eigene Texteditoren, sodass
diese Dateien jetzt standardmäßig in der Vorschau geöffnet werden. Dateien, die Orca selbst öffnet (`.txt` `.csv` `.tsv` `.html` `.htm`),
werden gemäß den Regeln von Orca weiterhin zuerst in der Quelltextansicht geöffnet; die Vorschau wählen Sie über den Ansichtsumschalter
oben rechts im Tab.

### Begleitdateien (📁 oder Ablegen)

Orca übergibt einem Editor nur die geöffnete Datei. Wählen Sie mit der Schaltfläche 📁 in der Symbolleiste einen Ordner (mit
gedrückter Umschalttaste einzelne Dateien) oder legen Sie Dateien auf der Vorschau ab – das Plugin liest sie dann innerhalb
seines Sandbox-Frames zusätzlich ein:

| Vorschau | Was ein Ordner oder abgelegte Dateien ergänzen |
| --- | --- |
| Roboter (URDF/xacro) | Meshes (STL, DAE mit Texturen, OBJ mit `.mtl`, glTF) ersetzen die Platzhalter, die Gelenkstellung bleibt erhalten; `xacro:include` wird aufgelöst (`$(find pkg)`, relativ, verschachtelt) |
| 3D | OBJ-Materialien und -Texturen, externe glTF-`.bin`-Dateien und -Bilder, DAE-Texturen |
| CAD-Zeichnung (DXF) | Externe Referenzen (Xrefs) werden als `XREF\|Layer` eingefügt, IMAGE-Objekte werden gezeichnet |
| KiCad | Navigation durch Unterblätter mit Referenzbezeichnern je Instanz, `.kicad_pro` → Schaltplan und Leiterplatte, benutzerdefinierte `.kicad_wks` |
| SolidWorks | **3D-Baugruppe** aus den gespeicherten Platzierungen (Dateien ab 2015 brauchen keine Teiledateien, Dateien bis 2014 verwenden die übergebenen Teile) |
| EPLAN | Makros werden gezeichnet (`.ema` `.emp`, Makros in `.edz`); `.elk` + `.edb`-Ordner → Projekteigenschaften, Seiten, Artikelliste |

### File-Preview-Panel

Öffnen Sie das Panel **File Preview** in der rechten Seitenleiste und verwenden Sie „Open file…“, „Open folder…“ oder Drag & Drop
(die Oberfläche des Plugins gibt es nur auf Koreanisch und Englisch). Die Datei wird mit denselben Renderern angezeigt, ohne die
50-MB-Grenze des Orca-Editors (es gelten nur die Grenzen der Renderer, bis 1 GB), und auch Dateien außerhalb eines Arbeitsbereichs
lassen sich öffnen. Gemeinsam geöffnete Dateien dienen als Begleitdateien. Das Panel benötigt keine zusätzlichen Berechtigungen.

## Installation

### (a) In der Orca-App (empfohlen)

Erfordert Orca **1.4.252** oder neuer.

1. Öffnen Sie **Einstellungen** → **Plugins**.
2. Wählen Sie **Plugin hinzufügen** → **Aus einer Git-URL…**.
3. Fügen Sie `https://github.com/hangams84/orca-file-preview.git` in das Feld **Repository-URL mit #ref** ein und klicken Sie auf **Weiter** → **Installieren**.
4. Prüfen Sie die von Orca angezeigten Berechtigungen (nur Sandbox-UI) und klicken Sie auf **Plugin aktivieren**.

Schritt-für-Schritt-Anleitung mit Screenshots: [docs/install-guide/de.md](docs/install-guide/de.md)

<!-- install-guide-thumbs -->
<a href="docs/install-guide/de.md"><img src="docs/install-guide/de/05-from-git-url.png" width="32%" alt="5"><img src="docs/install-guide/de/08-install.png" width="32%" alt="8"><img src="docs/install-guide/de/10-enable.png" width="32%" alt="10"></a>

Für `.dwg` und `.dwt` installieren Sie auf dieselbe Weise zusätzlich `https://github.com/hangams84/orca-file-preview-dwg.git`.

### (b) Über die Befehlszeile

```sh
# Neueste Version von GitHub installieren (Orca 1.4.252+). Orca gibt die angeforderten Rechte und einen Freigabe-Fingerabdruck aus.
orca plugin install https://github.com/hangams84/orca-file-preview
orca plugin install https://github.com/hangams84/orca-file-preview --approve <fingerprint>
# Eine bestimmte Version: https://github.com/hangams84/orca-file-preview#v0.5.0

# Oder aus einem lokalen Ordner
orca plugin install ./plugin
```

### (c) Release-Pakete, ausführbare Dateien und Skripte

Die Pakete laden Sie unter [GitHub Releases](https://github.com/hangams84/orca-file-preview/releases) herunter. Voraussetzung ist ein
Rechner, auf dem Orca 1.4.248 oder neuer installiert ist und mindestens einmal gestartet wurde; Administratorrechte sind nicht
nötig. Jedes Installationsprogramm zeigt die Berechtigungen an, die Orca zur Freigabe vorlegt, und erteilt die Freigabe erst nach
Ihrer Bestätigung.

| Betriebssystem | Ausführbare Datei | Skripte (zip- oder tar.gz-Paket) |
| --- | --- | --- |
| Windows 10/11 | `FilePreviewSetup-<Version>.exe` (Menü: Installieren · Aktualisieren · Deinstallieren · Status) | `installer\windows\install.cmd` |
| macOS | `File-Preview-Setup-<Version>-macos.zip` → *File Preview Setup.app* | `installer/macos/Install File Preview.command` |
| macOS · Linux | `sh file-preview-setup-<Version>.run [install\|update\|uninstall\|status]` | `sh installer/linux/install.sh` (Linux) |

Die ausführbaren Dateien sind nicht signiert. Blockiert Windows SmartScreen den Start, wählen Sie *Weitere Informationen* →
*Trotzdem ausführen*; unter macOS umgehen Sie Gatekeeper mit Control-Klick → *Öffnen*. Orca 1.4.248–1.4.251 kennt den Befehl
`plugin install` noch nicht; die Installationsprogramme registrieren den Ordner dort stattdessen mit `plugin dev load` – löschen Sie diesen
Ordner dann nicht. Unter Windows 7/8 bricht das Installationsprogramm mit einem klaren Hinweis ab, da Orca Windows 10 oder neuer voraussetzt. Alle
Optionen: [installer/README.md](installer/README.md)

### (d) Aktualisieren und deinstallieren

- **Über die Orca-App oder die CLI installiert**: Ermitteln Sie den Plugin-Schlüssel mit `orca plugin list`, aktualisieren Sie mit
  `orca plugin update <Schlüssel>` und entfernen Sie das Plugin mit `orca plugin uninstall <Schlüssel>`. Eine Installation über die
  Git-URL wechselt beim Aktualisieren auf den neuesten Versions-Tag.
- **Ausführbare Dateien**: das Menü von `FilePreviewSetup-<Version>.exe` (oder `/update` · `/uninstall`),
  `file-preview-setup-<Version>.run update|uninstall` bzw. unter macOS *File Preview Setup.app*.
- **Skripte**: Windows `installer\windows\update.cmd` · `uninstall.cmd`, macOS `Update File Preview.command` ·
  `Uninstall File Preview.command`, Linux `sh installer/linux/update.sh` · `sh installer/linux/uninstall.sh`.
- Eine Aktualisierung ermittelt das neueste GitHub-Release dieses Repositorys, lädt das Paket herunter, prüft die SHA-256-Prüfsumme und
  installiert nach Ihrer Freigabe neu. Die vorherige Version wird aufbewahrt. `--check` (unter Windows `-Check`) prüft nur.

## Einschränkungen

- **50-MB-Lesegrenze**: Orca übergibt einem Plugin-Editor höchstens 50 MB einer Datei (ausgenommen Bilder und PDFs; ein Plugin kann
  das nicht ändern, siehe [stablyai/orca#46775](https://github.com/stablyai/orca/issues/46775)). Das Plugin selbst akzeptiert bis zu
  1 GB. Öffnen Sie größere Dateien im [File-Preview-Panel](#file-preview-panel). STEP-Dateien lassen sich auch mit gzip komprimieren
  und als `.stpz` öffnen (STEP schrumpft meist auf ein Fünftel bis ein Achtel): `gzip -c model.step > model.stpz`.
- **Grenzen der CAD-Engine**: OpenCascade (32-Bit-WebAssembly, bis zu 4 GB Arbeitsspeicher) ist bis zu STEP-Dateien von etwa 200 MB praktikabel.
  Gemessen an synthetischen Baugruppen mit vielen Teilen: 61 MB in 1,5 Min. · 189 MB in 14 Min. · 343 MB nicht innerhalb von
  30 Min. fertig · 412 MB: Arbeitsspeicher reicht nicht aus.
- **Formate, die zuerst in der Quelltextansicht geöffnet werden**: `.txt` `.csv` `.tsv` `.html` `.htm` öffnet Orca selbst, daher erscheint
  zuerst die Quelltextansicht. Die Vorschau wählen Sie über den Ansichtsumschalter.
- **Was nicht gezeichnet wird**:
  - EPLAN: Schaltplanseiten (proprietärer binärer Objektspeicher von EPLAN, `.eod`/`.eox`) und Grafiken aus Symbolbibliotheken.
  - SolidWorks: Exakte B-Rep-Geometrie und Zeichnungsansichten werden nicht neu gezeichnet; stattdessen erscheinen die gespeicherten
    Bilder. Ausgeblendete und unterdrückte Komponenten werden nur aufgelistet, nicht gezeichnet.
  - draw.io: Nicht mitgelieferte Schablonenbibliotheken (`mxgraph.aws4.*` u. a.) erscheinen als gestrichelter Rahmen mit dem
    Schablonennamen, extern verlinkte Bilder als Platzhalter.
  - Visio: Formeln werden nicht ausgewertet (es gelten die gespeicherten Werte). Binäres `.vsd` wird nicht unterstützt (mit klarem Hinweis).
  - DWF: Ein Blatt mit Zeichenbefehlen, die der Leser nicht verarbeiten kann, zeigt die im Paket gespeicherte Miniaturansicht und einen Hinweis.
  - DWG (separates Plugin): 3D-Volumenkörper und Regionen (ACIS), Rasterbildinhalte, OLE-Objekte und Xrefs werden nicht gezeichnet,
    sondern in einem Hinweis aufgelistet.
  - Office: Diagramme und SmartArt in PPTX sowie Zellenformatvorlagen in Tabellenblättern werden vereinfacht dargestellt;
    Tabellenkalkulationen zeigen nur die ersten 20.000 Zeilen. Formeln, Diagramme und OLE-Objekte in `.hwp` erscheinen als beschriftete Rahmen.
- Mobil-Clients wurden mit dem Browser-Testharness (Smartphone-Profile, WebKit, Modus für ältere Engines) geprüft, nicht auf echten Geräten.

## Kompatibilität

Orca **1.4.248** oder neuer; für die Installation über die Git-URL **1.4.252** oder neuer. Die Kompatibilitäts-CI installiert jede
Orca-Version neu unter Ubuntu, macOS und Windows, installiert das Plugin und testet es. Die Ergebnistabelle wird nur an einer
Stelle gepflegt, im koreanischen README: [Orca-Kompatibilität (CI)](README.md#ci-matrix). Testnachweise je Plattform:
`docs/evidence/platforms/`.

## Entwicklung

```sh
npm ci
npm run vendor            # Bibliotheken von Drittanbietern nach plugin/vendor bündeln
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
node tools/check-readmes.mjs   # Sprachleiste, Links und Formattabelle aller 11 READMEs prüfen
```

### Aufbau des Repositorys

```text
plugin/            das ausgelieferte Plugin (orca-plugin.json, editor/, panel/, vendor/)
dwg-plugin/        Quellcode von File Preview DWG (GPL-3.0-or-later, separates Plugin)
installer/         Installationsskripte für Windows · macOS · Linux
samples/           Testdateien (tools/make-samples.py u. a.)
tools/harness/     Browser-Testharness mit Orca-ähnlicher CSP und simuliertem Host (Playwright)
tools/verify.mjs   Ausführung der Prüfrunden (tsc, validate, Unit-Tests, 4 Harness-Profile, Fuzzing, Aufnahmen aus der Orca-App)
docs/              Entwicklungs- und Prüfdokumentation (README.md, index.html, evidence/, release-notes/)
```

Prüfprotokolle und Screenshots: [docs/README.md](docs/README.md) · [docs/index.html](docs/index.html). Änderungen:
[CHANGELOG.md](CHANGELOG.md).

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz ([LICENSE](LICENSE)). Mitgelieferte Bibliotheken unterliegen ihren eigenen Lizenzen:
[plugin/THIRD_PARTY_NOTICES.md](plugin/THIRD_PARTY_NOTICES.md).
**File Preview DWG** für `.dwg` und `.dwt` ist ein separates Plugin unter GPL-3.0-or-later und nicht Teil dieses MIT-Plugins.
