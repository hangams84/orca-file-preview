// Sentences of the install guide pages. {key} = a UI label exactly as captured from Orca's DOM in
// that language (rendered bold), [key] = the same as plain text, {url}/{dwgUrl} = the Git URLs.
// Step keys match the screenshot slugs of capture.mjs. Keep the wording short and literal to the UI.

export const LANGS = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文（简体）' },
  { code: 'zh-TW', name: '繁體中文（台灣）' },
  { code: 'ja', name: '日本語' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' }
]

export const TEXT = {
  ko: {
    title: 'File Preview 설치 안내 (Orca 앱)',
    intro: 'Orca 앱의 설정 화면에서 GitHub 주소로 File Preview 플러그인을 설치하고 켜는 방법입니다. 터미널은 필요 없습니다.',
    labelsNote: '스크린샷: Orca {version}, 한국어 UI. Orca 버전에 따라 이름이나 위치가 조금 다를 수 있습니다.',
    stepsHeading: '설치 순서',
    stepAlt: '{n}단계',
    steps: {
      'settings-button': 'Orca 창 왼쪽 아래의 {settingsButton} 버튼(톱니바퀴)을 누릅니다.',
      'settings-menu': '메뉴에서 {settingsMenu}을 고릅니다.',
      plugins: '왼쪽 설정 목록에서 {plugins}을 누릅니다.',
      'add-plugin': '오른쪽 위의 {addPlugin}를 누릅니다.',
      'from-git-url': '메뉴에서 {fromGit} 항목을 고릅니다.',
      'repository-url': '{dialogTitle} 창이 {gitTab} 탭으로 열립니다. {urlLabel} 칸에 아래 주소를 붙여 넣습니다.',
      continue: '{continue}을 누릅니다.',
      install: 'Orca가 최신 버전을 찾습니다(“[resolved]”). {install}를 누릅니다.',
      trust: '게시자를 신뢰하는지 묻는 창(“[trustTitle]”)이 나옵니다. {trustInstall}를 누릅니다.',
      enable: '플러그인 화면의 {canAccess}에서 플러그인이 하는 일(미리 볼 형식의 파일 열기)을 확인하고 {enable}를 누릅니다. {keepOff}를 누르면 설치만 되고 꺼진 채로 남습니다.',
      permissions: '권한 확인 창이 나오면 내용을 확인하고 {consentEnable}를 누릅니다.',
      enabled: '상태가 {on}으로 바뀌었습니다. {backToApp}를 누릅니다.',
      'open-sample': '탐색기에서 지원하는 파일(예: {sample})을 엽니다.',
      preview: '파일이 미리보기로 열립니다.',
      'optional-dwg': '선택: DWG 도면도 보려면 같은 방법(4–10단계)으로 DWG 확장 플러그인을 설치합니다. 아래 주소를 붙여 넣고 {continue}, {install}를 누른 뒤 켭니다.'
    },
    troubleHeading: '문제 해결',
    trouble: [
      '**Git URL로 설치가 안 될 때**: Git URL 설치는 Orca 1.4.252 이상이 필요합니다. Orca를 업데이트한 뒤 다시 해 보세요.',
      '**“plugin exceeds the install size or file count limit” 오류**: v0.2.2보다 오래된 태그(v0.1.0–v0.2.1)에서만 생긴 문제입니다. 위 주소를 `#태그` 없이 그대로 쓰면 Orca가 최신 버전을 설치합니다.',
      '**`.txt` `.csv` `.tsv` `.html` `.htm` 파일이 글자로 열릴 때**: Orca가 직접 여는 형식이라 Source 보기로 먼저 열립니다. 탭 오른쪽 위의 보기 전환 버튼으로 미리보기를 고르세요.',
      '**3D 모델·로봇(URDF)·도면에서 텍스처, 메시, 참조 파일이 빠질 때**: 편집기는 연 파일 하나만 받습니다. 미리보기 도구 모음의 📁 버튼으로 참조 파일이 있는 폴더를 고르거나(Shift: 파일 여러 개), 파일을 미리보기에 끌어 놓으세요.',
      '**50 MB보다 큰 파일(“exceeds 50MB limit”)**: Orca는 편집기에 50 MB까지만 넘깁니다. 오른쪽 사이드바의 **File Preview** 패널에서 “파일 열기…”로 열면 이 한도가 없습니다(최대 1 GB).'
    ],
    footer: '[다른 언어](README.md) · [File Preview 저장소](https://github.com/hangams84/orca-file-preview)'
  },

  en: {
    title: 'Installing File Preview (Orca app)',
    intro: 'How to install and turn on the File Preview plugin from its GitHub URL in the Orca app settings. No terminal needed.',
    labelsNote: 'Screenshots: Orca {version}, English UI. Names and positions can differ slightly in other Orca versions.',
    stepsHeading: 'Steps',
    stepAlt: 'Step {n}',
    steps: {
      'settings-button': 'Click the {settingsButton} button (gear icon) at the bottom left of the Orca window.',
      'settings-menu': 'Choose {settingsMenu} in the menu.',
      plugins: 'In the settings list on the left, click {plugins}.',
      'add-plugin': 'Click {addPlugin} at the top right.',
      'from-git-url': 'Choose {fromGit}.',
      'repository-url': 'The {dialogTitle} dialog opens on the {gitTab} tab. Paste this address into {urlLabel}:',
      continue: 'Click {continue}.',
      install: 'Orca finds the newest version (“[resolved]”). Click {install}.',
      trust: 'Orca asks whether you trust the publisher (“[trustTitle]”). Click {trustInstall}.',
      enable: 'The plugin page shows the {canAccess} list: the plugin only opens the file types it previews. Click {enable}. ({keepOff} leaves it installed but off.)',
      permissions: 'If a permission prompt appears, check it and click {consentEnable}.',
      enabled: 'The status now shows {on}. Click {backToApp}.',
      'open-sample': 'Open a supported file in the Explorer, for example {sample}.',
      preview: 'The file opens in the preview.',
      'optional-dwg': 'Optional: to view DWG drawings, install the DWG companion plugin the same way (steps 4–10). Paste the address below, click {continue} and {install}, then turn it on.'
    },
    troubleHeading: 'Troubleshooting',
    trouble: [
      '**Installing from the Git URL does not work**: installing from a Git URL needs Orca 1.4.252 or newer. Update Orca and try again.',
      '**“plugin exceeds the install size or file count limit”**: this happened only with old tags (v0.1.0–v0.2.1), before v0.2.2. Use the address above without a `#tag`; Orca then installs the newest version.',
      '**A `.txt` `.csv` `.tsv` `.html` `.htm` file opens as text**: Orca opens these types itself, in the Source view first. Pick the preview with the view toggle at the top right of the tab.',
      '**A 3D model, robot (URDF) or drawing misses textures, meshes or referenced files**: the editor only gets the opened file. Click the 📁 button in the preview toolbar and pick the folder with the referenced files (Shift: single files), or drop them on the preview.',
      '**Files over 50 MB (“exceeds 50MB limit”)**: Orca hands an editor at most 50 MB. Open the file with “Open file…” in the **File Preview** panel in the right sidebar; it has no such limit (up to 1 GB).'
    ],
    footer: '[Other languages](README.md) · [File Preview repository](https://github.com/hangams84/orca-file-preview)'
  },

  'zh-CN': {
    title: '安装 File Preview（Orca 应用）',
    intro: '在 Orca 应用的设置中，通过 GitHub 地址安装并启用 File Preview 插件。无需使用终端。',
    labelsNote: '截图：Orca {version}，简体中文界面。其他 Orca 版本中的名称和位置可能略有不同。',
    stepsHeading: '步骤',
    stepAlt: '第 {n} 步',
    steps: {
      'settings-button': '点击 Orca 窗口左下角的 {settingsButton} 按钮（齿轮图标）。',
      'settings-menu': '在菜单中选择 {settingsMenu}。',
      plugins: '在左侧的设置列表中点击 {plugins}。',
      'add-plugin': '点击右上角的 {addPlugin}。',
      'from-git-url': '选择 {fromGit}。',
      'repository-url': '{dialogTitle} 对话框会在 {gitTab} 标签页中打开。将下面的地址粘贴到 {urlLabel}：',
      continue: '点击 {continue}。',
      install: 'Orca 会找到最新版本（“[resolved]”）。点击 {install}。',
      trust: 'Orca 会询问你是否信任发布者（“[trustTitle]”）。点击 {trustInstall}。',
      enable: '插件页面的 {canAccess} 部分列出了插件能做的事：打开它预览的文件类型。点击 {enable}。（选择 {keepOff} 则只安装，不启用。）',
      permissions: '如果出现权限提示，请确认后点击 {consentEnable}。',
      enabled: '状态现在显示为 {on}。点击 {backToApp}。',
      'open-sample': '在资源管理器中打开一个支持的文件，例如 {sample}。',
      preview: '文件会在预览中打开。',
      'optional-dwg': '可选：如需查看 DWG 图纸，请用同样的方法（第 4–10 步）安装 DWG 配套插件。粘贴下面的地址，点击 {continue} 和 {install}，然后启用它。'
    },
    troubleHeading: '故障排除',
    trouble: [
      '**无法通过 Git URL 安装**：通过 Git URL 安装需要 Orca 1.4.252 或更高版本。请更新 Orca 后重试。',
      '**“plugin exceeds the install size or file count limit”**：此问题只出现在 v0.2.2 之前的旧标签（v0.1.0–v0.2.1）。请使用上面不带 `#标签` 的地址，Orca 会安装最新版本。',
      '**`.txt` `.csv` `.tsv` `.html` `.htm` 文件以文本形式打开**：这些类型由 Orca 自己打开，先显示 Source 视图。请用标签页右上角的视图切换按钮选择预览。',
      '**3D 模型、机器人（URDF）或图纸缺少纹理、网格或引用文件**：编辑器只会收到打开的那个文件。点击预览工具栏中的 📁 按钮，选择包含引用文件的文件夹（按住 Shift：选择单个文件），或将文件拖放到预览中。',
      '**超过 50 MB 的文件（“exceeds 50MB limit”）**：Orca 最多向编辑器传递 50 MB。请在右侧边栏的 **File Preview** 面板中用 “Open file…” 打开文件，它没有这个限制（最大 1 GB）。'
    ],
    footer: '[其他语言](README.md) · [File Preview 仓库](https://github.com/hangams84/orca-file-preview)'
  },

  'zh-TW': {
    title: '安裝 File Preview（Orca 應用程式）',
    intro: '在 Orca 應用程式的設定中，透過 GitHub 網址安裝並啟用 File Preview 外掛。不需要使用終端機。',
    labelsNote: '截圖：Orca {version}，繁體中文介面。其他 Orca 版本中的名稱和位置可能略有不同。',
    stepsHeading: '步驟',
    stepAlt: '第 {n} 步',
    steps: {
      'settings-button': '點選 Orca 視窗左下角的 {settingsButton} 按鈕（齒輪圖示）。',
      'settings-menu': '在選單中選擇 {settingsMenu}。',
      plugins: '在左側的設定清單中點選 {plugins}。',
      'add-plugin': '點選右上角的 {addPlugin}。',
      'from-git-url': '選擇 {fromGit}。',
      'repository-url': '{dialogTitle} 對話框會在 {gitTab} 分頁中開啟。將下面的網址貼到 {urlLabel}：',
      continue: '點選 {continue}。',
      install: 'Orca 會找到最新版本（「[resolved]」）。點選 {install}。',
      trust: 'Orca 會詢問你是否信任發布者（「[trustTitle]」）。點選 {trustInstall}。',
      enable: '外掛頁面的 {canAccess} 部分列出了外掛能做的事：開啟它預覽的檔案類型。點選 {enable}。（選擇 {keepOff} 則只安裝、不啟用。）',
      permissions: '如果出現權限提示，請確認後點選 {consentEnable}。',
      enabled: '狀態現在顯示為 {on}。點選 {backToApp}。',
      'open-sample': '在檔案總管中開啟一個支援的檔案，例如 {sample}。',
      preview: '檔案會在預覽中開啟。',
      'optional-dwg': '選用：如需檢視 DWG 圖面，請用同樣的方法（第 4–10 步）安裝 DWG 配套外掛。貼上下面的網址，點選 {continue} 和 {install}，然後啟用它。'
    },
    troubleHeading: '疑難排解',
    trouble: [
      '**無法透過 Git URL 安裝**：透過 Git URL 安裝需要 Orca 1.4.252 或更新版本。請更新 Orca 後再試一次。',
      '**「plugin exceeds the install size or file count limit」**：這個問題只發生在 v0.2.2 之前的舊標籤（v0.1.0–v0.2.1）。請使用上面不帶 `#標籤` 的網址，Orca 會安裝最新版本。',
      '**`.txt` `.csv` `.tsv` `.html` `.htm` 檔案以文字形式開啟**：這些類型由 Orca 自己開啟，會先顯示 Source 檢視。請用分頁右上角的檢視切換按鈕選擇預覽。',
      '**3D 模型、機器人（URDF）或圖面缺少材質、網格或參照檔案**：編輯器只會收到開啟的那個檔案。點選預覽工具列中的 📁 按鈕，選擇含有參照檔案的資料夾（按住 Shift：選擇個別檔案），或將檔案拖放到預覽中。',
      '**超過 50 MB 的檔案（「exceeds 50MB limit」）**：Orca 最多只會傳 50 MB 給編輯器。請在右側邊欄的 **File Preview** 面板中用「Open file…」開啟檔案，它沒有這個限制（最大 1 GB）。'
    ],
    footer: '[其他語言](README.md) · [File Preview 儲存庫](https://github.com/hangams84/orca-file-preview)'
  },

  ja: {
    title: 'File Preview のインストール（Orca アプリ）',
    intro: 'Orca アプリの設定から、GitHub の URL で File Preview プラグインをインストールして有効にする手順です。ターミナルは不要です。',
    labelsNote: 'スクリーンショット：Orca {version}、日本語 UI。Orca のバージョンによって名前や位置が少し異なる場合があります。',
    stepsHeading: '手順',
    stepAlt: '手順 {n}',
    steps: {
      'settings-button': 'Orca ウィンドウ左下の {settingsButton} ボタン（歯車アイコン）をクリックします。',
      'settings-menu': 'メニューから {settingsMenu} を選びます。',
      plugins: '左側の設定一覧で {plugins} をクリックします。',
      'add-plugin': '右上の {addPlugin} をクリックします。',
      'from-git-url': '{fromGit} を選びます。',
      'repository-url': '{dialogTitle} ダイアログが {gitTab} タブで開きます。{urlLabel} に次のアドレスを貼り付けます。',
      continue: '{continue} をクリックします。',
      install: 'Orca が最新バージョンを見つけます（「[resolved]」）。{install} をクリックします。',
      trust: '発行者を信頼するか確認されます（「[trustTitle]」）。{trustInstall} をクリックします。',
      enable: 'プラグインのページの {canAccess} に、プラグインができること（プレビューする形式のファイルを開くこと）が表示されます。{enable} をクリックします。（{keepOff} を選ぶと、インストールだけして無効のままになります。）',
      permissions: '権限の確認が表示されたら、内容を確認して {consentEnable} をクリックします。',
      enabled: '状態が {on} になりました。{backToApp} をクリックします。',
      'open-sample': 'エクスプローラーで対応ファイル（例：{sample}）を開きます。',
      preview: 'ファイルがプレビューで開きます。',
      'optional-dwg': '任意：DWG 図面も表示するには、同じ方法（手順 4–10）で DWG 用の追加プラグインをインストールします。次のアドレスを貼り付け、{continue}、{install} をクリックしてから有効にします。'
    },
    troubleHeading: 'トラブルシューティング',
    trouble: [
      '**Git URL からインストールできない**：Git URL からのインストールには Orca 1.4.252 以降が必要です。Orca を更新してからもう一度お試しください。',
      '**「plugin exceeds the install size or file count limit」**：v0.2.2 より前の古いタグ（v0.1.0–v0.2.1）でのみ起きた問題です。上のアドレスを `#タグ` なしで使えば、Orca が最新バージョンをインストールします。',
      '**`.txt` `.csv` `.tsv` `.html` `.htm` ファイルがテキストで開く**：これらは Orca 自身が開く形式で、まず Source 表示で開きます。タブ右上の表示切り替えボタンでプレビューを選んでください。',
      '**3D モデル、ロボット（URDF）、図面でテクスチャ・メッシュ・参照ファイルが表示されない**：エディターが受け取るのは開いたファイルだけです。プレビューのツールバーの 📁 ボタンで参照ファイルのあるフォルダーを選ぶか（Shift：個別のファイル）、ファイルをプレビューにドロップしてください。',
      '**50 MB を超えるファイル（「exceeds 50MB limit」）**：Orca がエディターに渡すのは最大 50 MB です。右サイドバーの **File Preview** パネルで「Open file…」から開くと、この制限はありません（最大 1 GB）。'
    ],
    footer: '[ほかの言語](README.md) · [File Preview リポジトリ](https://github.com/hangams84/orca-file-preview)'
  },

  de: {
    title: 'File Preview installieren (Orca-App)',
    intro: 'So installieren und aktivieren Sie das Plugin File Preview über seine GitHub-URL in den Einstellungen der Orca-App. Ein Terminal ist nicht nötig.',
    labelsNote: 'Screenshots: Orca {version}, deutsche Oberfläche. In anderen Orca-Versionen können Namen und Positionen leicht abweichen. Der Pfad oben („Settings / …“) ist in Orca noch nicht übersetzt.',
    stepsHeading: 'Schritte',
    stepAlt: 'Schritt {n}',
    steps: {
      'settings-button': 'Klicken Sie unten links im Orca-Fenster auf die Schaltfläche {settingsButton} (Zahnrad).',
      'settings-menu': 'Wählen Sie im Menü {settingsMenu}.',
      plugins: 'Klicken Sie links in der Liste der Einstellungen auf {plugins}.',
      'add-plugin': 'Klicken Sie oben rechts auf {addPlugin}.',
      'from-git-url': 'Wählen Sie {fromGit}.',
      'repository-url': 'Der Dialog {dialogTitle} öffnet sich auf dem Tab {gitTab}. Fügen Sie diese Adresse in {urlLabel} ein:',
      continue: 'Klicken Sie auf {continue}.',
      install: 'Orca findet die neueste Version („[resolved]“). Klicken Sie auf {install}.',
      trust: 'Orca fragt, ob Sie dem Herausgeber vertrauen („[trustTitle]“). Klicken Sie auf {trustInstall}.',
      enable: 'Die Plugin-Seite zeigt unter {canAccess}, was das Plugin darf: die Dateitypen öffnen, die es anzeigt. Klicken Sie auf {enable}. ({keepOff} lässt es installiert, aber ausgeschaltet.)',
      permissions: 'Wenn eine Berechtigungsabfrage erscheint, prüfen Sie sie und klicken Sie auf {consentEnable}.',
      enabled: 'Der Status zeigt jetzt {on}. Klicken Sie auf {backToApp}.',
      'open-sample': 'Öffnen Sie im Explorer eine unterstützte Datei, zum Beispiel {sample}.',
      preview: 'Die Datei öffnet sich in der Vorschau.',
      'optional-dwg': 'Optional: Um DWG-Zeichnungen anzuzeigen, installieren Sie das DWG-Zusatz-Plugin auf dieselbe Weise (Schritte 4–10). Fügen Sie die Adresse unten ein, klicken Sie auf {continue} und {install} und schalten Sie es dann ein.'
    },
    troubleHeading: 'Fehlerbehebung',
    trouble: [
      '**Die Installation über die Git-URL funktioniert nicht**: Die Installation über eine Git-URL braucht Orca 1.4.252 oder neuer. Aktualisieren Sie Orca und versuchen Sie es erneut.',
      '**„plugin exceeds the install size or file count limit“**: Das trat nur bei alten Tags (v0.1.0–v0.2.1) vor v0.2.2 auf. Verwenden Sie die Adresse oben ohne `#Tag`; Orca installiert dann die neueste Version.',
      '**Eine `.txt`-, `.csv`-, `.tsv`-, `.html`- oder `.htm`-Datei öffnet sich als Text**: Diese Typen öffnet Orca selbst, zuerst in der Ansicht Source. Wählen Sie die Vorschau mit dem Ansichtsumschalter oben rechts im Tab.',
      '**Einem 3D-Modell, Roboter (URDF) oder einer Zeichnung fehlen Texturen, Meshes oder referenzierte Dateien**: Der Editor erhält nur die geöffnete Datei. Klicken Sie in der Symbolleiste der Vorschau auf 📁 und wählen Sie den Ordner mit den referenzierten Dateien (Umschalt: einzelne Dateien), oder ziehen Sie die Dateien auf die Vorschau.',
      '**Dateien über 50 MB („exceeds 50MB limit“)**: Orca übergibt einem Editor höchstens 50 MB. Öffnen Sie die Datei mit „Open file…“ im Panel **File Preview** in der rechten Seitenleiste; dort gibt es diese Grenze nicht (bis 1 GB).'
    ],
    footer: '[Andere Sprachen](README.md) · [File-Preview-Repository](https://github.com/hangams84/orca-file-preview)'
  },

  fr: {
    title: 'Installer File Preview (application Orca)',
    intro: 'Comment installer et activer le plugin File Preview depuis son URL GitHub dans les paramètres de l’application Orca. Aucun terminal n’est nécessaire.',
    labelsNote: 'Captures : Orca {version}, interface en français. Les noms et les positions peuvent varier légèrement dans d’autres versions d’Orca. Le chemin en haut (« Settings / … ») n’est pas encore traduit dans Orca.',
    stepsHeading: 'Étapes',
    stepAlt: 'Étape {n}',
    steps: {
      'settings-button': 'Cliquez sur le bouton {settingsButton} (roue dentée) en bas à gauche de la fenêtre Orca.',
      'settings-menu': 'Choisissez {settingsMenu} dans le menu.',
      plugins: 'Dans la liste des paramètres à gauche, cliquez sur {plugins}.',
      'add-plugin': 'Cliquez sur {addPlugin} en haut à droite.',
      'from-git-url': 'Choisissez {fromGit}.',
      'repository-url': 'La fenêtre {dialogTitle} s’ouvre sur l’onglet {gitTab}. Collez cette adresse dans {urlLabel} :',
      continue: 'Cliquez sur {continue}.',
      install: 'Orca trouve la dernière version (« [resolved] »). Cliquez sur {install}.',
      trust: 'Orca vous demande si vous faites confiance à l’éditeur (« [trustTitle] »). Cliquez sur {trustInstall}.',
      enable: 'La page du plugin indique sous {canAccess} ce que le plugin peut faire : ouvrir les types de fichiers qu’il affiche. Cliquez sur {enable}. ({keepOff} le laisse installé mais désactivé.)',
      permissions: 'Si une demande d’autorisation s’affiche, vérifiez-la et cliquez sur {consentEnable}.',
      enabled: 'L’état indique maintenant {on}. Cliquez sur {backToApp}.',
      'open-sample': 'Ouvrez un fichier pris en charge dans l’explorateur, par exemple {sample}.',
      preview: 'Le fichier s’ouvre dans l’aperçu.',
      'optional-dwg': 'Facultatif : pour afficher les dessins DWG, installez le plugin complémentaire DWG de la même façon (étapes 4 à 10). Collez l’adresse ci-dessous, cliquez sur {continue} puis sur {install}, puis activez-le.'
    },
    troubleHeading: 'Dépannage',
    trouble: [
      '**L’installation depuis l’URL Git ne fonctionne pas** : l’installation depuis une URL Git nécessite Orca 1.4.252 ou une version plus récente. Mettez Orca à jour et réessayez.',
      '**« plugin exceeds the install size or file count limit »** : ce problème ne touchait que les anciens tags (v0.1.0 à v0.2.1), avant v0.2.2. Utilisez l’adresse ci-dessus sans `#tag` ; Orca installe alors la dernière version.',
      '**Un fichier `.txt`, `.csv`, `.tsv`, `.html` ou `.htm` s’ouvre en texte** : Orca ouvre lui-même ces types, d’abord dans la vue Source. Choisissez l’aperçu avec le sélecteur de vue en haut à droite de l’onglet.',
      '**Un modèle 3D, un robot (URDF) ou un dessin n’affiche pas ses textures, maillages ou fichiers liés** : l’éditeur ne reçoit que le fichier ouvert. Cliquez sur le bouton 📁 de la barre d’outils de l’aperçu et choisissez le dossier des fichiers liés (Maj : fichiers individuels), ou déposez-les sur l’aperçu.',
      '**Fichiers de plus de 50 Mo (« exceeds 50MB limit »)** : Orca transmet au plus 50 Mo à un éditeur. Ouvrez le fichier avec « Open file… » dans le panneau **File Preview** de la barre latérale droite ; il n’a pas cette limite (jusqu’à 1 Go).'
    ],
    footer: '[Autres langues](README.md) · [Dépôt File Preview](https://github.com/hangams84/orca-file-preview)'
  },

  es: {
    title: 'Instalar File Preview (aplicación Orca)',
    intro: 'Cómo instalar y activar el plugin File Preview desde su URL de GitHub en la configuración de la aplicación Orca. No hace falta usar la terminal.',
    labelsNote: 'Capturas: Orca {version}, interfaz en español. Los nombres y las posiciones pueden variar un poco en otras versiones de Orca. La ruta de arriba («Settings / …») todavía no está traducida en Orca.',
    stepsHeading: 'Pasos',
    stepAlt: 'Paso {n}',
    steps: {
      'settings-button': 'Haz clic en el botón {settingsButton} (engranaje), abajo a la izquierda de la ventana de Orca.',
      'settings-menu': 'Elige {settingsMenu} en el menú.',
      plugins: 'En la lista de configuración de la izquierda, haz clic en {plugins}.',
      'add-plugin': 'Haz clic en {addPlugin}, arriba a la derecha.',
      'from-git-url': 'Elige {fromGit}.',
      'repository-url': 'El cuadro {dialogTitle} se abre en la pestaña {gitTab}. Pega esta dirección en {urlLabel}:',
      continue: 'Haz clic en {continue}.',
      install: 'Orca encuentra la versión más reciente («[resolved]»). Haz clic en {install}.',
      trust: 'Orca pregunta si confías en el editor («[trustTitle]»). Haz clic en {trustInstall}.',
      enable: 'La página del plugin muestra en {canAccess} lo que puede hacer el plugin: abrir los tipos de archivo que previsualiza. Haz clic en {enable}. ({keepOff} lo deja instalado pero desactivado.)',
      permissions: 'Si aparece una solicitud de permisos, revísala y haz clic en {consentEnable}.',
      enabled: 'El estado ahora muestra {on}. Haz clic en {backToApp}.',
      'open-sample': 'Abre un archivo compatible en el explorador, por ejemplo {sample}.',
      preview: 'El archivo se abre en la vista previa.',
      'optional-dwg': 'Opcional: para ver planos DWG, instala el plugin complementario de DWG de la misma forma (pasos 4–10). Pega la dirección de abajo, haz clic en {continue} y en {install}, y luego actívalo.'
    },
    troubleHeading: 'Solución de problemas',
    trouble: [
      '**La instalación desde la URL de Git no funciona**: instalar desde una URL de Git requiere Orca 1.4.252 o posterior. Actualiza Orca y vuelve a intentarlo.',
      '**«plugin exceeds the install size or file count limit»**: esto solo ocurría con etiquetas antiguas (v0.1.0–v0.2.1), anteriores a v0.2.2. Usa la dirección de arriba sin `#etiqueta`; Orca instalará la versión más reciente.',
      '**Un archivo `.txt`, `.csv`, `.tsv`, `.html` o `.htm` se abre como texto**: Orca abre estos tipos por sí mismo, primero en la vista Source. Elige la vista previa con el selector de vista de la esquina superior derecha de la pestaña.',
      '**A un modelo 3D, robot (URDF) o plano le faltan texturas, mallas o archivos referenciados**: el editor solo recibe el archivo abierto. Haz clic en el botón 📁 de la barra de herramientas de la vista previa y elige la carpeta con los archivos referenciados (Mayús: archivos sueltos), o arrástralos a la vista previa.',
      '**Archivos de más de 50 MB («exceeds 50MB limit»)**: Orca pasa como máximo 50 MB a un editor. Abre el archivo con «Open file…» en el panel **File Preview** de la barra lateral derecha; no tiene ese límite (hasta 1 GB).'
    ],
    footer: '[Otros idiomas](README.md) · [Repositorio de File Preview](https://github.com/hangams84/orca-file-preview)'
  },

  'pt-BR': {
    title: 'Instalar o File Preview (app Orca)',
    intro: 'Como instalar e ativar o plugin File Preview pela URL do GitHub nas configurações do app Orca. Não é preciso usar o terminal.',
    labelsNote: 'Capturas: Orca {version}, interface em português (Brasil). Os nomes e as posições podem variar um pouco em outras versões do Orca. O caminho no topo (“Settings / …”) ainda não está traduzido no Orca.',
    stepsHeading: 'Passos',
    stepAlt: 'Passo {n}',
    steps: {
      'settings-button': 'Clique no botão {settingsButton} (engrenagem), no canto inferior esquerdo da janela do Orca.',
      'settings-menu': 'Escolha {settingsMenu} no menu.',
      plugins: 'Na lista de configurações à esquerda, clique em {plugins}.',
      'add-plugin': 'Clique em {addPlugin}, no canto superior direito.',
      'from-git-url': 'Escolha {fromGit}.',
      'repository-url': 'A janela {dialogTitle} abre na aba {gitTab}. Cole este endereço em {urlLabel}:',
      continue: 'Clique em {continue}.',
      install: 'O Orca encontra a versão mais recente (“[resolved]”). Clique em {install}.',
      trust: 'O Orca pergunta se você confia no publicador (“[trustTitle]”). Clique em {trustInstall}.',
      enable: 'A página do plugin mostra em {canAccess} o que o plugin pode fazer: abrir os tipos de arquivo que ele exibe. Clique em {enable}. ({keepOff} deixa o plugin instalado, mas desativado.)',
      permissions: 'Se aparecer um pedido de permissão, confira e clique em {consentEnable}.',
      enabled: 'O status agora mostra {on}. Clique em {backToApp}.',
      'open-sample': 'Abra um arquivo compatível no explorador, por exemplo {sample}.',
      preview: 'O arquivo abre na visualização.',
      'optional-dwg': 'Opcional: para ver desenhos DWG, instale o plugin complementar de DWG da mesma forma (passos 4–10). Cole o endereço abaixo, clique em {continue} e em {install} e depois ative-o.'
    },
    troubleHeading: 'Solução de problemas',
    trouble: [
      '**A instalação pela URL do Git não funciona**: instalar por uma URL do Git exige o Orca 1.4.252 ou mais recente. Atualize o Orca e tente de novo.',
      '**“plugin exceeds the install size or file count limit”**: isso só acontecia com tags antigas (v0.1.0–v0.2.1), anteriores à v0.2.2. Use o endereço acima sem `#tag`; o Orca então instala a versão mais recente.',
      '**Um arquivo `.txt`, `.csv`, `.tsv`, `.html` ou `.htm` abre como texto**: o próprio Orca abre esses tipos, primeiro na visualização Source. Escolha a pré-visualização com o seletor de visualização no canto superior direito da aba.',
      '**Faltam texturas, malhas ou arquivos referenciados em um modelo 3D, robô (URDF) ou desenho**: o editor só recebe o arquivo aberto. Clique no botão 📁 da barra de ferramentas da pré-visualização e escolha a pasta com os arquivos referenciados (Shift: arquivos avulsos), ou arraste-os para a pré-visualização.',
      '**Arquivos com mais de 50 MB (“exceeds 50MB limit”)**: o Orca passa no máximo 50 MB a um editor. Abra o arquivo com “Open file…” no painel **File Preview** da barra lateral direita; ele não tem esse limite (até 1 GB).'
    ],
    footer: '[Outros idiomas](README.md) · [Repositório do File Preview](https://github.com/hangams84/orca-file-preview)'
  },

  ru: {
    title: 'Установка File Preview (приложение Orca)',
    intro: 'Как установить и включить плагин File Preview по его адресу на GitHub в настройках приложения Orca. Терминал не нужен.',
    labelsNote: 'Снимки экрана: Orca {version}, русский интерфейс. В других версиях Orca названия и расположение могут немного отличаться. Путь вверху («Settings / …») в Orca пока не переведён.',
    stepsHeading: 'Шаги',
    stepAlt: 'Шаг {n}',
    steps: {
      'settings-button': 'Нажмите кнопку {settingsButton} (шестерёнка) в левом нижнем углу окна Orca.',
      'settings-menu': 'Выберите в меню пункт {settingsMenu}.',
      plugins: 'В списке настроек слева нажмите {plugins}.',
      'add-plugin': 'Нажмите {addPlugin} в правом верхнем углу.',
      'from-git-url': 'Выберите {fromGit}.',
      'repository-url': 'Откроется окно {dialogTitle} на вкладке {gitTab}. Вставьте этот адрес в поле {urlLabel}:',
      continue: 'Нажмите {continue}.',
      install: 'Orca находит последнюю версию («[resolved]»). Нажмите {install}.',
      trust: 'Orca спрашивает, доверяете ли вы издателю («[trustTitle]»). Нажмите {trustInstall}.',
      enable: 'На странице плагина в разделе {canAccess} указано, что может плагин: открывать файлы тех типов, которые он показывает. Нажмите {enable}. ({keepOff} оставляет плагин установленным, но выключенным.)',
      permissions: 'Если появится запрос разрешений, проверьте его и нажмите {consentEnable}.',
      enabled: 'Теперь статус — {on}. Нажмите {backToApp}.',
      'open-sample': 'Откройте поддерживаемый файл в проводнике, например {sample}.',
      preview: 'Файл откроется в режиме предпросмотра.',
      'optional-dwg': 'Необязательно: чтобы просматривать чертежи DWG, установите дополнительный плагин для DWG тем же способом (шаги 4–10). Вставьте адрес ниже, нажмите {continue} и {install}, затем включите плагин.'
    },
    troubleHeading: 'Устранение неполадок',
    trouble: [
      '**Установка по Git URL не работает**: для установки по Git URL нужна Orca 1.4.252 или новее. Обновите Orca и попробуйте снова.',
      '**«plugin exceeds the install size or file count limit»**: это случалось только со старыми тегами (v0.1.0–v0.2.1), до v0.2.2. Используйте адрес выше без `#тега` — тогда Orca установит последнюю версию.',
      '**Файл `.txt`, `.csv`, `.tsv`, `.html` или `.htm` открывается как текст**: эти типы Orca открывает сама, сначала в режиме Source. Выберите предпросмотр переключателем вида в правом верхнем углу вкладки.',
      '**У 3D-модели, робота (URDF) или чертежа нет текстур, сеток или связанных файлов**: редактор получает только открытый файл. Нажмите кнопку 📁 на панели инструментов предпросмотра и выберите папку со связанными файлами (Shift — отдельные файлы) или перетащите их на предпросмотр.',
      '**Файлы больше 50 МБ («exceeds 50MB limit»)**: Orca передаёт редактору не больше 50 МБ. Откройте файл через «Open file…» на панели **File Preview** в правой боковой панели — там такого ограничения нет (до 1 ГБ).'
    ],
    footer: '[Другие языки](README.md) · [Репозиторий File Preview](https://github.com/hangams84/orca-file-preview)'
  },

  tr: {
    title: 'File Preview kurulumu (Orca uygulaması)',
    intro: 'File Preview eklentisini Orca uygulamasının ayarlarından GitHub adresiyle kurma ve açma adımları. Terminal gerekmez.',
    labelsNote: 'Ekran görüntüleri: Orca {version}, Türkçe arayüz. Diğer Orca sürümlerinde adlar ve konumlar biraz farklı olabilir.',
    stepsHeading: 'Adımlar',
    stepAlt: 'Adım {n}',
    steps: {
      'settings-button': 'Orca penceresinin sol altındaki {settingsButton} düğmesine (dişli simgesi) tıklayın.',
      'settings-menu': 'Menüden {settingsMenu} seçeneğini seçin.',
      plugins: 'Soldaki ayarlar listesinde {plugins} öğesine tıklayın.',
      'add-plugin': 'Sağ üstteki {addPlugin} düğmesine tıklayın.',
      'from-git-url': '{fromGit} seçeneğini seçin.',
      'repository-url': '{dialogTitle} penceresi {gitTab} sekmesinde açılır. Aşağıdaki adresi {urlLabel} alanına yapıştırın:',
      continue: '{continue} düğmesine tıklayın.',
      install: 'Orca en yeni sürümü bulur (“[resolved]”). {install} düğmesine tıklayın.',
      trust: 'Orca yayıncıya güvenip güvenmediğinizi sorar (“[trustTitle]”). {trustInstall} düğmesine tıklayın.',
      enable: 'Eklenti sayfasındaki {canAccess} bölümü, eklentinin neler yapabileceğini gösterir: önizlediği dosya türlerini açmak. {enable} düğmesine tıklayın. ({keepOff} seçilirse eklenti kurulu kalır ama kapalı olur.)',
      permissions: 'Bir izin isteği görünürse kontrol edin ve {consentEnable} düğmesine tıklayın.',
      enabled: 'Durum artık {on} olarak görünüyor. {backToApp} düğmesine tıklayın.',
      'open-sample': 'Gezginde desteklenen bir dosyayı açın, örneğin {sample}.',
      preview: 'Dosya önizlemede açılır.',
      'optional-dwg': 'İsteğe bağlı: DWG çizimlerini görmek için DWG ek eklentisini aynı şekilde (4–10. adımlar) kurun. Aşağıdaki adresi yapıştırın, {continue} ve {install} düğmelerine tıklayın, sonra eklentiyi açın.'
    },
    troubleHeading: 'Sorun giderme',
    trouble: [
      '**Git URL ile kurulum çalışmıyor**: Git URL ile kurulum için Orca 1.4.252 veya daha yenisi gerekir. Orca’yı güncelleyip yeniden deneyin.',
      '**“plugin exceeds the install size or file count limit”**: Bu sorun yalnızca v0.2.2’den önceki eski etiketlerde (v0.1.0–v0.2.1) görüldü. Yukarıdaki adresi `#etiket` olmadan kullanın; Orca en yeni sürümü kurar.',
      '**`.txt`, `.csv`, `.tsv`, `.html` veya `.htm` dosyası metin olarak açılıyor**: Bu türleri Orca kendisi açar, önce Source görünümünde. Önizlemeyi sekmenin sağ üstündeki görünüm değiştirme düğmesiyle seçin.',
      '**3B model, robot (URDF) veya çizimde doku, ağ ya da başvurulan dosyalar eksik**: Düzenleyici yalnızca açılan dosyayı alır. Önizleme araç çubuğundaki 📁 düğmesine tıklayıp başvurulan dosyaların bulunduğu klasörü seçin (Shift: tek tek dosyalar) veya dosyaları önizlemenin üzerine bırakın.',
      '**50 MB’tan büyük dosyalar (“exceeds 50MB limit”)**: Orca bir düzenleyiciye en fazla 50 MB verir. Dosyayı sağ kenar çubuğundaki **File Preview** panelinde “Open file…” ile açın; orada bu sınır yoktur (1 GB’a kadar).'
    ],
    footer: '[Diğer diller](README.md) · [File Preview deposu](https://github.com/hangams84/orca-file-preview)'
  }
}
