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

  const { impressions, clicks, spend, leads, notes } = req.body || {};
  if (!spend) return res.status(400).json({ error: 'spend обязателен' });

  const ctr = impressions && clicks ? ((Number(clicks) / Number(impressions)) * 100).toFixed(2) : null;
  const cpl = leads && Number(leads) > 0 ? (Number(spend) / Number(leads)).toFixed(0) : null;

  const prompt = `Проанализируй показатели рекламной кампании в Instagram/Facebook на рынке Казахстана и дай конкретные рекомендации.
Показы: ${impressions || 'не указано'}
Клики: ${clicks || 'не указано'}
CTR: ${ctr ? ctr + '%' : 'недостаточно данных'}
Расход: ${spend} ₸
Заявки: ${leads || 'не указано'}
CPL: ${cpl ? cpl + ' ₸' : 'недостаточно данных'}
Доп. контекст: ${notes || '—'}

Дай:
1) Оценка результата: хороший/средний/слабый — с обоснованием, относительно каких ориентиров по рынку это оцениваешь
2) 2-3 конкретные гипотезы, почему результат именно такой (не общие слова, а конкретные причины под эти цифры)
3) 2-3 конкретных действия на следующую неделю — что именно поменять (не "улучшить таргетинг", а конкретный шаг)

Жёсткие требования: без вводных и заключительных фраз, без клише, каждый пункт — конкретика, а не настроение. По-русски.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    });
    res.json({ text: completion.choices[0].message.content.trim(), ctr, cpl });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка анализа', details: err.message });
  }
});

export default router;
