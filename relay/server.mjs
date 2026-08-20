import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const BODY_LIMIT = 80 * 1024
const RETENTION_MS = 10 * 60 * 1000
const DEFAULT_MAILBOX_IDLE_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_MAILBOXES = 1024
const MAX_SWEEP_INTERVAL_MS = 60 * 1000
const idPattern = /^[A-Za-z0-9_-]{16,128}$/u
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/u

const capability = () => randomBytes(32).toString('base64url')
const digest = (value) => createHash('sha256').update(value).digest()

function authorized(request, expected) {
  const header = request.headers.authorization ?? ''
  const value = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!tokenPattern.test(value)) return false
  const actual = digest(value)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sendJson(response, status, payload, origin = null) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

async function readJson(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > BODY_LIMIT) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  return bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function validPublicKey(value) {
  if (!value || typeof value !== 'object') return false
  return Object.keys(value).every((key) => ['kty', 'crv', 'x', 'y', 'key_ops', 'ext'].includes(key))
    && value.kty === 'EC' && value.crv === 'P-256'
    && typeof value.x === 'string' && typeof value.y === 'string' && value.d === undefined
}

function validEnvelope(value, mailboxId, currentTime) {
  if (!value || typeof value !== 'object'
    || !Object.keys(value).every((key) => ['header', 'iv', 'ciphertext'].includes(key))) return false
  const header = value.header
  const headerFields = ['protocolVersion', 'messageId', 'mailboxId', 'senderDeviceId', 'sequence', 'kind', 'createdAt', 'expiresAt']
  if (!header || typeof header !== 'object' || !Object.keys(header).every((key) => headerFields.includes(key))) return false
  if (header.protocolVersion !== 1 || header.kind !== 'task.snapshot' || header.mailboxId !== mailboxId) return false
  if (![header.messageId, header.senderDeviceId].every((item) => typeof item === 'string' && idPattern.test(item))) return false
  if (!Number.isSafeInteger(header.sequence) || header.sequence < 1) return false
  const created = Date.parse(header.createdAt)
  const expires = Date.parse(header.expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expires)
    || expires <= currentTime || expires - created > 300_000) return false
  return typeof value.iv === 'string' && /^[A-Za-z0-9_-]{16,32}$/u.test(value.iv)
    && typeof value.ciphertext === 'string' && /^[A-Za-z0-9_-]{16,100000}$/u.test(value.ciphertext)
}

