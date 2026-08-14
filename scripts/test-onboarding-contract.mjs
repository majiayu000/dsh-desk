import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { assertContract as assert, createContractReader } from './lib/contract.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const dshPackagePath = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const dshRequire = createRequire(realpathSync(dshPackagePath))
const dshPackage = JSON.parse(readFileSync(dshPackagePath, 'utf8'))
const expectedVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  .dependencies['@deepseek-ai/dsh']

function packageRoot(resolver, name) {
  return dirname(dirname(resolver.resolve(name)))
}

assert(dshPackage.version === expectedVersion, 'the inspected Harness version differs from package.json')

const webAppRoot = packageRoot(dshRequire, '@deepseek-ai/dsh-web-app')
const webAppRequire = createRequire(join(webAppRoot, 'package.json'))
const modelsRoot = packageRoot(webAppRequire, '@deepseek-ai/dsh-client-ui-settings-models')
const readModels = createContractReader(modelsRoot)
const readWebApp = createContractReader(webAppRoot)
const modelsPackage = JSON.parse(readModels('package.json'))
const webPatch = readWebApp('cordis.patch.yml')
const client = readModels('lib/client.js')
const documentation = readModels('README.md')

assert(modelsPackage.version === expectedVersion, 'Models onboarding plugin version is not pinned with Harness')
for (const token of [
  'id: ui-settings-models',
  "name: '@deepseek-ai/dsh-client-ui-settings-models'",
]) {
  assert(webPatch.includes(token), `official Web bundle is missing ${token}`)
}

for (const token of [
  'settings.onboarding',
  'credentials.set',
  'onboardingTitle: "添加一个 API Key 开始使用"',
  'onboardingSave: "保存并继续"',
  'onboardingReadiness',
]) {
  assert(client.includes(token), `official onboarding client is missing ${token}`)
}
for (const token of [
  'write-only',
  'never carries a key value',
  'ANY provider the user can already reach ends it without rendering',
]) {
  assert(documentation.includes(token), `official credential boundary is missing ${token}`)
}

const testHome = mkdtempSync(join(tmpdir(), 'dsh-desk-onboarding-'))
try {
  const result = spawnSync(
    process.execPath,
    [join(dirname(dshPackagePath), 'lib', 'bin.js'), '--profile', 'web', '--dump-default-config'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: testHome, NO_COLOR: '1' },
    },
  )
  if (result.error) throw result.error
  assert(result.status === 0, `real Harness composition exited ${result.status}: ${result.stderr}`)
  assert(result.stdout.includes("name: '@deepseek-ai/dsh-client-ui-settings-models'"), 'real Web profile does not mount Models onboarding')
  assert(!result.stdout.match(/id: ui-settings-models[\s\S]{0,160}disabled: true/u), 'Models onboarding is disabled')
} finally {
  rmSync(testHome, { recursive: true, force: true })
}

console.log(`Official Harness ${expectedVersion} first-run model and write-only credential contract passed.`)
