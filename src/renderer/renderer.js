'use strict';

const $ = (id) => document.getElementById(id);

// Application state
let files = [];            // collected absolute input paths
let presets = [];
let processing = false;

// ---------------------------------------------------------------------------
// Settings <-> UI
// ---------------------------------------------------------------------------

function readUI() {
  const sizeModeBtn = document.querySelector('#sizeMode .seg-btn.active');
  const unit = parseInt($('sizeUnit').value, 10); // 1 = KB, 1024 = MB
  return {
    outputFormat: $('outputFormat').value,
    resize: {
      enabled: $('resizeEnabled').checked,
      width: parseInt($('resizeWidth').value, 10) || 0,
      height: parseInt($('resizeHeight').value, 10) || 0,
      mode: $('resizeMode').value,
    },
    size: {
      enabled: $('sizeEnabled').checked,
      mode: sizeModeBtn ? sizeModeBtn.dataset.mode : 'exact',
      value: (parseFloat($('sizeValue').value) || 0) * unit, // stored in KB
      toleranceKB: parseInt($('tolerance').value, 10),
      forceUnder: $('forceUnder').checked,
    },
    quality: {
      min: parseInt($('qualityMin').value, 10),
      max: parseInt($('qualityMax').value, 10),
    },
    output: { mode: document.querySelector('input[name="outmode"]:checked').value },
    naming: {
      mode: document.querySelector('input[name="naming"]:checked').value,
      suffix: $('namingSuffix').value || '_compressed',
    },
  };
}

function applyUI(s) {
  if (!s) return;
  if (s.outputFormat) $('outputFormat').value = s.outputFormat;
  if (s.resize) {
    $('resizeEnabled').checked = !!s.resize.enabled;
    if (s.resize.width) $('resizeWidth').value = s.resize.width;
    if (s.resize.height) $('resizeHeight').value = s.resize.height;
    if (s.resize.mode) $('resizeMode').value = s.resize.mode;
  }
  if (s.size) {
    $('sizeEnabled').checked = s.size.enabled !== false;
    setSizeMode(s.size.mode || 'exact');
    // Stored value is in KB. Show MB if it's a clean >=1024 multiple.
    let val = s.size.value || 500;
    if (val >= 1024 && val % 1024 === 0) {
      $('sizeUnit').value = '1024';
      $('sizeValue').value = val / 1024;
    } else {
      $('sizeUnit').value = '1';
      $('sizeValue').value = val;
    }
    if (s.size.toleranceKB) $('tolerance').value = String(s.size.toleranceKB);
    $('forceUnder').checked = !!s.size.forceUnder;
  }
  if (s.quality) {
    if (s.quality.min) $('qualityMin').value = s.quality.min;
    if (s.quality.max) $('qualityMax').value = s.quality.max;
  }
  if (s.output && s.output.mode) {
    const r = document.querySelector(`input[name="outmode"][value="${s.output.mode}"]`);
    if (r) r.checked = true;
  }
  if (s.naming) {
    const r = document.querySelector(`input[name="naming"][value="${s.naming.mode}"]`);
    if (r) r.checked = true;
    if (s.naming.suffix) $('namingSuffix').value = s.naming.suffix;
  }
  syncEnabledStates();
}

