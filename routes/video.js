import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { db } from '../lib/db.js';
import { requireClient } from '../lib/auth.js';
import { newJobId, jobDir, createJob, getJob, listJobs, removeJobFiles, enqueue } from '../lib/videoJobs.js';
import { generateEditPlans } from '../lib/videoEditPlan.js';
import { renderAllVariants } from '../lib/ffmpegRender.js';

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
    await db.write();

    const videos = await renderAllVariants(plans, jobDir(jobId), jobDir(jobId));
    job.videos = videos;
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
    id: job.id, status: job.status, plans: job.plans, videos: job.videos, error: job.error,
    brief: job.brief,
    files: job.files.map((f) => f.originalName),
    createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: job.expiresAt,
  });
});

// Скачать готовый ролик варианта A или B
router.get('/jobs/:id/download/:variant', requireClient, (req, res) => {
  const job = getJob(req.params.id, req.client.id);
  if (!job) return res.status(404).json({ error: 'Задание не найдено или уже удалено (файлы хранятся 24 часа)' });
  const video = (job.videos || []).find((v) => v.variant === req.params.variant.toUpperCase());
  if (!video) return res.status(404).json({ error: 'Ролик этого варианта не найден — возможно, рендер ещё не завершён' });
  const filePath = path.join(jobDir(job.id), video.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл ролика не найден на сервере' });
  res.download(filePath, `orbit_${job.id}_${video.variant}.mp4`);
});

// Пересобрать ролик с изменённым пользователем текстом (без повторного вызова ИИ)
router.post('/jobs/:id/rerender', requireClient, async (req, res) => {
  const job = getJob(req.params.id, req.client.id);
  if (!job) return res.status(404).json({ error: 'Задание не найдено или уже удалено (файлы хранятся 24 часа)' });
  if (!job.plans) return res.status(400).json({ error: 'У задания ещё нет готового плана монтажа' });
  const { variants } = req.body || {};
  if (!Array.isArray(variants) || !variants.length) {
    return res.status(400).json({ error: 'Нужно передать variants — массив планов с изменённым текстом' });
  }
  // Подставляем изменённый текст в существующий план, но source-клипы и тайминги не даём поменять
  const knownFiles = new Set(job.files.map((f) => f.filename));
  for (const v of variants) {
    for (const clip of v.clips || []) {
      if (!knownFiles.has(clip.source)) {
        return res.status(400).json({ error: `Неизвестный файл клипа "${clip.source}"` });
      }
    }
  }
  try {
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    await db.write();
    const videos = await renderAllVariants(variants, jobDir(job.id), jobDir(job.id));
    job.plans = variants;
    job.videos = videos;
    job.status = 'completed';
    job.error = null;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
  }
  job.updatedAt = new Date().toISOString();
  await db.write();
  res.json({ id: job.id, status: job.status, plans: job.plans, videos: job.videos, error: job.error });
});

// Служебный маршрут для тестирования рендера без реальных исходников —
// генерирует 3 коротких синтетических клипа (цветные заливки) через сам ffmpeg.
function makeSyntheticClip(outPath, color, seconds) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:d=${seconds}:r=30`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-800)))));
  });
}

// Временный диагностический маршрут — проверить, какие фильтры собраны в бинарник ffmpeg-static
router.get('/_debug/ffmpeg-info', requireClient, (req, res) => {
  const proc = spawn(ffmpegPath, ['-filters']);
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { err += d.toString(); });
  proc.on('close', (code) => {
    res.json({ code, hasDrawtext: out.includes('drawtext'), stdoutTail: out.slice(-2000), stderrTail: err.slice(-500) });
  });
});

router.post('/_debug/synthetic-job', requireClient, async (req, res) => {
  try {
    const jobId = newJobId();
    const dir = jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const colors = ['red', 'green', 'blue'];
    const files = [];
    for (let i = 0; i < colors.length; i++) {
      const filename = `synthetic_${i + 1}.mp4`;
      await makeSyntheticClip(path.join(dir, filename), colors[i], 5);
      files.push({ filename, originalname: `clip${i + 1}.mp4`, size: fs.statSync(path.join(dir, filename)).size });
    }
    const brief = {
      service: req.body.service || 'Тестовая услуга (синтетические клипы)',
      price: req.body.price || '1234 тенге',
      benefits: req.body.benefits || 'тестовое преимущество',
      audience: req.body.audience || 'тестовая аудитория',
      pain: req.body.pain || 'тестовая боль',
      desire: req.body.desire || 'тестовое желание',
      language: req.body.language || 'ru',
      duration: req.body.duration || '15 секунд',
      cta: req.body.cta || 'Тестовый призыв к действию',
      clipDescriptions: {},
    };
    const job = createJob(jobId, req.client.id, brief, files);
    await db.write();
    res.status(201).json({ jobId: job.id, status: job.status, expiresAt: job.expiresAt });
    enqueue(job.id, processJob);
  } catch (err) {
    res.status(500).json({ error: `Не удалось создать синтетическое задание: ${err.message}` });
  }
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
