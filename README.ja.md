[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Türkçe](README.tr.md)

# File Preview for Orca

[![orca-compat](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml/badge.svg)](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml)

File Preview は、Office・ハングル（Hangul）・PDF・テキスト・画像・3D・CAD・電子設計ファイルを Orca の中で**読み取り専用で
プレビュー**する [Orca](https://github.com/stablyai/orca) プラグインです。Orca のデスクトップ版（Windows・macOS・Linux）と
ブラウザー／モバイルクライアントで動作します。

- 最新リリース: **v0.4.0** ・ Orca **1.4.248** 以降が必要です（Git URL からのインストールは **1.4.252** 以降）。
- 実行方式は `sandboxed-ui` のみです。追加の権限（capability）やネットワークアクセスは使わず、ファイルを変更することもありません。

## 対応形式

| 形式 | 拡張子 | エンジン・表示内容 |
| --- | --- | --- |
| Word | `.docx` `.doc` | docx-preview・独自の OLE/CFB パーサー（RTF・HTML・DOCX として保存された `.doc` を自動判別） |
| PowerPoint | `.pptx` `.ppt` | 独自の OOXML レンダラー・独自の PPT レコードパーサー |
| Excel | `.xlsx` `.xlsm` `.xls` `.ods` | SheetJS CE（Web Worker、数式計算のフォールバック、仮想スクロール） |
| ハングル文書 | `.hwp` `.hwpx` | HWP 5 と HWPX（OWPML）を、ハングルが保存した行レイアウトどおりに表示。配布用文書・パスワード付き文書・HWP 3 では案内メッセージを表示 |
| PDF | `.pdf` | pdf.js（遅延レンダリング、韓国語 CMap、パスワード入力） |
| 画像 | `.gif` `.bmp` `.svg` | ブラウザーのデコーダー（SVG のスクリプトをブロック、背景を選択可能） |
| Web | `.html` `.htm` `.xhtml` | DOMPurify + サンドボックス化された iframe（スクリプトは実行しません） |
| 表 | `.csv` `.tsv` | 独自の RFC 4180 パーサー（文字コード・区切り文字の判別、並べ替え、フィルター） |
| テキスト | `.txt` `.log` | 文字コード判別（UTF-8/16、EUC-KR など）、行番号、折り返し |
| ダイアグラム | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | 独自の SVG レンダラー: draw.io（圧縮・複数ページ、標準図形・コネクタ・スタイル、HTML ラベルは DOMPurify で無害化）、Visio（マスター・スタイルシートの継承、すべての Geometry 行、グループ・コネクタ・文字書式・塗りつぶしパターン・グラデーション・テーマ・EMF/WMF 画像・背景ページ）。ページ選択、移動・拡大・全体表示、ダークキャンバス、リンク |
| 3D モデル | `.stl` `.obj` `.ply` `.glb` `.gltf` `.3mf` `.off` `.fbx` `.dae` | three.js（WebGL、回転・拡大・移動、タッチ操作、Draco・meshopt、Web Worker で解析）。OBJ の `.mtl` とテクスチャ、glTF の外部 `.bin` と画像、DAE・FBX・3MF のテクスチャは関連ファイル（📁 またはドロップ）から読み込みます |
| CAD（B-rep） | `.step` `.stp` `.stpz` `.iges` `.igs` `.brep` | OpenCascade（occt-import-js、WebAssembly、Web Worker）: アセンブリ・部品リスト・色、テッセレーション品質の選択。`.stpz` は gzip 圧縮した STEP |
| 2D CAD 図面 | `.dxf` `.dwf` `.dwfx` | 独自の Canvas 2D レンダラー: DXF（ASCII・バイナリ、R12–2018+、ブロック・寸法・ハッチング・MTEXT・韓国語）、DWF（W2D ストリーム、シート、サムネイルへのフォールバック）、DWFx（XPS ページ、埋め込みフォント）。画層リスト、モデル／レイアウト（ビューポート）／シートの選択、明るい／暗い背景、情報バー。DXF の外部参照（xref）と IMAGE は関連ファイルから読み込みます（xref の画層は `XREF\|画層`） |
| AutoCAD 図面（別プラグイン） | `.dwg` `.dwt` | **File Preview DWG** — [別リポジトリ](https://github.com/hangams84/orca-file-preview-dwg)、GPL-3.0-or-later、個別にインストールします（Git URL `https://github.com/hangams84/orca-file-preview-dwg.git`、ソースは [dwg-plugin/](dwg-plugin/README.md)）。LibreDWG（WebAssembly、Web Worker）+ Canvas: モデル／レイアウト、画層、ブロック、韓国語の文字、寸法、ハッチング |
| ロボット記述（ROS） | `.urdf` `.xacro` | 独自の XML リーダー + xacro プロセッサー（ROS 2 xacro 2.x の規則に準拠、eval を使わない安全な式評価）+ three.js: 機構ツリー、基本形状、原点・マテリアル、6 種類すべてのジョイント・可動範囲・mimic、ジョイントスライダー、外観／衝突／座標系／ジョイント軸の表示切り替え。`.urdf.xacro` も開けます。メッシュと `xacro:include` は関連ファイルから読み込みます |
| KiCad | `.kicad_sch` `.kicad_pcb` `.kicad_mod` `.kicad_sym` `.kicad_pro` `.kicad_wks` | 独自の S 式パーサー + SVG レンダラー（KiCad 6–10、KiCad のストロークフォント newstroke）: 回路図、基板（レイヤーの表示／非表示、表裏の反転）、フットプリント、シンボルライブラリ、プロジェクト概要、パッド・ピン・ネットのツールチップ。プロジェクトフォルダーを渡すと階層シートの移動とカスタム図面枠の表示に対応 |
| SolidWorks | `.sldprt` `.sldasm` `.slddrw` `.slddrt` `.prtdot` `.asmdot` `.drwdot` | 独自のコンテナリーダー（2014 以前の OLE/CFB、2015 以降の形式）: 保存されたプレビュー画像、部品の表示メッシュ（3D）、**アセンブリ 3D**（保存された配置 + メッシュ、なければ 📁 で渡した部品ファイル）、プロパティ・コンフィギュレーション・参照ファイル・フィーチャー名・保存履歴 |
| EPLAN Electric P8 | `.edz` `.zw1` `.elk` `.ell` `.elr` `.els` `.ela` `.elp` `.elx` `.zx1` `.ema` `.emp` | 独自の 7z（LZMA/LZMA2）・ZIP リーダー: EDZ の部品データ・画像・PDF 文書、**マクロ図形**（PXF: 線・円弧・曲線・文字、バリアント別）、プロジェクトバックアップのプロパティ・ページ説明・**部品リスト**・画像・内容ツリー、リンクファイル + 📁 プロジェクトフォルダー（`.edb`） |
| （読み取れないファイル） | 上記すべての形式 | 汎用インスペクター: 形式の識別、サイズ、エントロピー、16 進ダンプ、文字列 |
| **File Preview パネル** | 上記すべての形式 | 右サイドバーのパネル。詳しくは下記の [File Preview パネル](#file-preview-パネル) を参照してください |

共通機能: Orca のダーク／ライトテーマへのリアルタイム追従、韓国語／英語の UI、Ctrl+ホイール・ピンチ・ボタンによる拡大縮小、
スマートフォン画面での幅合わせ、ファイル変更時の自動更新、破損ファイルに対するわかりやすいエラー表示。

### テキスト形式もそのままプレビューで開きます（0.4.0）

URDF・xacro、KiCad、draw.io、ASCII DXF、STEP・IGES・BREP、OBJ などテキスト形式の 3D ファイル、RTF/HTML として保存された
`.doc`、XML 形式の `.xls` は、Orca がテキストファイルと判断します。プラグインがこれらのファイル用のテキストエディターを別途
登録しているため、既定でプレビューが開くようになりました。ただし、Orca が自分で開く形式（`.txt` `.csv` `.tsv` `.html` `.htm`）は
Orca の規則により Source ビューで先に開きます。タブ右上の表示切り替えボタンからプレビューを選んでください。

### 関連ファイル（📁 またはドロップ）

Orca がエディターに渡すのは、開いたファイル 1 つだけです。ツールバーの 📁 ボタンでフォルダーを選ぶか（Shift キーを押しながら
クリックするとファイルを個別に選択）、ファイルをプレビューにドロップすると、プラグインがサンドボックス化されたフレーム内で
それらのファイルもあわせて読み込みます。

| プレビュー | フォルダーやファイルを渡すと追加されるもの |
| --- | --- |
| ロボット（URDF/xacro） | メッシュ（STL、テクスチャ付き DAE、`.mtl` 付き OBJ、glTF）がプレースホルダーに置き換わり、ジョイントの姿勢はそのまま維持。`xacro:include` を展開（`$(find pkg)`、相対パス、入れ子） |
| 3D | OBJ のマテリアルとテクスチャ、glTF の外部 `.bin` と画像、DAE のテクスチャ |
| CAD 図面（DXF） | 外部参照（xref）を `XREF\|画層` として挿入、IMAGE 図形を描画 |
| KiCad | サブシートの移動（インスタンスごとのリファレンス）、`.kicad_pro` → 回路図・基板、カスタム `.kicad_wks` |
| SolidWorks | 保存された配置から**アセンブリ 3D** を表示（2015 以降のファイルは部品ファイル不要、2014 のファイルは渡された部品を使用） |
| EPLAN | マクロの描画（`.ema` `.emp`、`.edz` 内のマクロ）、`.elk` + `.edb` フォルダー → プロジェクトのプロパティ、ページ、部品リスト |

### File Preview パネル

右サイドバーの **File Preview** パネルで「Open file…」「Open folder…」を使うか、ファイルをドロップすると、同じレンダラーで
表示します（プラグインの UI は韓国語と英語のみです）。Orca のエディターの 50 MB 上限を受けず（レンダラー自体の上限、最大 1 GB）、
ワークスペース外のファイルも開けます。一緒に開いたファイルは関連ファイルとして使われます。追加の権限は必要ありません。

## インストール

### (a) Orca アプリでインストール（推奨）

Orca **1.4.252** 以降が必要です。

1. **設定** → **プラグイン** を開きます。
2. **プラグインを追加** → **Git URL から…** を選びます。
3. **リポジトリ URL** に `https://github.com/hangams84/orca-file-preview.git` を貼り付け、**続行** → **インストール** をクリックします。
4. Orca が表示するアクセス権（サンドボックス化された UI のみ）を確認し、**プラグインを有効にする** をクリックします。

スクリーンショット付きの手順: [docs/install-guide/ja.md](docs/install-guide/ja.md)

`.dwg`・`.dwt` が必要な場合は、同じ手順で `https://github.com/hangams84/orca-file-preview-dwg.git` もインストールしてください。

### (b) コマンドラインでインストール

```sh
# GitHub から最新版をインストール（Orca 1.4.252+）。Orca が要求する権限と承認用フィンガープリントを表示します。
orca plugin install https://github.com/hangams84/orca-file-preview
orca plugin install https://github.com/hangams84/orca-file-preview --approve <fingerprint>
# 特定のバージョン: https://github.com/hangams84/orca-file-preview#v0.4.0

# またはローカルフォルダーから
orca plugin install ./plugin
```

### (c) リリースパッケージ・実行ファイル・スクリプト

[GitHub Releases](https://github.com/hangams84/orca-file-preview/releases) からダウンロードします。Orca 1.4.248 以降がインストール
済みで、一度以上起動したことのある PC が必要です。管理者権限は必要ありません。どのインストーラーも Orca が承認を求める権限を
表示し、確認したあとでのみ承認します。

| OS | 実行ファイル | スクリプト（zip・tar.gz パッケージ） |
| --- | --- | --- |
| Windows 10/11 | `FilePreviewSetup-<バージョン>.exe`（メニュー: インストール・更新・削除・状態） | `installer\windows\install.cmd` |
| macOS | `File-Preview-Setup-<バージョン>-macos.zip` → *File Preview Setup.app* | `installer/macos/Install File Preview.command` |
| macOS・Linux | `sh file-preview-setup-<バージョン>.run [install\|update\|uninstall\|status]` | `sh installer/linux/install.sh`（Linux） |

実行ファイルには署名がありません。Windows SmartScreen にブロックされた場合は *詳細情報* → *実行* を選び、macOS の Gatekeeper では
Control キーを押しながらクリック → *開く* を選びます。Orca 1.4.248–1.4.251 には `plugin install` がないため、インストーラーは
`plugin dev load` による開発フォルダー登録でインストールします。この場合、フォルダーは削除しないでください。Windows 7/8 は Orca が
対応していないため、インストーラーが案内を表示してインストールを中止します（Windows 10 以降が必要）。すべてのオプション:
[installer/README.md](installer/README.md)

### (d) 更新とアンインストール

- **Orca アプリまたは CLI でインストールした場合**: `orca plugin list` でプラグインのキーを確認し、`orca plugin update <キー>` で
  更新、`orca plugin uninstall <キー>` で削除します。Git URL からインストールしたものは、更新すると最新のバージョンタグに移行します。
- **実行ファイル**: `FilePreviewSetup-<バージョン>.exe` のメニュー（または `/update`・`/uninstall`）、`file-preview-setup-<バージョン>.run update|uninstall`、
  macOS では *File Preview Setup.app* から選びます。
- **スクリプト**: Windows は `installer\windows\update.cmd`・`uninstall.cmd`、macOS は `Update File Preview.command`・
  `Uninstall File Preview.command`、Linux は `sh installer/linux/update.sh`・`sh installer/linux/uninstall.sh`。
- 更新では、このリポジトリの最新の GitHub リリースを確認してパッケージをダウンロードし、SHA-256 を検証したうえで、承認を経て
  再インストールします。以前のバージョンを 1 つ保持します。`--check`（Windows は `-Check`）は確認のみを行います。

## 制限事項

- **50 MB の読み込み上限**: Orca がプラグインのエディターに渡すのはファイルの最大 50 MB までです（画像と PDF を除く。プラグイン
  からは変更できません。[stablyai/orca#46775](https://github.com/stablyai/orca/issues/46775)）。プラグイン自体の上限は 1 GB です。
  これより大きいファイルは [File Preview パネル](#file-preview-パネル) で開いてください。STEP ファイルは gzip で圧縮して `.stpz`
  として開くこともできます（STEP は通常 5～8 分の 1 になります）: `gzip -c model.step > model.stpz`
- **CAD エンジンの規模**: OpenCascade（32 ビット WebAssembly、最大 4 GB のメモリ）の実用上の上限は STEP の元ファイルで約 200 MB
  です。実測（部品数の多い合成アセンブリ）: 61 MB で 1.5 分、189 MB で 14 分、343 MB は 30 分以内に完了せず、412 MB はメモリ不足。
- **Source ビューで先に開く形式**: `.txt` `.csv` `.tsv` `.html` `.htm` は Orca 自身が開く形式のため、Source ビューが先に表示されます。
  プレビューは表示切り替えボタンから選んでください。
- **描画しない内容**:
  - EPLAN: 回路図ページ（EPLAN 独自のバイナリオブジェクトストア `.eod`/`.eox`）とシンボルライブラリの図形。
  - SolidWorks: 正確な B-rep 形状と図面ビューは再描画せず、保存された画像を表示します。非表示・抑制されたコンポーネントは
    一覧にのみ表示します。
  - draw.io: 同梱していないステンシルライブラリ（`mxgraph.aws4.*` など）は、ステンシル名を記した破線の枠で表示します。リモートの
    画像はプレースホルダーで表示します。
  - Visio: 数式は評価せず、保存された値を使います。バイナリ形式の `.vsd` には対応していません（案内メッセージを表示）。
  - DWF: リーダーが処理できない描画命令を含むシートは、パッケージに保存されたサムネイルと案内を表示します。
  - DWG（別プラグイン）: 3D ソリッド・リージョン（ACIS）、ラスター画像の内容、OLE オブジェクト、xref は描画せず、注記に一覧表示します。
  - Office: PPTX のグラフ・SmartArt とシートのセルスタイルは簡略化して表示し、スプレッドシートは先頭の 20,000 行のみ表示します。
    `.hwp` の数式・グラフ・OLE オブジェクトは名前付きの枠で表示します。
- モバイルクライアントは実機ではなく、ブラウザーハーネス（スマートフォンのプロファイル、WebKit、旧エンジンモード）で検証しています。

## 互換性

Orca **1.4.248** 以降が必要です。Git URL からのインストールには **1.4.252** 以降が必要です。互換性 CI は Orca の各リリースを
Ubuntu・macOS・Windows に新規インストールし、プラグインをインストールしてテストします。結果の表は韓国語の README にのみ
掲載しています: [Orca の互換性（CI）](README.md#ci-matrix)。プラットフォーム別テストの記録: `docs/evidence/platforms/`

## 開発

```sh
npm ci
npm run vendor            # サードパーティライブラリを plugin/vendor にバンドル
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
node tools/check-readmes.mjs   # 11 言語の README の言語バー・リンク・形式表を検査
```

### リポジトリ構成

```text
plugin/            配布するプラグイン（orca-plugin.json、editor/、panel/、vendor/）
dwg-plugin/        File Preview DWG のソース（GPL-3.0-or-later、別プラグイン）
installer/         Windows・macOS・Linux 用インストールスクリプト
samples/           テスト用フィクスチャ（tools/make-samples.py など）
tools/harness/     Orca 相当の CSP とモックホストを備えたブラウザーハーネス（Playwright）
tools/verify.mjs   検証ラウンドの実行ツール（tsc、validate、単体テスト、ハーネス 4 プロファイル、ファジング、Orca アプリのキャプチャ）
docs/              開発・検証ドキュメント（README.md、index.html、evidence/、release-notes/）
```

検証記録とスクリーンショットは [docs/README.md](docs/README.md)・[docs/index.html](docs/index.html)、変更履歴は
[CHANGELOG.md](CHANGELOG.md) にあります。

## ライセンス

このプロジェクトは MIT ライセンスです（[LICENSE](LICENSE)）。同梱しているライブラリはそれぞれのライセンスに従います:
[plugin/THIRD_PARTY_NOTICES.md](plugin/THIRD_PARTY_NOTICES.md)。
`.dwg`・`.dwt` 用の **File Preview DWG** は GPL-3.0-or-later の別プラグインであり、この MIT プラグインには含まれていません。