function setSizeMode(mode) {
  document.querySelectorAll('#sizeMode .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // Tolerance only matters in exact mode.
  $('toleranceField').style.opacity = mode === 'exact' ? '1' : '.45';
}

function syncEnabledStates() {
  $('resizeFields').style.opacity = $('resizeEnabled').checked ? '1' : '.45';
  $('resizeFields').style.pointerEvents = $('resizeEnabled').checked ? 'auto' : 'none';
  $('sizeFields').style.opacity = $('sizeEnabled').checked ? '1' : '.45';
  $('sizeFields').style.pointerEvents = $('sizeEnabled').checked ? 'auto' : 'none';
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

async function loadPresets() {
  presets = await window.api.getPresets();
  renderPresetOptions();
}

function renderPresetOptions(selectName) {
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">— Custom —</option>';
  presets.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (selectName) {
    const idx = presets.findIndex((p) => p.name === selectName);
    if (idx >= 0) sel.value = String(idx);
  }
}

$('presetSelect').addEventListener('change', (e) => {
  const idx = e.target.value;
  if (idx === '') return;
  applyUI(presets[Number(idx)].settings);
  persist();
});

$('savePresetBtn').addEventListener('click', async () => {
  const name = prompt('Preset name:');
  if (!name) return;
  const settings = readUI();
  const existing = presets.findIndex((p) => p.name === name);
  if (existing >= 0) presets[existing] = { name, settings };
  else presets.push({ name, settings });
  await window.api.savePresets(presets);
  renderPresetOptions(name);
});

$('deletePresetBtn').addEventListener('click', async () => {
  const idx = $('presetSelect').value;
  if (idx === '') return;
  if (!confirm(`Delete preset "${presets[Number(idx)].name}"?`)) return;
  presets.splice(Number(idx), 1);
  await window.api.savePresets(presets);
  renderPresetOptions();
});

$('exportPresetBtn').addEventListener('click', () => window.api.exportPresets(presets));

$('importPresetBtn').addEventListener('click', async () => {
  const imported = await window.api.importPresets();
  if (!imported) return;
  // Merge by name (imported wins).
  const byName = new Map(presets.map((p) => [p.name, p]));
  imported.forEach((p) => byName.set(p.name, p));
  presets = Array.from(byName.values());
  await window.api.savePresets(presets);
  renderPresetOptions();
});

// ---------------------------------------------------------------------------
// File collection (drag & drop + buttons)
// ---------------------------------------------------------------------------

const dz = $('dropzone');

['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); })
);

dz.addEventListener('drop', async (e) => {
  const paths = [];
  for (const f of e.dataTransfer.files) {
    const p = window.api.getPathForFile(f);
    if (p) paths.push(p);
  }
  if (paths.length) await addPaths(paths);
});

$('addFilesBtn').addEventListener('click', async () => {
  const collected = await window.api.pickFiles();
  mergeFiles(collected);
});
$('addFolderBtn').addEventListener('click', async () => {
  const collected = await window.api.pickFolder();
  mergeFiles(collected);
});

async function addPaths(paths) {
  // Expand folders/nested folders on the main process.
  const collected = await window.api.collectImages(paths);
  mergeFiles(collected);
}

function mergeFiles(collected) {
  const set = new Set(files);
  collected.forEach((f) => set.add(f));
  files = Array.from(set);
  updateFileCount();
}

function updateFileCount() {
  const n = files.length;
  $('fileCount').textContent = n ? `${n} image${n === 1 ? '' : 's'} ready` : '';
  $('processBtn').disabled = n === 0 || processing;
  $('statusText').textContent = n ? `${n} image${n === 1 ? '' : 's'} queued` : 'Ready';
  dz.classList.toggle('has-files', n > 0);
}

$('clearBtn').addEventListener('click', () => {
  files = [];
  updateFileCount();
  $('resultsSection').hidden = true;
  $('resultsBody').innerHTML = '';
});

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

let stats = { success: 0, warning: 0, failed: 0, origTotal: 0, outTotal: 0 };

$('processBtn').addEventListener('click', startProcessing);
$('cancelBtn').addEventListener('click', () => window.api.cancel());

async function startProcessing() {
  if (!files.length || processing) return;
  const settings = readUI();

  let outputDir = null;
  if (settings.output.mode === 'ask' || settings.output.mode === 'new') {
    outputDir = await window.api.pickOutputFolder();
    if (settings.output.mode === 'ask' && !outputDir) return; // cancelled
  }

  processing = true;
  stats = { success: 0, warning: 0, failed: 0, origTotal: 0, outTotal: 0 };
  $('processBtn').disabled = true;
  $('cancelBtn').hidden = false;
  $('clearBtn').disabled = true;
  $('resultsBody').innerHTML = '';
  $('resultsSection').hidden = false;
  $('progressBar').hidden = false;
  setProgress(0, files.length);

  await window.api.process({ files, settings, outputDir });
}

window.api.onProgress((d) => {
  setProgress(d.done, d.total);
  addResultRow(d.result);
  updateSummary();
});

window.api.onComplete((d) => {
  processing = false;
  $('cancelBtn').hidden = true;
  $('clearBtn').disabled = false;
  $('processBtn').disabled = files.length === 0;
  $('statusText').textContent =
    `Done — ${stats.success} ok, ${stats.warning} warnings, ${stats.failed} failed`;
  $('progressLabel').textContent = `Completed ${d.done} / ${d.total}`;
});

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progressFill').style.width = pct + '%';
  $('progressLabel').textContent = `Processing ${done} / ${total}  (${pct}%)`;
}

function addResultRow(r) {
  const tr = document.createElement('tr');
  const status = r.ok ? r.status : 'failed';
  if (status === 'success') stats.success++;
  else if (status === 'warning') stats.warning++;
  else stats.failed++;

  if (r.ok) {
    stats.origTotal += r.originalSize || 0;
    stats.outTotal += r.outputSize || 0;
  }

  const saved =
    r.ok && r.originalSize
      ? Math.max(0, Math.round((1 - r.outputSize / r.originalSize) * 1000) / 10)
      : 0;

  const fileName = basename(r.outputPath || r.inputPath || '');
  const statusLabel = r.ok ? prettyReason(r) : (r.error || 'Failed');

  tr.innerHTML = `
    <td class="file" title="${escapeHtml(r.outputPath || r.inputPath || '')}">${escapeHtml(fileName)}</td>
    <td>${r.ok ? fmtSize(r.originalSize) : '—'}</td>
    <td>${r.ok ? fmtSize(r.outputSize) : '—'}</td>
    <td class="saved">${r.ok ? saved + '%' : '—'}</td>
    <td>${r.ok ? `${r.originalWidth}×${r.originalHeight} → ${r.outputWidth}×${r.outputHeight}` : '—'}</td>
    <td><span class="badge ${status}">${escapeHtml(statusLabel)}</span></td>
  `;
  const fileCell = tr.querySelector('.file');
  if (r.outputPath) fileCell.addEventListener('click', () => window.api.openPath(r.outputPath));
  $('resultsBody').appendChild(tr);
}

function prettyReason(r) {
  if (r.status === 'success') return 'Success';
  if (r.status === 'warning') return r.reason || 'Best effort';
  return r.reason || 'Failed';
}

function updateSummary() {
  const total = stats.success + stats.warning + stats.failed;
  const savedPct =
    stats.origTotal > 0
      ? Math.round((1 - stats.outTotal / stats.origTotal) * 1000) / 10
      : 0;
  $('summary').innerHTML =
    `<b>${total}</b> processed · <b>${stats.success}</b> success · ` +
    `<b>${stats.warning}</b> warnings · <b>${stats.failed}</b> failed · ` +
    `total saved <b>${savedPct}%</b> (${fmtSize(stats.origTotal)} → ${fmtSize(stats.outTotal)})`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}
function basename(p) { return p.split(/[\\/]/).pop(); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Wiring: persist settings, segmented control, enable toggles
// ---------------------------------------------------------------------------

document.querySelectorAll('#sizeMode .seg-btn').forEach((b) =>
  b.addEventListener('click', () => { setSizeMode(b.dataset.mode); persist(); })
);
$('resizeEnabled').addEventListener('change', () => { syncEnabledStates(); persist(); });
$('sizeEnabled').addEventListener('change', () => { syncEnabledStates(); persist(); });

// Persist on any input change (debounced) and mark preset as custom.
let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => window.api.saveSettings(readUI()), 250);
}
document.querySelectorAll('input, select').forEach((el) => {
  if (el.id === 'presetSelect') return;
  el.addEventListener('change', persist);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async function init() {
  await loadPresets();
  const saved = await window.api.getSettings();
  if (saved) applyUI(saved);
  else applyUI(presets[0] && presets[0].settings);
  syncEnabledStates();
  updateFileCount();
})();
