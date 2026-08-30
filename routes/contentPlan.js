import { Router } from 'express';
import OpenAI from 'openai';
import { requireClient, spendUnits } from '../lib/auth.js';

const router = Router();

router.post('/', requireClient, async (req, res) => {
  if (req.client.tariff === 'START') {
    return res.status(403).json({ error: 'Контент-план доступен на тарифах PRO и MAX' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  const ok = await spendUnits(req.client, 2);
  if (!ok) {
    return res.status(429).json({ error: 'Дневной лимит по тарифу исчерпан, попробуйте завтра' });
  }

  const { niche, audience, notes, language = 'ru' } = req.body || {};
  if (!niche) return res.status(400).json({ error: 'niche обязателен' });

  const LANG_LABEL = language === 'kz' ? 'казахском' : 'русском';

  const prompt = `Составь контент-план на 4 недели вперёд для Instagram под нишу. Пиши на ${LANG_LABEL} языке.
Ниша: ${niche}
Целевой клиент: ${audience || 'не указан'}
Доп. детали: ${notes || '—'}

Формат вывода — по неделям, для каждой недели 3 поста. Для каждого поста укажи:
- День недели
- Формат (сторис / карусель / рилс / статичный пост)
- Тема поста (2-4 слова)
- Конкретная идея (1 строка: что именно показать/сказать, без общих слов)

Жёсткие требования:
- Никаких вводных и заключительных фраз
- Запрещены клише: "незабываемые впечатления", "уютная атмосфера", "мир возможностей", "не упустите шанс" и подобные
- Каждая идея — конкретное действие или факт (например: "покажи процесс приготовления за 15 сек", "цифра: сколько клиентов обслужили за месяц"), а не настроение
- Компактно, списком по неделям
- Без markdown-разметки (никаких ###, **, __) — заголовки недель и полей просто текстом с новой строки`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    res.json({ text: completion.choices[0].message.content.trim() });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации контент-плана', details: err.message });
  }
});

export default router;
