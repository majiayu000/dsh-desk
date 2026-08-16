import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import './update.css'

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  notes: string | null
  downloadedBytes: number
  totalBytes: number | null
  checkedAt: number | null
  autoDownload: boolean
  downloadReady: boolean
  error: string | null
}

const orbit = document.querySelector<HTMLElement>('#status-orbit')!
const orbitProgress = document.querySelector<SVGCircleElement>('#orbit-progress')!
const badge = document.querySelector<HTMLElement>('#status-badge')!
const route = document.querySelector<HTMLElement>('#version-route')!
const title = document.querySelector<HTMLHeadingElement>('#status-title')!
const detail = document.querySelector<HTMLParagraphElement>('#status-detail')!
const downloadProgress = document.querySelector<HTMLElement>('#download-progress')!
const progressBar = document.querySelector<HTMLElement>('#progress-bar')!
const progressLabel = document.querySelector<HTMLElement>('#progress-label')!
const progressPercent = document.querySelector<HTMLElement>('#progress-percent')!
const notes = document.querySelector<HTMLElement>('#release-notes')!
const notesBody = document.querySelector<HTMLElement>('#release-notes-body')!
const primary = document.querySelector<HTMLButtonElement>('#primary-action')!
const check = document.querySelector<HTMLButtonElement>('#check-action')!
const autoDownload = document.querySelector<HTMLInputElement>('#auto-download')!
const currentVersion = document.querySelector<HTMLElement>('#current-version')!
const checkedAt = document.querySelector<HTMLElement>('#checked-at')!
const announcement = document.querySelector<HTMLElement>('#status-announcement')!

let status: UpdateStatus | null = null
let preferenceBusy = false
let actionBusy = false
let lastAnnouncedPhase: UpdatePhase | null = null
let refreshSequence = 0
let disposed = false
let unlistenStatus: UnlistenFn | null = null

const updatePhases = new Set<UpdatePhase>([
  'idle',
  'checking',
  'upToDate',
  'available',
  'downloading',
  'ready',
  'installing',
  'error',
])

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function isUpdateStatus(value: unknown): value is UpdateStatus {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.phase === 'string' &&
    updatePhases.has(candidate.phase as UpdatePhase) &&
    typeof candidate.currentVersion === 'string' &&
    isNullableString(candidate.availableVersion) &&
    isNullableString(candidate.notes) &&
    typeof candidate.downloadedBytes === 'number' &&
    Number.isFinite(candidate.downloadedBytes) &&
    candidate.downloadedBytes >= 0 &&
    isNullableNumber(candidate.totalBytes) &&
    isNullableNumber(candidate.checkedAt) &&
    typeof candidate.autoDownload === 'boolean' &&
    typeof candidate.downloadReady === 'boolean' &&
    isNullableString(candidate.error)
  )
}

