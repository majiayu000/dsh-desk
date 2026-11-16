import { resolve } from 'node:path'
import { assertContract as assert, createContractReader } from './lib/contract.mjs'

const root = resolve(import.meta.dirname, '..')
const read = createContractReader(root)
const desktopSource = read('src-tauri/src/lib.rs')

// Launching a running app again starts a second process on Windows and Linux, which
// the single-instance plugin reports to the first one.
assert(
  /tauri_plugin_single_instance::init\(\|app, _args, _cwd\| \{\s*window_manager::handle_second_launch\(app\);\s*\}\)/u.test(
    desktopSource,
  ),
  'a second launch must go through window_manager::handle_second_launch so a closed main window is reopened',
)

// macOS starts no second process for a Dock, Finder or Spotlight activation of a
// running app. It only delivers RunEvent::Reopen, which the plugin never sees.
const reopen = desktopSource.match(
  /#\[cfg\(target_os = "macos"\)\]\s*tauri::RunEvent::Reopen \{ \.\. \} => \{([\s\S]*?)\}/u,
)?.[1]

assert(
  reopen,
  'the macOS run loop must handle RunEvent::Reopen whatever has_visible_windows says: the plugin or update window that keeps the app alive is visible',
)
assert(
  reopen.includes('window_manager::reopen_closed_harness_window(app)'),
  'a macOS Dock or Finder reopen must rebuild a closed main window',
)

console.log('Desktop relaunch contracts passed.')
