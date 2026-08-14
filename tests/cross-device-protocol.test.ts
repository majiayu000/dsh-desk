import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDeviceIdentity,
  decodePairingFragment,
  decryptTaskSnapshot,
  deriveSessionKey,
  encodePairingFragment,
  encryptTaskSnapshot,
  type PairingOffer,
  type TaskSnapshot,
} from '../src/cross-device/protocol.ts'

const now = Date.parse('2026-08-15T00:00:00.000Z')

test('pairing derives matching non-extractable session keys', async () => {
  const desktop = await createDeviceIdentity('desktop-identity-0001')
  const phone = await createDeviceIdentity('phone-identity-00001')
  const offer: PairingOffer = {
    protocolVersion: 1,
    relayUrl: 'https://relay.example.test',
    pairingId: 'pairing-identity-0001',
    mailboxId: 'mailbox-identity-0001',
    desktopId: desktop.deviceId,
    desktopPublicKey: desktop.publicKey,
    nonce: 'MDEyMzQ1Njc4OWFiY2RlZg',
    expiresAt: new Date(now + 120_000).toISOString(),
    readToken: 'r'.repeat(43),
    pairingToken: 'p'.repeat(43),
  }
  assert.deepEqual(decodePairingFragment(`#${encodePairingFragment(offer, now)}`, now), offer)
  assert.equal(desktop.privateKey.extractable, false)
  assert.equal(phone.privateKey.extractable, false)

  const desktopKey = await deriveSessionKey(desktop.privateKey, phone.publicKey, offer.nonce, offer.pairingId)
  const phoneKey = await deriveSessionKey(phone.privateKey, desktop.publicKey, offer.nonce, offer.pairingId)
  const snapshot: TaskSnapshot = {
    taskId: 'task-identity-0000001',
    alias: '发布前兼容性检查',
    state: 'running',
    stage: 'Windows packaged runtime',
    startedAt: new Date(now - 30_000).toISOString(),
    elapsedSeconds: 30,
  }
  const envelope = await encryptTaskSnapshot(desktopKey, snapshot, {
    mailboxId: offer.mailboxId,
    senderDeviceId: desktop.deviceId,
    sequence: 1,
  }, now)
  assert.equal(JSON.stringify(envelope).includes(snapshot.alias), false)
  assert.deepEqual(await decryptTaskSnapshot(phoneKey, envelope, {
    mailboxId: offer.mailboxId,
    senderDeviceId: desktop.deviceId,
    afterSequence: 0,
  }, now + 1_000), snapshot)
})

test('tampering, replay, expiry, and extra plaintext fields fail closed', async () => {
  const desktop = await createDeviceIdentity('desktop-identity-0002')
  const phone = await createDeviceIdentity('phone-identity-00002')
  const nonce = 'ZmVkY2JhOTg3NjU0MzIxMA'
  const pairingId = 'pairing-identity-0002'
  const desktopKey = await deriveSessionKey(desktop.privateKey, phone.publicKey, nonce, pairingId)
  const phoneKey = await deriveSessionKey(phone.privateKey, desktop.publicKey, nonce, pairingId)
  const snapshot: TaskSnapshot = {
    taskId: 'task-identity-0000002',
    alias: '依赖审计',
    state: 'completed',
    stage: '完成',
    startedAt: new Date(now - 10_000).toISOString(),
    elapsedSeconds: 10,
  }
  const envelope = await encryptTaskSnapshot(desktopKey, snapshot, {
    mailboxId: 'mailbox-identity-0002',
    senderDeviceId: desktop.deviceId,
    sequence: 8,
  }, now)
  const expected = { mailboxId: envelope.header.mailboxId, senderDeviceId: desktop.deviceId, afterSequence: 0 }

  await assert.rejects(() => decryptTaskSnapshot(phoneKey, {
    ...envelope,
    header: { ...envelope.header, sequence: 9 },
  }, expected, now + 1_000))
  await assert.rejects(() => decryptTaskSnapshot(phoneKey, envelope, {
    ...expected, afterSequence: 8,
  }, now + 1_000), /replayed/u)
  await assert.rejects(() => decryptTaskSnapshot(phoneKey, envelope, expected, now + 180_000), /expired/u)
  await assert.rejects(() => encryptTaskSnapshot(desktopKey, {
    ...snapshot,
    prompt: 'secret prompt',
  } as TaskSnapshot, {
    mailboxId: envelope.header.mailboxId,
    senderDeviceId: desktop.deviceId,
    sequence: 9,
  }, now), /not allowed/u)
})
