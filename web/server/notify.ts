import { execFile } from "node:child_process";

export type Notifier = (title: string, body: string) => void;

/** AppleScript string literal: only backslash and double quote need escaping. */
export const appleScriptString = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** Builds the command used to show a system notification on `platform` (strings never go through a shell). */
export function notifyCommand(platform: NodeJS.Platform, title: string, body: string): { cmd: string; args: string[]; env?: Record<string, string> } | null {
  if (platform === "darwin") {
    return { cmd: "osascript", args: ["-e", `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`] };
  }
  if (platform === "linux") return { cmd: "notify-send", args: ["--app-name=LibreWallet", "--", title, body] };
  if (platform === "win32") {
    // Title/body travel in environment variables so they can't break out of the script.
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information",
      "$n.Visible = $true",
      "$n.ShowBalloonTip(8000, $env:LW_TITLE, $env:LW_BODY, [System.Windows.Forms.ToolTipIcon]::Info)",
      "Start-Sleep -Seconds 9",
      "$n.Dispose()",
    ].join("; ");
    return { cmd: "powershell", args: ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], env: { LW_TITLE: title, LW_BODY: body } };
  }
  return null;
}

/** Best-effort desktop notification; failures (no notifier installed, headless) are ignored. */
export const osNotifier: Notifier = (title, body) => {
  const c = notifyCommand(process.platform, title, body);
  if (!c) return;
  try {
    execFile(c.cmd, c.args, { env: { ...process.env, ...c.env }, windowsHide: true }, () => {}).unref();
  } catch { /* ignore */ }
};
