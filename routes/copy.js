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

  const prompt = `Напиши 3 варианта рекламного текста для Instagram/Facebook на ${LANG_LABEL} языке под один и тот же оффер, разным тоном:
1) ЭКСПЕРТНЫЙ ТОН — факты, без эмоций
2) ЭМОЦИОНАЛЬНЫЙ ТОН — акцент на ощущения от результата
3) ЧЕРЕЗ БОЛЬ КЛИЕНТА — старт с проблемы, которую снимает оффер

Товар/услуга: ${product}
Аудитория: ${audience || 'не указана'}
Оффер (используй только то, что здесь написано): ${offer}
Структура каждого варианта: ${FRAMEWORKS[framework] || FRAMEWORKS.pas}

Жёсткие требования к каждому варианту:
- Короткий (до 500 знаков)
- Используй только факты, цифры, скидки и сроки, которые дословно есть в поле "Оффер" выше. Не добавляй свои проценты, цены, сроки или свойства товара — если в оффере цифры нет, не упоминай цифру вообще.
- Запрещены слова и конструкции: "лучший", "лучшая", "самый", "гарантированно", "гарантия результата", "статистика показывает", "исследования показывают", а также любые проценты или цифры, которых нет дословно в оффере
- Без клише ("незабываемые впечатления", "уютная атмосфера", "маленький праздник", "мир возможностей", "не упустите шанс" и подобных)
- Максимум 2 эмодзи на вариант, без гирлянд из смайликов
- Без markdown-разметки

Выведи все 3 варианта подряд, каждый с заголовком тона заглавными буквами перед текстом.`;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
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
