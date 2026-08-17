export interface ParsedPluginInstallInput {
  operand: string
  fromCommand: boolean
}

const PLUGIN_ADD_PREFIX =
  /(?:^|[^A-Za-z0-9._-])dsh(?:\.exe)?\s+plugin(?:\s+--profile\s+[A-Za-z]+)?\s+add\s+/i

function cleanOperand(value: string): string {
  return value.replace(/[.,;:)]+$/g, '')
}

function parseAddOperand(rest: string): string | null {
  const value = rest.trimStart()
  if (!value) return null

  const quote = value[0]
  if (quote === "'" || quote === '"' || quote === '`') {
    const end = value.indexOf(quote, 1)
    const inner = (end === -1 ? value.slice(1) : value.slice(1, end)).trim()
    return inner.length > 0 ? inner : null
  }

  const token = value.match(/^[^\s'"`]+/)?.[0]
  if (!token) return null
  const operand = cleanOperand(token)
  return operand.length > 0 ? operand : null
}

export function parsePluginInstallInput(raw: string): ParsedPluginInstallInput {
  const value = raw.trim()
  if (!value) {
    return { operand: '', fromCommand: false }
  }

  const match = PLUGIN_ADD_PREFIX.exec(value)
  if (match) {
    const operand = parseAddOperand(value.slice(match.index + match[0].length))
    if (operand) {
      return { operand, fromCommand: true }
    }
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
