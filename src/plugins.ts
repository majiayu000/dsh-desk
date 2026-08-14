import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import catalogData from './plugin-catalog.json'
import './plugins.css'

type PluginAction = 'add' | 'remove' | 'update' | 'why'

interface InstalledPlugin {
  name: string
  requested: string
  version: string | null
}

interface PluginCommandResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  rolledBack: boolean
}

type PluginRisk = 'low' | 'review' | 'high'
type PluginSourceKind = 'registry' | 'github' | 'directory' | 'tarball' | 'url' | 'unknown'

interface PluginInspection {
  source: string
  kind: PluginSourceKind
  name: string | null
  version: string | null
  integrity: string | null
  repository: string | null
  trustSignal: string
  lifecycleScripts: string[]
  risk: PluginRisk
  warnings: string[]
  permissionNotice: string
}

type CatalogCategory = 'tools' | 'workflow' | 'data'
type CatalogStatus = 'available' | 'bundled'

interface CatalogEntry {
  id: string
  title: string
  package: string
  version: string
  source: string
  summary: string
  category: CatalogCategory
  categoryLabel: string
  status: CatalogStatus
  capabilities: string[]
  platforms: string[]
  trust: {
    label: string
    reviewedAt: string
    evidence: string[]
  }
}

interface PluginCatalog {
  schemaVersion: number
  harnessVersion: string
  desktopVersion: string
  entries: CatalogEntry[]
}

const catalog = catalogData as PluginCatalog

const source = document.querySelector<HTMLInputElement>('#plugin-source')!
const install = document.querySelector<HTMLButtonElement>('#install')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
const choosePackage = document.querySelector<HTMLButtonElement>('#choose-package')!
const chooseDirectory = document.querySelector<HTMLButtonElement>('#choose-directory')!
const list = document.querySelector<HTMLDivElement>('#plugin-list')!
const count = document.querySelector<HTMLParagraphElement>('#plugin-count')!
const panel = document.querySelector<HTMLElement>('#operation-panel')!
const operationTitle = document.querySelector<HTMLElement>('#operation-title')!
const operationState = document.querySelector<HTMLElement>('#operation-state')!
const operationOutput = document.querySelector<HTMLPreElement>('#operation-output')!
const reviewPanel = document.querySelector<HTMLElement>('#review-panel')!
const reviewTitle = document.querySelector<HTMLElement>('#review-title')!
const riskBadge = document.querySelector<HTMLElement>('#risk-badge')!
const reviewMetadata = document.querySelector<HTMLDListElement>('#review-metadata')!
const reviewWarnings = document.querySelector<HTMLUListElement>('#review-warnings')!
const permissionNotice = document.querySelector<HTMLParagraphElement>('#permission-notice')!
const confirmRisk = document.querySelector<HTMLInputElement>('#confirm-risk')!
const confirmInstall = document.querySelector<HTMLButtonElement>('#confirm-install')!
const cancelReview = document.querySelector<HTMLButtonElement>('#cancel-review')!
const catalogSearch = document.querySelector<HTMLInputElement>('#catalog-search')!
const catalogFilters = document.querySelector<HTMLElement>('#catalog-filters')!
const catalogList = document.querySelector<HTMLDivElement>('#catalog-list')!
const catalogCount = document.querySelector<HTMLParagraphElement>('#catalog-count')!

let busy = false
let pendingReview: { action: 'add' | 'update'; operand: string } | null = null
let selectedCategory: CatalogCategory | 'all' = 'all'
let installedNames = new Set<string>()

function setBusy(value: boolean): void {
  busy = value
  source.disabled = value
  install.disabled = value
  refresh.disabled = value
  choosePackage.disabled = value
  chooseDirectory.disabled = value
  catalogSearch.disabled = value
  cancelReview.disabled = value
  for (const button of list.querySelectorAll('button')) button.disabled = value
  for (const button of catalogFilters.querySelectorAll('button')) button.disabled = value
  for (const button of catalogList.querySelectorAll('button')) {
    button.disabled = value || button.dataset.permanentlyDisabled === 'true'
  }
}

function showOperation(title: string, state: string, output = ''): void {
  panel.hidden = false
  operationTitle.textContent = title
  operationState.textContent = state
  operationOutput.textContent = output
}

function actionLabel(action: PluginAction): string {
  return { add: '安装', remove: '卸载', update: '升级', why: '查看依赖' }[action]
}

