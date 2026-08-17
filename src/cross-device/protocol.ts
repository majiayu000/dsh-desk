export const CROSS_DEVICE_PROTOCOL_VERSION = 1 as const

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const idPattern = /^[A-Za-z0-9_-]{16,128}$/
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/

export type TaskState = 'running' | 'waiting' | 'completed' | 'failed'

export interface TaskSnapshot {
  taskId: string
  alias: string
  state: TaskState
  stage: string
  startedAt: string
  elapsedSeconds: number
  errorCode?: string
}

export interface PairingOffer {
  protocolVersion: typeof CROSS_DEVICE_PROTOCOL_VERSION
  relayUrl: string
  pairingId: string
  mailboxId: string
  desktopId: string
  desktopPublicKey: JsonWebKey
  nonce: string
  expiresAt: string
  readToken: string
  pairingToken: string
}

export interface DeviceIdentity {
  deviceId: string
  publicKey: JsonWebKey
  privateKey: CryptoKey
  fingerprint: string
}

export interface EnvelopeHeader {
  protocolVersion: typeof CROSS_DEVICE_PROTOCOL_VERSION
  messageId: string
  mailboxId: string
  senderDeviceId: string
  sequence: number
  kind: 'task.snapshot'
  createdAt: string
  expiresAt: string
}

export interface EncryptedEnvelope {
  header: EnvelopeHeader
  iv: string
  ciphertext: string
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url value')
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function canonicalPublicKey(key: JsonWebKey): string {
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y || key.d !== undefined) {
    throw new Error('Pairing keys must be P-256 public keys')
  }
  return JSON.stringify({ crv: 'P-256', kty: 'EC', x: key.x, y: key.y })
}

function canonicalHeader(header: EnvelopeHeader): string {
  return JSON.stringify({
    protocolVersion: header.protocolVersion,
    messageId: header.messageId,
    mailboxId: header.mailboxId,
    senderDeviceId: header.senderDeviceId,
    sequence: header.sequence,
    kind: header.kind,
    createdAt: header.createdAt,
    expiresAt: header.expiresAt,
  })
}

function isoTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function identifier(value: string, label: string): void {
  if (!idPattern.test(value)) throw new Error(`${label} is invalid`)
}

export function assertPairingOffer(value: PairingOffer, now = Date.now()): void {
  if (value.protocolVersion !== CROSS_DEVICE_PROTOCOL_VERSION) throw new Error('Unsupported protocol version')
  const relay = new URL(value.relayUrl)
  const loopback = relay.hostname === '127.0.0.1' || relay.hostname === 'localhost'
  if (relay.protocol !== 'https:' && !(loopback && relay.protocol === 'http:')) {
    throw new Error('Relay URL must use HTTPS outside loopback development')
  }
  identifier(value.pairingId, 'pairingId')
  identifier(value.mailboxId, 'mailboxId')
  identifier(value.desktopId, 'desktopId')
  canonicalPublicKey(value.desktopPublicKey)
  if (decodeBase64Url(value.nonce).byteLength < 16) throw new Error('Pairing nonce is too short')
  if (!tokenPattern.test(value.readToken) || !tokenPattern.test(value.pairingToken)) {
    throw new Error('Pairing capabilities are invalid')
  }
  const expiresAt = isoTimestamp(value.expiresAt, 'expiresAt')
  if (expiresAt <= now || expiresAt > now + 120_000) throw new Error('Pairing offer is expired or too long')
}

