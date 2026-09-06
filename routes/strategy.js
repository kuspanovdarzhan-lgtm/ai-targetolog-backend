import { Router } from 'express';
import OpenAI from 'openai';
import { db } from '../lib/db.js';
import { requireClient, spendUnits } from '../lib/auth.js';

const router = Router();

router.post('/', requireClient, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  const ok = await spendUnits(req.client, 1);
  if (!ok) {
    return res.status(429).json({ error: 'Дневной лимит по тарифу исчерпан, попробуйте завтра' });
  }

  const { niche, audience, city, budget, notes } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  const prompt = `Ты работаешь ТОЛЬКО с данными брифа ниже. Не используй никакие внешние знания о рынке, конкурентах, статистике, исследованиях или трендах — их у тебя нет.

Ниша: ${niche}
Целевой клиент: ${audience || 'не указан'}
Город: ${city || 'не указан'}
Бюджет на рекламу: ${budget || 'не указан'}
Доп. детали: ${notes || '—'}

Дай:
1) 2-3 сегмента целевой аудитории — выведи их логически из ниши и целевого клиента, указанных выше. Без процентов, без "доли рынка", без выдуманных цифр.
2) Позиционирование/УТП — 2-3 варианта. Каждый вариант начни ровно со слов "Гипотеза для тестирования: " — это предположение, которое нужно проверить на практике, а не установленный факт.

Жёсткие требования:
- Никаких вводных и заключительных фраз, только суть
- Запрещено: любые проценты, доли рынка, статистика, "исследования показывают", данные о конкурентах, гарантии результата, любые цифры (кроме бюджета/города, если они указаны в брифе выше)
- Запрещены клише: "уютная атмосфера", "незабываемые впечатления", "высокое качество", "команда профессионалов", "широкий ассортимент", "индивидуальный подход" и аналоги
- Каждый пункт — конкретное предположение под конкретную нишу и аудиторию, а не общие слова
- Пиши как внутренний рабочий документ для таргетолога, а не как рекламный текст`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    });
    const text = completion.choices[0].message.content.trim();

    req.client.materials.strategy = { text, brief: { niche, audience, city, budget, notes }, createdAt: new Date().toISOString() };
    await db.write();

    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации стратегии', details: err.message });
  }
});

export default router;
