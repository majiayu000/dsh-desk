import assert from 'node:assert/strict'
import test from 'node:test'
import { clipboardPluginSource, parsePluginInstallInput } from '../src/plugin-source.ts'

test('a copied registry command yields only the add operand', () => {
  assert.deepEqual(
    parsePluginInstallInput('dsh plugin --profile web add @struktoai/mirage-dsh'),
    { operand: '@struktoai/mirage-dsh', fromCommand: true },
  )
  assert.deepEqual(
    parsePluginInstallInput('dsh plugin --profile web add github:omdsh-dev/dsh-at-file#e0db46f643ceceed5a9001e1a643b08855672b0d'),
    { operand: 'github:omdsh-dev/dsh-at-file#e0db46f643ceceed5a9001e1a643b08855672b0d', fromCommand: true },
  )
})

test('quoted commands, prompts, and extra prose still parse', () => {
  assert.equal(
    parsePluginInstallInput('`$ dsh plugin --profile web add @scope/plugin`').operand,
    '@scope/plugin',
  )
  assert.equal(
    parsePluginInstallInput('复制：dsh.exe plugin --profile tui add "owner/repo"').operand,
    'owner/repo',
  )
  assert.equal(
    parsePluginInstallInput('dsh plugin add @scope/plugin').operand,
    '@scope/plugin',
  )
})

test('a raw package spec is left unchanged', () => {
  assert.deepEqual(
    parsePluginInstallInput('@scope/dsh-plugin@1.2.3'),
    { operand: '@scope/dsh-plugin@1.2.3', fromCommand: false },
  )
  assert.deepEqual(parsePluginInstallInput('  '), { operand: '', fromCommand: false })
})

test('quoted local paths keep spaces inside the operand', () => {
  assert.deepEqual(
    parsePluginInstallInput('dsh plugin add "file:/Users/Alice Smith/plugin"'),
    { operand: 'file:/Users/Alice Smith/plugin', fromCommand: true },
  )
  assert.equal(
    parsePluginInstallInput("dsh plugin --profile web add 'file:/Users/Alice Smith/plugin'").operand,
    'file:/Users/Alice Smith/plugin',
  )
})

test('lookbehind-free matching still rejects a prefixed identifier', () => {
  assert.deepEqual(
    parsePluginInstallInput('notdsh plugin add @scope/plugin'),
    { operand: 'notdsh plugin add @scope/plugin', fromCommand: false },
  )
})

test('clipboard detection only fires for an explicit plugin add command', () => {
  assert.equal(clipboardPluginSource('dsh plugin --profile web add @scope/plugin'), '@scope/plugin')
  assert.equal(clipboardPluginSource('@scope/plugin'), null)
  assert.equal(clipboardPluginSource('dsh plugin --profile web why @scope/plugin'), null)
  assert.equal(clipboardPluginSource(''), null)
})
