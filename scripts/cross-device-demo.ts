import {
  createDeviceIdentity,
  deriveSessionKey,
  encodePairingFragment,
  encryptTaskSnapshot,
  type PairingOffer,
  type TaskSnapshot,
} from '../src/cross-device/protocol.ts'

const relayUrl = (process.env.DSH_RELAY_URL ?? 'http://127.0.0.1:8787').replace(/\/$/u, '')
const companionUrl = process.env.DSH_COMPANION_URL ?? 'http://localhost:1420/companion.html'
const adminToken = process.env.RELAY_ADMIN_TOKEN

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function responseJson(response: Response): Promise<Record<string, string>> {
  if (!response.ok) throw new Error(`Relay returned ${response.status} ${response.statusText}`)
  return response.json() as Promise<Record<string, string>>
}

const desktop = await createDeviceIdentity()
const mailbox = await responseJson(await fetch(`${relayUrl}/v1/mailboxes`, {
  method: 'POST',
  headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {},
}))
const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
let nonceBinary = ''
for (const byte of nonceBytes) nonceBinary += String.fromCharCode(byte)
const nonce = btoa(nonceBinary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const offer: PairingOffer = {
  protocolVersion: 1,
  relayUrl,
  pairingId: mailbox.pairingId,
  mailboxId: mailbox.mailboxId,
  desktopId: desktop.deviceId,
  desktopPublicKey: desktop.publicKey,
  nonce,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  readToken: mailbox.readToken,
  pairingToken: mailbox.pairingToken,
}

console.log('Open this URL on the Companion device within two minutes:')
console.log(`${companionUrl}#${encodePairingFragment(offer)}`)
console.log('Waiting for the one-time device response…')

let pairedDevice: { deviceId: string; publicKey: JsonWebKey } | null = null
while (Date.now() < Date.parse(offer.expiresAt)) {
  const response = await fetch(`${relayUrl}/v1/pairings/${offer.pairingId}/response`, {
    headers: { Authorization: `Bearer ${mailbox.writeToken}` },
  })
  if (response.status === 200) {
    pairedDevice = await response.json() as { deviceId: string; publicKey: JsonWebKey }
    break
  }
  if (response.status !== 204) throw new Error(`Pairing poll failed with ${response.status}`)
  await sleep(1_000)
}
if (!pairedDevice) throw new Error('Pairing expired before a device responded')

const sessionKey = await deriveSessionKey(desktop.privateKey, pairedDevice.publicKey, nonce, offer.pairingId)
const startedAt = new Date().toISOString()
const states: Array<Pick<TaskSnapshot, 'state' | 'stage' | 'elapsedSeconds'>> = [
  { state: 'running', stage: '正在检查 macOS / Windows / Linux', elapsedSeconds: 4 },
  { state: 'running', stage: '正在验证打包运行时', elapsedSeconds: 9 },
  { state: 'completed', stage: '全部兼容性检查已通过', elapsedSeconds: 14 },
]

for (const [index, state] of states.entries()) {
  const envelope = await encryptTaskSnapshot(sessionKey, {
    taskId: 'phase-a-demo-task-0001',
    alias: 'Phase A 加密状态演示',
    startedAt,
    ...state,
  }, {
    mailboxId: offer.mailboxId,
    senderDeviceId: desktop.deviceId,
    sequence: index + 1,
  })
  const response = await fetch(`${relayUrl}/v1/mailboxes/${offer.mailboxId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mailbox.writeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (!response.ok) throw new Error(`Publishing snapshot failed with ${response.status}`)
  console.log(`Published encrypted status ${index + 1}/${states.length}: ${state.state}`)
  if (index < states.length - 1) await sleep(5_000)
}
