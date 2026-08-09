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
> Changing the public key is free **right now**, because no release has ever
> shipped with a working updater — nothing in the field is verifying against
> the current one. That stops being true after the first published release.

## Cutting a release

1. Bump `version` in `desktop/src-tauri/tauri.conf.json`. The updater compares
   this against the installed copy, so an unchanged version ships nothing.
2. Commit it.
3. Tag and push:

```bash
git tag desktop-v1.0.1 && git push origin desktop-v1.0.1
```

The workflow builds Windows and macOS, signs both, and creates a **draft**
release with the installers and `latest.json`.

4. **Publish the draft.** This step is not optional and is easy to forget:
   `releases/latest/download/latest.json` — the URL the app polls — does not
   resolve to a draft. Until you press Publish, no café sees the update.

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
