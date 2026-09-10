import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';
import { renderCaptionPng, WIDTH, HEIGHT } from './textOverlay.js';

const FPS = 30;

const FFMPEG_TIMEOUT_MS = 90 * 1000;

function runFfmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    // stdio: игнорируем stdin и stdout явно — если их не читать, у ffmpeg может
    // забиться буфер пайпа и процесс зависнет на записи, хотя сам Node не блокируется.
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg завис и был остановлен через ${timeoutMs / 1000} с. Последний вывод: ${stderr.slice(-1500)}`));
    }, timeoutMs);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg завершился с ошибкой (код ${code}): ${stderr.slice(-1500)}`));
    });
  });
}

function fontSizeFor(text) {
  const len = String(text || '').length;
  if (len > 60) return 42;
  if (len > 40) return 50;
  if (len > 25) return 58;
  return 66;
}

// Собирает один вертикальный ролик 1080x1920 H.264 из плана монтажа.
// Текст накладывается как PNG через overlay (не drawtext — его нет в сборке ffmpeg-static).
// Оригинальный звук исходных клипов в MVP не используется — на выходе тихая
// звуковая дорожка, чтобы файл корректно проигрывался везде (сообщение несёт подпись/капшены).
export async function renderVariant(variant, clipsDir, outputPath, onProgress) {
  const report = (s) => { try { onProgress?.(s); } catch (_) { /* progress reporting must never break rendering */ } };
  const segments = variant.clips || [];
  if (!segments.length) throw new Error('В плане нет ни одного клипа для монтажа');

  const capDir = path.join(clipsDir, 'captions');
  if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
  report('building captions');

  const inputArgs = [];
  segments.forEach((seg) => {
    const filePath = path.join(clipsDir, seg.source);
    if (!fs.existsSync(filePath)) throw new Error(`Файл клипа не найден: ${seg.source}`);
    inputArgs.push('-i', filePath);
  });

  const filters = [];
  let nextInputIdx = segments.length;
  const segLabels = [];

  segments.forEach((seg, i) => {
    const start = Number(seg.start) || 0;
    let end = Number(seg.end);
    if (!Number.isFinite(end) || end <= start) end = start + 3;
    filters.push(`[${i}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS}[vbase${i}]`);

    let label = `vbase${i}`;
    if (seg.onScreenText) {
      report(`caption seg${i} before`);
      const pngPath = path.join(capDir, `seg${i}.png`);
      renderCaptionPng(pngPath, seg.onScreenText, { y: Math.round(HEIGHT * 0.78), fontSize: fontSizeFor(seg.onScreenText) });
      report(`caption seg${i} after`);
      inputArgs.push('-loop', '1', '-i', pngPath);
      const capIdx = nextInputIdx++;
      filters.push(`[${label}][${capIdx}:v]overlay=0:0[vcap${i}]`);
      label = `vcap${i}`;
    }
    segLabels.push(label);
  });

  filters.push(`${segLabels.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=1:a=0[vconcat]`);
  let finalLabel = 'vconcat';

  if (variant.priceCard?.show && variant.priceCard.text) {
    report('caption price before');
    const pngPath = path.join(capDir, 'price.png');
    renderCaptionPng(pngPath, variant.priceCard.text, { y: Math.round(HEIGHT * 0.84), fontSize: 56, boxed: true });
    report('caption price after');
    inputArgs.push('-loop', '1', '-i', pngPath);
    const idx = nextInputIdx++;
    filters.push(`[${finalLabel}][${idx}:v]overlay=0:0[vprice]`);
    finalLabel = 'vprice';
  }
  if (variant.cta) {
    report('caption cta before');
    const pngPath = path.join(capDir, 'cta.png');
    renderCaptionPng(pngPath, variant.cta, { y: Math.round(HEIGHT * 0.92), fontSize: 54 });
    report('caption cta after');
    inputArgs.push('-loop', '1', '-i', pngPath);
    const idx = nextInputIdx++;
    filters.push(`[${finalLabel}][${idx}:v]overlay=0:0[vcta]`);
    finalLabel = 'vcta';
  }
  if (variant.hook) {
    report('caption hook before');
    const pngPath = path.join(capDir, 'hook.png');
    renderCaptionPng(pngPath, variant.hook, { y: Math.round(HEIGHT * 0.1), fontSize: 62 });
    report('caption hook after');
    inputArgs.push('-loop', '1', '-i', pngPath);
    const idx = nextInputIdx++;
    filters.push(`[${finalLabel}][${idx}:v]overlay=0:0:enable='lt(t,3)'[vhook]`);
    finalLabel = 'vhook';
  }

  const silentAudioIdx = nextInputIdx++;
  inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex', filters.join(';'),
    '-map', `[${finalLabel}]`,
    '-map', `${silentAudioIdx}:a`,
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];

  report('spawning ffmpeg');
  await runFfmpeg(args);
  report('ffmpeg done');
  return outputPath;
}

// Рендерит все варианты плана, возвращает [{variant, filename}]
export async function renderAllVariants(variants, clipsDir, outDir, onProgress) {
  const results = [];
  for (const variant of variants) {
    const filename = `output_${variant.variant}.mp4`;
    const outputPath = path.join(outDir, filename);
    await renderVariant(variant, clipsDir, outputPath, (s) => onProgress?.(`variant ${variant.variant}: ${s}`));
    results.push({ variant: variant.variant, filename });
  }
  return results;
}
