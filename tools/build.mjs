// בונה את index.html מתוך content.json – גיבוי שמוצג מיד, גם אם Supabase לא זמין.
// שימוש: node tools/build.mjs
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

const data = JSON.parse(read('content.json'));
const siteJs = read('site.js');
const ctx = { window: {}, document: { currentScript: null }, console };
vm.createContext(ctx);
vm.runInContext(siteJs, ctx);
const Site = ctx.window.Site;
const { html, css } = Site.renderPage(data);

const seo = (data.settings && data.settings.seo) || {};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssV = hash(read('site.css'));
const jsV = hash(siteJs);

const out = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(seo.title)}</title>
<meta name="description" content="${esc(seo.description)}">
<meta property="og:title" content="${esc(seo.title)}">
<meta property="og:description" content="${esc(seo.description)}">
<meta property="og:image" content="${esc(seo.image)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23140d07' stroke='%23d4af37' stroke-width='4'/%3E%3Ctext x='32' y='43' font-size='30' font-weight='900' text-anchor='middle' fill='%23d4af37' font-family='Arial'%3EB%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css?v=${cssV}">
<style id="node-css">${css}</style>
</head>
<body>
<!-- נבנה אוטומטית מ-content.json (tools/build.mjs). לעריכה: admin.html -->
<div id="app" data-prerendered="1">${html}</div>

<!-- חלון צפייה גדול -->
<div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-label="צפייה בסרטון בגדול">
  <button class="lb-close" id="lbClose" type="button" aria-label="סגירה">✕</button>
  <video id="lbVideo" controls playsinline></video>
</div>
<script>window.__STAMP__=${JSON.stringify(data.stamp || '')};</script>
<script src="site.js?v=${jsV}" data-boot="public"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('index.html built', (out.length / 1024).toFixed(1) + 'KB');
