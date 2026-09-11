import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// На Render примонтирован постоянный диск в /var/data — если он есть, пишем туда,
// иначе (локальная разработка) используем обычную папку data/ рядом с проектом.
export const dataDir = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
const defaultData = { leads: [], clients: [], clientLeads: [], trialUsage: [], videoJobs: [] };

export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= defaultData;
  db.data.leads ||= [];
  db.data.clients ||= [];
  db.data.clientLeads ||= [];
  db.data.trialUsage ||= [];
  db.data.videoJobs ||= [];
  // Owner-requested personal cabinet account. No admin privileges or expiry.
  // Seed only if absent; never reactivate, rotate or reset an existing account.
  if (!db.data.clients.some(client => client.id === 'darzhan-personal')) {
    db.data.clients.push({
      id: 'darzhan-personal',
      name: 'Даржан — личный кабинет ZUMRA',
      tariff: 'PRO',
      codeHash: '8485cd3165e8eeabb9e2ef12c6242a1c10e33112e54194dcc914b8c65c5dc6c0',
      active: true,
      usageDate: null,
      usageUnits: 0,
      createdAt: new Date().toISOString(),
    });
  }
  await db.write();
}

export function findClientByCode(code) {
  if (typeof code !== 'string' || !code || code.length > 256) return undefined;
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  return db.data.clients.find(client => client.active !== false && (
    client.code === code || client.codeHash === hash
  ));
}
