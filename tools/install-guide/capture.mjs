// Inside the orca-guide container: drives a real Orca (fresh profile per language) over CDP through
// Settings → Plugins → Add plugin → From a Git URL → Install → trust → Enable → open a sample,
// and saves one raw screenshot per step plus steps.json (element boxes and the labels read from the DOM).
//   node capture.mjs <work-dir> <lang...>        (lang = Orca's code: ko en zh zh-Hant ja de fr es pt ru tr)
// Labels are found through Orca's own locale catalogs (read from app.asar), so the same script works
// in every UI language; English fallbacks come from Orca's en.json.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// playwright-core lives in the image (/opt/pw), not in this repository.
const { chromium } = createRequire(process.env.PW_DIR || '/opt/pw/package.json')('playwright-core')
const HERE = path.dirname(new URL(import.meta.url).pathname)
const [WORK, ...LANGS] = process.argv.slice(2)
const PORT = Number(process.env.PORT || 9222)
const PLUGIN_URL = process.env.PLUGIN_URL || 'https://github.com/hangams84/orca-file-preview.git'
const DWG_URL = process.env.DWG_URL || 'https://github.com/hangams84/orca-file-preview-dwg.git'
const SAMPLE = process.env.SAMPLE || 'sample.docx'
const ASAR = '/opt/Orca/resources/app.asar'

// Orca catalog keys used by the flow, with the English text (Orca's en.json) as fallback.
const K = {
  settings: ['auto.components.sidebar.SidebarSettingsHelpMenu.a428c25998', 'Settings'],
  pluginsNav: ['auto.hooks.useSettingsNavigationMetadata.pluginsTitle', 'Plugins'],
  addPlugin: ['auto.components.settings.PluginAddMenu.add', 'Add plugin'],
  fromGit: ['auto.components.settings.PluginAddMenu.git', 'From a Git URL…'],
  dialogTitle: ['auto.components.settings.PluginInstallDialog.title', 'Install plugin'],
  gitTab: ['auto.components.settings.PluginInstallDialog.gitTab', 'Git URL'],
  gitLabel: ['auto.components.settings.PluginInstallDialog.gitLabel', 'Repository URL'],
  continue: ['auto.components.settings.PluginInstallDialog.continue', 'Continue'],
  install: ['auto.components.settings.PluginInstallDialog.install', 'Install'],
  cancel: ['auto.components.settings.PluginInstallTrustDialog.cancel', 'Cancel'],
  trustInstall: ['auto.components.settings.PluginInstallTrustDialog.install', 'Install'],
  enable: ['auto.components.settings.PluginConsentDialog.enable', 'Enable plugin'],
  keepOff: ['auto.components.settings.PluginInstallConsent.keepOff', 'Keep off'],
  canAccess: ['auto.components.settings.PluginDetailSections.access', 'Can access'],
  on: ['auto.components.settings.PluginStatus.on', 'On'],
  backToApp: ['auto.components.settings.SettingsSidebar.60f8a673a7', 'Back to app'],
  toggleRight: ['auto.App.9e0b441a91', 'Toggle right sidebar']
}

// --- app.asar: find and read the renderer's locale catalog for a language -----------------------
function readAsar() {
  const fd = fs.openSync(ASAR, 'r')
  const b = Buffer.alloc(16)
  fs.readSync(fd, b, 0, 16, 0)
  const hb = Buffer.alloc(b.readUInt32LE(12))
  fs.readSync(fd, hb, 0, hb.length, 16)
  return { fd, header: JSON.parse(hb.toString()), base: 8 + b.readUInt32LE(4) }
}
function catalogFor(lang) {
  if (lang === 'en') return {}
  const { fd, header, base } = readAsar()
  const assets = header.files.out.files.renderer.files.assets.files
  const re = new RegExp(`^${lang.replace('-', '\\-')}-[\\w-]{8}\\.json$`)
  const name = Object.keys(assets).find((n) => re.test(n))
  if (!name) throw new Error(`no catalog for ${lang} in app.asar`)
  const e = assets[name]
  if (e.unpacked) return JSON.parse(fs.readFileSync(`${ASAR}.unpacked/out/renderer/assets/${name}`, 'utf8'))
  const buf = Buffer.alloc(e.size)
  fs.readSync(fd, buf, 0, e.size, base + Number(e.offset))
  return JSON.parse(buf.toString())
}
const lookup = (cat, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cat)

// --- helpers --------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
const starts = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
      const page = b.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('renderer/index.html'))
      if (page) return { b, page }
      await b.close().catch(() => {})
    } catch {}
    await sleep(1000)
  }
  throw new Error('could not attach to Orca over CDP')
}

async function dismissPopups(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape')
    await sleep(300)
  }
}

