import { resolve } from 'node:path'
import { assertContract as assert, createContractReader } from './lib/contract.mjs'

const root = resolve(import.meta.dirname, '..')
const read = createContractReader(root)
const desktopSource = read('src-tauri/src/lib.rs')

assert(
  desktopSource.includes('.about(Some(about_metadata))'),
  'the About menu must receive metadata so Windows and Linux open a native dialog',
)
assert(
  !desktopSource.includes('.about(None)'),
  'the About menu must not silently no-op on Windows or Linux',
)
for (const field of ['name', 'version', 'authors', 'comments', 'license', 'website']) {
  assert(
    desktopSource.includes(`.${field}(Some(`),
    `the native About dialog must include ${field} metadata`,
  )
}
assert(
  desktopSource.includes('show_menu_action_error(app, "打开插件管理窗口", error)'),
  'plugin management menu failures must be shown to the user',
)
assert(
  desktopSource.includes('show_menu_action_error(app, "打开软件更新窗口", error)'),
  'software update menu failures must be shown to the user',
)

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

console.log('Desktop menu contracts passed.')
