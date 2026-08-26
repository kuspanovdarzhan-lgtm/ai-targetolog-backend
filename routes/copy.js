import { Router } from 'express';
import OpenAI from 'openai';
import { requireClient, spendUnits } from '../lib/auth.js';

const router = Router();

const FRAMEWORKS = {
  pas: 'PAS (Проблема → Агитация → Решение)',
  aida: 'AIDA (Внимание → Интерес → Желание → Действие)',
};

router.post('/', requireClient, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  const ok = await spendUnits(req.client, 1);
  if (!ok) {
    return res.status(429).json({ error: 'Дневной лимит по тарифу исчерпан, попробуйте завтра' });
  }

  const { product, audience, offer, tone = 'дружеский', framework = 'pas' } = req.body || {};
  if (!product || !offer) {
    return res.status(400).json({ error: 'product и offer обязательны' });
  }

  const prompt = `Напиши рекламный текст для Instagram/Facebook на русском языке.
Товар/услуга: ${product}
Аудитория: ${audience || 'не указана'}
Оффер: ${offer}
Тон: ${tone}
Структура: ${FRAMEWORKS[framework] || FRAMEWORKS.pas}
Требования: текст короткий (до 600 знаков), конкретный — обязательно включи цифру/факт из оффера (%, ₸, сроки, количество). Без общих фраз и клише ("незабываемые впечатления", "уютная атмосфера", "маленький праздник", "мир возможностей", "не упустите шанс" и подобных) — каждое предложение должно нести конкретную выгоду или факт, а не настроение. Максимум 2-3 эмодзи по делу, без гирлянд из смайликов. Без markdown-разметки.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
    });
    res.json({ text: completion.choices[0].message.content.trim() });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации текста', details: err.message });
  }
});

export default router;
