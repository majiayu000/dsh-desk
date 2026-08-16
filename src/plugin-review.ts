import type { PluginInspection } from './plugins'

export type PluginOperation = 'add' | 'update'

export interface ResolvedPluginOperation {
  action: PluginOperation
  operand: string
}

/**
 * Binds a confirmed review to the exact package the inspection showed.
 *
 * The inspection resolves a bare registry name to the registry's `latest` at
 * view time. If the confirmed action re-sent that bare name, the install
 * would re-resolve `latest` and could install (and run lifecycle scripts
 * from) a version the user never reviewed. Pinning the operand to
 * `name@version` closes that window. `pnpm update` does not accept version
 * specifiers, so an update to a pinned registry version is expressed as an
 * `add` of that exact version — dsh reconciles plugins by installed state,
 * which makes the two equivalent for the plugin profile.
 */
export function resolveReviewedOperation(
  action: PluginOperation,
  typed: string,
  inspection: PluginInspection,
): ResolvedPluginOperation {
  if (inspection.kind === 'registry' && inspection.name !== null && inspection.version !== null) {
    return { action: 'add', operand: `${inspection.name}@${inspection.version}` }
  }
  return { action, operand: typed }
}
