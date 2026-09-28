#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || $(id -u) == 0 ]]; then
  echo 'Usage: bash scripts/test-appimage.sh <AppImage> (run as a non-root user with sudo)' >&2
  exit 1
fi

appimage=$(realpath "$1")
scratch=$(mktemp -d)
cleanup() {
  sudo -n rm -rf -- "$scratch"
}
trap cleanup EXIT

chmod +x "$appimage"
offset=$("$appimage" --appimage-offset)
# Keep root ownership so the test cannot pass using the builder's owner/group bits.
sudo -n unsquashfs -no-progress -o "$offset" -d "$scratch/app" "$appimage" >/dev/null
for launcher in AppRun AppRun.wrapped; do
  if [[ ! -r "$scratch/app/$launcher" || ! -x "$scratch/app/$launcher" ]]; then
    stat -c '%a %U:%G %n' "$scratch/app/$launcher" >&2
    echo "$launcher must be readable and executable by a different user" >&2
    exit 1
  fi
done
"$scratch/app/usr/lib/DSH Desk/runtime/node/bin/node" --version

mkdir -p "$scratch/config" "$scratch/data" "$scratch/cache"
export XDG_CONFIG_HOME="$scratch/config"
export XDG_DATA_HOME="$scratch/data"
export XDG_CACHE_HOME="$scratch/cache"

# Variables below belong to the child shell running inside the display/session.
# shellcheck disable=SC2016
xvfb-run -a dbus-run-session -- bash -euo pipefail -c '
  app_dir=$1
  log=$2
  "$app_dir/AppRun" >"$log" 2>&1 &
  app_pid=$!
  cleanup() {
    pkill -TERM -P "$app_pid" 2>/dev/null || true
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  }
  trap cleanup EXIT
  for ((second = 0; second < 30; second++)); do
    if ! kill -0 "$app_pid" 2>/dev/null; then
      cat "$log" >&2
      echo "AppImage exited before the startup check completed" >&2
      exit 1
    fi
    if (( second >= 15 )) && xwininfo -root -tree | grep "DSH Desk" >/dev/null; then
      echo "AppImage window is visible and the application is still running"
      exit 0
    fi
    sleep 1
  done
  cat "$log" >&2
  echo "AppImage did not show a DSH Desk window within 30 seconds" >&2
  exit 1
' _ "$scratch/app" "$scratch/app.log"
