import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import leadsRouter from './routes/leads.js';
import copyRouter from './routes/copy.js';
import creativeRouter from './routes/creative.js';
import metaAdsRouter from './routes/metaAds.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/leads', leadsRouter);
app.use('/api/copy', copyRouter);
app.use('/api/creative', creativeRouter);
app.use('/api/meta-ads', metaAdsRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`AI-Targetolog backend запущен на порту ${port}`);
});
