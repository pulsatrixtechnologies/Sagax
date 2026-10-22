// The user-mode helper that runs on the end user's computer, over the tunnel
// a stage-1 session already established, to give the technician live control.
// It is delivered in the session command itself (no binary shipped, nothing
// installed): on Windows a short PowerShell program that injects input with
// SendInput (standard rights, the user's own session) and streams the screen
// as JPEG frames with CopyFromScreen. It exits when the server closes its
// stdin (the technician released control or the session closed) or when its
// deadline passes, and it writes nothing to disk. The server never
// interpolates anything the person typed into this script: only the bounded
// numbers below.
import type { RemoteSessionOs } from "../shared/remote-session.ts";

export interface ControlHelperOptions {
  /** Frames per second, 2..15. */
  fps: number;
  /** JPEG quality, 30..90. */
  quality: number;
  /** Hard stop in seconds, so an orphaned helper cannot outlive the session. */
  maxSeconds: number;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** True when live control is available for this OS. Windows only for now;
 * macOS and Linux would need a tool we do not ship, so the screen there stays
 * read-only (see the PR body: a JC decision). */
export function controlSupported(os: RemoteSessionOs): boolean {
  return os === "windows";
}

/** The command the server runs over `tailcat ssh <addr>` for live control, or
 * null when this OS has no control path. Returns the script too, so a test can
 * assert its contents without decoding base64. */
export function controlHelperCommand(os: RemoteSessionOs, options: ControlHelperOptions): { command: string; script: string } | null {
  if (os !== "windows") return null;
  const script = windowsControlScript(options);
  // -EncodedCommand takes base64 of UTF-16LE: it carries a long program
  // through ssh with no quoting, and the bytes are our own, never the person's.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, script };
}

/** Normalized pointer space (shared/remote-control NORM_MAX), mapped to the
 * SendInput absolute range 0..65535 across the whole virtual desktop. */
export function windowsControlScript(options: ControlHelperOptions): string {
  const fps = clampInt(options.fps, 2, 15);
  const quality = clampInt(options.quality, 30, 90);
  const maxSeconds = clampInt(options.maxSeconds, 1, 26 * 60 * 60);
  const frameInterval = Math.max(1, Math.round(1000 / fps));
  // The P/Invoke surface: SendInput for mouse and keyboard, the virtual-screen
  // metrics for the absolute mapping, and GDI+ for JPEG encoding.
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PxInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public const uint MOUSE=0, KEYBD=1;
  public const uint MOVE=0x0001, ABSOLUTE=0x8000, VIRTUALDESK=0x4000, LDOWN=0x0002, LUP=0x0004, RDOWN=0x0008, RUP=0x0010, MDOWN=0x0020, MUP=0x0040, WHEEL=0x0800;
  public const uint KEYUP=0x0002, UNICODE=0x0004;
  static INPUT[] One() { INPUT[] a = new INPUT[1]; a[0].type = 0; return a; }
  public static void Mouse(uint flags, int dx, int dy, uint data) {
    INPUT[] a = One(); a[0].type = MOUSE; a[0].u.mi.dwFlags = flags; a[0].u.mi.dx = dx; a[0].u.mi.dy = dy; a[0].u.mi.mouseData = data;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Key(ushort vk, bool up) {
    INPUT[] a = One(); a[0].type = KEYBD; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = up ? KEYUP : 0;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Unicode(char c, bool up) {
    INPUT[] a = One(); a[0].type = KEYBD; a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = UNICODE | (up ? KEYUP : 0);
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

$NORM = 10000
$deadline = (Get-Date).AddSeconds(${maxSeconds})

function Get-Bounds { [System.Windows.Forms.SystemInformation]::VirtualScreen }

# Map a normalized 0..$NORM point to the SendInput absolute range over the
# whole virtual desktop (0..65535), so a multi-monitor host maps correctly.
function Send-Move([int]$nx, [int]$ny) {
  $b = Get-Bounds
  $ax = [int](($nx / $NORM) * 65535.0)
  $ay = [int](($ny / $NORM) * 65535.0)
  [PxInput]::Mouse([PxInput]::MOVE -bor [PxInput]::ABSOLUTE -bor [PxInput]::VIRTUALDESK, $ax, $ay, 0)
}

# Input runs on its own thread so the frame loop never stalls behind a click.
$inputThread = [System.Threading.Thread]::new({
  $stdin = [Console]::In
  while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }
    try {
      $sp = $line.IndexOf(' ')
      $op = if ($sp -lt 0) { $line } else { $line.Substring(0, $sp) }
      $rest = if ($sp -lt 0) { '' } else { $line.Substring($sp + 1) }
      switch ($op) {
        'm' { $p = $rest.Split(' '); Send-Move ([int]$p[0]) ([int]$p[1]) }
        'd' { $b = [int]$rest; if ($b -eq 0) { [PxInput]::Mouse([PxInput]::LDOWN,0,0,0) } elseif ($b -eq 1) { [PxInput]::Mouse([PxInput]::RDOWN,0,0,0) } else { [PxInput]::Mouse([PxInput]::MDOWN,0,0,0) } }
        'u' { $b = [int]$rest; if ($b -eq 0) { [PxInput]::Mouse([PxInput]::LUP,0,0,0) } elseif ($b -eq 1) { [PxInput]::Mouse([PxInput]::RUP,0,0,0) } else { [PxInput]::Mouse([PxInput]::MUP,0,0,0) } }
        'w' { $d = [int]$rest; [PxInput]::Mouse([PxInput]::WHEEL,0,0,[uint32]($d * 120)) }
        'k' { $p = $rest.Split(' '); [PxInput]::Key([uint16][int]$p[0], ([int]$p[1] -eq 0)) }
        'x' { $s = ($rest | ConvertFrom-Json); foreach ($ch in $s.ToCharArray()) { [PxInput]::Unicode($ch, $false); [PxInput]::Unicode($ch, $true) } }
      }
    } catch { }
  }
})
$inputThread.IsBackground = $true
$inputThread.Start()

# Binary stdout: type byte, 4-byte big-endian length, payload.
$out = [Console]::OpenStandardOutput()
function Write-Frame([byte]$type, [byte[]]$payload) {
  $len = $payload.Length
  $header = [byte[]]@($type, (($len -shr 24) -band 0xFF), (($len -shr 16) -band 0xFF), (($len -shr 8) -band 0xFF), ($len -band 0xFF))
  $out.Write($header, 0, 5); if ($len -gt 0) { $out.Write($payload, 0, $len) }; $out.Flush()
}

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})

$lastW = 0; $lastH = 0; $lastHash = $null
$sha = [System.Security.Cryptography.SHA1]::Create()
while ((Get-Date) -lt $deadline) {
  $b = Get-Bounds
  $w = [Math]::Max(1, $b.Width); $h = [Math]::Max(1, $b.Height)
  if ($w -ne $lastW -or $h -ne $lastH) {
    $meta = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress @{ w = $w; h = $h }))
    Write-Frame 0x4D $meta
    $lastW = $w; $lastH = $h
  }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $jpeg, $params)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    # Skip an identical frame so an idle screen sends nothing.
    $hash = [Convert]::ToBase64String($sha.ComputeHash($bytes))
    if ($hash -ne $lastHash) { Write-Frame 0x46 $bytes; $lastHash = $hash }
  } finally { $g.Dispose(); $bmp.Dispose() }
  Start-Sleep -Milliseconds ${frameInterval}
}
`;
}
