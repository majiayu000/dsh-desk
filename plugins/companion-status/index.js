/** Cordis plugin name shown in Harness diagnostics. */
export const name = 'dsh-desk-companion-status'

/** Wait for the official SessionStore service before activating. */
export const inject = ['sessions']

/**
 * The first delivery step intentionally proves the official plugin load path.
 * Session projection and transport are added only after this package loads in
 * a real Harness profile.
 */
export function apply() {}
