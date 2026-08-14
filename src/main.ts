import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import './style.css'

type RuntimePhase = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'

interface RuntimeStatus {
  phase: RuntimePhase
  url: string | null
  errorCode: string | null
  message: string | null
}

const label = document.querySelector<HTMLParagraphElement>('#status-label')!
const detail = document.querySelector<HTMLParagraphElement>('#status-detail')!
const dot = document.querySelector<HTMLSpanElement>('#status-dot')!
const progress = document.querySelector<HTMLDivElement>('#progress')!
const actions = document.querySelector<HTMLDivElement>('#actions')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const logs = document.querySelector<HTMLButtonElement>('#logs')!

function render(status: RuntimeStatus): void {
  document.body.dataset.phase = status.phase
  dot.dataset.phase = status.phase

  const copy: Record<RuntimePhase, [string, string]> = {
    stopped: ['运行环境已停止', '可以重新启动 DeepSeek Harness。'],
    starting: ['正在启动 DeepSeek Harness', status.message ?? '首次启动可能需要一点时间。'],
    ready: ['运行环境已就绪', '正在打开工作界面…'],
    stopping: ['正在安全退出', '正在保存会话并关闭后台进程。'],
    failed: [
      'DeepSeek Harness 启动失败',
      status.errorCode
        ? `${status.errorCode}: ${status.message ?? '请打开诊断目录查看详细日志。'}`
        : status.message ?? '请打开诊断目录查看详细日志。',
    ],
  }

  ;[label.textContent, detail.textContent] = copy[status.phase]
  progress.hidden = status.phase !== 'starting' && status.phase !== 'stopping'
  actions.hidden = status.phase !== 'failed' && status.phase !== 'stopped'
}

retry.addEventListener('click', async () => {
  retry.disabled = true
  try {
    await invoke('restart_runtime')
  } finally {
    retry.disabled = false
  }
})

logs.addEventListener('click', () => invoke('open_diagnostic_folder'))

async function initialize(): Promise<void> {
  await listen<RuntimeStatus>('runtime-status', ({ payload }) => render(payload))

  try {
    render(await invoke<RuntimeStatus>('get_runtime_status'))
  } catch (error) {
    render({
      phase: 'failed',
      url: null,
      errorCode: 'desktop-ipc-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

void initialize()