async function runAction(action: PluginAction, operand: string): Promise<void> {
  const value = operand.trim()
  if (!value || busy) return

  setBusy(true)
  showOperation(`${actionLabel(action)} ${value}`, '执行中…')
  try {
    const result = await invoke<PluginCommandResult>('run_plugin_command', {
      request: {
        action,
        operand: value,
        confirmedRisk: action === 'add' || action === 'update' || action === 'remove',
      },
    })
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n')
    showOperation(
      `${actionLabel(action)} ${value}`,
      result.success
        ? '完成'
        : `${result.rolledBack ? '失败 · 已恢复' : '失败'}${result.exitCode === null ? '' : ` · 退出码 ${result.exitCode}`}`,
      output || (result.success ? '命令执行成功。' : '命令执行失败。'),
    )
    if (action !== 'why') {
      if (result.success) source.value = ''
      await loadPlugins()
    }
  } catch (error) {
    showOperation(`${actionLabel(action)} ${value}`, '失败', String(error))
  } finally {
    setBusy(false)
  }
}

function metadataRow(label: string, value: string | null): DocumentFragment | null {
  if (!value) return null
  const fragment = document.createDocumentFragment()
  const term = document.createElement('dt')
  term.textContent = label
  const detail = document.createElement('dd')
  detail.textContent = value
  fragment.append(term, detail)
  return fragment
}

async function beginReview(action: 'add' | 'update', operand: string): Promise<void> {
  const value = operand.trim()
  if (!value || busy) return

  setBusy(true)
  showOperation(`检查 ${value}`, '正在读取来源和安装脚本…')
  try {
    const inspection = await invoke<PluginInspection>('inspect_plugin_source', { operand: value })
    pendingReview = { action, operand: value }
    reviewTitle.textContent = `${action === 'add' ? '安装' : '升级'} ${inspection.name ?? value}`
    riskBadge.dataset.risk = inspection.risk
    riskBadge.textContent = { low: '低风险信号', review: '需要检查', high: '高风险信号' }[inspection.risk]
    const rows = [
      metadataRow('来源类型', inspection.kind),
      metadataRow('包名', inspection.name),
      metadataRow('版本', inspection.version),
      metadataRow('完整性', inspection.integrity),
      metadataRow('信任信号', inspection.trustSignal),
      metadataRow('仓库', inspection.repository),
      metadataRow('生命周期脚本', inspection.lifecycleScripts.join('、') || '未发现'),
    ].filter((row): row is DocumentFragment => row !== null)
    reviewMetadata.replaceChildren(...rows)
    reviewWarnings.replaceChildren(...inspection.warnings.map((warning) => {
      const item = document.createElement('li')
      item.textContent = warning
      return item
    }))
    if (inspection.warnings.length === 0) {
      const item = document.createElement('li')
      item.textContent = '顶层 manifest 没有发现生命周期脚本，并且 registry 提供了内容完整性。'
      reviewWarnings.append(item)
    }
    permissionNotice.textContent = inspection.permissionNotice
    confirmRisk.checked = false
    confirmInstall.disabled = true
    confirmInstall.textContent = action === 'add' ? '确认并安装' : '确认并升级'
    reviewPanel.hidden = false
    panel.hidden = true
  } catch (error) {
    pendingReview = null
    showOperation(`检查 ${value}`, '检查失败，未执行安装', String(error))
  } finally {
    setBusy(false)
  }
}

function pluginCard(plugin: InstalledPlugin): HTMLElement {
  const card = document.createElement('article')
  card.className = 'plugin-card'

  const identity = document.createElement('div')
  identity.className = 'plugin-identity'
  const name = document.createElement('h3')
  name.textContent = plugin.name
  const version = document.createElement('p')
  version.textContent = plugin.version ?? plugin.requested
  identity.append(name, version)

  const actions = document.createElement('div')
  actions.className = 'plugin-actions'
  const why = document.createElement('button')
  why.type = 'button'
  why.textContent = '依赖'
  why.addEventListener('click', () => void runAction('why', plugin.name))
  const update = document.createElement('button')
  update.type = 'button'
  update.textContent = '升级'
  update.addEventListener('click', () => void beginReview('update', plugin.name))
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'danger-button'
  remove.textContent = '卸载'
  remove.addEventListener('click', () => {
    if (window.confirm(`确定卸载 ${plugin.name}？失败时会自动恢复操作前的 Profile。`)) {
      void runAction('remove', plugin.name)
    }
  })
  actions.append(why, update, remove)

  card.append(identity, actions)
  return card
}

