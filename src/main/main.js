'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { WorkerPool } = require('./pool');

const isDev = process.argv.includes('--dev');

const INPUT_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff',
]);

let mainWindow = null;
let pool = null;
let cancelRequested = false;

// ---------------------------------------------------------------------------
// Settings & preset persistence (userData dir)
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function presetsPath() {
  return path.join(app.getPath('userData'), 'presets.json');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_PRESETS = [
  {
    name: 'Flow Album Artwork',
    settings: {
      outputFormat: 'jpg',
      resize: { enabled: true, width: 3000, height: 3000, mode: 'aspect' },
      size: { enabled: true, mode: 'exact', value: 500, toleranceKB: 5, forceUnder: false },
      quality: { min: 60, max: 95 },
      naming: { mode: 'suffix', suffix: '_compressed' },
    },
  },
  {
    name: 'Telecom Artwork',
    settings: {
      outputFormat: 'jpg',
      resize: { enabled: true, width: 1080, height: 1080, mode: 'aspect' },
      size: { enabled: true, mode: 'max', value: 250, toleranceKB: 5, forceUnder: true },
      quality: { min: 50, max: 95 },
      naming: { mode: 'suffix', suffix: '_telecom' },
    },
  },
  {
    name: 'Web Upload',
    settings: {
      outputFormat: 'webp',
      resize: { enabled: false, width: 3000, height: 3000, mode: 'fit' },
      size: { enabled: true, mode: 'exact', value: 150, toleranceKB: 5, forceUnder: false },
      quality: { min: 50, max: 95 },
      naming: { mode: 'original' },
    },
  },
  {
    name: 'Social Media',
    settings: {
      outputFormat: 'jpg',
      resize: { enabled: true, width: 2048, height: 2048, mode: 'aspect' },
      size: { enabled: true, mode: 'exact', value: 1024, toleranceKB: 10, forceUnder: false },
      quality: { min: 60, max: 95 },
      naming: { mode: 'suffix', suffix: '_social' },
    },
  },
];

function loadPresets() {
  const data = readJson(presetsPath(), null);
  if (!data || !Array.isArray(data) || data.length === 0) {
    writeJson(presetsPath(), DEFAULT_PRESETS);
    return DEFAULT_PRESETS;
  }
  return data;
}

// ---------------------------------------------------------------------------
// File collection (recursive folder walk)
// ---------------------------------------------------------------------------

function collectImages(paths) {
  const out = [];
  const seen = new Set();

  const walk = (p) => {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      let entries = [];
      try {
        entries = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const e of entries) walk(path.join(p, e));
    } else if (stat.isFile()) {
      const ext = path.extname(p).toLowerCase();
      if (INPUT_EXTS.has(ext) && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  };

  for (const p of paths) walk(p);
  return out;
}

// ---------------------------------------------------------------------------
// Output path resolution
// ---------------------------------------------------------------------------

function resolveOutputPath(inputPath, settings, outputDir, index = 0, total = 1) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const fmt = (settings.outputFormat || 'jpg').toLowerCase();
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;

  let name = base;
  const naming = settings.naming || { mode: 'suffix', suffix: '_compressed' };

  if (naming.mode === 'suffix') {
    let suffix = naming.suffix || '_compressed';
    // Support a {size} token, e.g. cover_500kb.jpg
    if (suffix.includes('{size}') && settings.size && settings.size.value) {
      suffix = suffix.replace('{size}', `${settings.size.value}kb`);
    }
    name = base + suffix;
  } else if (naming.mode === 'rename') {
    // Replace the filename entirely with the user's text. When more than one
    // file is processed we append a zero-padded counter so outputs never
    // overwrite each other (e.g. artwork_001, artwork_002, ...).
    const custom = (naming.rename || 'image').trim() || 'image';
    if (total > 1) {
      const pad = String(total).length;
      const counter = String(index + 1).padStart(pad, '0');
      name = `${custom}_${counter}`;
    } else {
      name = custom;
    }
  }

  let targetDir = dir;
  if (settings.output && settings.output.mode === 'new') {
    targetDir = outputDir || path.join(dir, 'compressed');
  } else if (settings.output && settings.output.mode === 'ask') {
    targetDir = outputDir || dir;
  }

  return path.join(targetDir, `${name}.${ext}`);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#0d0d10',
    title: 'Image Compressor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  pool = new WorkerPool();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (pool) await pool.destroy();
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('collect-images', async (_e, paths) => collectImages(paths));

ipcMain.handle('pick-files', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'] },
    ],
  });
  if (res.canceled) return [];
  return collectImages(res.filePaths);
});

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a folder',
    properties: ['openDirectory'],
  });
  if (res.canceled) return [];
  return collectImages(res.filePaths);
});

ipcMain.handle('pick-output-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled) return null;
  return res.filePaths[0];
});

ipcMain.handle('get-settings', async () => readJson(settingsPath(), null));
ipcMain.handle('save-settings', async (_e, settings) => writeJson(settingsPath(), settings));

ipcMain.handle('get-presets', async () => loadPresets());
ipcMain.handle('save-presets', async (_e, presets) => writeJson(presetsPath(), presets));

ipcMain.handle('export-presets', async (_e, presets) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export presets',
    defaultPath: 'image-compressor-presets.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled) return false;
  return writeJson(res.filePath, presets);
});

ipcMain.handle('import-presets', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import presets',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled) return null;
  const data = readJson(res.filePaths[0], null);
  return Array.isArray(data) ? data : null;
});

ipcMain.handle('open-path', async (_e, p) => {
  shell.showItemInFolder(p);
});

ipcMain.handle('cancel-processing', async () => {
  cancelRequested = true;
  return true;
});

ipcMain.handle('process', async (event, { files, settings, outputDir }) => {
  cancelRequested = false;
  const total = files.length;
  let done = 0;

  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
  };

  const tasks = files.map((inputPath, index) => {
    const outputPath = resolveOutputPath(inputPath, settings, outputDir, index, total);
    return pool
      .run({ inputPath, outputPath, settings })
      .then((msg) => {
        done++;
        send('progress', {
          done,
          total,
          file: path.basename(inputPath),
          result: msg.ok
            ? { ...msg.data, ok: true }
            : { ...msg.data, ok: false, status: 'failed' },
        });
      });
  });

  await Promise.all(tasks);
  send('complete', { total, done, canceled: cancelRequested });
  return { total, done };
});
