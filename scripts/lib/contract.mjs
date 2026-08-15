import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function createContractReader(root) {
  return (path) => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n')
}

export function assertContract(condition, message) {
  if (!condition) throw new Error(message)
}
