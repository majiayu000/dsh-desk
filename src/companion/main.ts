import {
  createDeviceIdentity,
  decodePairingFragment,
  deriveSessionKey,
  type EncryptedEnvelope,
  type PairingOffer,
  type TaskSnapshot,
} from '../cross-device/protocol.ts'
import { applyEnvelopes } from '../cross-device/feed.ts'
import './style.css'

interface StoredSession {
  id: 'active'
  relayUrl: string
  mailboxId: string
  desktopId: string
  readToken: string
  key: CryptoKey
  lastSequence: number
  fingerprint: string
  snapshots: TaskSnapshot[]
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const connectionLabel = document.querySelector<HTMLElement>('#connection-label')!
const connectionDot = document.querySelector<HTMLElement>('#connection-dot')!
const pairingPanel = document.querySelector<HTMLElement>('#pairing-panel')!
const taskPanel = document.querySelector<HTMLElement>('#task-panel')!
const taskList = document.querySelector<HTMLElement>('#task-list')!
const emptyState = document.querySelector<HTMLElement>('#empty-state')!
const updatedAt = document.querySelector<HTMLElement>('#updated-at')!
const errorBanner = document.querySelector<HTMLElement>('#error-banner')!
const installButton = document.querySelector<HTMLButtonElement>('#install-button')!
const disconnectButton = document.querySelector<HTMLButtonElement>('#disconnect-button')!

const tasks = new Map<string, TaskSnapshot>()
let session: StoredSession | null = null
let installPrompt: InstallPromptEvent | null = null
let pollTimer: number | null = null

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dsh-desk-companion', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pairings', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readSession(): Promise<StoredSession | null> {
  const database = await openDatabase()
  return new Promise<StoredSession | null>((resolve, reject) => {
    const request = database.transaction('pairings').objectStore('pairings').get('active')
    request.onsuccess = () => resolve((request.result as StoredSession | undefined) ?? null)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function writeSession(value: StoredSession): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('pairings', 'readwrite')
    transaction.objectStore('pairings').put(value)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function clearSession(): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('pairings', 'readwrite')
    transaction.objectStore('pairings').delete('active')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

function setConnection(state: 'offline' | 'connecting' | 'online', label: string): void {
  connectionDot.dataset.state = state
  connectionLabel.textContent = label
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  errorBanner.textContent = message
  errorBanner.hidden = false
  setConnection('offline', '连接中断')
}

function clearError(): void {
  errorBanner.hidden = true
  errorBanner.textContent = ''
}

function showNotice(message: string): void {
  errorBanner.textContent = message
  errorBanner.hidden = false
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

function renderTasks(): void {
  taskList.replaceChildren()
  const ordered = [...tasks.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  emptyState.hidden = ordered.length > 0
  for (const task of ordered) {
    const article = document.createElement('article')
    article.className = 'task-card'
    article.dataset.state = task.state

    const rail = document.createElement('span')
    rail.className = 'task-rail'
    const content = document.createElement('div')
    content.className = 'task-content'
    const state = document.createElement('p')
    state.className = 'task-state'
    state.textContent = ({ running: '运行中', waiting: '等待桌面', completed: '已完成', failed: '失败' })[task.state]
    const title = document.createElement('h2')
    title.textContent = task.alias
    const stage = document.createElement('p')
    stage.className = 'task-stage'
    stage.textContent = task.errorCode ? `${task.stage} · ${task.errorCode}` : task.stage
    const time = document.createElement('time')
    time.className = 'task-time'
    time.dateTime = task.startedAt
    time.textContent = formatDuration(task.elapsedSeconds)
    content.append(state, title, stage)
    article.append(rail, content, time)
    taskList.append(article)
  }
  updatedAt.textContent = `更新于 ${new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date())}`
}

async function pair(offer: PairingOffer): Promise<StoredSession> {
  setConnection('connecting', '正在建立加密通道')
  const identity = await createDeviceIdentity()
  const key = await deriveSessionKey(identity.privateKey, offer.desktopPublicKey, offer.nonce, offer.pairingId)
  const response = await fetch(`${offer.relayUrl}/v1/pairings/${offer.pairingId}/response`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${offer.pairingToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: identity.deviceId,
      deviceName: 'DSH Companion PWA',
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
    }),
  })
  if (!response.ok) throw new Error(`配对中继拒绝了请求（${response.status}）`)
  return {
    id: 'active',
    relayUrl: offer.relayUrl,
    mailboxId: offer.mailboxId,
    desktopId: offer.desktopId,
    readToken: offer.readToken,
    key,
    lastSequence: 0,
    fingerprint: identity.fingerprint,
    snapshots: [],
  }
}

async function poll(): Promise<void> {
  if (!session) return
  try {
    const response = await fetch(
      `${session.relayUrl}/v1/mailboxes/${session.mailboxId}/messages?after=${session.lastSequence}`,
      { headers: { Authorization: `Bearer ${session.readToken}` }, cache: 'no-store' },
    )
    if (!response.ok) throw new Error(`中继读取失败（${response.status}）`)
    const body = await response.json() as { messages: EncryptedEnvelope[] }
    const result = await applyEnvelopes(
      {
        key: session.key,
        mailboxId: session.mailboxId,
        senderDeviceId: session.desktopId,
        lastSequence: session.lastSequence,
      },
      tasks,
      body.messages,
    )
    session.lastSequence = result.lastSequence
    if (body.messages.length > 0) {
      session.snapshots = [...tasks.values()]
      await writeSession(session)
    }
    clearError()
    setConnection('online', '端到端加密已连接')
    if (result.skipped > 0) {
      showNotice(`跳过 ${result.skipped} 条无法解密或已过期的消息。`)
    }
    renderTasks()
  } catch (error) {
    showError(error)
  } finally {
    pollTimer = window.setTimeout(() => void poll(), 5_000)
  }
}

function showConnected(): void {
  for (const snapshot of session?.snapshots ?? []) tasks.set(snapshot.taskId, snapshot)
  pairingPanel.hidden = true
  taskPanel.hidden = false
  disconnectButton.hidden = false
  renderTasks()
  void poll()
}

disconnectButton.addEventListener('click', async () => {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  await clearSession()
  session = null
  tasks.clear()
  location.replace('/companion.html')
})

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installPrompt = event as InstallPromptEvent
  installButton.hidden = false
})

installButton.addEventListener('click', async () => {
  if (!installPrompt) return
  await installPrompt.prompt()
  await installPrompt.userChoice
  installPrompt = null
  installButton.hidden = true
})

async function initialize(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/companion-sw.js')
    } catch {
      // The offline shell is an enhancement; without it pairing and polling
      // still work, so registration failures must not abort initialization.
    }
  }
  try {
    if (location.hash.includes('pair=')) {
      const offer = decodePairingFragment(location.hash)
      session = await pair(offer)
      await writeSession(session)
      history.replaceState(null, '', '/companion.html')
    } else {
      session = await readSession()
    }
    if (session) showConnected()
    else setConnection('offline', '等待桌面配对')
  } catch (error) {
    showError(error)
  }
}

void initialize()
