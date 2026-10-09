# Windows launch check (Sagax 0.4.16)

The Windows packages of 0.4.16 are cross-built on macOS
(`pnpm package:fork:win:cross`, see `docs/releasing.md` step 3). The build
checks every binary by its bytes (`scripts/verify-win-natives.mjs`), but
nothing in that flow runs the app. This page is the launch check a person does
on a real Windows PC before the next release, and after it for 0.4.16.

Release: https://github.com/pulsatrixtechnologies/sagax/releases/tag/pulsa-v0.4.16

## What ships

| File | What it is |
|---|---|
| `Sagax-0.4.16-setup.exe` | One NSIS installer carrying x64 and arm64; it installs the one matching the PC |
| `Sagax-0.4.16-win-x64.zip` | Portable, x64 |
| `Sagax-0.4.16-win-arm64.zip` | Portable, arm64 |
| `latest.yml` | Windows update feed, one entry, pins the installer's sha512 |

The build is unsigned: SmartScreen shows an unknown publisher.

## Machines

Run the check on both, the arm64 one first (it is the one we never saw run):

1. Windows 11 on arm64 (Snapdragon PC, or a Windows 11 ARM VM on Apple
   Silicon such as UTM, Parallels or the QEMU lab).
2. Windows 10 or 11 on x64.

A clean user profile is best. Note the Windows build (`winver`) and the arch
(`Settings > System > About`, "System type").

## Before installing

1. Download `Sagax-0.4.16-setup.exe` and `latest.yml` from the release.
2. Check the installer hash against the feed, in PowerShell:

   ```powershell
   $h = (Get-FileHash .\Sagax-0.4.16-setup.exe -Algorithm SHA512).Hash
   [Convert]::ToBase64String([byte[]] -split ($h -replace '..', '0x$& '))
   Select-String -Path .\latest.yml -Pattern 'sha512'
   ```

   The base64 value must equal the `sha512` line of `latest.yml`.

## Install and first launch

- [ ] SmartScreen: More info, then Run anyway. No UAC prompt (per-user install).
- [ ] The installer finishes and Sagax opens by itself.
- [ ] Start menu and desktop shortcut are named "Pulsatrix Sagax".
- [ ] `Settings > Apps > Installed apps` lists "Pulsatrix Sagax 0.4.16".
- [ ] Task Manager, Details tab, "Architecture" column: `Sagax.exe` is ARM64
      on the arm64 PC, x64 on the x64 PC (not emulated).
- [ ] The main window loads within 60 s: the chat, not the "Couldn't start the
      bot server" page, not a black window.
- [ ] No update popup at launch (a silent background check is expected).

## Working app

- [ ] Data folder exists: `%APPDATA%\sagax` (a machine that had an older
      build may still use `%APPDATA%\openmausbot`; both are expected).
- [ ] Server log is written under that folder's `logs\` (`server.log`), with
      no stack trace at startup.
- [ ] The model picker lists at least one engine (this exercises the `.cmd`
      shim resolution in `server/procs.ts`, which only runs on Windows).
- [ ] Create a bot, send a message, get a reply.
- [ ] Attach a small `.zip` to a message: the bot sees its text files.
- [ ] Close the window and reopen from the Start menu: the chat is still there.
- [ ] Quit from the tray or menu: no `Sagax.exe` left in Task Manager.

## Portable zips

- [ ] Unzip the zip for the PC's arch, run `Sagax.exe`: same "first launch"
      checks. Then the other arch on arm64 only (x64 runs emulated): it should
      start, slower.

## Optional: the scripted smoke

With Node 24 and a Sagax checkout on the Windows PC:

```powershell
node scripts\smoke-packaged-launch.mjs --app "$env:LOCALAPPDATA\Programs\Sagax\Sagax.exe"
node scripts\verify-win-natives.mjs "$env:LOCALAPPDATA\Programs\Sagax" arm64
```

(Use `x64` on the x64 PC. Adjust the path if the installer chose another
folder: the shortcut's "Open file location" shows it.) The smoke prints
`[smoke] renderer-ready` and exits 0 when the window reached the server.

## Update path

- [ ] On a PC with 0.4.15 installed, launch it and let it update: it must
      offer and install 0.4.16, then restart on 0.4.16 (Help or About shows the
      version). A download that does nothing points at a `latest.yml` sha512
      mismatch.

## Report

Post in the GitHub issue "Windows launch check 0.4.16": Windows build, arch,
each box ticked or the failure with a screenshot and the last 50 lines of
`server.log`. Never paste a token, cookie or credentials file.
