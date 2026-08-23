import { Router } from 'express';
import crypto from 'crypto';
import { db, initDb } from '../lib/db.js';
import { requireAdmin, TARIFF_LIMITS } from '../lib/auth.js';

const router = Router();
await initDb();

function genCode() {
  return crypto.randomBytes(4).toString('hex'); // например "a1b2c3d4"
}

// Создать нового клиента и выдать ему код доступа в кабинет.
// Вызывается тобой вручную после того, как клиент оплатил подписку.
router.post('/', requireAdmin, async (req, res) => {
  const { name, tariff = 'START' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  if (!TARIFF_LIMITS[tariff]) {
    return res.status(400).json({ error: `tariff должен быть одним из: ${Object.keys(TARIFF_LIMITS).join(', ')}` });
  }

  const client = {
    id: Date.now().toString(36),
    name,
    tariff,
    code: genCode(),
    active: true,
    usageDate: null,
    usageUnits: 0,
    createdAt: new Date().toISOString(),
  };
  db.data.clients.push(client);
  await db.write();
  res.status(201).json({ ok: true, client });
});

router.get('/', requireAdmin, async (req, res) => {
  await db.read();
  res.json({ clients: db.data.clients });
});

// Включить/выключить доступ клиента или сменить тариф
router.patch('/:id', requireAdmin, async (req, res) => {
  await db.read();
  const client = db.data.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'клиент не найден' });
  const { active, tariff } = req.body || {};
  if (typeof active === 'boolean') client.active = active;
  if (tariff) {
    if (!TARIFF_LIMITS[tariff]) {
      return res.status(400).json({ error: `tariff должен быть одним из: ${Object.keys(TARIFF_LIMITS).join(', ')}` });
    }
    client.tariff = tariff;
  }
  await db.write();
  res.json({ ok: true, client });
});

// Публичный вход клиента по коду доступа — код проверяется, доп. данные не раскрываются
router.post('/login', async (req, res) => {
  const { code } = req.body || {};
  await db.read();
  const client = db.data.clients.find((c) => c.code === code && c.active !== false);
  if (!client) return res.status(401).json({ error: 'неверный или отключённый код доступа' });
  const limit = TARIFF_LIMITS[client.tariff] ?? TARIFF_LIMITS.START;
  const todayKey = new Date().toISOString().slice(0, 10);
  const usedToday = client.usageDate === todayKey ? client.usageUnits : 0;
  res.json({ ok: true, name: client.name, tariff: client.tariff, limit, usedToday });
});

export default router;
