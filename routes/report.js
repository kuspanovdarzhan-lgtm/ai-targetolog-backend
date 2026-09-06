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

  const { city, impressions, clicks, spend, leads, notes } = req.body || {};
  if (!spend) return res.status(400).json({ error: 'spend обязателен' });

  const ctr = impressions && clicks ? ((Number(clicks) / Number(impressions)) * 100).toFixed(2) : null;
  const cpl = leads && Number(leads) > 0 ? (Number(spend) / Number(leads)).toFixed(0) : null;

  // Сравниваем только с собственной историей этого клиента (реальные прошлые цифры),
  // никогда с выдуманной рыночной нормой.
  const prevReports = req.client.reports || [];
  const prev = prevReports.length ? prevReports[prevReports.length - 1] : null;
  const historyLine = prev
    ? `Предыдущий отчёт (${new Date(prev.createdAt).toLocaleDateString('ru-RU')}): CTR ${prev.ctr ?? 'н/д'}%, CPL ${prev.cpl ?? 'н/д'} ₸, расход ${prev.spend} ₸, заявки ${prev.leads ?? 'н/д'}.`
    : 'Предыдущих отчётов по этому клиенту нет — сравнивать не с чем.';

  const prompt = `Проанализируй фактические показатели рекламной кампании в Instagram/Facebook для одного конкретного клиента.
Город: ${city || 'не указан'}
Показы: ${impressions || 'не указано'}
Клики: ${clicks || 'не указано'}
CTR (посчитан из показов/кликов): ${ctr ? ctr + '%' : 'недостаточно данных для расчёта'}
Расход: ${spend} ₸
Заявки: ${leads || 'не указано'}
CPL (посчитан из расхода/заявок): ${cpl ? cpl + ' ₸' : 'недостаточно данных для расчёта'}
Доп. контекст: ${notes || '—'}
${historyLine}

Дай:
1) Изложи фактические цифры (CTR, CPL, расход, заявки) простыми словами. Если есть предыдущий отчёт — сравни с ним (рост/падение). Если предыдущего отчёта нет — так и скажи, без оценки "хорошо/плохо", потому что сравнивать не с чем (рыночных норм у нас нет).
2) 2-3 гипотезы, почему результат именно такой — основывайся только на переданных цифрах, городе и доп. контексте, ничего не выдумывай.
3) 2-3 конкретных действия на следующую неделю — ТОЛЬКО по таргетингу, креативу, тексту объявления, времени показа или распределению бюджета внутри уже заданного бюджета.

Жёсткий запрет: не предлагай смену города, скидки, акции, новые офферы или снижение цены — эти решения не входят в твои рекомендации и требуют отдельного разрешения клиента.
Без вводных и заключительных фраз, без клише, без выдуманной статистики и процентов, которых нет в цифрах выше. По-русски.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    });
    const text = completion.choices[0].message.content.trim();

    const report = {
      text, city: city || '', impressions: impressions || null, clicks: clicks || null,
      spend, leads: leads || null, ctr, cpl, notes: notes || '', createdAt: new Date().toISOString(),
    };
    req.client.reports.push(report);
    await db.write();

    res.json({ text, ctr, cpl });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка анализа', details: err.message });
  }
});

router.get('/history', requireClient, async (req, res) => {
  res.json({ reports: req.client.reports || [] });
});

export default router;
