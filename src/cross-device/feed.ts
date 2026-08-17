import {
  AuthenticatedEnvelopeRejectedError,
  decryptTaskSnapshot,
  type EncryptedEnvelope,
  type TaskSnapshot,
} from './protocol.ts'

export interface FeedSubscription {
  key: CryptoKey
  mailboxId: string
  senderDeviceId: string
  lastSequence: number
}

export interface FeedResult {
  lastSequence: number
  accepted: number
  skipped: number
}

export async function applyEnvelopes(
  subscription: FeedSubscription,
  tasks: Map<string, TaskSnapshot>,
  envelopes: EncryptedEnvelope[],
  now = Date.now(),
): Promise<FeedResult> {
  let lastSequence = subscription.lastSequence
  let accepted = 0
  let skipped = 0
  const ordered = [...envelopes].sort(
    (left, right) => left.header.sequence - right.header.sequence,
  )
  for (const envelope of ordered) {
    try {
      const snapshot = await decryptTaskSnapshot(
        subscription.key,
        envelope,
        {
          mailboxId: subscription.mailboxId,
          senderDeviceId: subscription.senderDeviceId,
          afterSequence: lastSequence,
        },
        now,
      )
      tasks.set(snapshot.taskId, snapshot)
      accepted += 1
      lastSequence = envelope.header.sequence
    } catch (error) {
      skipped += 1
      if (error instanceof AuthenticatedEnvelopeRejectedError) {
        lastSequence = error.sequence
      }
    }
  }
  return { lastSequence, accepted, skipped }
}
