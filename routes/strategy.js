import { Router } from 'express';
import OpenAI from 'openai';
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

  const { niche, audience, budget, notes } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  const prompt = `Подготовь короткий разбор рынка для таргетированной рекламы в Instagram/Facebook под рынок Казахстана.
Ниша: ${niche}
Целевой клиент: ${audience || 'не указан'}
Бюджет на рекламу: ${budget || 'не указан'}
Доп. детали: ${notes || '—'}

Дай:
1) Общий расклад по нише — кто обычно уже рекламируется и с каким посылом (без выдумывания конкретных названий компаний)
2) 3 сегмента целевой аудитории с кратким описанием
3) Рекомендованное позиционирование/УТП
Пиши по-русски, кратко и по делу, без вступлений и заключений.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    res.json({ text: completion.choices[0].message.content.trim() });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации стратегии', details: err.message });
  }
});

export default router;
