import { Router } from 'express';
import OpenAI from 'openai';
import { db } from '../lib/db.js';
import { requireClient, spendUnits } from '../lib/auth.js';

const router = Router();

const FRAMEWORKS = {
  pas: 'PAS (Проблема → Агитация → Решение)',
  aida: 'AIDA (Внимание → Интерес → Желание → Действие)',
};

const COMMON_RULES = (langLabel) => `Правила, которые нельзя нарушать:
- Работай ТОЛЬКО с данными брифа, которые тебе дал пользователь. Никогда не выдумывай статистику, скидки, гарантии, свойства товара, сроки, комплектацию, результаты или преимущества, которых нет в брифе.
- Если какой-то конкретной информации не хватает — прямо напиши "Нужно уточнить у клиента" в этом месте, не придумывай замену и не додумывай за клиента.
- Запрещены слова: "лучший", "лучшая", "самый", "гарантированно", "гарантия результата", "статистика показывает", "исследования показывают"
- Запрещены клише: "незабываемые впечатления", "уютная атмосфера", "маленький праздник", "мир возможностей", "не упустите шанс", "не упустите возможность"
- Пиши на ${langLabel} языке, без markdown-разметки (никаких **, ###, __)`;

function textAdUserPrompt({ product, audience, offer, framework }) {
  return `Ниша/товар: ${product}
Аудитория: ${audience || 'не указана'}
Оффер: ${offer}

Напиши 3 варианта рекламного текста под этот оффер и эту нишу, разным тоном, структура каждого — ${FRAMEWORKS[framework] || FRAMEWORKS.pas}:
1) ЭКСПЕРТНЫЙ ТОН — факты, без эмоций
2) ЭМОЦИОНАЛЬНЫЙ ТОН — акцент на ощущения от результата
3) ЧЕРЕЗ БОЛЬ КЛИЕНТА — старт с проблемы, которую снимает оффер

Каждый вариант — до 500 знаков, максимум 2 эмодзи. Выведи все 3 варианта подряд, каждый с заголовком тона заглавными буквами перед текстом. Каждый вариант должен явно упоминать «${product}» — не пиши абстрактно.`;
}

function videoUserPrompt(f) {
  return `Ниша/товар: ${f.product}
Аудитория: ${f.audience || 'не указана'}
Оффер: ${f.offer || 'не указан'}
Длительность ролика: ${f.duration || 'не указана — выбери разумную длительность 15-30 сек и укажи её'}
Цель рекламы: ${f.goal || 'не указана'}
Основная боль клиента: ${f.pain || 'не указана'}
Основное желание клиента: ${f.desire || 'не указано'}
Что входит в услугу: ${f.included || 'не указано'}
Подтверждённые преимущества: ${f.benefits || 'не указаны'}
Доступные фото и видео: ${f.media || 'не указано'}
Человек будет говорить в кадре: ${f.onCamera ? 'да' : 'нет / не указано'}

Если длительность указана (например 20-25 секунд) — сценарий по таймкодам обязан укладываться ровно в этот диапазон, не больше.

Дай ответ строго в этом порядке, с номерами пунктов:
1) Рекламный угол
2) Три варианта хука на первые 3 секунды
3) Таблица сценария по таймкодам — для каждой строки: таймкод, кадр (что в кадре), текст на экране, озвучка
4) Список кадров, которые необходимо снять
5) Текст объявления (подпись под роликом)
6) Заголовок
7) Призыв к действию
8) Второй вариант ролика для A/B-теста — другой рекламный угол или хук, коротко опиши отличие
9) Список недостающей информации — перечисли, какие поля выше были "не указаны" и требуют уточнения у клиента`;
}

async function generateVideoScript(client, f, langLabel) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Ты сценарист рекламных роликов для Reels/Stories.\n\n${COMMON_RULES(langLabel)}` },
      { role: 'user', content: videoUserPrompt(f) },
    ],
    temperature: 0.7,
  });
  return completion.choices[0].message.content.trim();
}

async function generateTextAd(client, f, langLabel) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Ты копирайтер рекламных объявлений для Instagram/Facebook.\n\n${COMMON_RULES(langLabel)}` },
      { role: 'user', content: textAdUserPrompt(f) },
    ],
    temperature: 0.7,
  });
  return completion.choices[0].message.content.trim();
}

router.post('/', requireClient, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  const body = req.body || {};
  const mode = ['video', 'text', 'full'].includes(body.mode) ? body.mode : 'text';
  const language = body.language === 'kz' ? 'kz' : 'ru';
  const langLabel = language === 'kz' ? 'казахском' : 'русском';
  const { product, audience, offer, framework = 'pas' } = body;

  if (!product) return res.status(400).json({ error: 'product обязателен' });
  if (mode === 'text' && !offer) return res.status(400).json({ error: 'offer обязателен для режима "Текст объявления"' });

  const UNITS = { text: 1, video: 2, full: 3 };
  const ok = await spendUnits(req.client, UNITS[mode]);
  if (!ok) {
    return res.status(429).json({ error: 'Дневной лимит по тарифу исчерпан, попробуйте завтра' });
  }

  const videoFields = {
    product, audience, offer,
    duration: body.duration, goal: body.goal, pain: body.pain, desire: body.desire,
    included: body.included, benefits: body.benefits, media: body.media, onCamera: body.onCamera,
  };

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let text;

    if (mode === 'video') {
      text = await generateVideoScript(client, videoFields, langLabel);
    } else if (mode === 'full') {
      const [video, ad] = await Promise.all([
        generateVideoScript(client, videoFields, langLabel),
        generateTextAd(client, { product, audience, offer: offer || 'не указан', framework }, langLabel),
      ]);
      text = `=== ВИДЕОСЦЕНАРИЙ ===\n\n${video}\n\n=== ТЕКСТ ОБЪЯВЛЕНИЯ (3 варианта) ===\n\n${ad}`;
    } else {
      text = await generateTextAd(client, { product, audience, offer, framework }, langLabel);
    }

    req.client.materials.copy = { text, mode, brief: { ...videoFields, framework, language }, createdAt: new Date().toISOString() };
    await db.write();

    res.json({ text, mode });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации', details: err.message });
  }
});

export default router;
