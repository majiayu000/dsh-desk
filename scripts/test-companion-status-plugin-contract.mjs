import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { stopProcess } from './lib/child-process.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const pluginRoot = join(projectRoot, 'plugins', 'companion-status')
const dshEntry = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const toolBin = join(projectRoot, 'node_modules', '.bin')
const testHome = mkdtempSync(join(tmpdir(), 'dsh-desk-status-plugin-'))
const bridgeToken = 'contract_test_token_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const bridgeUrl = 'http://127.0.0.1:43191/v1/harness/status'
const timeoutMs = Number(process.env.DSH_CONTRACT_TIMEOUT_MS ?? 45_000)

const baseEnv = {
  ...process.env,
  DSH_HOME: testHome,
  DSH_DESK_STATUS_BRIDGE_URL: bridgeUrl,
  DSH_DESK_STATUS_BRIDGE_TOKEN: bridgeToken,
  PATH: `${toolBin}${delimiter}${process.env.PATH ?? ''}`,
  NO_COLOR: '1',
}

function run(args) {
  const result = spawnSync(process.execPath, [dshEntry, ...args], {
    cwd: projectRoot,
    env: baseEnv,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

async function waitForReady(child) {
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12_000)
  })

  const ready = new Promise((resolveReady, rejectReady) => {
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (!line.startsWith('dsh web: ')) return
      const raw = line.slice('dsh web: '.length).split(/\s/u, 1)[0]
      const url = new URL(raw)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
        rejectReady(new Error(`Harness escaped loopback policy: ${raw}`))
        return
      }
      resolveReady(url)
    })
    child.once('error', rejectReady)
    child.once('exit', (code, signal) => {
      rejectReady(new Error(`Harness exited before ready (${code ?? signal})\n${stderr}`))
    })
  })

  const timeout = new Promise((_, rejectTimeout) => {
    setTimeout(() => rejectTimeout(new Error(`Harness did not become ready in ${timeoutMs}ms\n${stderr}`)), timeoutMs)
  })
  const url = await Promise.race([ready, timeout])
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (response.status !== 200) throw new Error(`Harness health check returned ${response.status}`)
}

let child
try {
  run(['plugin', '--profile', 'web', 'add', `file:${pluginRoot}`])
  const manifest = JSON.parse(readFileSync(join(testHome, 'profiles', 'web', 'package.json'), 'utf8'))
  if (manifest.dependencies?.['@dsh-desk/companion-status-plugin'] === undefined) {
    throw new Error('Official plugin command did not add the companion status bundle')
  }

  const composed = run(['--profile', 'web', '--dump-config'])
  if (!composed.includes("name: '@dsh-desk/companion-status-plugin'")) {
    throw new Error('Composed Harness config does not include the status plugin row')
  }
  if (composed.includes(bridgeToken)) {
    throw new Error('Bridge capability leaked into composed Harness config')
  }

  child = spawn(process.execPath, [dshEntry, 'web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: baseEnv,
  })
  await waitForReady(child)
  console.log('Companion status plugin contract verified: add, compose, secret redaction, and real Harness load.')
} finally {
  if (child) await stopProcess(child)
  rmSync(testHome, { recursive: true, force: true })
}
