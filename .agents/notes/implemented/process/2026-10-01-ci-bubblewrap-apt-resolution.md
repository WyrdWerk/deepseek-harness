# Agent Note: resolve CI bubblewrap through apt metadata, not a pinned pool URL

Status: implemented

English | [中文](2026-10-01-ci-bubblewrap-apt-resolution.zh.md)

## Problem

`scripts/prepare-ci-bubblewrap.sh` downloaded `bubblewrap_0.9.0-1ubuntu0.1_amd64.deb` from a hand-pinned `archive.ubuntu.com` URL and verified a hand-recorded SHA256. Ubuntu's security update superseded that build with `0.9.0-1ubuntu0.3`, and the pool keeps only the current version, so the pinned URL began returning 404. Every scheduled E2E run on `no-telemetry-compat` failed in the bubblewrap step with curl exit 22 from 2026-09-11 onward — before the API-key preflight, so the suite reported no signal. The pinned-filename design carried a second rot mode: the `ubuntu-latest` label migrates to Ubuntu 26 from 2026-10-19, where a noble-pinned `.deb` would be the wrong release.

## Decision

The script resolves the current bubblewrap candidate through apt and extracts that payload: `sudo apt-get update --quiet` refreshes the runner image's package indexes, `apt-get download bubblewrap` fetches the candidate `.deb` into the extraction directory, `dpkg-deb --extract` unpacks it, and the downloaded file is removed. The introducing decision stands unchanged — download runs no package transaction — and integrity verification now rests on apt: the image's keyring verifies the `InRelease` signature, and apt checks the `.deb` SHA256 against the signed `Packages` index. The Linux x86_64 guard, the `kernel.apparmor_restrict_unprivileged_userns` knob, the `GITHUB_PATH` entry, and the functional `bwrap` probe are unchanged. When `apt-get download` produces no `.deb`, the script fails with a `::error::` annotation naming the runner's apt sources as the inspection target.

## Verification

The script ran on a Linux x86_64 host: apt resolved the distro candidate, the extraction directory held only `usr/bin` after cleanup, and the `--version` and `--ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true` probes passed. The signed `noble-updates` index separately confirmed the candidate is `0.9.0-1ubuntu0.3`, the supersede that broke the pin. The `ci.yml` lanes that run this script on every pull request are the standing regression check; no new gate is added.

## Alternatives considered

- **Re-pin `0.9.0-1ubuntu0.3` with a fresh SHA256.** Smallest diff, but it reintroduces the failure mode: the next security supersede re-breaks every lane, and on a branch without active pull requests the breakage surfaces only in nightly runs.
- **Parse `Packages.gz` and verify with `gpgv` inside the script.** Reimplements apt's index verification in shell for no additional guarantee and keeps a second copy of release-specific logic.
- **Install through `apt-get install bubblewrap`.** Rejected by the introducing decision (the package transaction scans the image's full dpkg database and runs post-install hooks); download-only keeps that cost out.

## Consequences

- Each runner release gets its own current candidate: hosted 24.04 today, Ubuntu 26 after the label migration, and the self-hosted failover VM through its own sources.
- The pinned version and hash constants disappear; a tampered `.deb` now fails apt's signature or hash check instead of matching a script constant.
- Lanes pay one `apt-get update` — a metadata refresh, no package change — per bubblewrap preparation step.
