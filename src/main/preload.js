'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File collection
  collectImages: (paths) => ipcRenderer.invoke('collect-images', paths),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickOutputFolder: () => ipcRenderer.invoke('pick-output-folder'),

  // Resolve real filesystem paths from dropped File objects (Electron >= 32
  // removed File.path; webUtils.getPathForFile is the supported replacement).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || null;
    }
  },

  // Settings & presets
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  savePresets: (p) => ipcRenderer.invoke('save-presets', p),
  exportPresets: (p) => ipcRenderer.invoke('export-presets', p),
  importPresets: () => ipcRenderer.invoke('import-presets'),

  // Processing
  process: (payload) => ipcRenderer.invoke('process', payload),
  cancel: () => ipcRenderer.invoke('cancel-processing'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),

  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  onComplete: (cb) => ipcRenderer.on('complete', (_e, d) => cb(d)),
});
