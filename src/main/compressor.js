'use strict';

/**
 * compressor.js
 *
 * Core image processing engine.
 *
 * Responsibilities:
 *   - Resize (Maintain aspect / Fit-no-upscale / Crop to fill / Stretch),
 *     with upscaling supported so images can be enlarged past their original
 *   - Format conversion (JPG / PNG / WEBP)
 *   - Hit a precise output file size using a binary search over encoder quality
 *
 * The "exact file size" feature is the heart of the app. For lossy formats
 * (JPEG / WEBP, and palette PNG) the relationship between quality and encoded
 * size is monotonic-ish: higher quality -> larger file. We exploit that with a
 * binary search across the [minQuality, maxQuality] range to converge on the
 * target in a small number of encode passes (typically 6-8) rather than trying
 * every quality level linearly.
 */

const sharp = require('sharp');

const KB = 1024;

// Tune libvips concurrency per sharp call. We parallelise across FILES at the
// pool level, so keep per-image threads modest to avoid oversubscription.
sharp.concurrency(1);
sharp.cache(false);

/**
 * Apply resize transform to a sharp pipeline based on settings.
 */
function applyResize(pipeline, meta, settings) {
  if (!settings.resize || !settings.resize.enabled) return pipeline;

  const width = parseInt(settings.resize.width, 10) || null;
  const height = parseInt(settings.resize.height, 10) || null;
  if (!width && !height) return pipeline;

  const mode = settings.resize.mode || 'aspect';

  switch (mode) {
    case 'exact':
      // Stretch to exact dimensions (may distort). Enlarges if the source is
      // smaller than the target. Use this to force any aspect ratio.
      return pipeline.resize({ width, height, fit: 'fill' });

    case 'cover':
      // Crop to fill the exact dimensions, centered. No distortion: the image
      // is scaled to cover the box and the overflowing edges are trimmed.
      // Enlarges if needed. This is how a square becomes a non-square aspect
      // ratio (e.g. 4000x4000 -> 1920x1080) without squishing.
      return pipeline.resize({
        width,
        height,
        fit: 'cover',
        position: 'centre',
      });

    case 'fit':
      // Fit within the box, preserving aspect ratio, NEVER upscaling. The
      // "safe" option for staff who only want to shrink, never grow.
      return pipeline.resize({
        width,
        height,
        fit: 'inside',
        withoutEnlargement: true,
      });

    case 'aspect':
    default:
      // Maintain aspect ratio, scaling up OR down so the image fills the box
      // as closely as possible. Enlarges when the source is smaller than the
      // target. 4000x4000 -> 3000x3000, 6000x4000 -> 3000x2000, and a small
      // 1000x1000 -> 3000x3000 (now upscales).
      return pipeline.resize({
        width,
        height,
        fit: 'inside',
        withoutEnlargement: false,
      });
  }
}

/**
 * Encode a prepared (already-resized) sharp pipeline at a given quality and
 * return a Buffer. The pipeline is cloned per attempt so the source decode is
 * reused but encoding is fresh.
 */
async function encodeAt(baseBuffer, format, quality) {
  const pipeline = sharp(baseBuffer);

  switch (format) {
    case 'jpg':
    case 'jpeg':
      return pipeline
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
        .toBuffer();

    case 'webp':
      return pipeline.webp({ quality, effort: 4 }).toBuffer();

    case 'png':
      // PNG is lossless by default. To make size respond to "quality" we use
      // palette quantization (quality controls palette/dithering). This lets
      // the binary search work on PNG too.
      return pipeline
        .png({
          quality,
          palette: true,
          compressionLevel: 9,
          effort: 7,
        })
        .toBuffer();

    default:
      throw new Error(`Unsupported output format: ${format}`);
  }
}

/**
 * Binary-search encoder quality to reach a target/maximum file size.
 *
 * @param {Buffer} baseBuffer  Resized RGBA/decoded source buffer.
 * @param {object} opts
 *   format        'jpg' | 'png' | 'webp'
 *   sizeMode      'max' | 'exact'
 *   targetBytes   desired size in bytes
 *   toleranceBytes (exact mode) acceptable ± window
 *   minQuality / maxQuality   search bounds (1..100)
 *   maxIterations
 *   forceUnder    boolean — result must be <= target
 *
 * @returns {{buffer, quality, size, status, reason}}
 */
