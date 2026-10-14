#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so resolve
# the current bubblewrap candidate through apt's signed metadata and extract
# that payload into the ephemeral runner directory. A hand-pinned pool URL rots
# when a security update supersedes the pinned build and the archive drops the
# old .deb — 0.9.0-1ubuntu0.1 → 0.9.0-1ubuntu0.3 left every lane red with curl
# exit 22 — while apt tracks the pool's current version on every runner release.

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

root="${RUNNER_TEMP}/dsh-bubblewrap"
mkdir -p "$root"

# `apt-get download` runs no package transaction: it fetches the candidate .deb
# into the working directory and validates its SHA256 against the signed
# Packages index (InRelease verified with the image's Ubuntu archive keyring).
sudo apt-get update --quiet
(cd "$root" && apt-get download bubblewrap)

archive=$(find "$root" -maxdepth 1 -name 'bubblewrap_*.deb' -print -quit)
if [[ -z "$archive" ]]; then
  echo '::error::apt-get download produced no bubblewrap .deb — inspect the runner distro apt sources' >&2
  exit 1
fi
dpkg-deb --extract "$archive" "$root"
rm -f "$archive"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
