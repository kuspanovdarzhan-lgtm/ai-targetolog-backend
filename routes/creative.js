import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

router.post('/', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY не задан в .env' });
  }

  const { description, style = 'минимализм, яркий, премиум' } = req.body || {};
  if (!description) {
    return res.status(400).json({ error: 'description обязателен' });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const image = await client.images.generate({
      model: 'gpt-image-1',
      prompt: `Рекламный креатив для соцсетей. ${description}. Стиль: ${style}.`,
      size: '1024x1024',
    });
    res.json({ b64: image.data[0].b64_json });
  } catch (err) {
    res.status(502).json({ error: 'Ошибка генерации изображения', details: err.message });
  }
});

export default router;
