'use strict';

/**
 * worker.js — runs inside a Node worker_thread.
 *
 * Receives a job ({ inputPath, outputPath, settings }), processes the image
 * with the compressor engine, writes the output file, and posts back metrics.
 * Running in a worker keeps the heavy libvips work off the main/UI thread.
 */

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { processImage } = require('./compressor');

parentPort.on('message', async (job) => {
  const { id, inputPath, outputPath, settings } = job;
  try {
    const inputBuffer = fs.readFileSync(inputPath);
    const result = await processImage(inputBuffer, settings);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.outputBuffer);

    parentPort.postMessage({
      id,
      ok: true,
      data: {
        inputPath,
        outputPath,
        originalSize: result.originalSize,
        outputSize: result.outputSize,
        quality: result.quality,
        status: result.status,
        reason: result.reason,
        iterations: result.iterations,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
      },
    });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      data: { inputPath, outputPath, error: err.message },
    });
  }
});
