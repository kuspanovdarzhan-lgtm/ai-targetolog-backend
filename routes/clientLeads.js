import { Router } from 'express';
import { db, initDb } from '../lib/db.js';
import { requireClient } from '../lib/auth.js';

const router = Router();
await initDb();

// Клиент вручную заносит свои заявки (пока нет автоматического трекинга рекламы)
router.post('/', requireClient, async (req, res) => {
  const { name, phone, source, note } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name обязателен' });

  const lead = {
    id: Date.now().toString(36),
    clientId: req.client.id,
    name,
    phone: phone || '',
    source: source || '',
    note: note || '',
    createdAt: new Date().toISOString(),
  };
  db.data.clientLeads.push(lead);
  await db.write();
  res.status(201).json({ ok: true, lead });
});

router.get('/', requireClient, async (req, res) => {
  await db.read();
  const leads = db.data.clientLeads
    .filter((l) => l.clientId === req.client.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ leads });
});

router.delete('/:id', requireClient, async (req, res) => {
  await db.read();
  const lead = db.data.clientLeads.find((l) => l.id === req.params.id && l.clientId === req.client.id);
  if (!lead) return res.status(404).json({ error: 'заявка не найдена' });
  db.data.clientLeads = db.data.clientLeads.filter((l) => l.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});

export default router;