async function invokeStatus(command: string, args?: Record<string, unknown>): Promise<UpdateStatus> {
  const result: unknown = await invoke(command, args)
  if (!isUpdateStatus(result)) throw new Error(`更新状态响应无效：${command}`)
  return result
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatCheckedAt(value: number | null): string {
  if (!value) return '尚未检查'
  const date = new Date(value)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  return sameDay ? `上次检查：今天 ${time}` : `上次检查：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`
}

function progressOf(value: UpdateStatus): number {
  if (!value.totalBytes || value.totalBytes <= 0) return 0
  return Math.min(100, Math.round((value.downloadedBytes / value.totalBytes) * 100))
}

function render(value: UpdateStatus): void {
  status = value
  orbit.dataset.phase = value.phase
  const progress = progressOf(value)
  orbitProgress.style.setProperty('--progress', `${132 - (132 * progress) / 100}`)

  currentVersion.textContent = `当前版本 ${value.currentVersion}`
  checkedAt.textContent = formatCheckedAt(value.checkedAt)
  autoDownload.checked = value.autoDownload
  autoDownload.disabled = preferenceBusy || value.phase === 'installing'
  route.textContent = value.availableVersion ? `${value.currentVersion}  →  ${value.availableVersion}` : ''
  notes.hidden = !value.notes || !value.availableVersion
  notesBody.textContent = value.notes ?? ''
  downloadProgress.hidden = value.phase !== 'downloading'
  progressBar.style.width = `${progress}%`
  progressPercent.textContent = value.totalBytes ? `${progress}%` : '—'
  if (value.totalBytes) {
    downloadProgress.setAttribute('aria-valuenow', String(progress))
    downloadProgress.removeAttribute('aria-valuetext')
  } else {
    downloadProgress.removeAttribute('aria-valuenow')
    downloadProgress.setAttribute('aria-valuetext', `已下载 ${formatBytes(value.downloadedBytes)}，正在验证更新包`)
  }
  progressLabel.textContent = value.totalBytes
    ? `${formatBytes(value.downloadedBytes)} / ${formatBytes(value.totalBytes)}`
    : `${formatBytes(value.downloadedBytes)} · 正在验证更新包`

  const content: Record<UpdatePhase, { badge: string; title: string; detail: string }> = {
    idle: {
      badge: '准备就绪',
      title: '让 DSH Desk 保持最新',
      detail: '更新包会先完成签名验证，安装前不会打断当前工作。',
    },
    checking: {
      badge: '正在检查',
      title: '正在寻找可用更新',
      detail: '正在连接 DSH Desk 的签名更新通道…',
    },
    upToDate: {
      badge: '已是最新',
      title: 'DSH Desk 已是最新版本',
      detail: '这台设备已经安装当前通道提供的最新版本。',
    },
    available: {
      badge: '发现更新',
      title: `DSH Desk ${value.availableVersion ?? ''} 可以下载`,
      detail: '你可以现在下载，继续使用应用，稍后再重启安装。',
    },
    downloading: {
      badge: '后台下载',
      title: `正在准备 DSH Desk ${value.availableVersion ?? ''}`,
      detail: '下载完成后会自动验证签名，不会立即重启应用。',
    },
    ready: {
      badge: '可以安装',
      title: `DSH Desk ${value.availableVersion ?? ''} 已准备好`,
      detail: '重启会安全停止本地 Harness，然后安装经过验证的更新。',
    },
    installing: {
      badge: '正在安装',
      title: '正在安全退出并安装更新',
      detail: '请不要关闭应用，DSH Desk 将在安装后自动重新打开。',
    },
    error: {
      badge: '需要处理',
      title: value.downloadReady ? '安装暂时无法继续' : '更新没有完成',
      detail: value.error ?? '请检查网络连接后重试。当前版本不会受到影响。',
    },
  }

  badge.textContent = content[value.phase].badge
  title.textContent = content[value.phase].title
  detail.textContent = content[value.phase].detail
  if (lastAnnouncedPhase !== value.phase) {
    announcement.textContent = `${content[value.phase].title}。${content[value.phase].detail}`
    lastAnnouncedPhase = value.phase
  }

  const busy = actionBusy || value.phase === 'checking' || value.phase === 'downloading' || value.phase === 'installing'
  primary.disabled = busy
  check.disabled = busy
  check.hidden = value.phase === 'idle' || value.phase === 'checking'

  if (value.phase === 'available') primary.textContent = '下载更新'
  else if (value.phase === 'ready' || (value.phase === 'error' && value.downloadReady)) primary.textContent = '重启并安装'
  else if (value.phase === 'error' && value.availableVersion) primary.textContent = '重新下载'
  else if (value.phase === 'installing') primary.textContent = '正在安装…'
  else if (value.phase === 'downloading') primary.textContent = '正在下载…'
  else if (value.phase === 'checking') primary.textContent = '正在检查…'
  else primary.textContent = '检查更新'
}

async function refreshStatus(): Promise<void> {
  const sequence = ++refreshSequence
  const value = await invokeStatus('get_update_status')
  if (!disposed && sequence === refreshSequence) render(value)
}

async function runAction(command: string): Promise<void> {
  if (actionBusy) return
  actionBusy = true
  if (status) render(status)
  try {
    await invoke(command)
    await refreshStatus()
  } catch (error) {
    console.error(`update action failed: ${command}`, error)
    await refreshStatus().catch((refreshError) => console.error('failed to refresh update status', refreshError))
  } finally {
    actionBusy = false
    if (status) render(status)
  }
}

function runPrimaryAction(): Promise<void> {
  if (!status) return Promise.resolve()
  if (status.phase === 'available' || (status.phase === 'error' && status.availableVersion && !status.downloadReady)) {
    return runAction('download_update')
  }
  if (status.phase === 'ready' || (status.phase === 'error' && status.downloadReady)) {
    return runAction('install_update')
  }
  return runAction('check_for_updates')
}

primary.addEventListener('click', () => void runPrimaryAction())
check.addEventListener('click', () => void runAction('check_for_updates'))
autoDownload.addEventListener('change', async () => {
  if (!status || preferenceBusy) return
  preferenceBusy = true
  autoDownload.disabled = true
  try {
    render(await invokeStatus('set_update_auto_download', { enabled: autoDownload.checked }))
  } catch {
    autoDownload.checked = status.autoDownload
  } finally {
    preferenceBusy = false
    if (status) render(status)
  }
})

async function initialize(): Promise<void> {
  const stopListening = await listen('update-status', () => {
    void refreshStatus().catch((error) => console.error('failed to refresh update status', error))
  })
  if (disposed) {
    stopListening()
    return
  }
  unlistenStatus = stopListening
  try {
    await refreshStatus()
  } catch (error) {
    render({
      phase: 'error',
      currentVersion: '—',
      availableVersion: null,
      notes: null,
      downloadedBytes: 0,
      totalBytes: null,
      checkedAt: null,
      autoDownload: false,
      downloadReady: false,
      error: String(error),
    })
  }
}

window.addEventListener('pagehide', () => {
  disposed = true
  unlistenStatus?.()
  unlistenStatus = null
}, { once: true })

void initialize()
