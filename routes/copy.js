import { Router } from 'express';
import OpenAI from 'openai';
import { db } from '../lib/db.js';
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

  const { product, audience, offer, framework = 'pas', language = 'ru' } = req.body || {};
  if (!product || !offer) {
    return res.status(400).json({ error: 'product и offer обязательны' });
  }

  const LANG_LABEL = language === 'kz' ? 'казахском' : 'русском';

  const systemPrompt = `Ты копирайтер рекламных объявлений для Instagram/Facebook. Пишешь на ${LANG_LABEL} языке.

Правила, которые нельзя нарушать:
- Каждый вариант обязан явно называть конкретный товар/услугу/нишу из брифа — никогда не пиши обобщённо "товары", "услуги", "наш центр", "наш магазин"
- Используй только факты, цифры, скидки и сроки, которые дословно есть в поле "Оффер" — если там нет цифры, не придумывай её
- Запрещены слова: "лучший", "лучшая", "самый", "гарантированно", "гарантия результата", "статистика показывает", "исследования показывают"
- Запрещены клише: "незабываемые впечатления", "уютная атмосфера", "маленький праздник", "мир возможностей", "не упустите шанс", "не упустите возможность"
- Короткий текст (до 500 знаков на вариант), максимум 2 эмодзи, без markdown-разметки`;

  const userPrompt = `Ниша/товар: ${product}
Аудитория: ${audience || 'не указана'}
Оффер: ${offer}

Напиши 3 варианта рекламного текста под этот оффер и эту нишу, разным тоном, структура каждого — ${FRAMEWORKS[framework] || FRAMEWORKS.pas}:
1) ЭКСПЕРТНЫЙ ТОН — факты, без эмоций
2) ЭМОЦИОНАЛЬНЫЙ ТОН — акцент на ощущения от результата
3) ЧЕРЕЗ БОЛЬ КЛИЕНТА — старт с проблемы, которую снимает оффер

Выведи все 3 варианта подряд, каждый с заголовком тона заглавными буквами перед текстом. Каждый вариант должен явно упоминать «${product}» — не пиши абстрактно.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });
    const text = completion.choices[0].message.content.trim();

    req.client.materials.copy = { text, brief: { product, audience, offer, framework, language }, createdAt: new Date().toISOString() };
    await db.write();

    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации текста', details: err.message });
  }
});

export default router;
