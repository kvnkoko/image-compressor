'use strict';

/**
 * pool.js — a small fixed-size worker_threads pool.
 *
 * Spreads image jobs across N workers (default = CPU count, capped) so a batch
 * of hundreds/thousands of files processes in parallel while the UI stays
 * responsive. Each worker handles one job at a time; jobs queue until a worker
 * is free.
 */

const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

class WorkerPool {
  constructor(size) {
    const cpus = os.cpus().length || 4;
    this.size = size || Math.max(2, Math.min(cpus, 8));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs = new Map(); // id -> { resolve, reject }
    this._seq = 0;

    for (let i = 0; i < this.size; i++) {
      this._spawn();
    }
  }

  _spawn() {
    const worker = new Worker(path.join(__dirname, 'worker.js'));
    worker.on('message', (msg) => {
      const pending = this.jobs.get(msg.id);
      if (pending) {
        this.jobs.delete(msg.id);
        pending.resolve(msg);
      }
      this.idle.push(worker);
      this._drain();
    });
    worker.on('error', (err) => {
      // A worker crashed — fail any job it owned and replace it.
      for (const [id, pending] of this.jobs) {
        if (pending.worker === worker) {
          this.jobs.delete(id);
          pending.resolve({ id, ok: false, data: { error: err.message } });
        }
      }
      this.workers = this.workers.filter((w) => w !== worker);
      this.idle = this.idle.filter((w) => w !== worker);
      this._spawn();
    });
    this.workers.push(worker);
    this.idle.push(worker);
  }

  _drain() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.shift();
      const task = this.queue.shift();
      const pending = this.jobs.get(task.id);
      if (pending) pending.worker = worker;
      worker.postMessage(task);
    }
  }

  run(job) {
    const id = ++this._seq;
    const task = { ...job, id };
    return new Promise((resolve) => {
      this.jobs.set(id, { resolve });
      this.queue.push(task);
      this._drain();
    });
  }

  async destroy() {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs.clear();
  }
}

module.exports = { WorkerPool };
