/**
 * Mark the document so CSS can tell the Electron shell from a browser tab,
 * and macOS from Windows.
 *
 * macOS draws traffic lights over the top-left of a frameless window; Windows
 * keeps a normal title bar, so the same padding would just be a hole. Done on
 * the client because the portal is also opened in a tab, where none of this
 * applies.
 */
export function markDesktopShell(): void {
  if (typeof navigator === "undefined") return;
  if (!navigator.userAgent.includes("Electron")) return;
  const root = document.documentElement;
  root.dataset.desktop = "1";
  root.dataset.platform = /Windows NT/i.test(navigator.userAgent)
    ? "win"
    : /Mac OS X|Macintosh/i.test(navigator.userAgent)
      ? "mac"
      : "linux";
}
