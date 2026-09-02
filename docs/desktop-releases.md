# Releasing the desktop app

## First: does this need a release at all?

Usually not. The desktop app is a thin native window over
`https://khaopiyo.ventron.in` — `frontendDist` is null and the window loads the
live site. **Every web change reaches every café the moment Vercel deploys**,
with no release, no download, and no reinstall.

A release is only needed when something under `desktop/src-tauri` changes: the
window itself, the icons, the updater, or native features like printing.

## One-time setup

The updater verifies every download against a public key baked into
`tauri.conf.json`. The matching private key signs the artifacts in CI, and
without it the app will refuse an update as unsigned.

Generate a keypair:

```bash
cargo tauri signer generate -w khaopiyo-updater.key
```

Then, in the GitHub repo → Settings → Secrets and variables → Actions, add:

- `TAURI_SIGNING_PRIVATE_KEY` — the entire contents of `khaopiyo-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase you chose (empty string if none)

Put the public key it prints into `tauri.conf.json` under
`plugins.updater.pubkey`, replacing what is there.

> **Keep the private key.** Losing it means every installed copy stops
> accepting updates, because a new key produces signatures they cannot verify,
> and the only fix is walking every café through a manual reinstall. Store it
> somewhere that outlives this laptop.
>
> Rotating the public key is no longer free either. Releases are in the field
> now, verifying against the current one, so swapping it strands every
> installed copy exactly the way losing the private key does.

## Cutting a release

1. Bump `version` in `desktop/src-tauri/tauri.conf.json`. The updater compares
   this against the installed copy, so an unchanged version ships nothing.
2. Commit it.
3. Tag and push:

```bash
git tag desktop-v1.0.1 && git push origin desktop-v1.0.1
```

That is the whole process. The workflow builds and signs the Windows
installer, then **publishes** a release with it and `latest.json`. There is no
draft and nothing left to press — cafés start picking it up on their next
launch. (macOS has its own manual workflow, `build-macos.yml`, which only
uploads artifacts; it is not part of a release.)

### Trying a build without shipping it

Give the tag a pre-release suffix:

```bash
git tag desktop-v1.0.1-rc1 && git push origin desktop-v1.0.1-rc1
```

The release is still published, so the `.msi` is right there to download and
install by hand — but GitHub marks it a *pre-release*, and
`releases/latest/download/latest.json` (the URL the app polls) resolves only to
the newest release that is neither a draft nor a pre-release. No café sees it.
Manual `workflow_dispatch` runs are held back the same way. When the build
looks good, tag the plain version and that one ships.

> **Nothing pauses a build for a human any more.** That is deliberate: the old
> "publish the draft" step stranded v1.1.8 for hours and every café went
> without a print-bridge fix. What protects cafés now is that the build has to
> succeed before anything is published, that a failed update is silent by
> design (a café simply keeps the version it has, see below), and that
> anything you are unsure of can go out under an `-rc` tag first.

## What a café experiences

On the next launch, the app checks once in the background. If a newer version
exists it downloads and installs silently, and the new version is running the
time after that. Nobody is prompted and nothing interrupts service.

Failures are deliberately silent — no internet, GitHub down, a malformed
release — because the app is a window onto a live site and works perfectly
without ever updating its shell. Worst case a café stays on the version it has.

## Known rough edges

**Windows SmartScreen.** The installer is not code-signed, so a fresh install
shows "Windows protected your PC" → More info → Run anyway. This affects manual
installs only; updates applied by the updater are verified by signature and do
not prompt. Removing the warning needs a paid code-signing certificate.

**macOS Gatekeeper.** Same story — no Apple Developer account is wired in, so a
first install needs right-click → Open. An unsigned .app can also be blocked
outright on newer macOS; if that becomes a real obstacle, notarisation is the
fix and it needs a paid account.

**The version lives in two places.** `tauri.conf.json` is the real one; the git
tag is just what triggers the build. Keep them in step or the release name and
the update check will disagree.