export function createRelayServer({
  allowedOrigin = 'http://localhost:1420',
  adminToken = null,
  pairingTtlMs = 120_000,
  mailboxIdleTtlMs = DEFAULT_MAILBOX_IDLE_TTL_MS,
  maxMailboxes = DEFAULT_MAX_MAILBOXES,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(pairingTtlMs) || pairingTtlMs < 1) throw new Error('pairingTtlMs must be a positive integer')
  if (!Number.isSafeInteger(mailboxIdleTtlMs) || mailboxIdleTtlMs < 1) {
    throw new Error('mailboxIdleTtlMs must be a positive integer')
  }
  if (!Number.isSafeInteger(maxMailboxes) || maxMailboxes < 1) throw new Error('maxMailboxes must be a positive integer')
  if (typeof now !== 'function') throw new Error('now must be a function')

  const mailboxes = new Map()
  const mailboxIdByPairingId = new Map()
  const sweepIntervalMs = Math.min(mailboxIdleTtlMs, MAX_SWEEP_INTERVAL_MS)
  let lastSweepAt = now()

  function deleteMailbox(mailboxId, mailbox) {
    mailboxes.delete(mailboxId)
    mailboxIdByPairingId.delete(mailbox.pairingId)
  }

  function sweepExpiredMailboxes(currentTime, force = false) {
    if (!force && currentTime - lastSweepAt < sweepIntervalMs) return
    lastSweepAt = currentTime
    for (const [mailboxId, mailbox] of mailboxes) {
      if (currentTime - mailbox.lastAccessedAt >= mailboxIdleTtlMs) deleteMailbox(mailboxId, mailbox)
    }
  }

  return createServer(async (request, response) => {
    const currentTime = now()
    sweepExpiredMailboxes(currentTime)
    const requestOrigin = request.headers.origin ?? null
    if (requestOrigin && requestOrigin !== allowedOrigin) {
      return sendJson(response, 403, { error: 'origin-not-allowed' })
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': requestOrigin ?? allowedOrigin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return response.end()
    }

    try {
      const url = new URL(request.url ?? '/', 'http://relay.invalid')
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(response, 200, { status: 'ok', storage: 'memory', content: 'opaque-only' }, requestOrigin)
      }

      if (request.method === 'POST' && url.pathname === '/v1/mailboxes') {
        if (adminToken && !authorized(request, digest(adminToken))) {
          return sendJson(response, 401, { error: 'unauthorized' }, requestOrigin)
        }
        if (mailboxes.size >= maxMailboxes) {
          sweepExpiredMailboxes(currentTime, true)
          if (mailboxes.size >= maxMailboxes) {
            return sendJson(response, 503, { error: 'mailbox-capacity-reached' }, requestOrigin)
          }
        }
        const mailboxId = randomUUID()
        const pairingId = randomUUID()
        const readToken = capability()
        const writeToken = capability()
        const pairingToken = capability()
        mailboxes.set(mailboxId, {
          pairingId,
          pairingExpiresAt: currentTime + pairingTtlMs,
          lastAccessedAt: currentTime,
          readDigest: digest(readToken),
          writeDigest: digest(writeToken),
          pairingDigest: digest(pairingToken),
          pairingUsed: false,
          pairingResponse: null,
          messages: [],
        })
        mailboxIdByPairingId.set(pairingId, mailboxId)
        return sendJson(response, 201, { mailboxId, pairingId, readToken, writeToken, pairingToken }, requestOrigin)
      }

      const messagesRoute = /^\/v1\/mailboxes\/([^/]+)\/messages$/u.exec(url.pathname)
      if (messagesRoute) {
        const mailboxId = messagesRoute[1]
        const mailbox = mailboxes.get(mailboxId)
        if (!mailbox) return sendJson(response, 404, { error: 'mailbox-not-found' }, requestOrigin)
        if (request.method === 'POST') {
          if (!authorized(request, mailbox.writeDigest)) return sendJson(response, 401, { error: 'unauthorized' }, requestOrigin)
          const envelope = await readJson(request)
          const completedAt = now()
          if (mailboxes.get(mailboxId) !== mailbox) return sendJson(response, 404, { error: 'mailbox-not-found' }, requestOrigin)
          if (!validEnvelope(envelope, mailboxId, completedAt)) return sendJson(response, 400, { error: 'invalid-envelope' }, requestOrigin)
          mailbox.lastAccessedAt = completedAt
          const cutoff = completedAt - RETENTION_MS
          mailbox.messages = mailbox.messages.filter((item) => item.receivedAt > cutoff).slice(-99)
          mailbox.messages.push({ envelope, receivedAt: completedAt })
          return sendJson(response, 202, { accepted: true, messageId: envelope.header.messageId }, requestOrigin)
        }
        if (request.method === 'GET') {
          if (!authorized(request, mailbox.readDigest)) return sendJson(response, 401, { error: 'unauthorized' }, requestOrigin)
          const after = Number(url.searchParams.get('after') ?? 0)
          if (!Number.isSafeInteger(after) || after < 0) return sendJson(response, 400, { error: 'invalid-cursor' }, requestOrigin)
          mailbox.lastAccessedAt = currentTime
          const cutoff = currentTime - RETENTION_MS
          mailbox.messages = mailbox.messages.filter((item) => item.receivedAt > cutoff)
          const messages = mailbox.messages.map((item) => item.envelope)
            .filter((item) => item.header.sequence > after)
          return sendJson(response, 200, { messages }, requestOrigin)
        }
      }

      const pairingRoute = /^\/v1\/pairings\/([^/]+)\/response$/u.exec(url.pathname)
      if (pairingRoute) {
        const mailboxId = mailboxIdByPairingId.get(pairingRoute[1])
        const mailbox = mailboxId ? mailboxes.get(mailboxId) : null
        if (!mailbox) return sendJson(response, 404, { error: 'pairing-not-found' }, requestOrigin)
        if (request.method === 'POST') {
          if (!authorized(request, mailbox.pairingDigest) || mailbox.pairingUsed
            || currentTime >= mailbox.pairingExpiresAt) {
            return sendJson(response, 401, { error: 'pairing-capability-invalid' }, requestOrigin)
          }
          const body = await readJson(request)
          const completedAt = now()
          if (mailboxes.get(mailboxId) !== mailbox) return sendJson(response, 404, { error: 'pairing-not-found' }, requestOrigin)
          if (mailbox.pairingUsed || completedAt >= mailbox.pairingExpiresAt) {
            return sendJson(response, 401, { error: 'pairing-capability-invalid' }, requestOrigin)
          }
          if (!idPattern.test(body.deviceId ?? '') || !validPublicKey(body.publicKey)
            || typeof body.fingerprint !== 'string' || body.fingerprint.length > 64
            || typeof body.deviceName !== 'string' || body.deviceName.length < 1 || body.deviceName.length > 80) {
            return sendJson(response, 400, { error: 'invalid-pairing-response' }, requestOrigin)
          }
          mailbox.lastAccessedAt = completedAt
          mailbox.pairingUsed = true
          mailbox.pairingResponse = body
          return sendJson(response, 202, { accepted: true }, requestOrigin)
        }
        if (request.method === 'GET') {
          if (!authorized(request, mailbox.writeDigest)) return sendJson(response, 401, { error: 'unauthorized' }, requestOrigin)
          mailbox.lastAccessedAt = currentTime
          if (!mailbox.pairingResponse) return sendJson(response, 204, {}, requestOrigin)
          const body = mailbox.pairingResponse
          mailbox.pairingResponse = null
          return sendJson(response, 200, body, requestOrigin)
        }
      }

      return sendJson(response, 404, { error: 'not-found' }, requestOrigin)
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body-too-large'
      return sendJson(response, tooLarge ? 413 : 400, { error: tooLarge ? 'body-too-large' : 'invalid-request' }, requestOrigin)
    }
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const host = process.env.RELAY_HOST ?? '127.0.0.1'
  const port = Number(process.env.RELAY_PORT ?? 8787)
  const allowedOrigin = process.env.RELAY_ALLOWED_ORIGIN ?? 'http://localhost:1420'
  const server = createRelayServer({ allowedOrigin, adminToken: process.env.RELAY_ADMIN_TOKEN ?? null })
  server.listen(port, host, () => {
    console.log(`DSH Desk opaque relay listening on http://${host}:${port}`)
    console.log(`Allowed browser origin: ${allowedOrigin}`)
    if (!process.env.RELAY_ADMIN_TOKEN) console.warn('RELAY_ADMIN_TOKEN is unset; local development only')
  })
}
