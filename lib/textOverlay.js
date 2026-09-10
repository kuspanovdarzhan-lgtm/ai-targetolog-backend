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

// Рисует PNG размером под сам текст (не во весь кадр 1080x1920 — полнокадровые
// прозрачные PNG на каждую подпись заметно увеличивают пиковую память ffmpeg при
// декодировании overlay-входов). Возвращает {x, y} — координаты для overlay-фильтра,
// где y — вертикальный ЦЕНТР текста на кадре 1080x1920.
export function renderCaptionPng(outPath, text, { y, fontSize = 60, color = '#ffffff', boxed = false } = {}) {
  const measure = createCanvas(10, 10).getContext('2d');
  measure.font = `${fontSize}px "${FONT_FAMILY}"`;

  const maxWidth = WIDTH * 0.85;
  const lines = wrapText(measure, text, maxWidth);
  const lineHeight = fontSize * 1.3;
  const textHeight = lines.length * lineHeight;
  const widest = Math.max(...lines.map((l) => measure.measureText(l).width));

  const padX = boxed ? 40 : 34;
  const padY = boxed ? 25 : 34;
  const canvasW = Math.min(Math.ceil(widest + padX * 2), WIDTH - 40);
  const canvasH = Math.ceil(textHeight + padY * 2);

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = canvasW / 2;
  const startY = canvasH / 2 - textHeight / 2 + lineHeight / 2;

  if (boxed) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, 0, 0, canvasW, canvasH, 18);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const ly = startY + i * lineHeight;
    if (!boxed) {
      ctx.lineWidth = Math.round(fontSize * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, cx, ly);
    }
    ctx.fillStyle = boxed ? '#111111' : color;
    ctx.fillText(line, cx, ly);
  });

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));

  const x = Math.round((WIDTH - canvasW) / 2);
  const overlayY = Math.round(y - canvasH / 2);
  return { x, y: overlayY, width: canvasW, height: canvasH };
}
