'use strict';

const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const fetch    = require('node-fetch');

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://gotenberg:3000';
const TMPL_DIR      = path.join(__dirname, '../../data/templates');

/**
 * Parse SVG dimensions from viewBox or width/height attributes.
 * Returns { widthIn, heightIn } in inches for Gotenberg.
 *
 * Strategy (in priority order):
 *  1. viewBox="x y w h" — most reliable, used by design tools
 *  2. width/height attributes with unit (mm, cm, px, pt)
 *  3. width/height as bare numbers (assumed px at 96dpi)
 *  4. Default: Letter 8.5 × 11 inches
 *
 * Gotenberg/Chromium renders at 96 DPI by default.
 * 1 inch = 96px, 1 inch = 25.4mm, 1 inch = 72pt
 */
function parseSvgDimensions(svgContent) {
  // 1. Try viewBox
  const vbMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      // viewBox units are user units (px by default unless transform applied)
      const w = parts[2];
      const h = parts[3];
      return { widthIn: +(w / 96).toFixed(4), heightIn: +(h / 96).toFixed(4), source: 'viewBox' };
    }
  }

  // 2. Try explicit width/height with units
  const wMatch = svgContent.match(/\bwidth=["']([^"']+)["']/i);
  const hMatch = svgContent.match(/\bheight=["']([^"']+)["']/i);
  if (wMatch && hMatch) {
    const parse = (val) => {
      const m = val.trim().match(/^([\d.]+)(mm|cm|in|pt|px)?$/i);
      if (!m) return null;
      const n = parseFloat(m[1]);
      const u = (m[2] || 'px').toLowerCase();
      const toIn = { px: 1/96, mm: 1/25.4, cm: 1/2.54, in: 1, pt: 1/72 };
      return n * (toIn[u] || 1/96);
    };
    const w = parse(wMatch[1]);
    const h = parse(hMatch[1]);
    if (w && h && w > 0 && h > 0) {
      return { widthIn: +w.toFixed(4), heightIn: +h.toFixed(4), source: 'width/height' };
    }
  }

  // 3. Default: US Letter landscape (common for certificates)
  return { widthIn: 11, heightIn: 8.5, source: 'default-letter-landscape' };
}

/**
 * Generate a PDF certificate by overlaying a name on an SVG template.
 * @param {Object} tmpl  - Template record from DB
 * @param {string} name  - Attendee name to overlay
 * @returns {{ buffer: Buffer, sizeKb: number, dimensions: Object }}
 */
async function generateCertificate(tmpl, name) {
  const svgPath = path.join(TMPL_DIR, tmpl.filename);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`SVG template file not found: ${tmpl.filename}`);
  }

  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const dims       = parseSvgDimensions(svgContent);

  const alignTransform = {
    left:   'translateX(0)',
    center: 'translateX(-50%)',
    right:  'translateX(-100%)',
  }[tmpl.text_align] || 'translateX(-50%)';

  const html = buildHtml({ svgContent, name, alignTransform, tmpl });

  const form = new FormData();
  form.append('index.html', Buffer.from(html, 'utf8'), {
    filename: 'index.html',
    contentType: 'text/html',
  });

  // Exact SVG dimensions → no white space, smaller file
  form.append('paperWidth',  String(dims.widthIn));
  form.append('paperHeight', String(dims.heightIn));
  form.append('marginTop',    '0');
  form.append('marginBottom', '0');
  form.append('marginLeft',   '0');
  form.append('marginRight',  '0');
  form.append('printBackground', 'true');
  form.append('scale', '1');
  // Avoid PDF/A (embeds ICC profiles, adds ~100-200KB unnecessary overhead)
  // No pdfa flag = regular PDF, smaller size

  const response = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method:  'POST',
    body:    form,
    headers: form.getHeaders(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gotenberg error ${response.status}: ${errText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    sizeKb:     Math.round(buffer.length / 1024),
    dimensions: dims,
  };
}

function buildHtml({ svgContent, name, alignTransform, tmpl }) {
  const safeName = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    display: block;
  }
  .canvas svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .name-overlay {
    position: absolute;
    left: ${tmpl.text_x}%;
    top: ${tmpl.text_y}%;
    transform: ${alignTransform} translateY(-50%);
    font-family: "${tmpl.font_family}", sans-serif;
    font-size: ${tmpl.font_size}px;
    color: ${tmpl.font_color};
    font-weight: ${tmpl.font_weight};
    font-style: ${tmpl.font_style};
    text-align: ${tmpl.text_align};
    white-space: nowrap;
    line-height: 1.1;
  }
</style>
</head>
<body>
<div class="canvas">
${svgContent}
<div class="name-overlay">${safeName}</div>
</div>
</body>
</html>`;
}

/**
 * Estimate PDF file size for a campaign (for UI display).
 * @param {string} svgPath
 * @returns {{ estimatedKb: { min, max }, totalMb: { min, max }, notes: string[] }}
 */
function estimatePdfSize(svgContent) {
  const hasRasterImages = /data:image\/(png|jpeg|jpg|gif|webp)/i.test(svgContent);
  const svgSizeKb = Buffer.byteLength(svgContent, 'utf8') / 1024;

  let min, max;
  const notes = [];

  if (hasRasterImages) {
    min = Math.round(svgSizeKb * 0.8 + 50);
    max = Math.round(svgSizeKb * 1.5 + 150);
    notes.push('El SVG contiene imágenes embebidas (base64) que aumentan el tamaño del PDF.');
    notes.push('Para reducir el peso: exporta el SVG referenciando imágenes externas o usa menor resolución.');
  } else {
    // Vector-only SVG: Chromium/Gotenberg adds ~80-120KB base overhead
    min = 80;
    max = Math.max(200, Math.round(svgSizeKb * 2 + 80));
    notes.push('SVG vectorial puro — tamaño óptimo. Sin imágenes rasterizadas embebidas.');
  }

  return { estimatedKb: { min, max }, hasRasterImages, notes };
}

module.exports = { generateCertificate, parseSvgDimensions, estimatePdfSize };
