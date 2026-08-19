import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { createRelayServer } from '../relay/server.mjs'

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

test('relay accepts only opaque envelopes and separates capabilities', async (context) => {
  const server = createRelayServer({ allowedOrigin: 'https://companion.example.test', adminToken: 'a'.repeat(43) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => server.close())
  const address = server.address()
  assert(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`

  assert.equal((await request(base, '/healthz')).status, 200)
  assert.equal((await request(base, '/v1/mailboxes', { method: 'POST' })).status, 401)
  const created = await request(base, '/v1/mailboxes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${'a'.repeat(43)}` },
  })
  assert.equal(created.status, 201)
  const { mailboxId, pairingId, readToken, writeToken, pairingToken } = created.body

  const pairing = {
    deviceId: 'phone-identity-00001',
    deviceName: 'My phone',
    fingerprint: 'fingerprint-00000001',
    publicKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
  }
  const pairPath = `/v1/pairings/${pairingId}/response`
  assert.equal((await request(base, pairPath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pairing),
  })).status, 202)
  assert.equal((await request(base, pairPath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pairingToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pairing),
  })).status, 401)
  assert.deepEqual((await request(base, pairPath, {
    headers: { Authorization: `Bearer ${writeToken}` },
  })).body, pairing)

  const envelope = {
    header: {
      protocolVersion: 1,
      messageId: 'message-identity-0001',
      mailboxId,
      senderDeviceId: 'desktop-identity-0001',
      sequence: 1,
      kind: 'task.snapshot',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    },
    iv: 'a'.repeat(16),
    ciphertext: 'b'.repeat(64),
  }
  const messagePath = `/v1/mailboxes/${mailboxId}/messages`
  assert.equal((await request(base, messagePath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })).status, 401)
  assert.equal((await request(base, messagePath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...envelope, prompt: 'relay must reject plaintext fields' }),
  })).status, 400)
  assert.equal((await request(base, messagePath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  })).status, 202)
  const messages = await request(base, `${messagePath}?after=0`, {
    headers: { Authorization: `Bearer ${readToken}` },
  })
  assert.deepEqual(messages.body.messages, [envelope])
  assert.equal(JSON.stringify(messages.body).includes('relay must reject'), false)
})

test('relay rejects an expired one-time pairing capability', async (context) => {
  const server = createRelayServer({ pairingTtlMs: 1 })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => server.close())
  const address = server.address()
  assert(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const created = await request(base, '/v1/mailboxes', { method: 'POST' })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const response = await request(base, `/v1/pairings/${created.body.pairingId}/response`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${created.body.pairingToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'phone-identity-00002',
      deviceName: 'Expired phone',
      fingerprint: 'fingerprint-00000002',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
    }),
  })
  assert.equal(response.status, 401)
})

test('relay bounds mailbox storage and reclaims idle capacity', async (context) => {
  let currentTime = 1_000
  const server = createRelayServer({
    maxMailboxes: 2,
    mailboxIdleTtlMs: 1_000,
    now: () => currentTime,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => server.close())
  const address = server.address()
  assert(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`

  const first = await request(base, '/v1/mailboxes', { method: 'POST' })
  const second = await request(base, '/v1/mailboxes', { method: 'POST' })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.deepEqual(
    await request(base, '/v1/mailboxes', { method: 'POST' }),
    { status: 503, body: { error: 'mailbox-capacity-reached' } },
  )

  currentTime += 1_000
  assert.equal((await request(base, '/v1/mailboxes', { method: 'POST' })).status, 201)
  assert.equal((await request(base, `/v1/mailboxes/${first.body.mailboxId}/messages`)).status, 404)
  assert.equal((await request(base, `/v1/pairings/${second.body.pairingId}/response`)).status, 404)
})

test('relay rejects invalid resource limits before listening', () => {
  assert.throws(() => createRelayServer({ maxMailboxes: 0 }), /maxMailboxes/u)
  assert.throws(() => createRelayServer({ mailboxIdleTtlMs: 0 }), /mailboxIdleTtlMs/u)
  assert.throws(() => createRelayServer({ pairingTtlMs: 0 }), /pairingTtlMs/u)
  assert.throws(() => createRelayServer({ now: 1 }), /now/u)
})
