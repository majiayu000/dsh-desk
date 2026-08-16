import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReviewedOperation } from '../src/plugin-review.ts'
import type { PluginInspection } from '../src/plugins.ts'

function inspection(overrides: Partial<PluginInspection>): PluginInspection {
  return {
    source: 'example-plugin',
    kind: 'registry',
    name: 'example-plugin',
    version: '1.4.0',
    integrity: 'sha512-example',
    repository: null,
    trustSignal: 'npm integrity（只能校验内容，不代表维护者签名）',
    lifecycleScripts: [],
    risk: 'low',
    warnings: [],
    permissionNotice: 'notice',
    ...overrides,
  }
}

test('a reviewed registry install is pinned to the inspected version', () => {
  assert.deepEqual(
    resolveReviewedOperation('add', 'example-plugin', inspection({})),
    { action: 'add', operand: 'example-plugin@1.4.0' },
  )
})

test('a reviewed registry update installs the exact inspected version', () => {
  assert.deepEqual(
    resolveReviewedOperation('update', 'example-plugin', inspection({})),
    { action: 'add', operand: 'example-plugin@1.4.0' },
    'pnpm update ignores version specifiers, so the pinned upgrade must go through add',
  )
})

test('an already pinned operand stays at the version the inspection resolved', () => {
  assert.deepEqual(
    resolveReviewedOperation('add', 'example-plugin@1.2.3', inspection({})),
    { action: 'add', operand: 'example-plugin@1.4.0' },
  )
})

test('non-registry sources and incomplete metadata keep the typed operand', () => {
  assert.deepEqual(
    resolveReviewedOperation('add', '/local/plugin-dir', inspection({ kind: 'directory', name: null, version: null })),
    { action: 'add', operand: '/local/plugin-dir' },
  )
  assert.deepEqual(
    resolveReviewedOperation('update', 'example-plugin', inspection({ version: null })),
    { action: 'update', operand: 'example-plugin' },
  )
})
