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

  const { product, audience, offer, framework = 'pas' } = req.body || {};
  if (!product || !offer) {
    return res.status(400).json({ error: 'product и offer обязательны' });
  }

  const prompt = `Напиши 3 варианта рекламного текста для Instagram/Facebook на русском языке под один и тот же оффер, разным тоном:
1) ЭКСПЕРТНЫЙ ТОН — факты и цифры, без эмоций
2) ЭМОЦИОНАЛЬНЫЙ ТОН — акцент на ощущения от результата
3) ЧЕРЕЗ БОЛЬ КЛИЕНТА — старт с проблемы, которую снимает оффер

Товар/услуга: ${product}
Аудитория: ${audience || 'не указана'}
Оффер: ${offer}
Структура каждого варианта: ${FRAMEWORKS[framework] || FRAMEWORKS.pas}

Требования к каждому варианту: короткий (до 500 знаков), обязательно с цифрой/фактом из оффера (%, ₸, сроки, количество). Без клише ("незабываемые впечатления", "уютная атмосфера", "маленький праздник", "мир возможностей", "не упустите шанс" и подобных) — каждое предложение несёт конкретную выгоду или факт, не настроение. Максимум 2 эмодзи на вариант, без гирлянд из смайликов. Без markdown-разметки.

Выведи все 3 варианта подряд, каждый с заголовком тона заглавными буквами перед текстом.`;

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
