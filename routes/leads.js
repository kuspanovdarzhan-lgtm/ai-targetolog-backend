import { Router } from 'express';
import { db, initDb } from '../lib/db.js';
import { notifyTelegram } from '../lib/telegram.js';

const router = Router();
await initDb();

// Приём заявки с сайта (форма или кнопка вместо WhatsApp-ссылки)
router.post('/', async (req, res) => {
  const { name, phone, niche, message, source } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'name и phone обязательны' });
  }

  const lead = {
    id: Date.now().toString(36),
    name,
    phone,
    niche: niche || '',
    message: message || '',
    source: source || 'site',
    createdAt: new Date().toISOString(),
  };

  db.data.leads.push(lead);
  await db.write();

  await notifyTelegram(
    `🆕 <b>Новая заявка</b>\nИмя: ${name}\nТелефон: ${phone}\nНиша: ${niche || '—'}\nСообщение: ${message || '—'}`
  );

  res.status(201).json({ ok: true, lead });
});

// Список заявок — только с админ-ключом (заголовок x-api-key)
router.get('/', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  await db.read();
  res.json({ leads: db.data.leads });
});

export default router;
