# Image Compressor

A lightweight, professional **Windows desktop** utility for batch resizing, converting, and compressing images to a **precise target file size**. Built for content operations teams processing album artwork, marketing assets, and distribution/telecom images at volume.

No technical knowledge required: drag in files or folders, pick a preset, click **Process**.

---

## Features

- **Drag & drop** single files, multiple files, folders, and nested folders
- **Inputs:** JPG, JPEG, PNG, WEBP, BMP, TIFF
- **Outputs:** JPG, PNG, WEBP
- **Resize** — Exact Dimensions / Fit Within / Maintain Aspect Ratio
- **Two file-size modes:**
  - **Maximum Size** — output never exceeds the limit
  - **Exact Size** (primary feature) — converges on the target within a chosen tolerance using a **binary search over encoder quality**
- **Precision settings:** ±1 / ±5 / ±10 / ±25 KB
- **Per-image quality adaptation** — prioritizes consistent output *size*, not a fixed quality
- **Force Under Target** — guarantees results stay below the limit (for strict telecom/distributor rules)
- **Multi-threaded** worker pool — fast on 1, 100, or 1,000+ images, UI stays responsive
- **Presets** — save / load / import / export (ships with Flow Album Artwork, Telecom Artwork, Web Upload, Social Media)
- **Output options** — Same Folder / New Folder / Ask Every Time
- **Naming** — keep original or add suffix (supports `{size}` token, e.g. `cover_500kb.jpg`)
- **Results screen** — original/output size, % saved, dimensions, status, and failure reasons
- **Settings persistence** across sessions

---

## How the Exact-Size algorithm works

For each image:

1. Auto-orient (EXIF) and **resize** once into a lossless intermediate buffer.
2. **Binary search** encoder quality between *Min Quality* and *Max Quality*:
   - Encode at the midpoint quality, measure the actual byte size.
   - If too big → search lower half; if room to grow → search upper half.
   - Track the best candidate **under** target and the **closest** candidate overall.
3. Stop when within tolerance, max iterations reached, or quality bounds exhausted.
4. Pick the result per mode:
   - **Exact:** closest to target (or closest *under* target if *Force Under* is on).
   - **Maximum / Force Under:** largest result that is still ≤ target.
5. Always write the **best achievable** output, even on failure, and report the reason
   (e.g. `Target Unreachable At Minimum Quality`).

This converges in ~6–8 encode passes per image instead of scanning quality linearly, and lets every image use a *different* quality to land on a *consistent size*.

> PNG is lossless; to make it respond to a size target the engine uses palette quantization (`quality` controls the palette), so PNG can also be size-targeted.

---

## Tech stack

- **Electron** — desktop shell + modern UI (Linear/Raycast-style dark theme)
- **sharp** (libvips) — extremely fast, multi-threaded image encoding
- **worker_threads** pool — parallel batch processing off the UI thread
- **electron-builder** — NSIS installer + portable EXE

---

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **Windows 10 / 11** to produce and run Windows builds
  - You can develop on macOS/Linux, but build the Windows installer **on Windows** (sharp ships native binaries; `electron-builder install-app-deps` fetches the correct ones per platform).

---

## Run from source

```bash
cd image-compressor
npm install          # also runs electron-builder install-app-deps (native sharp)
npm start            # launch the app
npm run dev          # launch with DevTools
```

If sharp fails to load under Electron, rebuild its native binding:

```bash
npm run rebuild
```

---

## Build Windows deliverables

Run on **Windows**:

```bash
npm install
npm run dist            # builds BOTH installer (NSIS) and portable EXE (x64)
# or individually:
npm run dist:installer  # Image Compressor-Setup-1.0.0.exe
npm run dist:portable   # Image Compressor-Portable-1.0.0.exe
```

Output appears in `dist/`:

- `Image Compressor-Setup-1.0.0.exe` — **installer** (desktop + start-menu shortcuts, choose install dir)
- `Image Compressor-Portable-1.0.0.exe` — **portable** single-file, no install required

### App icon

Place a `build/icon.ico` (256×256 multi-resolution) before building for a branded icon.
Without it, electron-builder uses the default Electron icon (build still succeeds).

---

## Settings & presets storage

Stored as JSON in the per-user app data folder:

```
%APPDATA%\Image Compressor\settings.json
%APPDATA%\Image Compressor\presets.json
```

Presets can also be exported/imported as standalone `.json` files from the sidebar.

---

## Project structure

```
image-compressor/
├─ package.json              # deps + electron-builder config
├─ build/                    # build resources (icon.ico)
└─ src/
   ├─ main/
   │  ├─ main.js             # app lifecycle, IPC, dialogs, folder walk, persistence
   │  ├─ preload.js          # secure contextBridge API
   │  ├─ compressor.js       # resize + convert + exact-size binary search engine
   │  ├─ worker.js           # per-file processing inside a worker thread
   │  └─ pool.js             # fixed-size worker_threads pool
   └─ renderer/
      ├─ index.html          # UI layout
      ├─ styles.css          # dark, modern theme
      └─ renderer.js         # UI logic, drag&drop, presets, results
```

---

## License

MIT