function catalogCard(entry: CatalogEntry): HTMLElement {
  const card = document.createElement('article')
  card.className = 'catalog-card'

  const header = document.createElement('div')
  header.className = 'catalog-card-header'
  const category = document.createElement('span')
  category.className = 'catalog-category'
  category.textContent = entry.categoryLabel
  const trust = document.createElement('span')
  trust.className = 'catalog-trust'
  trust.textContent = entry.trust.label
  header.append(category, trust)

  const title = document.createElement('h3')
  title.textContent = entry.title
  const packageName = document.createElement('code')
  packageName.textContent = `${entry.package}@${entry.version}`
  const summary = document.createElement('p')
  summary.className = 'catalog-summary'
  summary.textContent = entry.summary

  const capabilities = document.createElement('ul')
  capabilities.className = 'catalog-capabilities'
  capabilities.replaceChildren(...entry.capabilities.map((capability) => {
    const item = document.createElement('li')
    item.textContent = capability
    return item
  }))

  const footer = document.createElement('div')
  footer.className = 'catalog-card-footer'
  const compatibility = document.createElement('span')
  compatibility.textContent = `Harness ${catalog.harnessVersion} · ${entry.platforms.join(' / ')}`
  const action = document.createElement('button')
  action.type = 'button'
  if (entry.status === 'bundled') {
    action.textContent = '已内置'
    action.dataset.permanentlyDisabled = 'true'
    action.disabled = true
  } else if (installedNames.has(entry.package)) {
    action.textContent = '审查并应用版本'
    action.addEventListener('click', () => void beginReview('add', entry.source))
  } else {
    action.className = 'primary-button'
    action.textContent = '审查并安装'
    action.addEventListener('click', () => void beginReview('add', entry.source))
  }
  footer.append(compatibility, action)
  card.append(header, title, packageName, summary, capabilities, footer)
  return card
}

function renderCatalog(): void {
  const query = catalogSearch.value.trim().toLocaleLowerCase('zh-CN')
  const entries = catalog.entries.filter((entry) => {
    if (selectedCategory !== 'all' && entry.category !== selectedCategory) return false
    const searchable = [entry.title, entry.package, entry.summary, ...entry.capabilities]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
    return searchable.includes(query)
  })
  catalogList.replaceChildren(...entries.map(catalogCard))
  catalogCount.textContent = `${entries.length} 个条目 · 适配 DSH Desk ${catalog.desktopVersion}`
  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = '没有匹配的可信目录条目。仍可在下方手动检查其他来源。'
    catalogList.append(empty)
  }
}

async function loadPlugins(): Promise<void> {
  refresh.disabled = true
  try {
    const plugins = await invoke<InstalledPlugin[]>('list_plugins')
    installedNames = new Set(plugins.map((plugin) => plugin.name))
    renderCatalog()
    list.replaceChildren(...plugins.map(pluginCard))
    count.textContent = plugins.length === 0 ? '还没有安装用户插件' : `${plugins.length} 个用户插件`
    if (plugins.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      empty.textContent = '在上方输入插件来源即可安装。'
      list.append(empty)
    }
  } catch (error) {
    count.textContent = '读取失败'
    list.replaceChildren()
    showOperation('读取插件列表', '失败', String(error))
  } finally {
    refresh.disabled = false
  }
}

install.addEventListener('click', () => void beginReview('add', source.value))
source.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void beginReview('add', source.value)
})
confirmRisk.addEventListener('change', () => {
  confirmInstall.disabled = !confirmRisk.checked
})
cancelReview.addEventListener('click', () => {
  pendingReview = null
  reviewPanel.hidden = true
})
confirmInstall.addEventListener('click', () => {
  if (!pendingReview || !confirmRisk.checked) return
  const pending = pendingReview
  pendingReview = null
  reviewPanel.hidden = true
  void runAction(pending.action, pending.operand)
})
refresh.addEventListener('click', () => void loadPlugins())
catalogSearch.addEventListener('input', renderCatalog)
catalogFilters.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-category]')
  if (!button) return
  selectedCategory = button.dataset.category as CatalogCategory | 'all'
  for (const candidate of catalogFilters.querySelectorAll('button')) {
    candidate.classList.toggle('is-active', candidate === button)
  }
  renderCatalog()
})
choosePackage.addEventListener('click', async () => {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: '插件包', extensions: ['tgz'] }],
  })
  if (selected) source.value = selected
})
chooseDirectory.addEventListener('click', async () => {
  const selected = await open({ multiple: false, directory: true })
  if (selected) source.value = selected
})

renderCatalog()
void loadPlugins()