export async function createDeviceIdentity(deviceId = crypto.randomUUID()): Promise<DeviceIdentity> {
  identifier(deviceId, 'deviceId')
  const generated = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )
  const publicKey = await crypto.subtle.exportKey('jwk', generated.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey)
  const privateKey = await crypto.subtle.importKey(
    'jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
  )
  const fingerprint = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalPublicKey(publicKey)))
  return {
    deviceId,
    publicKey,
    privateKey,
    fingerprint: encodeBase64Url(new Uint8Array(fingerprint)).slice(0, 22),
  }
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerPublicKey: JsonWebKey,
  pairingNonce: string,
  pairingId: string,
): Promise<CryptoKey> {
  identifier(pairingId, 'pairingId')
  canonicalPublicKey(peerPublicKey)
  const peer = await crypto.subtle.importKey(
    'jwk', peerPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256)
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: decodeBase64Url(pairingNonce),
    info: encoder.encode(`dsh-desk/cross-device/v1/${pairingId}`),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export function encodePairingFragment(offer: PairingOffer, now = Date.now()): string {
  assertPairingOffer(offer, now)
  return `pair=${encodeBase64Url(encoder.encode(JSON.stringify(offer)))}`
}

export function decodePairingFragment(fragment: string, now = Date.now()): PairingOffer {
  const encoded = new URLSearchParams(fragment.replace(/^#/u, '')).get('pair')
  if (!encoded) throw new Error('Pairing fragment is missing')
  const offer = JSON.parse(decoder.decode(decodeBase64Url(encoded))) as PairingOffer
  assertPairingOffer(offer, now)
  return offer
}

export function assertTaskSnapshot(value: TaskSnapshot): void {
  const allowed = new Set(['taskId', 'alias', 'state', 'stage', 'startedAt', 'elapsedSeconds', 'errorCode'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Field is not allowed: ${key}`)
  identifier(value.taskId, 'taskId')
  if (typeof value.alias !== 'string' || value.alias.length < 1 || value.alias.length > 80) throw new Error('Invalid alias')
  if (!['running', 'waiting', 'completed', 'failed'].includes(value.state)) throw new Error('Invalid state')
  if (typeof value.stage !== 'string' || value.stage.length < 1 || value.stage.length > 120) throw new Error('Invalid stage')
  isoTimestamp(value.startedAt, 'startedAt')
  if (!Number.isInteger(value.elapsedSeconds) || value.elapsedSeconds < 0) throw new Error('Invalid elapsedSeconds')
  if (value.errorCode !== undefined && !/^[a-z0-9-]{1,64}$/u.test(value.errorCode)) throw new Error('Invalid errorCode')
}

export class AuthenticatedEnvelopeRejectedError extends Error {
  readonly sequence: number

  constructor(sequence: number, message: string) {
    super(message)
    this.name = 'AuthenticatedEnvelopeRejectedError'
    this.sequence = sequence
  }
}

function assertHeaderStructure(header: EnvelopeHeader): void {
  if (header.protocolVersion !== 1 || header.kind !== 'task.snapshot') throw new Error('Invalid envelope kind')
  identifier(header.messageId, 'messageId')
  identifier(header.mailboxId, 'mailboxId')
  identifier(header.senderDeviceId, 'senderDeviceId')
  if (!Number.isSafeInteger(header.sequence) || header.sequence < 1) throw new Error('Invalid sequence')
  isoTimestamp(header.createdAt, 'createdAt')
  isoTimestamp(header.expiresAt, 'expiresAt')
}

function assertHeaderLifetime(header: EnvelopeHeader, now: number): void {
  const createdAt = Date.parse(header.createdAt)
  const expiresAt = Date.parse(header.expiresAt)
  if (expiresAt <= now || expiresAt - createdAt > 300_000) {
    throw new AuthenticatedEnvelopeRejectedError(header.sequence, 'Envelope is expired or too long')
  }
}

export async function encryptTaskSnapshot(
  key: CryptoKey,
  snapshot: TaskSnapshot,
  routing: { mailboxId: string; senderDeviceId: string; sequence: number },
  now = Date.now(),
): Promise<EncryptedEnvelope> {
  assertTaskSnapshot(snapshot)
  const header: EnvelopeHeader = {
    protocolVersion: 1,
    messageId: crypto.randomUUID(),
    mailboxId: routing.mailboxId,
    senderDeviceId: routing.senderDeviceId,
    sequence: routing.sequence,
    kind: 'task.snapshot',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
  }
  assertHeaderStructure(header)
  assertHeaderLifetime(header, now)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(canonicalHeader(header)), tagLength: 128 },
    key,
    encoder.encode(JSON.stringify(snapshot)),
  )
  return { header, iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(new Uint8Array(ciphertext)) }
}

export async function decryptTaskSnapshot(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
  expected: { mailboxId: string; senderDeviceId: string; afterSequence: number },
  now = Date.now(),
): Promise<TaskSnapshot> {
  assertHeaderStructure(envelope.header)
  if (envelope.header.mailboxId !== expected.mailboxId || envelope.header.senderDeviceId !== expected.senderDeviceId) {
    throw new Error('Envelope identity mismatch')
  }
  if (envelope.header.sequence <= expected.afterSequence) throw new Error('Envelope sequence was replayed')
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: decodeBase64Url(envelope.iv),
    additionalData: encoder.encode(canonicalHeader(envelope.header)),
    tagLength: 128,
  }, key, decodeBase64Url(envelope.ciphertext))
  const snapshot = JSON.parse(decoder.decode(plaintext)) as TaskSnapshot
  try {
    assertTaskSnapshot(snapshot)
    assertHeaderLifetime(envelope.header, now)
  } catch (error) {
    if (error instanceof AuthenticatedEnvelopeRejectedError) throw error
    const message = error instanceof Error ? error.message : 'Authenticated envelope was rejected'
    throw new AuthenticatedEnvelopeRejectedError(envelope.header.sequence, message)
  }
  return snapshot
}
