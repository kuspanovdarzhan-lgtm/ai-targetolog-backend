import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf');

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

// Экранирование текста для drawtext: убираем переносы строк, экранируем
// обратный слэш и одинарную кавычку (текст обёрнут в одинарные кавычки в фильтре).
function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '’')
    .replace(/:/g, '\\:')
    .trim();
}

function fontSizeFor(text) {
  const len = String(text || '').length;
  if (len > 60) return 40;
  if (len > 40) return 48;
  if (len > 25) return 56;
  return 64;
}

function drawtextFilter(text, { size, color = 'white', y, enable }) {
  const t = escapeDrawtext(text);
  if (!t) return null;
  const parts = [
    `fontfile='${FONT_PATH}'`,
    `text='${t}'`,
    `fontsize=${size ?? fontSizeFor(text)}`,
    `fontcolor=${color}`,
    'borderw=4',
    'bordercolor=black@0.8',
    'x=(w-text_w)/2',
    `y=${y}`,
  ];
  if (enable) parts.push(`enable='${enable}'`);
  return `drawtext=${parts.join(':')}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg завершился с ошибкой (код ${code}): ${stderr.slice(-1500)}`));
    });
  });
}

// Собирает один вертикальный ролик 1080x1920 H.264 из плана монтажа.
// Оригинальный звук исходных клипов не используется в MVP (только подпись/капшены) —
// на выходе тихая звуковая дорожка, чтобы файл корректно проигрывался везде.
export async function renderVariant(variant, clipsDir, outputPath) {
  const segments = variant.clips || [];
  if (!segments.length) throw new Error('В плане нет ни одного клипа для монтажа');

  const inputArgs = [];
  segments.forEach((seg) => {
    const filePath = path.join(clipsDir, seg.source);
    if (!fs.existsSync(filePath)) throw new Error(`Файл клипа не найден: ${seg.source}`);
    inputArgs.push('-i', filePath);
  });
  const silentAudioIdx = segments.length;
  inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');

  const filters = [];
  segments.forEach((seg, i) => {
    const start = Number(seg.start) || 0;
    let end = Number(seg.end);
    if (!Number.isFinite(end) || end <= start) end = start + 3;
    let chain = `[${i}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS}`;
    const textFilter = drawtextFilter(seg.onScreenText, { y: `h-${Math.round(HEIGHT * 0.22)}` });
    if (textFilter) chain += `,${textFilter}`;
    chain += `[v${i}]`;
    filters.push(chain);
  });
  filters.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[vconcat]`);

  let finalLabel = 'vconcat';
  if (variant.priceCard?.show && variant.priceCard.text) {
    filters.push(`[${finalLabel}]${drawtextFilter(variant.priceCard.text, {
      size: 56, color: 'black', y: `h-${Math.round(HEIGHT * 0.16)}`,
    }).replace('drawtext=', 'drawtext=box=1:boxcolor=white@0.85:boxborderw=20:')}[vprice]`);
    finalLabel = 'vprice';
  }
  if (variant.cta) {
    filters.push(`[${finalLabel}]${drawtextFilter(variant.cta, { size: 58, y: `h-${Math.round(HEIGHT * 0.08)}` })}[vcta]`);
    finalLabel = 'vcta';
  }
  if (variant.hook) {
    filters.push(`[${finalLabel}]${drawtextFilter(variant.hook, { size: 68, y: Math.round(HEIGHT * 0.08), enable: 'lt(t,3)' })}[vhook]`);
    finalLabel = 'vhook';
  }

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

  await runFfmpeg(args);
  return outputPath;
}

// Рендерит все варианты плана, возвращает [{variant, filename}]
export async function renderAllVariants(variants, clipsDir, outDir) {
  const results = [];
  for (const variant of variants) {
    const filename = `output_${variant.variant}.mp4`;
    const outputPath = path.join(outDir, filename);
    await renderVariant(variant, clipsDir, outputPath);
    results.push({ variant: variant.variant, filename });
  }
  return results;
}
