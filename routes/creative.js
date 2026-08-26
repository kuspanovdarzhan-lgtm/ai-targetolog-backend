import { Router } from 'express';
import OpenAI from 'openai';
import { requireClient, spendUnits } from '../lib/auth.js';

const router = Router();

router.post('/', requireClient, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  // Картинка заметно дороже текста — списываем 5 единиц вместо 1
  const ok = await spendUnits(req.client, 5);
  if (!ok) {
    return res.status(429).json({ error: 'Дневной лимит по тарифу исчерпан, попробуйте завтра' });
  }

  const { description, style = 'минимализм, яркий, премиум', format = 'feed' } = req.body || {};
  if (!description) {
    return res.status(400).json({ error: 'description обязателен' });
  }

  const SIZES = {
    feed: '1024x1024',   // квадрат — лента Instagram/Facebook
    story: '1024x1536',  // вертикаль — Stories/Reels
    banner: '1536x1024', // горизонталь — Facebook-баннер
  };
  const size = SIZES[format] || SIZES.feed;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // gpt-image-1 заметно хуже следует описанию на русском/кириллице и часто
    // съезжает на generic premium-product кадр. Прогоняем через перевод на
    // английский, чтобы содержание картинки реально совпадало с брифом.
    const translation = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Translate and expand this into a vivid, concrete English prompt for an AI image generator making an ad creative. Keep it under 300 characters, describe the literal scene (subject, setting, composition), no marketing fluff words. Source (Russian): "${description}". Style: ${style}.`,
      }],
      temperature: 0.5,
    });
    const englishPrompt = translation.choices[0].message.content.trim();

    const image = await client.images.generate({
      model: 'gpt-image-1',
      prompt: `Advertising creative for social media. ${englishPrompt} No text or letters anywhere in the image.`,
      size,
    });
    res.json({ b64: image.data[0].b64_json });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации изображения', details: err.message });
  }
});

export default router;
