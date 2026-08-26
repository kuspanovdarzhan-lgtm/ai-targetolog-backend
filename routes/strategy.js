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
2) 3 сегмента целевой аудитории с кратким описанием и примерной долей каждого сегмента в % от общего спроса
3) Рекомендованное позиционирование/УТП
4) Ориентировочные цифры под указанный бюджет: примерный CPL в тенге, примерное число лидов в месяц, примерный CTR — с пометкой "ориентировочно"

Жёсткие требования к стилю:
- Никаких вводных и заключительных фраз, только суть
- Запрещены клише: "уютная атмосфера", "незабываемые впечатления", "высокое качество", "команда профессионалов", "широкий ассортимент", "индивидуальный подход" и любые их аналоги
- Каждый пункт — конкретный факт, цифра или тактика, не настроение
- Пиши как внутренний рабочий документ для таргетолога, а не как рекламный текст
- По-русски`;

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
