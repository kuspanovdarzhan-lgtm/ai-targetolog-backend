import { Router } from 'express';

const router = Router();

// Реальный запуск кампаний в Meta требует:
//   1. Приложение на developers.facebook.com с разрешением ads_management
//   2. Верифицированный Business Manager (проверка занимает от пары дней)
//   3. META_ACCESS_TOKEN и META_AD_ACCOUNT_ID в .env
// До этого момента эндпоинт отдаёт понятную ошибку вместо тихой заглушки.

router.post('/campaigns', async (req, res) => {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    return res.status(503).json({
      error: 'Meta Ads API не настроен',
      details:
        'Нужны META_ACCESS_TOKEN и META_AD_ACCOUNT_ID — выдаются после верификации Business Manager на developers.facebook.com',
    });
  }
  // TODO: после верификации — интеграция через facebook-nodejs-business-sdk
  res.status(501).json({ error: 'Запуск кампаний ещё не реализован' });
});

export default router;
