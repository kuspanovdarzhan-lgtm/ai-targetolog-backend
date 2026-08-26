import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import leadsRouter from './routes/leads.js';
import copyRouter from './routes/copy.js';
import creativeRouter from './routes/creative.js';
import metaAdsRouter from './routes/metaAds.js';
import strategyRouter from './routes/strategy.js';
import clientsRouter from './routes/clients.js';
import contentPlanRouter from './routes/contentPlan.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/leads', leadsRouter);
app.use('/api/copy', copyRouter);
app.use('/api/creative', creativeRouter);
app.use('/api/meta-ads', metaAdsRouter);
app.use('/api/strategy', strategyRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/content-plan', contentPlanRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`AI-Targetolog backend запущен на порту ${port}`);
});
