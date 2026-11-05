/* תיק עבודות – מרנדר עץ אלמנטים + התנהגות באתר.
   אותו קוד משמש את האתר, את בניית הגיבוי (build) ואת העורך הוויזואלי. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://touuyegybctmfdtzlbmt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_OaxEZB5EkKNvGlXk9yrY-w_6gV7zcsI';
  const BP = { tablet: 1024, mobile: 767 };

  // ---------- ניקוי ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => {
    u = String(u ?? '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|media\/)/i.test(u) || /^[\w\-./%?=&]+$/.test(u) && !/^[a-z]+:/i.test(u)) return u;
    return '';
  };
  const ID_RE = /^[a-zA-Z][\w-]{0,63}$/;
  const CLASS_RE = /^[a-zA-Z][\w-]{0,40}$/;
  const cls = (list) => (list || []).filter((c) => CLASS_RE.test(c)).join(' ');

  // HTML מותר בטקסט עשיר: b, strong, i, em, br, span (class/style מותרים), a (href/target/rel/class/download/title)
  const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'br', 'span', 'a', 'u', 's']);
  const STYLE_OK = /^(color|font-size|font-weight)$/;
  function sanitizeStyle(s) {
    return String(s || '').split(';').map((d) => d.split(':')).filter((p) => p.length === 2 && STYLE_OK.test(p[0].trim()) && /^[#\w\s.,%()-]+$/.test(p[1].trim()))
      .map((p) => p[0].trim() + ':' + p[1].trim()).join(';');
  }
  function sanitizeHtml(html) {
    // מפרק תגיות בעזרת regex פשוט: כל תגית שלא ברשימה – נמחקת; תכונות נבדקות אחת-אחת.
    return String(html ?? '').replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (m, tag, attrs) => {
      tag = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (m.startsWith('</')) return tag === 'br' ? '' : `</${tag}>`;
      const out = [];
      attrs.replace(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, name, __, v1, v2) => {
        name = name.toLowerCase(); const v = v1 ?? v2 ?? '';
        if (name === 'class') { const c = cls(v.split(/\s+/)); if (c) out.push(`class="${c}"`); }
        else if (name === 'style') { const s = sanitizeStyle(v); if (s) out.push(`style="${esc(s)}"`); }
        else if (tag === 'a' && name === 'href') { const u = safeUrl(v); if (u) out.push(`href="${esc(u)}"`); }
        else if (tag === 'a' && (name === 'target' || name === 'title' || name === 'download')) out.push(`${name}="${esc(v)}"`);
        else if (tag === 'a' && name === 'rel') out.push('rel="noopener"');
      });
      if (tag === 'a' && /target="_blank"/.test(out.join(' ')) && !out.some((a) => a.startsWith('rel='))) out.push('rel="noopener"');
      return `<${tag}${out.length ? ' ' + out.join(' ') : ''}>`;
    });
  }

  // ---------- סגנונות לפי מכשיר ----------
  const CSS_PROPS = new Set(['color', 'background-color', 'background-image', 'background', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'box-shadow', 'opacity', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
    'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'position', 'top', 'left', 'right', 'bottom', 'z-index',
    'text-decoration', 'aspect-ratio', 'object-fit', '--gap', '--cols']);
  const VAL_OK = /^[#\w\s.,%()\-+/'"!]*$/;
  function declBlock(obj) {
    return Object.entries(obj || {}).filter(([k, v]) => CSS_PROPS.has(k) && v !== '' && v != null && VAL_OK.test(String(v)) && !/url\(\s*['"]?\s*javascript/i.test(String(v)))
      .map(([k, v]) => `${k}:${v}`).join(';');
  }
  function nodeCss(node, out) {
    if (!ID_RE.test(node.id || '')) return;
    // משקל קבוע: #app + מחלקה – גובר על העיצוב הבסיסי של האתר
    const sel = `#app .n-${node.id}`;
    const st = node.style || {};
    for (const state of ['base', 'hover']) {
      const s = st[state]; if (!s) continue;
      const suf = state === 'hover' ? ':hover' : '';
      const d = declBlock(s.desktop); if (d) out.desk.push(`${sel}${suf}{${d}}`);
      const t = declBlock(s.tablet); if (t) out.tab.push(`${sel}${suf}{${t}}`);
      const m = declBlock(s.mobile); if (m) out.mob.push(`${sel}${suf}{${m}}`);
    }
    const h = node.hide || {};
    if (h.desktop) out.desk.push(`@media (min-width:${BP.tablet + 1}px){${sel}{display:none!important}}`);
    if (h.tablet) out.desk.push(`@media (min-width:${BP.mobile + 1}px) and (max-width:${BP.tablet}px){${sel}{display:none!important}}`);
    if (h.mobile) out.mob.push(`${sel}{display:none!important}`);
    (node.children || []).forEach((c) => nodeCss(c, out));
  }
  function docsCss(docs) {
    const out = { desk: [], tab: [], mob: [] };
    docs.forEach((d) => {
      if (!d) return;
      const bg = d.settings && d.settings.background;
      if (bg && d.kind === 'page') { const b = declBlock({ background: bg }); if (b) out.desk.push(`body{${b} fixed}`); }
      (d.nodes || []).forEach((n) => nodeCss(n, out));
    });
    let css = out.desk.join('\n');
    if (out.tab.length) css += `\n@media (max-width:${BP.tablet}px){${out.tab.join('')}}`;
    if (out.mob.length) css += `\n@media (max-width:${BP.mobile}px){${out.mob.join('')}}`;
    return css;
  }

  // ---------- תבניות כרטיסים (רשימות חיות) ----------
  const CARDS = {
    featured(e) {
      const d = e.data;
      return `<article class="featured" data-entry="${esc(e.id)}">
      <div class="phone"><div class="inner"><video data-zoom src="${esc(safeUrl(d.video))}" poster="${esc(safeUrl(d.poster))}" controls playsinline preload="metadata"></video></div></div>
      <div>${d.badge ? `<span class="badge">${esc(d.badge)}</span>` : ''}
        <h3>${esc(d.title)}</h3>
        ${d.quote ? `<p class="quote">${sanitizeHtml(d.quote)}</p>` : ''}
        ${d.description ? `<p class="muted">${esc(d.description)}</p>` : ''}
        ${(d.tags || []).length ? `<div class="tags">${d.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div></article>`;
    },
    video(e) {
      const d = e.data; const l = d.link || {};
      return `<article class="vcard" data-entry="${esc(e.id)}">
        <video data-zoom src="${esc(safeUrl(d.video))}" poster="${esc(safeUrl(d.poster))}" controls playsinline preload="metadata"></video>
        <h3>${esc(d.title)}</h3>
        ${d.description ? `<p class="muted">${esc(d.description)}</p>` : ''}
        ${safeUrl(l.href) ? `<div class="more"><a href="${esc(safeUrl(l.href))}" target="_blank" rel="noopener">${esc(l.label || 'לצפייה ←')}</a></div>` : ''}
      </article>`;
    },
    site(e) {
      const d = e.data;
      return `<a class="site" data-entry="${esc(e.id)}" href="${esc(safeUrl(d.href))}" target="_blank" rel="noopener">
        <video data-loop src="${esc(safeUrl(d.video))}" poster="${esc(safeUrl(d.poster))}" muted loop playsinline preload="none"></video>
        <b>${esc(d.title)}</b><span>${esc(d.description)}</span><div class="go">${esc(d.cta || 'לאתר ←')}</div>
      </a>`;
    },
    'featured-site'(e) {
      // אתר ראשי: כמו הסרטון הראשי – טלפון זהב עם סרטון הגלילה, וטקסט + כפתור
      const d = e.data;
      return `<article class="featured featured-site" data-entry="${esc(e.id)}">
      <div class="phone"><div class="inner"><video data-loop src="${esc(safeUrl(d.video))}" poster="${esc(safeUrl(d.poster))}" muted loop playsinline preload="none"></video></div></div>
      <div>${d.badge ? `<span class="badge">${esc(d.badge)}</span>` : ''}
        <h3>${esc(d.title)}</h3>
        ${d.quote ? `<p class="quote">${sanitizeHtml(d.quote)}</p>` : ''}
        ${d.description ? `<p class="muted">${esc(d.description)}</p>` : ''}
        ${(d.tags || []).length ? `<div class="tags">${d.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${safeUrl(d.href) ? `<div class="btns"><a class="btn primary" href="${esc(safeUrl(d.href))}" target="_blank" rel="noopener">${esc(d.cta || 'לאתר ←')}</a></div>` : ''}
      </div></article>`;
    },
    skillgroup(e) {
      const d = e.data;
      return `<div class="skill" data-entry="${esc(e.id)}"><h3>${esc(d.title)}</h3><div class="tags">${(d.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>`;
    },
  };
  function listEntries(data, source) {
    const all = (data.entries || []).filter((e) => e.status === 'publish');
    if (source === 'featured') return all.filter((e) => e.type === 'video' && e.data.featured).sort((a, b) => a.sort - b.sort).slice(0, 1);
    if (source === 'video') return all.filter((e) => e.type === 'video' && !e.data.featured).sort((a, b) => a.sort - b.sort);
    if (source === 'featured-site') return all.filter((e) => e.type === 'site' && e.data.featured).sort((a, b) => a.sort - b.sort).slice(0, 1);
    if (source === 'site') return all.filter((e) => e.type === 'site' && !e.data.featured).sort((a, b) => a.sort - b.sort);
    return all.filter((e) => e.type === source).sort((a, b) => a.sort - b.sort);
  }

  // ---------- רינדור עץ ----------
  function tokens(str, data) {
    const s = data.settings || {}; const c = s.contact || {};
    return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => {
      const map = { whatsapp: c.whatsapp, phone: c.phone, email: c.email, cv: (s.cv || {}).url };
      return map[k] != null ? map[k] : m;
    });
  }
  function attrsFor(node, extraCls) {
    const c = [`n-${node.id}`, cls(node.classes), extraCls].filter(Boolean).join(' ');
    let a = ` class="${c}" data-nid="${esc(node.id)}"`;
    if (node.anchor && ID_RE.test(node.anchor)) a += ` id="${node.anchor}"`;
    return a;
  }
  const SAFE_TAGS = { section: ['section', 'header', 'footer', 'nav', 'main', 'div', 'article'], container: ['div', 'header', 'nav', 'article', 'section'] };
  function pickTag(node, def) {
    const allowed = SAFE_TAGS[node.type] || [def];
    return allowed.includes(node.tag) ? node.tag : def;
  }

  function renderNode(node, data) {
    const p = node.props || {};
    const kids = () => (node.children || []).map((c) => renderNode(c, data)).join('');
    switch (node.type) {
      case 'section': { const t = pickTag(node, 'section'); return `<${t}${attrsFor(node)}>${kids()}</${t}>`; }
      case 'container': { const t = pickTag(node, 'div'); return `<${t}${attrsFor(node)}>${kids()}</${t}>`; }
      case 'heading': { const lv = Math.min(6, Math.max(1, +p.level || 2)); return `<h${lv}${attrsFor(node)}>${sanitizeHtml(tokens(p.html, data))}</h${lv}>`; }
      case 'text': { const t = p.tag === 'div' ? 'div' : 'p'; return `<${t}${attrsFor(node)}>${sanitizeHtml(tokens(p.html, data))}</${t}>`; }
      case 'button': {
        if (p.action === 'sound') return `<button type="button" data-action="sound"${attrsFor(node)}>${esc(p.text)}</button>`;
        const href = safeUrl(tokens(p.href, data));
        const extra = (p.newTab ? ' target="_blank" rel="noopener"' : '') + (p.download ? ` download="${esc(p.download)}"` : '') + (p.title ? ` title="${esc(p.title)}"` : '');
        return `<a${attrsFor(node)} href="${esc(href)}"${extra}>${esc(tokens(p.text, data))}</a>`;
      }
      case 'image': return `<img${attrsFor(node)} src="${esc(safeUrl(p.src))}" alt="${esc(p.alt)}" loading="lazy">`;
      case 'video': {
        const flags = ['playsinline', p.controls && 'controls', p.autoplay && 'autoplay', p.muted && 'muted', p.loop && 'loop', p.zoom && 'data-zoom', p.reel && 'data-reel'].filter(Boolean).join(' ');
        return `<video${attrsFor(node)} src="${esc(safeUrl(p.src))}" poster="${esc(safeUrl(p.poster))}" ${flags} preload="${p.preload === 'none' ? 'none' : 'metadata'}"></video>`;
      }
      case 'tags': return `<div${attrsFor(node, 'tags')}>${(p.items || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
      case 'menu': return `<div${attrsFor(node)}>${(p.items || []).map((it) => `<a href="${esc(safeUrl(it.href))}"${it.newTab ? ' target="_blank" rel="noopener"' : ''}>${esc(it.label)}</a>`).join('')}</div>`;
      case 'divider': return `<hr${attrsFor(node)}>`;
      case 'listing': {
        const tpl = CARDS[p.source]; if (!tpl) return '';
        const items = listEntries(data, p.source).map(tpl).join('');
        if (p.source === 'featured') return `<div${attrsFor(node)}>${items}</div>`;
        return `<div${attrsFor(node)}>${items}</div>`;
      }
      default: return '';
    }
  }

  function renderPage(data) {
    const docs = data.docs || {};
    const header = docs.header ? docs.header.nodes.map((n) => renderNode(n, data)).join('') : '';
    const main = docs.home ? docs.home.nodes.map((n) => renderNode(n, data)).join('') : '';
    const footer = docs.footer ? docs.footer.nodes.map((n) => renderNode(n, data)).join('') : '';
    return {
      html: `${header}<main id="top">${main}</main>${footer}`,
      css: docsCss([docs.header, docs.home, docs.footer]),
    };
  }

  // ---------- התנהגות (runtime) ----------
  let cleanup = [];
  function initRuntime(root, opts) {
    cleanup.forEach((f) => f()); cleanup = [];
    opts = opts || {};
    if (opts.edit) {
      // במצב עריכה: רק המראה (כפתורי הגדלה), בלי התנהגות
      root.querySelectorAll('video[data-zoom]').forEach((v) => {
        if (v.parentNode.classList.contains('zwrap')) return;
        const wrap = document.createElement('div'); wrap.className = 'zwrap';
        v.parentNode.insertBefore(wrap, v); wrap.appendChild(v);
        const btn = document.createElement('span'); btn.className = 'zoom'; btn.textContent = '⤢'; wrap.appendChild(btn);
      });
      return;
    }
    const lb = document.getElementById('lb');
    const lbVideo = document.getElementById('lbVideo');
    const lbClose = document.getElementById('lbClose');
    const reel = root.querySelector('video[data-reel]');
    const sound = root.querySelector('[data-action="sound"]');
    const muteReel = () => { if (reel) { reel.muted = true; if (sound) sound.textContent = '🔇 הפעלת סאונד'; } };
    if (sound && reel && !opts.edit) sound.addEventListener('click', () => {
      reel.muted = !reel.muted;
      if (!reel.muted) { reel.currentTime = 0; reel.play(); }
      sound.textContent = reel.muted ? '🔇 הפעלת סאונד' : '🔊 השתקה';
    });
    // ריל של אתר מתנגן רק כשהוא על המסך
    const io = new IntersectionObserver((es) => {
      for (const e of es) { const v = e.target; if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause(); }
    }, { threshold: 0.35 });
    root.querySelectorAll('video[data-loop]').forEach((v) => io.observe(v));
    cleanup.push(() => io.disconnect());
    // מפעילים סרטון – כל השאר נעצרים
    const players = root.querySelectorAll('video[controls]');
    players.forEach((v) => v.addEventListener('play', () => { players.forEach((o) => { if (o !== v) o.pause(); }); muteReel(); }));
    // הגדלה
    let lastFocus = null;
    function openBig(src, time, poster) {
      players.forEach((o) => o.pause()); muteReel();
      lastFocus = document.activeElement;
      lbVideo.src = src; lbVideo.poster = poster || ''; lbVideo.muted = false;
      lb.hidden = false; document.body.style.overflow = 'hidden';
      lbVideo.addEventListener('loadedmetadata', () => { lbVideo.currentTime = time || 0; lbVideo.play().catch(() => {}); }, { once: true });
      lbClose.focus();
    }
    function closeBig() {
      lbVideo.pause(); lbVideo.removeAttribute('src'); lbVideo.load();
      lb.hidden = true; document.body.style.overflow = ''; lastFocus?.focus();
    }
    root.querySelectorAll('video[data-zoom]').forEach((v) => {
      if (v.parentNode.classList.contains('zwrap')) return;
      const wrap = document.createElement('div'); wrap.className = 'zwrap';
      v.parentNode.insertBefore(wrap, v); wrap.appendChild(v);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'zoom'; btn.textContent = '⤢'; btn.title = 'הגדלה'; btn.setAttribute('aria-label', 'הגדלת הסרטון');
      btn.addEventListener('click', () => openBig(v.currentSrc || v.src, v === reel ? 0 : v.currentTime, v.poster));
      wrap.appendChild(btn);
    });
    if (!lb.dataset.bound) {
      lb.dataset.bound = '1';
      lbClose.addEventListener('click', closeBig);
      lb.addEventListener('click', (e) => { if (e.target === lb) closeBig(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !lb.hidden) closeBig(); });
      document.addEventListener('fullscreenerror', (e) => {
        const v = e.target;
        if (v instanceof HTMLVideoElement && v !== lbVideo) openBig(v.currentSrc || v.src, v.currentTime, v.poster);
      });
    }
  }

  function mount(data, opts) {
    const app = document.getElementById('app');
    const r = renderPage(data);
    let st = document.getElementById('node-css');
    if (!st) { st = document.createElement('style'); st.id = 'node-css'; document.head.appendChild(st); }
    st.textContent = r.css;
    app.innerHTML = r.html;
    initRuntime(app, opts);
  }

  // ---------- טעינת תוכן חי מ-Supabase ----------
  async function sb(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) throw new Error('supabase ' + res.status);
    return res.json();
  }
  async function fetchLive() {
    const [docs, entries, settings] = await Promise.all([
      sb('pf_site_docs?select=id,doc,revision&order=id'),
      sb('pf_entries?select=id,type,status,sort,data,revision,updated_at&status=eq.publish&order=sort,id'),
      sb('pf_settings?select=key,value&order=key'),
    ]);
    const data = { docs: {}, entries, settings: {}, stamp: '' };
    docs.forEach((d) => { data.docs[d.id] = d.doc; });
    settings.forEach((s) => { data.settings[s.key] = s.value; });
    data.stamp = stampOf(docs, entries, settings);
    return data;
  }
  function stampOf(docs, entries, settings) {
    return [docs.map((d) => d.id + d.revision).join(','), entries.map((e) => e.id + ':' + e.revision + ':' + e.sort).join(','), JSON.stringify(settings)].join('|');
  }

  const Site = { renderPage, renderNode, sanitizeHtml, safeUrl, docsCss, listEntries, mount, initRuntime, fetchLive, CSS_PROPS, ID_RE, SUPABASE_URL, SUPABASE_KEY, BP };
  window.Site = Site;

  // ---------- הפעלה באתר הציבורי ----------
  if (document.currentScript && document.currentScript.dataset.boot === 'public') {
    // הגיבוי כבר מרונדר בתוך העמוד (build). אחר כך בודקים אם יש ב-Supabase גרסה חדשה יותר.
    const app = document.getElementById('app');
    initRuntime(app);
    if (!SUPABASE_KEY.startsWith('__')) {
      fetchLive().then((live) => {
        if (live.stamp !== window.__STAMP__ && live.docs.home) { mount(live); if (live.settings.seo) applySeo(live.settings.seo); }
      }).catch(() => { /* Supabase לא זמין – נשארים עם הגיבוי */ });
    }
  }
  function applySeo(seo) {
    if (seo.title) document.title = seo.title;
    const m = document.querySelector('meta[name="description"]'); if (m && seo.description) m.content = seo.description;
  }
})();
