import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, dataDir } from './db.js';

export const UPLOAD_ROOT = path.join(dataDir, 'video-uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

export function newJobId() {
  return crypto.randomBytes(6).toString('hex');
}

export function jobDir(jobId) {
  return path.join(UPLOAD_ROOT, jobId);
}

export function createJob(id, clientId, brief, files) {
  const now = new Date();
  const job = {
    id,
    clientId,
    status: 'queued', // queued | processing | completed | failed
    brief,
    files: files.map((f) => ({ filename: f.filename, originalName: f.originalname, size: f.size })),
    plans: null,
    videos: null,
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
  db.data.videoJobs.push(job);
  return job;
}

export function getJob(id, clientId) {
  return db.data.videoJobs.find((j) => j.id === id && j.clientId === clientId);
}

export function listJobs(clientId) {
  return db.data.videoJobs
    .filter((j) => j.clientId === clientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function removeJobFiles(jobId) {
  const dir = jobDir(jobId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Простая очередь с конкурентностью 1 — для закрытой беты этого достаточно
// и не даёт нескольким тяжёлым заданиям конкурировать за 0.5 CPU одновременно.
const queue = [];
let processing = false;

export function enqueue(jobId, handler) {
  queue.push({ jobId, handler });
  runQueue();
}

async function runQueue() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const { jobId, handler } = queue.shift();
    try {
      await handler(jobId);
    } catch (err) {
      console.error('[video-queue] задание упало неожиданно:', jobId, err);
    }
  }
  processing = false;
}
