import { resolve } from 'node:path'
import { assertContract as assert, createContractReader } from './lib/contract.mjs'

const root = resolve(import.meta.dirname, '..')
const read = createContractReader(root)
const desktopSource = read('src-tauri/src/lib.rs')

const editMenu = desktopSource.match(
  /#\[cfg\(target_os = "macos"\)\]\s*\{([\s\S]*?)\}\s*#\[cfg\(not\(target_os = "macos"\)\)\]/u,
)?.[1]

assert(editMenu, 'the macOS desktop menu must include a platform-scoped Edit submenu')
assert(
  editMenu.includes('SubmenuBuilder::with_id(app, EDIT_MENU_ID, "Edit")'),
  'the macOS desktop menu must build a native Edit submenu',
)
for (const command of ['cut', 'copy', 'paste', 'select_all']) {
  assert(
    editMenu.includes(`.${command}()`),
    `the macOS Edit menu must include the native ${command} command`,
  )
}
assert(
  !editMenu.includes('.text('),
  'macOS Edit commands must remain native predefined items with standard accelerators',
)
assert(
  editMenu.includes('menu.item(&edit).build()'),
  'the native Edit submenu must be attached to the application menu',
)

console.log('macOS native Edit menu contract passed.')