async function captureLanguage(lang) {
  const out = path.join(WORK, lang)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const cat = catalogFor(lang)
  const missing = []
  const T = (k) => {
    const [key, en] = K[k]
    const v = lookup(cat, key)
    if (lang !== 'en' && typeof v !== 'string') missing.push(key)
    return typeof v === 'string' ? v : en
  }

  execFileSync('bash', [path.join(HERE, 'start-orca.sh')], { stdio: 'inherit' })
  const { b, page } = await connect()
  await page.waitForLoadState('domcontentloaded')
  await sleep(3000)
  // A returning user: onboarding done, the chosen UI language set, then reload to apply it.
  await page.evaluate(async (uiLanguage) => {
    const s = await window.api.onboarding.get()
    await window.api.onboarding.update({
      ...s, closedAt: Date.now(), outcome: 'completed', lastCompletedStep: s.lastCompletedStep || 5,
      checklist: { ...s.checklist, dismissed: true }
    })
    await window.api.settings.set({ uiLanguage })
  }, lang)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await sleep(5000)
  await dismissPopups(page)
  await sleep(1500)
  await dismissPopups(page)

  const steps = []
  // One screenshot per step, taken before the action, with the boxes of the element(s) to act on.
  async function shot(slug, targets, extra = {}) {
    await sleep(700)
    const n = steps.length + 1
    const file = `${String(n).padStart(2, '0')}-${slug}.png`
    const boxes = []
    const labels = {}
    for (const t of targets) {
      await t.loc.waitFor({ state: 'visible', timeout: 60000 })
      await t.loc.scrollIntoViewIfNeeded().catch(() => {})
      const bb = await t.loc.boundingBox()
      boxes.push({ ...bb, primary: !t.secondary })
      if (t.label) {
        labels[t.label] = (await t.loc.evaluate((e) => e.innerText.trim() || e.getAttribute('aria-label') || e.value || ''))
          .split('\n')[0].trim()
      }
    }
    for (const [k, loc] of Object.entries(extra)) {
      labels[k] = (await loc.first().evaluate((e) => e.innerText || e.getAttribute('aria-label') || '')).trim()
    }
    await sleep(300)
    await page.screenshot({ path: path.join(out, file) })
    steps.push({ n, slug, file, boxes, labels })
    console.log(`  ${lang} ${file} ${JSON.stringify(labels)}`)
  }

  // 1. The settings button at the bottom of the left rail.
  const gear = page.getByRole('button', { name: exact(T('settings')) }).last()
  await shot('settings-button', [{ loc: gear, label: 'settingsButton' }])
  await gear.click()
  // 2. Settings in its menu.
  const menuSettings = page.getByRole('menuitem', { name: exact(T('settings')) })
  await shot('settings-menu', [{ loc: menuSettings, label: 'settingsMenu' }])
  await menuSettings.click()
  // 3. Plugins in the settings sidebar.
  const nav = page.getByRole('button', { name: starts(T('pluginsNav')) }).first()
  await nav.waitFor({ state: 'visible' })
  await nav.scrollIntoViewIfNeeded()
  await shot('plugins', [{ loc: nav, label: 'plugins' }])
  await nav.click()
  // 4. Add plugin.
  const add = page.getByRole('button', { name: exact(T('addPlugin')) })
  await shot('add-plugin', [{ loc: add, label: 'addPlugin' }])
  await add.click()
  // 5. From a Git URL…
  const fromGit = page.getByRole('menuitem', { name: exact(T('fromGit')) })
  await shot('from-git-url', [{ loc: fromGit, label: 'fromGit' }])
  await fromGit.click()
  // 6. The repository URL field of the Install plugin dialog.
  const dlg = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
  const field = dlg.getByRole('textbox').first()
  const fieldLabel = dlg.getByText(exact(T('gitLabel'))).first()
  await shot('repository-url', [{ loc: field }, { loc: fieldLabel, label: 'urlLabel', secondary: true }], {
    dialogTitle: dlg.getByRole('heading').first(),
    gitTab: dlg.getByText(exact(T('gitTab')))
  })
  await field.fill(PLUGIN_URL)
  // 7. Continue.
  const cont = dlg.getByRole('button', { name: exact(T('continue')) })
  await shot('continue', [{ loc: cont, label: 'continue' }])
  await cont.click()
  // 8. Install (after Orca resolved the newest version tag).
  const install = dlg.getByRole('button', { name: exact(T('install')) })
  await install.waitFor({ state: 'visible', timeout: 120000 })
  await page.waitForFunction((el) => !el.disabled, await install.elementHandle(), { timeout: 120000 })
  const resolved = dlg.getByText(/v\d+\.\d+\.\d+/).first()
  await shot('install', [{ loc: install, label: 'install' }, { loc: resolved, label: 'resolved', secondary: true }])
  await install.click()
  // 9. The trust prompt for a plugin from an unchecked Git repository.
  const trust = page.getByRole('dialog').filter({ hasText: 'hangams84' }).filter({ hasNot: page.getByRole('textbox') }).last()
  const trustInstall = trust.getByRole('button', { name: exact(T('trustInstall')) })
  await shot('trust', [{ loc: trustInstall, label: 'trustInstall' }], {
    trustTitle: trust.getByRole('heading').first()
  })
  await trustInstall.click()
  // 10. The plugin page: what it can access, then Enable plugin.
  const enable = page.getByRole('button', { name: starts(T('enable')) })
  await enable.waitFor({ state: 'visible', timeout: 180000 })
  const access = page.getByText(exact(T('canAccess'))).first()
  // Outline the whole "Can access" card: its nearest ancestor taller than the title row.
  await access.evaluate((e) => {
    let n = e.parentElement
    while (n && n.getBoundingClientRect().height < 120) n = n.parentElement
    ;(n || e).setAttribute('data-guide-access', '')
  })
  const accessPanel = page.locator('[data-guide-access]')
  await shot('enable', [{ loc: enable, label: 'enable' }, { loc: accessPanel, secondary: true }], {
    keepOff: page.getByRole('button', { name: starts(T('keepOff')) }),
    canAccess: access
  })
  await enable.click()
  // A permission prompt may follow on some versions; capture it if it shows.
  await sleep(2500)
  const consent = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: starts(T('enable')) }) })
  if (await consent.count()) {
    const btn = consent.getByRole('button', { name: starts(T('enable')) }).last()
    await shot('permissions', [{ loc: btn, label: 'consentEnable' }], { consentTitle: consent.getByRole('heading').first() })
    await btn.click()
    await sleep(2500)
  }
  // 11. Enabled: the status says On; go back to the app.
  const status = page.getByText(exact(T('on'))).first()
  await status.waitFor({ state: 'visible', timeout: 60000 })
  const sw = page.getByRole('switch').first()
  const back = page.getByRole('button', { name: exact(T('backToApp')) })
  await shot('enabled', [{ loc: back, label: 'backToApp' }, { loc: status, label: 'on', secondary: true }, { loc: sw, secondary: true }])
  await back.click()
  await sleep(1500)
  // 12. Open the sample from the Explorer.
  const item = page.getByText(SAMPLE, { exact: true }).first()
  await shot('open-sample', [{ loc: item, label: 'sample' }])
  await item.click()
  await sleep(2000)
  // 13. The preview (right sidebar hidden so the page has room).
  await page.getByRole('button', { name: exact(T('toggleRight')) }).first().click({ timeout: 5000 }).catch(() => {})
  // The plugin editor is a <webview> inside this surface; give the renderer time to draw the page.
  const surface = page.locator('[data-plugin-editor-surface] webview').last()
  await surface.waitFor({ state: 'visible', timeout: 60000 })
  await sleep(8000)
  await shot('preview', [{ loc: surface }])

  // 14. Optional: the DWG companion, installed the same way (shown up to the resolved version).
  await page.getByRole('button', { name: exact(T('settings')) }).last().click()
  await page.getByRole('menuitem', { name: exact(T('settings')) }).click()
  await nav.waitFor({ state: 'visible' })
  await nav.click()
  await add.click()
  await fromGit.click()
  await field.waitFor({ state: 'visible' })
  await field.fill(DWG_URL)
  await cont.click()
  await install.waitFor({ state: 'visible', timeout: 120000 })
  await page.waitForFunction((el) => !el.disabled, await install.elementHandle(), { timeout: 120000 })
  await shot('optional-dwg', [{ loc: install, label: 'install' }, { loc: field, secondary: true }])
  await dlg.getByRole('button', { name: exact(T('cancel')) }).first().click().catch(() => page.keyboard.press('Escape'))

  let version = null
  try {
    version = execFileSync('dpkg-query', ['-W', '-f', '${Version}', 'orca-ide'], { encoding: 'utf8' }).trim()
  } catch {}
  fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify({ lang, orcaVersion: version, missingKeys: missing, steps }, null, 1))
  await b.close().catch(() => {})
}

for (const lang of LANGS) {
  let ok = false
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    try {
      console.log(`== ${lang} (attempt ${attempt})`)
      await captureLanguage(lang)
      ok = true
    } catch (e) {
      console.error(`!! ${lang}: ${e.message.split('\n')[0]}`)
    }
  }
  if (!ok) process.exitCode = 1
}
process.exit(process.exitCode || 0)
