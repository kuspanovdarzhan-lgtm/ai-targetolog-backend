import { Router } from 'express';
import OpenAI from 'openai';
import { db, initDb } from '../lib/db.js';

const router = Router();
await initDb();

const DAILY_LIMIT_PER_IP = 1;

// Публичный тизер ИИ-Стратега на лендинге — без кода доступа, но с лимитом
// по IP, чтобы кто угодно не мог бесконечно жечь бюджет OpenAI.
router.post('/', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'ИИ пока не подключён' });
  }

  const { niche } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  const ip = req.ip || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  await db.read();
  const usedToday = db.data.trialUsage.filter((t) => t.ip === ip && t.date === today).length;
  if (usedToday >= DAILY_LIMIT_PER_IP) {
    return res.status(429).json({ error: 'Бесплатная проба на сегодня уже использована. Полный доступ — в личном кабинете.' });
  }

  const prompt = `Дай короткий, но конкретный тизер разбора рынка для таргетированной рекламы под нишу "${niche}" на рынке Казахстана.
Ровно 2 пункта:
1) Один конкретный факт о конкуренции в этой нише (без выдумывания названий компаний)
2) Один сегмент целевой аудитории с кратким описанием

Не давай позиционирование и цифры CPL/CTR — это в полной версии.
В конце добавь отдельной строкой: "Это часть анализа — полная стратегия, тексты объявлений и креативы доступны в личном кабинете."
Жёстко: без вводных фраз, без клише, конкретика, по-русски.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });
    db.data.trialUsage.push({ ip, date: today, niche, createdAt: new Date().toISOString() });
    await db.write();
    res.json({ text: completion.choices[0].message.content.trim() });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации', details: err.message });
  }
});

export default router;
