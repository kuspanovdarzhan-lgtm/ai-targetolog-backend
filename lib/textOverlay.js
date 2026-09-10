import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Roboto-Bold.ttf');
const FONT_FAMILY = 'OrbitCaption';
GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);

export const WIDTH = 1080;
export const HEIGHT = 1920;

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Рисует прозрачный PNG 1080x1920 с текстом в нужном месте кадра —
// используется для наложения через overlay-фильтр ffmpeg, т.к. в бинарнике
// ffmpeg-static отсутствует drawtext (нет libfreetype в сборке).
export function renderCaptionPng(outPath, text, { y, fontSize = 60, color = '#ffffff', boxed = false } = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = WIDTH * 0.85;
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = y - totalHeight / 2 + lineHeight / 2;

  if (boxed) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.min(widest + 80, WIDTH - 40);
    const boxH = totalHeight + 50;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, WIDTH / 2 - boxW / 2, y - boxH / 2, boxW, boxH, 18);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const ly = startY + i * lineHeight;
    if (!boxed) {
      ctx.lineWidth = Math.round(fontSize * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, WIDTH / 2, ly);
    }
    ctx.fillStyle = boxed ? '#111111' : color;
    ctx.fillText(line, WIDTH / 2, ly);
  });

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}
