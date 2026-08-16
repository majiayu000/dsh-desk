import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDeviceIdentity,
  deriveSessionKey,
  encryptTaskSnapshot,
  type EncryptedEnvelope,
  type TaskSnapshot,
} from '../src/cross-device/protocol.ts'
import { applyEnvelopes } from '../src/cross-device/feed.ts'

const now = Date.parse('2026-08-15T00:00:00.000Z')

interface Session {
  desktopKey: CryptoKey
  phoneKey: CryptoKey
  desktopId: string
  mailboxId: string
}

async function establishSession(seed: string): Promise<Session> {
  const desktop = await createDeviceIdentity(`desktop-identity-${seed}`)
  const phone = await createDeviceIdentity(`phone-identity-${seed.padEnd(5, '0')}`)
  const nonce = 'MDEyMzQ1Njc4OWFiY2RlZg'
  const pairingId = `pairing-identity-${seed}`
  return {
    desktopKey: await deriveSessionKey(desktop.privateKey, phone.publicKey, nonce, pairingId),
    phoneKey: await deriveSessionKey(phone.privateKey, desktop.publicKey, nonce, pairingId),
    desktopId: desktop.deviceId,
    mailboxId: `mailbox-identity-${seed}`,
  }
}

function snapshot(id: string, alias: string): TaskSnapshot {
  return {
    taskId: id,
    alias,
    state: 'running',
    stage: '构建快照',
    startedAt: new Date(now - 30_000).toISOString(),
    elapsedSeconds: 30,
  }
}

test('an expired envelope no longer wedges the poll cursor', async () => {
  const session = await establishSession('feed01')
  const expired = await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00001', '过期快照'), {
    mailboxId: session.mailboxId,
    senderDeviceId: session.desktopId,
    sequence: 1,
  }, now - 10 * 60_000)
  const valid = await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00002', '有效快照'), {
    mailboxId: session.mailboxId,
    senderDeviceId: session.desktopId,
    sequence: 2,
  }, now)

  const tasks = new Map<string, TaskSnapshot>()
  const result = await applyEnvelopes(
    { key: session.phoneKey, mailboxId: session.mailboxId, senderDeviceId: session.desktopId, lastSequence: 0 },
    tasks,
    [expired, valid],
    now + 1_000,
  )

  assert.equal(result.skipped, 1)
  assert.equal(result.accepted, 1)
  assert.equal(result.lastSequence, 2, 'the cursor must advance past the poisoned envelope')
  assert.equal(tasks.has('task-identity-feed00001'), false)
  assert.equal(tasks.get('task-identity-feed00002')?.alias, '有效快照')
})

test('a tampered envelope is skipped without starving newer messages', async () => {
  const session = await establishSession('feed02')
  const poisoned: EncryptedEnvelope = {
    ...(await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00003', '被篡改'), {
      mailboxId: session.mailboxId,
      senderDeviceId: session.desktopId,
      sequence: 4,
    }, now)),
  }
  poisoned.ciphertext = `A${poisoned.ciphertext.slice(1)}`
  const valid = await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00004', '后续快照'), {
    mailboxId: session.mailboxId,
    senderDeviceId: session.desktopId,
    sequence: 5,
  }, now)

  const tasks = new Map<string, TaskSnapshot>()
  const result = await applyEnvelopes(
    { key: session.phoneKey, mailboxId: session.mailboxId, senderDeviceId: session.desktopId, lastSequence: 3 },
    tasks,
    [valid, poisoned],
    now + 1_000,
  )

  assert.equal(result.accepted, 1)
  assert.equal(result.skipped, 1)
  assert.equal(result.lastSequence, 5)
  assert.equal(tasks.has('task-identity-feed00004'), true)
})

test('out-of-order delivery is applied in sequence order', async () => {
  const session = await establishSession('feed03')
  const first = await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00005', '第一条'), {
    mailboxId: session.mailboxId,
    senderDeviceId: session.desktopId,
    sequence: 6,
  }, now)
  const second = await encryptTaskSnapshot(session.desktopKey, snapshot('task-identity-feed00006', '第二条'), {
    mailboxId: session.mailboxId,
    senderDeviceId: session.desktopId,
    sequence: 7,
  }, now)

  const tasks = new Map<string, TaskSnapshot>()
  const result = await applyEnvelopes(
    { key: session.phoneKey, mailboxId: session.mailboxId, senderDeviceId: session.desktopId, lastSequence: 5 },
    tasks,
    [second, first],
    now + 1_000,
  )

  assert.equal(result.accepted, 2)
  assert.equal(result.skipped, 0)
  assert.equal(result.lastSequence, 7)
  assert.equal(tasks.size, 2)
})
