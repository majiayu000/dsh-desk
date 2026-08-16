import {
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
  /** Cursor to fetch after in the next poll; it advances past bad envelopes. */
  lastSequence: number
  accepted: number
  skipped: number
}

/**
 * Applies fetched envelopes to the task store in sequence order.
 *
 * A single envelope that is expired, tampered with, or otherwise undecryptable
 * must not wedge the mailbox cursor: the relay retains envelopes far longer
 * than their 120 s validity window, so a cursor that only advances on
 * successful decryption would re-fetch the same poisoned envelope forever
 * and starve every newer snapshot. Failed envelopes are counted, skipped,
 * and the cursor moves past them.
 */
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
    } catch {
      skipped += 1
    }
    lastSequence = envelope.header.sequence
  }
  return { lastSequence, accepted, skipped }
}
