import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// На Render примонтирован постоянный диск в /var/data — если он есть, пишем туда,
// иначе (локальная разработка) используем обычную папку data/ рядом с проектом.
const dataDir = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'db.json');
const adapter = new JSONFile(file);
const defaultData = { leads: [], clients: [], clientLeads: [] };

export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= defaultData;
  db.data.leads ||= [];
  db.data.clients ||= [];
  db.data.clientLeads ||= [];
  await db.write();
}
