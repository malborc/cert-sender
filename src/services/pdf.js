'use strict';

const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const fetch    = require('node-fetch');
const QRCode   = require('qrcode');

// Fuentes del sistema que NO se buscan en Google Fonts
const SYSTEM_FONTS = new Set([
  'Arial', 'Georgia', 'Helvetica', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Courier New', 'Palatino', 'Garamond',
]);

// Cache en memoria: fontFamily → CSS con @font-face embebido en base64
const fontCssCache = new Map();

/**
 * Fetches Google Font CSS server-side, downloads the woff2 files,
 * and returns a <style> block with @font-face using base64 data URIs.
 * This guarantees Gotenberg/Chromium has the font without network access.
 */
async function buildEmbeddedFontStyle(fontFamily) {
  if (SYSTEM_FONTS.has(fontFamily)) return '';
  if (fontCssCache.has(fontFamily)) return fontCssCache.get(fontFamily);

  try {
    const family = fontFamily.replace(/\s+/g, '+');
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;

    // Google Fonts returns different formats based on User-Agent; request woff2
    const cssRes = await fetch(cssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    });
    if (!cssRes.ok) return '';
    let css = await cssRes.text();

    // Find all font file URLs in the CSS and replace with base64 data URIs
    const urlMatches = [...css.matchAll(/url\(([^)]+)\)/g)];
    await Promise.all(urlMatches.map(async ([full, rawUrl]) => {
      const url = rawUrl.replace(/['"]/g, '');
      try {
        const fontRes = await fetch(url);
        const buf     = Buffer.from(await fontRes.arrayBuffer());
        const b64     = buf.toString('base64');
        const fmt     = url.includes('.woff2') ? 'woff2' : url.includes('.woff') ? 'woff' : 'truetype';
        css = css.replace(full, `url(data:font/${fmt};base64,${b64})`);
      } catch { /* skip individual font variant on error */ }
    }));

    const style = `<style>\n${css}\n</style>`;
    fontCssCache.set(fontFamily, style);
    return style;
  } catch {
    return ''; // fall back to system font if anything fails
  }
}


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
  const wAttr = (svgContent.match(/\bwidth=["']([^"']+)["']/i) || [])[1] || '';
  const hAttr = (svgContent.match(/\bheight=["']([^"']+)["']/i) || [])[1] || '';

  // 1. Try explicit width/height with physical units (mm, cm, in, pt)
  //    These are unambiguous regardless of viewBox.
  const parsePhysical = (val) => {
    const m = val.trim().match(/^([\d.]+)(mm|cm|in|pt)$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const toIn = { mm: 1/25.4, cm: 1/2.54, in: 1, pt: 1/72 };
    return n * toIn[m[2].toLowerCase()];
  };
  const wPhys = parsePhysical(wAttr);
  const hPhys = parsePhysical(hAttr);
  if (wPhys && hPhys && wPhys > 0 && hPhys > 0) {
    return { widthIn: +wPhys.toFixed(4), heightIn: +hPhys.toFixed(4), source: 'physical-units' };
  }

  // 2. Try viewBox
  const vbMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      const vw = parts[2], vh = parts[3];

      // When width/height are percentages or absent, the viewBox units are a
      // coordinate space with no inherent DPI. Design tools commonly use:
      //   300 DPI → 3300×2550 = 11"×8.5" Letter landscape
      //   150 DPI → 1650×1275 = 11"×8.5"
      //    96 DPI → 1056×816  = 11"×8.5"
      //
      // Heuristic: if viewBox units >1000 AND width/height are % or absent,
      // find the smallest standard DPI that yields a plausible certificate size
      // (2"–20" on the long side).
      const wIsPercent = !wAttr || wAttr.includes('%');
      const hIsPercent = !hAttr || hAttr.includes('%');

      if ((wIsPercent || hIsPercent) && (vw > 1000 || vh > 1000)) {
        for (const dpi of [300, 200, 150, 120, 96]) {
          const wIn = vw / dpi, hIn = vh / dpi;
          const longer = Math.max(wIn, hIn);
          if (longer >= 2 && longer <= 20) {
            return { widthIn: +wIn.toFixed(4), heightIn: +hIn.toFixed(4), source: `viewBox-${dpi}dpi` };
          }
        }
      }

      // Explicit px width/height or small viewBox → standard 96 DPI interpretation
      const wIn = vw / 96, hIn = vh / 96;
      // Safety cap: if still unreasonably large, clamp to A3 landscape (16.5"×11.7")
      if (wIn > 20 || hIn > 20) {
        const scale = 16.5 / Math.max(wIn, hIn);
        return { widthIn: +(wIn * scale).toFixed(4), heightIn: +(hIn * scale).toFixed(4), source: 'viewBox-capped' };
      }
      return { widthIn: +wIn.toFixed(4), heightIn: +hIn.toFixed(4), source: 'viewBox-96dpi' };
    }
  }

  // 3. Try bare px values in width/height
  const parsePx = (val) => {
    const m = val.trim().match(/^([\d.]+)(px)?$/i);
    return m ? parseFloat(m[1]) / 96 : null;
  };
  const wPx = parsePx(wAttr), hPx = parsePx(hAttr);
  if (wPx && hPx && wPx > 0 && hPx > 0) {
    return { widthIn: +wPx.toFixed(4), heightIn: +hPx.toFixed(4), source: 'px-units' };
  }

  // 4. Default: US Letter landscape
  return { widthIn: 11, heightIn: 8.5, source: 'default-letter-landscape' };
}

