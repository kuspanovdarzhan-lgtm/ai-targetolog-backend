import OpenAI from 'openai';

// Генерирует 2 структурированных монтажных плана (JSON) для A/B-теста.
// ИИ не видит содержимое видео — работает только с брифом и (опционально)
// короткими текстовыми описаниями клипов, которые указал пользователь.
export async function generateEditPlans({ service, price, benefits, audience, pain, desire, language, duration, cta, clips }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY не задан в .env');
  }
  const langLabel = language === 'kz' ? 'казахском' : 'русском';

  const clipList = clips
    .map((c, i) => `${i + 1}. ${c.filename}${c.description ? ' — ' + c.description : ' — описание не указано, содержимое неизвестно, используй как нейтральную перебивку'}`)
    .join('\n');

  const system = `Ты монтажёр рекламных вертикальных роликов 9:16 для Reels/Stories. Составляешь структурированный монтажный план.

Правила:
- Работай ТОЛЬКО с данными брифа и списком клипов ниже. Никогда не выдумывай преимущества, гарантии, цены или характеристики услуги, которых нет в брифе.
- Если у клипа нет описания — не придумывай, что на нём изображено, используй его просто как нейтральную перебивку по порядку.
- Если цена не указана в брифе — priceCard.show обязан быть false.
- Если подтверждённых преимуществ нет — не упоминай преимущества в хуке и тексте.
- Длительность ролика должна соответствовать указанной в брифе (если не указана — выбери 15-20 секунд и явно укажи это в totalDuration).
- В поле "source" используй ТОЛЬКО имена файлов из списка клипов ниже, не придумывай новые имена.
- Верни СТРОГО валидный JSON, без markdown и пояснений вокруг, формата:
{"variants": [
  {"variant":"A","totalDuration":"15 сек","hook":"...","clips":[{"source":"имя_файла","start":0,"end":3.5,"onScreenText":"...","transition":"cut"}],"priceCard":{"show":false,"text":""},"cta":"..."},
  {"variant":"B", ...}
]}`;

  const user = `Услуга: ${service}
Цена: ${price || 'не указана'}
Подтверждённые преимущества: ${benefits || 'не указаны'}
Целевая аудитория: ${audience || 'не указана'}
Основная боль клиента: ${pain || 'не указана'}
Желание клиента: ${desire || 'не указано'}
Длительность ролика: ${duration || 'не указана'}
CTA: ${cta || 'не указан'}
Язык текста в кадре: ${langLabel}

Доступные исходные клипы:
${clipList}

Составь 2 разных сценария (вариант A и вариант B) для A/B-теста — разные хуки и разный порядок клипов.`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('ИИ вернул невалидный JSON, попробуйте ещё раз');
  }
  if (!Array.isArray(parsed.variants) || parsed.variants.length < 2) {
    throw new Error('ИИ не вернул два варианта сценария, попробуйте ещё раз');
  }

  // Сверяем, что source в плане реально существует среди загруженных клипов —
  // если модель всё же что-то придумала, лучше явно упасть, чем тихо сломать рендер.
  const knownFiles = new Set(clips.map((c) => c.filename));
  for (const variant of parsed.variants) {
    for (const clip of variant.clips || []) {
      if (!knownFiles.has(clip.source)) {
        throw new Error(`ИИ сослался на несуществующий файл "${clip.source}" — попробуйте ещё раз`);
      }
    }
  }

  return parsed.variants;
}
