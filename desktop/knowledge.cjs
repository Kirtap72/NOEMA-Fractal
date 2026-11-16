'use strict';
/**
 * Disk side of the experiment memory (FORMULA-EXPLORATION-01): <profile>/ai-bridge/knowledge/experiments.jsonl, one compact JSON record
 * per line. The records hold a formula chain, an idea, an observation and a verdict, never pictures, conversations or paths.
 * The newest MAX_RECORDS are kept. Every write is atomic (the same routine the draft files use). Local only: nothing here is sent anywhere.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./storage.cjs');

const MAX_RECORDS = 1500;
const MAX_LINE_BYTES = 4096;

function createExperimentStore({ dir, write = atomicWrite }) {
  const file = path.join(dir, 'experiments.jsonl');
  let queue = Promise.resolve();

  async function read() {
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const lines = [];
    for (const line of text.split('\n')) { if (!line.trim()) continue; try { JSON.parse(line); lines.push(line); } catch { /* a damaged line is skipped, never trusted */ } }
    return lines;
  }

  /** The stored records as JSON texts (the window parses and validates them again). */
  const list = () => read();

  /** Appends one record. Serialised so two quick calls cannot overwrite each other. */
  function append(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_LINE_BYTES || text.includes('\n')) return Promise.reject(Error('Invalid experiment entry.'));
    JSON.parse(text);
    const job = queue.then(async () => {
      const lines = await read();
      lines.push(text);
      await fs.mkdir(dir, { recursive: true });
      await write(file, lines.slice(-MAX_RECORDS).join('\n') + '\n');
      return true;
    });
    queue = job.catch(() => {});
    return job;
  }

  return { list, append };
}

module.exports = { createExperimentStore, MAX_RECORDS };
