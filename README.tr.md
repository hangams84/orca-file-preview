[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Türkçe](README.tr.md)

# File Preview for Orca

[![orca-compat](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml/badge.svg)](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml)

File Preview; Office, Hangul, PDF, metin, görsel, 3D, CAD ve elektronik tasarım dosyalarının **salt okunur önizlemesini** doğrudan
Orca içinde gösteren bir [Orca](https://github.com/stablyai/orca) eklentisidir. Masaüstü Orca'da (Windows · macOS · Linux) ve
tarayıcı/mobil istemcilerde çalışır.

- Son sürüm: **v0.4.0** · Orca **1.4.248** veya üzeri gerekir (Git URL'si ile kurulum için **1.4.252** veya üzeri)
- Yalnızca `sandboxed-ui` olarak çalışır: ek izin (capability) istemez, ağa erişmez ve dosyalarınızı hiçbir zaman değiştirmez.

## Desteklenen biçimler

| Biçim | Uzantılar | Motor · gösterilenler |
| --- | --- | --- |
| Word | `.docx` `.doc` | docx-preview · kendi OLE/CFB ayrıştırıcımız (RTF, HTML veya DOCX olarak kaydedilmiş `.doc` dosyalarını tanır) |
| PowerPoint | `.pptx` `.ppt` | Kendi OOXML işleyicimiz · kendi PPT kayıt ayrıştırıcımız |
| Excel | `.xlsx` `.xlsm` `.xls` `.ods` | SheetJS CE (Web Worker, yedek formül hesaplama, sanal kaydırma) |
| Hangul | `.hwp` `.hwpx` | HWP 5 ve HWPX (OWPML), Hangul'un kaydettiği satır düzeniyle gösterilir. Dağıtım korumalı ve parolalı belgeler ile HWP 3 dosyaları anlaşılır bir mesaj alır |
| PDF | `.pdf` | pdf.js (gecikmeli işleme, Korece CMap'ler, parola girişi) |
| Görseller | `.gif` `.bmp` `.svg` | Tarayıcı kod çözücüsü (SVG betikleri engellenir, arka plan seçilebilir) |
| Web | `.html` `.htm` `.xhtml` | DOMPurify + korumalı alanda iframe (betikler hiçbir zaman çalıştırılmaz) |
| Tablolar | `.csv` `.tsv` | Kendi RFC 4180 ayrıştırıcımız (kodlama ve ayırıcı algılama, sıralama, filtre) |
| Metin | `.txt` `.log` | Kodlama algılama (UTF-8/16, EUC-KR vb.), satır numaraları, satır kaydırma |
| Diyagramlar | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | Kendi SVG işleyicimiz: draw.io (sıkıştırılmış ve çok sayfalı dosyalar, yerleşik şekiller, bağlayıcılar, stiller, DOMPurify ile temizlenen HTML etiketleri), Visio (ana şekil ve stil sayfası kalıtımı, tüm Geometry satırları, gruplar, bağlayıcılar, metin biçimlendirme, dolgu desenleri, degradeler, temalar, EMF/WMF resimler, arka plan sayfaları). Sayfa seçimi, kaydırma, yakınlaştırma, sığdırma, koyu tuval, bağlantılar |
| 3D modeller | `.stl` `.obj` `.ply` `.glb` `.gltf` `.3mf` `.off` `.fbx` `.dae` | three.js (WebGL, döndürme, yakınlaştırma, kaydırma, dokunma, Draco ve meshopt, Web Worker'da ayrıştırma). OBJ'nin `.mtl` dosyaları ve dokuları, glTF'nin harici `.bin` dosyaları ve görselleri ile DAE/FBX/3MF dokuları eşlik eden dosyalardan (📁 veya sürükleyip bırakma) okunur |
| CAD (B-rep) | `.step` `.stp` `.stpz` `.iges` `.igs` `.brep` | OpenCascade (occt-import-js, WebAssembly, Web Worker): montajlar, parça listesi, renkler, seçilebilir mozaikleme kalitesi. `.stpz`, gzip ile sıkıştırılmış STEP'tir |
| 2D CAD çizimleri | `.dxf` `.dwf` `.dwfx` | Kendi Canvas 2D işleyicimiz: DXF (ASCII ve ikili, R12–2018+, bloklar, ölçülendirmeler, taramalar, MTEXT, Korece metin), DWF (W2D akışları, paftalar, yedek küçük resim), DWFx (XPS sayfaları, gömülü yazı tipleri). Katman listesi, model/yerleşim (görünüm pencereleri)/pafta seçimi, açık/koyu arka plan, bilgi çubuğu. DXF dış referansları (xref) ve IMAGE nesneleri eşlik eden dosyalardan okunur (xref katmanları `XREF\|katman` olarak görünür) |
| AutoCAD çizimleri (ayrı eklenti) | `.dwg` `.dwt` | **File Preview DWG**: [ayrı depo](https://github.com/hangams84/orca-file-preview-dwg), GPL-3.0-or-later, ayrıca kurulur (Git URL'si `https://github.com/hangams84/orca-file-preview-dwg.git`, kaynak kodu [dwg-plugin/](dwg-plugin/README.md) içinde). LibreDWG (WebAssembly, Web Worker) + Canvas: model/yerleşimler, katmanlar, bloklar, Korece metin, ölçülendirmeler, taramalar |
| Robot tanımları (ROS) | `.urdf` `.xacro` | Kendi XML okuyucumuz ve xacro işlemcimiz (ROS 2 xacro 2.x kurallarına uygun, eval kullanmayan güvenli ifade değerlendirici) + three.js: kinematik ağaç, temel şekiller, orijinler ve malzemeler, altı eklem türünün tümü, sınırlar, mimic, eklem kaydırıcıları, görsel/çarpışma/koordinat çerçevesi/eklem ekseni gösterimi. `.urdf.xacro` dosyalarını da açar. Ağlar ve `xacro:include` dosyaları eşlik eden dosyalardan okunur |
| KiCad | `.kicad_sch` `.kicad_pcb` `.kicad_mod` `.kicad_sym` `.kicad_pro` `.kicad_wks` | Kendi S-ifadesi ayrıştırıcımız + SVG işleyicimiz (KiCad 6–10, KiCad'in newstroke çizgi yazı tipi): şemalar, baskılı devre kartları (katman gösterme/gizleme, ön/arka yüz çevirme), ayak izleri, sembol kütüphaneleri, proje özeti, pad, pin ve net araç ipuçları. Proje klasörüyle: hiyerarşik sayfalar arasında gezinme ve özel çizim çerçeveleri |
| SolidWorks | `.sldprt` `.sldasm` `.slddrw` `.slddrt` `.prtdot` `.asmdot` `.drwdot` | Kendi kapsayıcı okuyucumuz (2014'e kadar OLE/CFB, 2015 ve sonrası biçim): kayıtlı önizleme resimleri, parçanın 3D görüntü ağı, **3D montaj** (kayıtlı yerleşimler + ağlar; yoksa 📁 ile verilen parça dosyaları), özellikler, yapılandırmalar, başvurulan dosyalar, özellik adları, kayıt geçmişi |
| EPLAN Electric P8 | `.edz` `.zw1` `.elk` `.ell` `.elr` `.els` `.ela` `.elp` `.elx` `.zx1` `.ema` `.emp` | Kendi 7z (LZMA/LZMA2) ve ZIP okuyucumuz: EDZ parça verileri, resimler ve PDF belgeleri, **makro grafikleri** (PXF: çizgiler, yaylar, eğriler, metinler; varyant başına), özellikler, sayfa açıklamaları, **parça listesi**, resimler ve içerik ağacıyla proje yedekleri, bağlantı dosyaları + 📁 proje klasörü (`.edb`) |
| (okunamayan dosyalar) | Yukarıdaki tüm biçimler | Genel denetleyici: biçim tanıma, boyut, entropi, onaltılık döküm, dizeler |
| **File Preview paneli** | Yukarıdaki tüm biçimler | Sağ kenar çubuğunda bir panel; aşağıdaki [File Preview paneli](#file-preview-paneli) bölümüne bakın |

Her yerde: koyu/açık tema Orca'yı anında izler, Korece/İngilizce arayüz, Ctrl+tekerlek, iki parmakla sıkıştırma veya düğmelerle
yakınlaştırma, telefonlarda genişliğe sığdırma, dosya değiştiğinde otomatik yenileme ve hasarlı dosyalar için anlaşılır bir mesaj.

### Metin biçimleri doğrudan önizlemede açılır (0.4.0)

Orca; URDF, xacro, KiCad, draw.io, ASCII DXF, STEP/IGES/BREP, OBJ ve diğer metin tabanlı 3D biçimlerini, RTF/HTML olarak kaydedilmiş
`.doc` dosyalarını ve XML `.xls` dosyalarını metin olarak kabul eder. Eklenti bunlar için ayrı metin düzenleyicileri kaydeder; bu
nedenle bu dosyalar artık varsayılan olarak önizlemede açılır. Orca'nın kendisinin açtığı dosyalar (`.txt` `.csv` `.tsv` `.html`
`.htm`) ise Orca'nın kuralları gereği yine önce Source görünümünde açılır; önizlemeyi sekmenin sağ üst köşesindeki görünüm
değiştiriciden seçin.

### Eşlik eden dosyalar (📁 veya sürükleyip bırakma)

Orca, düzenleyiciye yalnızca açtığınız dosyayı verir. Araç çubuğundaki 📁 düğmesiyle bir klasör seçin (tek tek dosya seçmek için
Shift tuşunu basılı tutun) veya dosyaları önizlemenin üzerine bırakın; eklenti bunları korumalı alandaki çerçevesinde okur:

| Önizleme | Klasör veya bırakılan dosyalarla eklenenler |
| --- | --- |
| Robot (URDF/xacro) | Ağlar (STL, dokulu DAE, `.mtl` dosyalı OBJ, glTF) yer tutucuların yerini alır, eklem pozu korunur; `xacro:include` çözümlenir (`$(find pkg)`, göreli yollar, iç içe) |
| 3D | OBJ malzemeleri ve dokuları, glTF harici `.bin` dosyaları ve görselleri, DAE dokuları |
| CAD çizimi (DXF) | Dış referanslar (xref) `XREF\|katman` olarak eklenir, IMAGE nesneleri çizilir |
| KiCad | Örnek başına referans tanımlayıcılarıyla alt sayfalar arasında gezinme, `.kicad_pro` → şema ve kart, özel `.kicad_wks` |
| SolidWorks | Kayıtlı yerleşimlerden **3D montaj** (2015 ve sonrası dosyalar parça dosyası gerektirmez; 2014 dosyaları verilen parçaları kullanır) |
| EPLAN | Makrolar çizilir (`.ema` `.emp`, `.edz` içindeki makrolar); `.elk` + `.edb` klasörü → proje özellikleri, sayfalar, parça listesi |

### File Preview paneli

Sağ kenar çubuğunda **File Preview** panelini açın ve "Open file…", "Open folder…" düğmelerini ya da sürükleyip bırakmayı kullanın
(eklentinin arayüzü yalnızca Korece ve İngilizcedir). Dosya aynı işleyicilerle gösterilir; Orca düzenleyicisinin 50 MB sınırı
uygulanmaz (yalnızca işleyicilerin kendi sınırları geçerlidir, en fazla 1 GB) ve çalışma alanı dışındaki dosyalar da açılabilir. Birlikte
açılan dosyalar eşlik eden dosya olarak kullanılır. Panel ek izin gerektirmez.

## Kurulum

### (a) Orca uygulamasında (önerilen)

Orca **1.4.252** veya üzeri gerekir.

1. **Ayarlar** → **Eklentiler**'i açın.
2. **Eklenti ekle** → **Bir Git URL’sinden…** seçeneğini seçin.
3. Depo URL'si alanına `https://github.com/hangams84/orca-file-preview.git` adresini yapıştırın, ardından **Devam** → **Yükle**'ye tıklayın.
4. Orca'nın gösterdiği erişimi (yalnızca korumalı alan arayüzü) kontrol edin ve **Eklentiyi etkinleştir**'e tıklayın.

Ekran görüntülü adım adım kılavuz: [docs/install-guide/tr.md](docs/install-guide/tr.md)

`.dwg` ve `.dwt` için `https://github.com/hangams84/orca-file-preview-dwg.git` adresini de aynı şekilde kurun.

### (b) Komut satırından

```sh
# GitHub'dan en son sürümü kurun (Orca 1.4.252+). Orca istenen erişimi ve onay parmak izini yazdırır.
orca plugin install https://github.com/hangams84/orca-file-preview
orca plugin install https://github.com/hangams84/orca-file-preview --approve <fingerprint>
# Belirli bir sürüm: https://github.com/hangams84/orca-file-preview#v0.4.0

# Veya yerel bir klasörden
orca plugin install ./plugin
```

### (c) Sürüm paketleri, yürütülebilir dosyalar ve betikler

Bunları [GitHub Releases](https://github.com/hangams84/orca-file-preview/releases) sayfasından indirin. Orca 1.4.248 veya üzerinin
kurulu olduğu ve en az bir kez çalıştırılmış bir bilgisayar gerekir; yönetici hakları gerekmez. Her yükleyici, Orca'nın onaylamanızı
istediği erişimi gösterir ve yalnızca siz onayladıktan sonra onay verir.

| İşletim sistemi | Yürütülebilir dosya | Betikler (zip veya tar.gz paketi) |
| --- | --- | --- |
| Windows 10/11 | `FilePreviewSetup-<sürüm>.exe` (menü: kur · güncelle · kaldır · durum) | `installer\windows\install.cmd` |
| macOS | `File-Preview-Setup-<sürüm>-macos.zip` → *File Preview Setup.app* | `installer/macos/Install File Preview.command` |
| macOS · Linux | `sh file-preview-setup-<sürüm>.run [install\|update\|uninstall\|status]` | `sh installer/linux/install.sh` (Linux) |

Yürütülebilir dosyalar imzalı değildir. Windows SmartScreen birini engellerse *Ek bilgi* → *Yine de çalıştır*'ı seçin; macOS'te
Gatekeeper'ı geçmek için Control tuşuna basılı tutarak tıklayın → *Aç*. Orca 1.4.248–1.4.251 sürümlerinde `plugin install` yoktur; bu
nedenle yükleyiciler klasörü `plugin dev load` ile kaydeder; bu durumda klasörü silmeyin. Orca, Windows 10 veya üzerini gerektirdiği
için Windows 7/8'de kurulum açık bir mesajla reddedilir. Tüm seçenekler: [installer/README.md](installer/README.md)

### (d) Güncelleme ve kaldırma

- **Orca uygulamasından veya CLI ile kurduysanız**: eklenti anahtarını `orca plugin list` ile bulun, ardından `orca plugin update <anahtar>`
  ile güncelleyin ve `orca plugin uninstall <anahtar>` ile kaldırın. Git URL'si ile yapılan kurulum, güncellendiğinde en yeni sürüm
  etiketine geçer.
- **Yürütülebilir dosyalar**: `FilePreviewSetup-<sürüm>.exe` menüsü (veya `/update` · `/uninstall`), `file-preview-setup-<sürüm>.run update|uninstall`
  ya da macOS'te *File Preview Setup.app*.
- **Betikler**: Windows `installer\windows\update.cmd` · `uninstall.cmd`, macOS `Update File Preview.command` ·
  `Uninstall File Preview.command`, Linux `sh installer/linux/update.sh` · `sh installer/linux/uninstall.sh`.
- Güncelleme, bu deponun GitHub'daki en son sürümünü denetler, paketi indirir, SHA-256 değerini doğrular ve onayınızdan sonra yeniden
  kurar. Önceki sürüm saklanır. `--check` (Windows'ta `-Check`) yalnızca denetler.

## Sınırlamalar

- **50 MB okuma sınırı**: Orca, bir eklenti düzenleyicisine bir dosyanın en fazla 50 MB'ını verir (görseller ve PDF'ler hariç; eklenti
  bunu değiştiremez, bkz. [stablyai/orca#46775](https://github.com/stablyai/orca/issues/46775)). Eklentinin kendisi 1 GB'a kadar kabul
  eder. Daha büyük dosyaları [File Preview paneli](#file-preview-paneli) ile açın. STEP dosyaları gzip ile sıkıştırılıp `.stpz` olarak
  da açılabilir (STEP genellikle 5–8 kat küçülür): `gzip -c model.step > model.stpz`.
- **CAD motorunun kaldırabildiği boyut**: OpenCascade (32 bit WebAssembly, en fazla 4 GB bellek) yaklaşık 200 MB STEP'e kadar pratik
  olarak kullanılabilir. Çok parçalı sentetik montajlarda ölçülen: 61 MB 1,5 dk · 189 MB 14 dk · 343 MB 30 dk içinde bitmez · 412 MB'ta
  bellek yetmez.
- **Önce Source görünümünde açılan biçimler**: `.txt` `.csv` `.tsv` `.html` `.htm` dosyalarını Orca kendisi açar, bu yüzden önce Source
  görünümü gelir. Önizlemeyi görünüm değiştiriciden seçin.
- **Çizilmeyenler**:
  - EPLAN: şema sayfaları (EPLAN'a özgü ikili nesne deposu, `.eod`/`.eox`) ve sembol kütüphanesi grafikleri.
  - SolidWorks: tam B-rep geometrisi ve çizim görünüşleri yeniden çizilmez, bunların yerine kayıtlı resimler gösterilir. Gizli ve
    bastırılmış bileşenler listelenir, çizilmez.
  - draw.io: pakete dahil olmayan şablon kütüphaneleri (`mxgraph.aws4.*` vb.) şablon adını taşıyan kesik çizgili bir kutu olarak, uzak
    görseller yer tutucu olarak gösterilir.
  - Visio: formüller hesaplanmaz (kayıtlı değerler kullanılır). İkili `.vsd` desteklenmez (açık bir mesaj gösterilir).
  - DWF: okuyucunun işleyemediği çizim komutları içeren bir pafta, pakette kayıtlı küçük resmi ve bir uyarıyı gösterir.
  - DWG (ayrı eklenti): 3D katılar ve bölgeler (ACIS), raster görsel içeriği, OLE nesneleri ve xref'ler çizilmez; bir notta listelenir.
  - Office: PPTX'teki grafikler ve SmartArt ile tablolardaki hücre stilleri basitleştirilir; elektronik tablolarda ilk 20.000 satır
    gösterilir. `.hwp` içindeki denklemler, grafikler ve OLE nesneleri etiketli kutular olarak gösterilir.
- Mobil istemciler gerçek cihazlarda değil, tarayıcı test düzeneğiyle (telefon profilleri, WebKit, eski motor modu) test edildi.

## Uyumluluk

Orca **1.4.248** veya üzeri; Git URL'si ile kurulum için **1.4.252** veya üzeri. Uyumluluk CI'ı her Orca sürümünü Ubuntu, macOS ve
Windows'a sıfırdan kurar, ardından eklentiyi kurup test eder. Sonuç tablosu yalnızca tek bir yerde, Korece README'de tutulur:
[Orca uyumluluğu (CI)](README.md#ci-matrix). Platform testlerinin kanıtları: `docs/evidence/platforms/`.

## Geliştirme

```sh
npm ci
npm run vendor            # üçüncü taraf kütüphaneleri plugin/vendor içine paketle
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
node tools/check-readmes.mjs   # 11 README'nin dil çubuğunu, bağlantılarını ve biçim tablosunu denetle
```

### Depo yapısı

```text
plugin/            dağıtılan eklenti (orca-plugin.json, editor/, panel/, vendor/)
dwg-plugin/        File Preview DWG kaynak kodu (GPL-3.0-or-later, ayrı eklenti)
installer/         Windows · macOS · Linux kurulum betikleri
samples/           test dosyaları (tools/make-samples.py vb.)
tools/harness/     Orca benzeri CSP ve sahte ana makineli tarayıcı test düzeneği (Playwright)
tools/verify.mjs   doğrulama turu çalıştırıcısı (tsc, validate, birim testleri, 4 düzenek profili, fuzzing, Orca uygulaması ekran görüntüleri)
docs/              geliştirme ve doğrulama belgeleri (README.md, index.html, evidence/, release-notes/)
```

Doğrulama kayıtları ve ekran görüntüleri: [docs/README.md](docs/README.md) · [docs/index.html](docs/index.html). Değişiklikler:
[CHANGELOG.md](CHANGELOG.md).

## Lisans

Bu proje MIT lisansıyla dağıtılır ([LICENSE](LICENSE)). Pakete dahil kütüphaneler kendi lisanslarını korur:
[plugin/THIRD_PARTY_NOTICES.md](plugin/THIRD_PARTY_NOTICES.md).
`.dwg` ve `.dwt` için **File Preview DWG**, GPL-3.0-or-later lisanslı ayrı bir eklentidir ve bu MIT eklentisinin parçası değildir.