/**
 * Generate a PDF certificate by overlaying a name on an SVG template.
 * @param {Object} tmpl       - Template record from DB
 * @param {string} name       - Attendee name to overlay
 * @param {string} [verifyUrl]- Full URL for QR code (optional, uses tmpl.qr_enabled)
 * @returns {{ buffer: Buffer, sizeKb: number, dimensions: Object }}
 */
const DPI = 150; // resolution for rasterization (150 Dpi = good quality, ~3× smaller than 300)

async function generateCertificate(tmpl, name, verifyUrl = null) {
  const svgPath = path.join(TMPL_DIR, tmpl.filename);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`SVG template file not found: ${tmpl.filename}`);
  }

  const displayName = tmpl.name_uppercase ? name.toUpperCase() : name;

  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const dims       = parseSvgDimensions(svgContent);

  const alignTransform = {
    left:   'translateX(0)',
    center: 'translateX(-50%)',
    right:  'translateX(-100%)',
  }[tmpl.text_align] || 'translateX(-50%)';

  const embeddedFont = await buildEmbeddedFontStyle(tmpl.font_family);

  // Generate QR code if verifyUrl is provided (caller decides; tmpl provides position/size)
  let qrDataUrl = null;
  if (verifyUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        errorCorrectionLevel: 'M',
        margin: 3,
        width: tmpl.qr_size || 80,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch (e) {
      console.error('[pdf] QR generation error:', e.message);
    }
  }

  const html = buildHtml({ svgContent, name: displayName, alignTransform, tmpl, embeddedFont, qrDataUrl });

  // ── Step 1: render HTML → PNG (rasterizes text, no editable layer) ──────
  const pxW = Math.round(dims.widthIn  * DPI);
  const pxH = Math.round(dims.heightIn * DPI);

  const screenshotForm = new FormData();
  screenshotForm.append('index.html', Buffer.from(html, 'utf8'), {
    filename: 'index.html', contentType: 'text/html',
  });
  screenshotForm.append('width',           String(pxW));
  screenshotForm.append('height',          String(pxH));
  screenshotForm.append('format',          'png');
  screenshotForm.append('omitBackground',  'false');
  screenshotForm.append('clip',            'true');

  const screenshotRes = await fetch(`${GOTENBERG_URL}/forms/chromium/screenshot/html`, {
    method: 'POST', body: screenshotForm, headers: screenshotForm.getHeaders(),
  });
  if (!screenshotRes.ok) {
    const errText = await screenshotRes.text();
    throw new Error(`Gotenberg screenshot error ${screenshotRes.status}: ${errText}`);
  }
  const pngBuffer = Buffer.from(await screenshotRes.arrayBuffer());
  const pngB64    = pngBuffer.toString('base64');

  // ── Step 2: embed PNG → PDF (exact paper size, no margins) ──────────────
  const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${dims.widthIn}in;height:${dims.heightIn}in;overflow:hidden}
img{width:100%;height:100%;display:block;object-fit:fill}</style></head>
<body><img src="data:image/png;base64,${pngB64}"></body></html>`;

  const pdfForm = new FormData();
  pdfForm.append('index.html', Buffer.from(pdfHtml, 'utf8'), {
    filename: 'index.html', contentType: 'text/html',
  });
  pdfForm.append('paperWidth',     String(dims.widthIn));
  pdfForm.append('paperHeight',    String(dims.heightIn));
  pdfForm.append('marginTop',      '0');
  pdfForm.append('marginBottom',   '0');
  pdfForm.append('marginLeft',     '0');
  pdfForm.append('marginRight',    '0');
  pdfForm.append('printBackground','true');

  const pdfRes = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: 'POST', body: pdfForm, headers: pdfForm.getHeaders(),
  });
  if (!pdfRes.ok) {
    const errText = await pdfRes.text();
    throw new Error(`Gotenberg PDF error ${pdfRes.status}: ${errText}`);
  }

  const buffer = Buffer.from(await pdfRes.arrayBuffer());
  return {
    buffer,
    sizeKb:     Math.round(buffer.length / 1024),
    dimensions: dims,
  };
}

function buildHtml({ svgContent, name, alignTransform, tmpl, embeddedFont = '', qrDataUrl = null }) {
  const safeName = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const qrBlock = qrDataUrl ? `
  <div style="position:absolute;
              left:${tmpl.qr_x}%;
              top:${tmpl.qr_y}%;
              transform:translate(-50%,-50%);
              background:white;
              border-radius:4px;
              line-height:0;">
    <img src="${qrDataUrl}"
         style="width:${tmpl.qr_size}px;
                height:${tmpl.qr_size}px;
                display:block;
                image-rendering:pixelated;" />
  </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${embeddedFont}
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
<div class="name-overlay">${safeName}</div>${qrBlock}
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

module.exports = { generateCertificate, parseSvgDimensions, estimatePdfSize, SYSTEM_FONTS };
