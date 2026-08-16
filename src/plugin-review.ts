import type { PluginInspection } from './plugins'

export type PluginOperation = 'add' | 'update'

export interface ResolvedPluginOperation {
  action: PluginOperation
  operand: string
}

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
