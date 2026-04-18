'use strict';

const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const fetch    = require('node-fetch');

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://gotenberg:3000';
const TMPL_DIR      = path.join(__dirname, '../../data/templates');

/**
 * Generate a PDF certificate by overlaying a name on an SVG template.
 * @param {Object} tmpl  - Template record from DB (filename, text_x, text_y, etc.)
 * @param {string} name  - Attendee name to overlay
 * @returns {Buffer}     - PDF binary buffer
 */
async function generateCertificate(tmpl, name) {
  const svgPath = path.join(TMPL_DIR, tmpl.filename);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`SVG template file not found: ${tmpl.filename}`);
  }

  const svgContent = fs.readFileSync(svgPath, 'utf8');

  // Build transform for text alignment
  const alignTransform = {
    left:   'translateX(0)',
    center: 'translateX(-50%)',
    right:  'translateX(-100%)',
  }[tmpl.text_align] || 'translateX(-50%)';

  const html = buildHtml({
    svgContent,
    name,
    x:           tmpl.text_x,
    y:           tmpl.text_y,
    fontFamily:  tmpl.font_family,
    fontSize:    tmpl.font_size,
    fontColor:   tmpl.font_color,
    fontWeight:  tmpl.font_weight,
    fontStyle:   tmpl.font_style,
    textAlign:   tmpl.text_align,
    alignTransform,
  });

  const form = new FormData();
  form.append('index.html', Buffer.from(html, 'utf8'), {
    filename: 'index.html',
    contentType: 'text/html',
  });
  // Letter size, landscape if SVG is wide
  form.append('paperWidth', '8.5');
  form.append('paperHeight', '11');
  form.append('marginTop', '0');
  form.append('marginBottom', '0');
  form.append('marginLeft', '0');
  form.append('marginRight', '0');
  form.append('printBackground', 'true');
  form.append('scale', '1');

  const response = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: 'POST',
    body:   form,
    headers: form.getHeaders(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gotenberg error ${response.status}: ${errText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildHtml({ svgContent, name, x, y, fontFamily, fontSize, fontColor,
                     fontWeight, fontStyle, textAlign, alignTransform }) {
  // Escape HTML entities in the name (except we want it to display normally)
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
  html, body { width: 100%; height: 100%; overflow: hidden; }
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-start;
  }
  .canvas svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .name-overlay {
    position: absolute;
    left: ${x}%;
    top: ${y}%;
    transform: ${alignTransform} translateY(-50%);
    font-family: "${fontFamily}", sans-serif;
    font-size: ${fontSize}px;
    color: ${fontColor};
    font-weight: ${fontWeight};
    font-style: ${fontStyle};
    text-align: ${textAlign};
    white-space: nowrap;
    line-height: 1.1;
    pointer-events: none;
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

module.exports = { generateCertificate };