async function searchQuality(baseBuffer, opts) {
  const {
    format,
    sizeMode,
    targetBytes,
    toleranceBytes,
    minQuality,
    maxQuality,
    maxIterations,
    forceUnder,
  } = opts;

  let lo = minQuality;
  let hi = maxQuality;

  // Best candidate that satisfies the "<= target" constraint (for max mode and
  // forceUnder), and the overall closest candidate (for exact mode).
  let bestUnder = null; // { buffer, quality, size }
  let bestClosest = null; // { buffer, quality, size, diff }

  let iterations = 0;

  const consider = (buffer, quality) => {
    const size = buffer.length;
    if (size <= targetBytes) {
      if (!bestUnder || size > bestUnder.size) {
        bestUnder = { buffer, quality, size };
      }
    }
    const diff = Math.abs(size - targetBytes);
    if (!bestClosest || diff < bestClosest.diff) {
      bestClosest = { buffer, quality, size, diff };
    }
    return size;
  };

  // Binary search.
  while (lo <= hi && iterations < maxIterations) {
    iterations++;
    const q = Math.round((lo + hi) / 2);
    const buf = await encodeAt(baseBuffer, format, q);
    const size = consider(buf, q);

    if (sizeMode === 'exact') {
      if (Math.abs(size - targetBytes) <= toleranceBytes) {
        // Within tolerance. If forceUnder, only accept when <= target.
        if (!forceUnder || size <= targetBytes) {
          return {
            buffer: buf,
            quality: q,
            size,
            status: 'success',
            reason: 'Within tolerance',
            iterations,
          };
        }
      }
    }

    // Decide search direction.
    if (size > targetBytes) {
      hi = q - 1; // too big -> lower quality
    } else {
      lo = q + 1; // room to grow -> higher quality
    }
  }

  // Search exhausted. Choose the best result according to mode/constraints.
  if (sizeMode === 'max' || forceUnder) {
    if (bestUnder) {
      const within =
        sizeMode === 'exact'
          ? Math.abs(bestUnder.size - targetBytes) <= toleranceBytes
          : true;
      return {
        buffer: bestUnder.buffer,
        quality: bestUnder.quality,
        size: bestUnder.size,
        status: within ? 'success' : 'warning',
        reason: within
          ? 'Under target'
          : 'Best result under target (tolerance not met)',
        iterations,
      };
    }
    // Could not get under target even at minimum quality.
    return {
      buffer: bestClosest.buffer,
      quality: bestClosest.quality,
      size: bestClosest.size,
      status: 'failed',
      reason: 'Target Unreachable At Minimum Quality',
      iterations,
    };
  }

  // Exact mode without forceUnder: return the closest we found.
  const within = bestClosest.diff <= toleranceBytes;
  let reason;
  if (within) {
    reason = 'Within tolerance';
  } else if (bestClosest.size > targetBytes && bestClosest.quality <= minQuality) {
    // Even at the lowest allowed quality the file is still larger than target.
    reason = 'Target Unreachable At Minimum Quality';
  } else if (bestClosest.size < targetBytes && bestClosest.quality >= maxQuality) {
    // Even at the highest allowed quality the file is smaller than target.
    reason = 'Target Unreachable At Maximum Quality';
  } else {
    // Adjacent quality steps straddle the target — no level lands in tolerance.
    reason = 'Closest achievable size';
  }
  return {
    buffer: bestClosest.buffer,
    quality: bestClosest.quality,
    size: bestClosest.size,
    status: within ? 'success' : 'warning',
    reason,
    iterations,
  };
}

/**
 * Process a single image fully: resize -> convert -> size-target search.
 *
 * @param {Buffer} inputBuffer raw bytes of the source file
 * @param {object} settings    full settings object from the UI
 * @returns {object} result with output buffer + metrics
 */
async function processImage(inputBuffer, settings) {
  const originalSize = inputBuffer.length;
  const srcMeta = await sharp(inputBuffer).metadata();

  // Build a resized, orientation-corrected intermediate buffer once. Encoding
  // attempts re-run only the encoder, not the resize/decode.
  let prep = sharp(inputBuffer, { failOn: 'none' }).rotate(); // auto-orient via EXIF
  prep = applyResize(prep, srcMeta, settings);

  // Materialise to a lossless intermediate (raw) so repeated encodes are cheap
  // and consistent. We use PNG-compressed buffer as the carrier to keep memory
  // reasonable while staying lossless.
  const baseBuffer = await prep.png({ compressionLevel: 0 }).toBuffer();
  const outMeta = await sharp(baseBuffer).metadata();

  const format = (settings.outputFormat || 'jpg').toLowerCase();

  const targetBytes = Math.round((settings.size.value || 0) * KB);
  const toleranceBytes = Math.round((settings.size.toleranceKB ?? 5) * KB);
  const minQuality = clampQuality(settings.quality?.min ?? 60);
  const maxQuality = clampQuality(settings.quality?.max ?? 95);
  const maxIterations = settings.maxIterations ?? 12;

  let result;

  if (!settings.size || !settings.size.enabled || !targetBytes) {
    // No size targeting — just encode at max quality.
    const buf = await encodeAt(baseBuffer, format, maxQuality);
    result = {
      buffer: buf,
      quality: maxQuality,
      size: buf.length,
      status: 'success',
      reason: 'No size target',
      iterations: 1,
    };
  } else {
    result = await searchQuality(baseBuffer, {
      format,
      sizeMode: settings.size.mode || 'max', // 'max' | 'exact'
      targetBytes,
      toleranceBytes,
      minQuality: Math.min(minQuality, maxQuality),
      maxQuality: Math.max(minQuality, maxQuality),
      maxIterations,
      forceUnder: !!settings.size.forceUnder,
    });
  }

  return {
    outputBuffer: result.buffer,
    originalSize,
    outputSize: result.size,
    quality: result.quality,
    status: result.status,
    reason: result.reason,
    iterations: result.iterations,
    originalWidth: srcMeta.width,
    originalHeight: srcMeta.height,
    outputWidth: outMeta.width,
    outputHeight: outMeta.height,
    format,
  };
}

function clampQuality(q) {
  q = parseInt(q, 10);
  if (Number.isNaN(q)) return 80;
  return Math.max(1, Math.min(100, q));
}

module.exports = { processImage };
