import { Router } from 'express';
import { db, initDb } from '../lib/db.js';
import { requireClient } from '../lib/auth.js';
import { notifyTelegram, notifyTelegramPhoto } from '../lib/telegram.js';

const router = Router();
await initDb();

function readiness(client) {
  const m = client.materials || {};
  return {
    strategy: Boolean(m.strategy?.text),
    copy: Boolean(m.copy?.text),
    creative: Boolean(m.creative?.b64),
  };
}

// Клиент подтверждает материалы и передаёт кампанию специалисту на ручной запуск.
// Это НЕ запускает рекламу в Meta — просто фиксирует статус и уведомляет специалиста
// со ВСЕМ комплектом (бриф + стратегия + тексты + креатив), а не только брифом.
router.post('/confirm', requireClient, async (req, res) => {
  const client = req.client;
  const ready = readiness(client);
  if (!ready.strategy || !ready.copy || !ready.creative) {
    return res.status(400).json({
      error: 'Нельзя передать на запуск, пока не готовы стратегия, тексты и креатив',
      ready,
    });
  }

  const { niche, audience, city, budget, offer, notes } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  client.campaignStatus = 'submitted';
  client.campaignBrief = { niche, audience: audience || '', city: city || '', budget: budget || '', offer: offer || '', notes: notes || '' };
  client.campaignUpdatedAt = new Date().toISOString();
  await db.write();

  const m = client.materials;
  const summary =
    `📋 <b>Кампания передана на запуск</b>\n` +
    `Клиент: ${client.name} (тариф ${client.tariff})\n` +
    `Ниша: ${niche}\nГород: ${city || '—'}\nАудитория: ${audience || '—'}\nБюджет: ${budget || '—'}\nОффер: ${offer || '—'}\nДоп: ${notes || '—'}\n\n` +
    `<b>Стратегия:</b>\n${m.strategy.text.slice(0, 900)}\n\n` +
    `<b>Тексты объявлений:</b>\n${m.copy.text.slice(0, 900)}`;

  await notifyTelegramPhoto(`Креатив для кампании: ${client.name} — ${niche}`, m.creative.b64);
  await notifyTelegram(summary);

  res.json({ ok: true, status: client.campaignStatus, updatedAt: client.campaignUpdatedAt });
});

router.get('/status', requireClient, async (req, res) => {
  const client = req.client;
  res.json({
    status: client.campaignStatus || null,
    brief: client.campaignBrief || null,
    updatedAt: client.campaignUpdatedAt || null,
    ready: readiness(client),
    materials: {
      strategy: client.materials?.strategy || null,
      copy: client.materials?.copy || null,
      contentPlan: client.materials?.contentPlan || null,
      creative: client.materials?.creative || null,
    },
  });
});

export default router;
