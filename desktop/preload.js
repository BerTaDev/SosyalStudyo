const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studioShell", {
  version: 1,
  bw: {
    state: () => ipcRenderer.invoke("bw:state"),
    layout: (r) => ipcRenderer.invoke("bw:layout", r),
    open: (url) => ipcRenderer.invoke("bw:open", url),
    close: (id) => ipcRenderer.invoke("bw:close", id),
    activate: (id) => ipcRenderer.invoke("bw:activate", id),
    nav: (id, action, url) => ipcRenderer.invoke("bw:nav", { id, action, url }),
    capture: (id, mode) => ipcRenderer.invoke("bw:capture", { id, mode }),
    snapshot: () => ipcRenderer.invoke("bw:snapshot"),
    focus: () => ipcRenderer.invoke("bw:focus"),
    onState: (cb) => ipcRenderer.on("bw-state", (_e, s) => cb(s)),
    onCommand: (cb) => ipcRenderer.on("bw-cmd", (_e, c) => cb(c)),
  },
  upd: {
    state: () => ipcRenderer.invoke("upd:state"),
    download: () => ipcRenderer.invoke("upd:download"),
    install: () => ipcRenderer.invoke("upd:install"),
  },
});
