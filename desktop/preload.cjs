const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the portal window may ask of this Mac: the apps it answers locally
 * while Slates runs on a host (see LOCAL_APPS in main.mjs), and their data.
 * Only loaded in that mode; web/lib/desktop-bridge.ts is the other side.
 */
const flag = process.argv.find((arg) => arg.startsWith("--slates-local-apps="));
const localApps = flag ? flag.slice("--slates-local-apps=".length).split(",").filter(Boolean) : [];

contextBridge.exposeInMainWorld("slatesDesktop", {
  localApps,
  localFetch: (path, init) =>
    ipcRenderer.invoke("slates:local-fetch", { path, method: init && init.method, body: init && init.body }),
});
