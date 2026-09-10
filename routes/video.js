import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import { db } from '../lib/db.js';
import { requireClient } from '../lib/auth.js';
import { newJobId, jobDir, createJob, getJob, listJobs, removeJobFiles, enqueue } from '../lib/videoJobs.js';
import { generateEditPlans } from '../lib/videoEditPlan.js';

const router = Router();

const MIN_FILES = 3;
const MAX_FILES = 10;
const MAX_FILE_MB = 25;
const ALLOWED_EXT = ['.mp4', '.mov'];

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = jobDir(req.jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // убираем всё, кроме безопасных символов — файлы кладём в папку задания,
    // так что коллизии имён между разными заданиями не страшны
    const safe = file.originalname.replace(/[^a-zA-Zа-яА-Я0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    // Расширение — основной сигнал (надёжнее, чем content-type, который клиенты
    // выставляют по-разному); mimetype проверяем мягко, только если он явно не видео.
    const extOk = ALLOWED_EXT.includes(extOf(file.originalname));
    const mimeLooksWrong = file.mimetype && !file.mimetype.startsWith('video/') && file.mimetype !== 'application/octet-stream';
    if (!extOk || mimeLooksWrong) {
      return cb(new Error('BAD_FILE_TYPE'));
    }
    cb(null, true);
  },
});

function assignJobId(req, res, next) {
  req.jobId = newJobId();
  next();
}

async function processJob(jobId) {
  await db.read();
  const job = db.data.videoJobs.find((j) => j.id === jobId);
  if (!job) return;

  job.status = 'processing';
  job.updatedAt = new Date().toISOString();
  await db.write();

  try {
    const plans = await generateEditPlans({
      ...job.brief,
      clips: job.files.map((f) => ({
        filename: f.filename,
        description: (job.brief.clipDescriptions || {})[f.originalName] || '',
      })),
    });
    job.plans = plans;
    job.status = 'completed';
    job.error = null;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
  }
  job.updatedAt = new Date().toISOString();
  await db.write();
}

router.post('/jobs', requireClient, assignJobId, upload.array('clips', MAX_FILES), async (req, res) => {
  const files = req.files || [];
  if (files.length < MIN_FILES) {
    files.forEach((f) => fs.unlinkSync(f.path));
    removeJobFiles(req.jobId);
    return res.status(400).json({ error: `Нужно минимум ${MIN_FILES} видеофайла, загружено ${files.length}` });
  }

  let clipDescriptions = {};
  if (req.body.clipDescriptions) {
    try {
      clipDescriptions = JSON.parse(req.body.clipDescriptions);
    } catch (e) {
      removeJobFiles(req.jobId);
      return res.status(400).json({ error: 'clipDescriptions должен быть валидным JSON-объектом {"имя_файла":"описание"}' });
    }
  }

  const { service, price, benefits, audience, pain, desire, language, duration, cta } = req.body;
  if (!service) {
    removeJobFiles(req.jobId);
    return res.status(400).json({ error: 'Поле "service" (услуга) обязательно' });
  }

  const brief = { service, price, benefits, audience, pain, desire, language, duration, cta, clipDescriptions };
  const job = createJob(req.jobId, req.client.id, brief, files);
  await db.write();

  res.status(201).json({ jobId: job.id, status: job.status, expiresAt: job.expiresAt });

  enqueue(job.id, processJob); // не ждём — обработка идёт в фоне
});

router.get('/jobs', requireClient, (req, res) => {
  const jobs = listJobs(req.client.id).map((j) => ({
    id: j.id, status: j.status, createdAt: j.createdAt, expiresAt: j.expiresAt, service: j.brief?.service,
  }));
  res.json({ jobs });
});

router.get('/jobs/:id', requireClient, (req, res) => {
  const job = getJob(req.params.id, req.client.id);
  if (!job) return res.status(404).json({ error: 'Задание не найдено или уже удалено (файлы хранятся 24 часа)' });
  res.json({
    id: job.id, status: job.status, plans: job.plans, error: job.error,
    brief: job.brief,
    files: job.files.map((f) => f.originalName),
    createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: job.expiresAt,
  });
});

// Понятные сообщения об ошибках вместо стандартной HTML-страницы Express
router.use((err, req, res, next) => {
  if (req.jobId) removeJobFiles(req.jobId);
  if (err.message === 'BAD_FILE_TYPE') {
    return res.status(400).json({ error: `Разрешены только файлы ${ALLOWED_EXT.join(', ')}` });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `Файл больше ${MAX_FILE_MB} МБ — уменьшите размер и попробуйте снова` });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: `Максимум ${MAX_FILES} файлов за раз` });
  }
  console.error('[video] неожиданная ошибка:', err);
  res.status(500).json({ error: 'Внутренняя ошибка при загрузке файлов' });
});

export default router;
