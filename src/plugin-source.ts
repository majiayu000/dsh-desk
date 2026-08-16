export interface ParsedPluginInstallInput {
  operand: string
  fromCommand: boolean
}

const PLUGIN_ADD_COMMAND =
  /(?<![A-Za-z0-9._-])dsh(?:\.exe)?\s+plugin(?:\s+--profile\s+[A-Za-z]+)?\s+add\s+['"`]?([^\s'"`]+)/i

function cleanOperand(value: string): string {
  return value.replace(/[.,;:)]+$/g, '')
}

export function parsePluginInstallInput(raw: string): ParsedPluginInstallInput {
  const value = raw.trim()
  if (!value) {
    return { operand: '', fromCommand: false }
  }

  const match = value.match(PLUGIN_ADD_COMMAND)
  if (match?.[1]) {
    return { operand: cleanOperand(match[1]), fromCommand: true }
  }

  return { operand: value, fromCommand: false }
}

export function clipboardPluginSource(raw: string): string | null {
  const parsed = parsePluginInstallInput(raw)
  if (!parsed.fromCommand || parsed.operand.length === 0) {
    return null
  }
  return parsed.operand
}
