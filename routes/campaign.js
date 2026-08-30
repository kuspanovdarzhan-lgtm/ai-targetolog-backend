import { Router } from 'express';
import { db, initDb } from '../lib/db.js';
import { requireClient } from '../lib/auth.js';
import { notifyTelegram } from '../lib/telegram.js';

const router = Router();
await initDb();

// Клиент подтверждает материалы и передаёт кампанию специалисту на ручной запуск.
// Это НЕ запускает рекламу в Meta — просто фиксирует статус и уведомляет специалиста.
router.post('/confirm', requireClient, async (req, res) => {
  const { niche, audience, budget, offer, notes } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  const client = db.data.clients.find((c) => c.id === req.client.id);
  client.campaignStatus = 'submitted';
  client.campaignBrief = { niche, audience: audience || '', budget: budget || '', offer: offer || '', notes: notes || '' };
  client.campaignUpdatedAt = new Date().toISOString();
  await db.write();

  await notifyTelegram(
    `📋 <b>Кампания передана на запуск</b>\nКлиент: ${client.name} (тариф ${client.tariff})\nНиша: ${niche}\nАудитория: ${audience || '—'}\nБюджет: ${budget || '—'}\nОффер: ${offer || '—'}\nДоп: ${notes || '—'}`
  );

  res.json({ ok: true, status: client.campaignStatus, updatedAt: client.campaignUpdatedAt });
});

router.get('/status', requireClient, async (req, res) => {
  await db.read();
  const client = db.data.clients.find((c) => c.id === req.client.id);
  res.json({
    status: client.campaignStatus || null,
    brief: client.campaignBrief || null,
    updatedAt: client.campaignUpdatedAt || null,
  });
});

export default router;
