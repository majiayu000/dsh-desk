import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
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
}

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

let busy = false

function setBusy(value: boolean): void {
  busy = value
  source.disabled = value
  install.disabled = value
  refresh.disabled = value
  choosePackage.disabled = value
  chooseDirectory.disabled = value
  for (const button of list.querySelectorAll('button')) button.disabled = value
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
      request: { action, operand: value },
    })
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n')
    showOperation(
      `${actionLabel(action)} ${value}`,
      result.success ? '完成' : `失败${result.exitCode === null ? '' : ` · 退出码 ${result.exitCode}`}`,
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
  update.addEventListener('click', () => void runAction('update', plugin.name))
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'danger-button'
  remove.textContent = '卸载'
  remove.addEventListener('click', () => void runAction('remove', plugin.name))
  actions.append(why, update, remove)

  card.append(identity, actions)
  return card
}

async function loadPlugins(): Promise<void> {
  refresh.disabled = true
  try {
    const plugins = await invoke<InstalledPlugin[]>('list_plugins')
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

install.addEventListener('click', () => void runAction('add', source.value))
source.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void runAction('add', source.value)
})
refresh.addEventListener('click', () => void loadPlugins())
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

void loadPlugins()
