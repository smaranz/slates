const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the portal window may ask of this Mac: the apps it answers locally
 * while Slates runs on a host (see LOCAL_APPS in main.mjs), and their data;
 * and saving a file from the host into Downloads › Slates, since the Mac
 * can't reach the host's disk. web/lib/desktop-bridge.ts is the other side.
 */
const flag = process.argv.find((arg) => arg.startsWith("--slates-local-apps="));
const localApps = flag ? flag.slice("--slates-local-apps=".length).split(",").filter(Boolean) : [];

contextBridge.exposeInMainWorld("slatesDesktop", {
  localApps,
  localFetch: (path, init) =>
    ipcRenderer.invoke("slates:local-fetch", { path, method: init && init.method, body: init && init.body }),
  saveFile: (url, name, options) =>
    ipcRenderer.invoke("slates:save-file", {
      url,
      name,
      then: options && options.then,
      notify: options && options.notify,
    }),
});
