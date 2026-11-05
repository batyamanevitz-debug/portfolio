/* ניהול תיק העבודות – תוכן (סרטונים, אתרים, כלים), הגדרות וסל מיחזור. */
(function () {
  'use strict';
  // חייבים לבדוק לפני יצירת החיבור: supabase-js מנקה את הכתובת מיד אחרי שהוא קורא אותה
  const cameFromRecovery = /type=recovery/.test(location.hash);
  const sb = window.supabase.createClient(Site.SUPABASE_URL, Site.SUPABASE_KEY);
  const BUCKET = 'portfolio';
  const MAX_MB = 50;
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };

  const TYPES = {
    video: { one: 'סרטון', many: 'סרטונים', icon: '🎬' },
    site: { one: 'אתר', many: 'אתרים', icon: '🌐' },
    skillgroup: { one: 'קבוצת כלים', many: 'כלים', icon: '🧰' },
  };
  const state = { user: null, entries: [], settings: {}, view: 'video', q: '', dirty: false };

  // ---------- כתובת ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.view = p.get('view') || 'video';
    return p.get('item');
  }
  function setUrl(view, item) {
    const p = new URLSearchParams();
    p.set('view', view); if (item) p.set('item', item);
    history.pushState(null, '', '?' + p.toString());
  }
  window.addEventListener('popstate', () => { const item = readUrl(); render(); if (item) openEditor(item); else closeDrawer(true); });
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- הודעות ----------
  let toastTimer;
  function toast(msg, undo) {
    const t = $('#toast'); t.innerHTML = ''; t.append(h('span', {}, msg));
    if (undo) t.append(h('button', { onclick: () => { t.hidden = true; undo(); } }, 'בטל'));
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 3000);
  }
  function confirmBox(title, text, okLabel = 'אישור', danger = false) {
    return new Promise((res) => {
      const wrap = h('div', { class: 'modal-wrap', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal' }, h('h3', {}, title), h('p', {}, text),
          h('div', { class: 'acts' },
            h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { wrap.remove(); res(true); } }, okLabel),
            h('button', { class: 'btn', onclick: () => { wrap.remove(); res(false); } }, 'ביטול'))));
      document.body.append(wrap); wrap.querySelector('button').focus();
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { wrap.remove(); res(false); } });
    });
  }
  const errText = (e) => {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login/i.test(m)) return 'המייל או הסיסמה לא נכונים.';
    if (/row-level security|permission denied|אין הרשאה/i.test(m)) return 'אין הרשאה לפעולה הזו.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'אין חיבור לאינטרנט, או ש-Supabase לא זמין. נסו שוב.';
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return `הקובץ גדול מדי (עד ${MAX_MB}MB).`;
    return m;
  };

  // ---------- כניסה ----------
  async function boot() {
    sb.auth.onAuthStateChange((ev) => {
      if (ev === 'PASSWORD_RECOVERY') showNewPassword();
      if (ev === 'SIGNED_OUT') { state.user = null; showLogin(); }
    });
    const { data } = await sb.auth.getSession();
    if (cameFromRecovery && data.session) { state.user = data.session.user; return showNewPassword(); }
    if (data.session) { state.user = data.session.user; await start(); } else showLogin();
  }
  function showLogin(msg) {
    const root = $('#root'); root.innerHTML = '';
    const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
    const pass = h('input', { type: 'password', id: 'pass', autocomplete: 'current-password', required: true, dir: 'ltr' });
    const err = h('div', { class: 'err', role: 'alert' }, msg || '');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        btn.disabled = false;
        if (error) { err.textContent = errText(error); return; }
        state.user = data.user; start();
      },
    },
      h('h1', {}, 'כניסה לניהול'), h('p', {}, 'תיק העבודות של בתיה מנביץ'),
      h('div', { class: 'field' }, h('label', { for: 'email' }, 'מייל'), email),
      h('div', { class: 'field' }, h('label', { for: 'pass' }, 'סיסמה'), pass),
      err);
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'כניסה');
    form.append(btn, h('button', {
      class: 'btn ghost', type: 'button', onclick: async () => {
        if (!email.value.trim()) { err.textContent = 'כתבו קודם את המייל.'; return; }
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
        err.textContent = error ? errText(error) : 'שלחנו קישור לאיפוס סיסמה למייל.';
      },
    }, 'שכחתי סיסמה'));
    root.append(h('div', { class: 'login' }, form)); email.focus();
  }
  function showNewPassword(fromApp) {
    const root = $('#root'); root.innerHTML = '';
    const pass = h('input', { type: 'password', id: 'np1', autocomplete: 'new-password', minlength: 8, required: true, dir: 'ltr' });
    const pass2 = h('input', { type: 'password', id: 'np2', autocomplete: 'new-password', minlength: 8, required: true, dir: 'ltr' });
    const err = h('div', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'שמירת הסיסמה');
    root.append(h('div', { class: 'login' }, h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        if (pass.value.length < 8) { err.textContent = 'הסיסמה צריכה להיות לפחות 8 תווים.'; return; }
        if (pass.value !== pass2.value) { err.textContent = 'שתי הסיסמאות לא זהות.'; return; }
        btn.disabled = true;
        const { error } = await sb.auth.updateUser({ password: pass.value });
        btn.disabled = false;
        if (error) { err.textContent = /same|different from the old/i.test(error.message) ? 'זו אותה סיסמה כמו קודם. בחרי סיסמה אחרת.' : /weak|at least/i.test(error.message) ? 'הסיסמה חלשה מדי. נסי ארוכה יותר, עם אותיות ומספרים.' : errText(error); return; }
        history.replaceState(null, '', location.pathname);
        const { data } = await sb.auth.getUser(); state.user = data.user;
        await start(); toast('✓ הסיסמה שונתה');
      },
    }, h('h1', {}, 'סיסמה חדשה'), h('p', {}, 'לפחות 8 תווים, עם אותיות ומספרים.'),
      h('div', { class: 'field' }, h('label', { for: 'np1' }, 'סיסמה חדשה'), pass),
      h('div', { class: 'field' }, h('label', { for: 'np2' }, 'שוב, לאימות'), pass2),
      err, btn,
      fromApp ? h('button', { class: 'btn ghost', type: 'button', onclick: () => render() }, 'ביטול') : null)));
    pass.focus();
  }

  // ---------- נתונים ----------
  async function load() {
    const [e, s] = await Promise.all([
      sb.from('pf_entries').select('*').order('sort').order('id'),
      sb.from('pf_settings').select('*'),
    ]);
    if (e.error) throw e.error; if (s.error) throw s.error;
    state.entries = e.data; state.settings = {};
    s.data.forEach((r) => (state.settings[r.key] = r.value));
  }
  async function start() {
    try {
      const { data: ok, error } = await sb.rpc('pf_is_admin');
      if (error) throw error;
      if (!ok) { await sb.auth.signOut(); return showLogin('למשתמש הזה אין הרשאת ניהול.'); }
      await load();
    } catch (e) { return showLogin(errText(e)); }
    const item = readUrl(); render(); if (item) openEditor(item);
  }

  // ---------- שלד ----------
  function render() {
    const root = $('#root'); root.innerHTML = '';
    const count = (t) => state.entries.filter((e) => e.type === t && e.status !== 'trash').length;
    const trashN = state.entries.filter((e) => e.status === 'trash').length;
    const nav = (view, icon, label, n) => h('button', { class: 'nav' + (state.view === view ? ' on' : ''), onclick: () => { side.classList.remove('open'); go(view); } },
      h('span', { 'aria-hidden': 'true' }, icon), label, n != null ? h('span', { class: 'count' }, String(n)) : null);
    const side = h('aside', { class: 'side' },
      h('div', { class: 'brand' }, 'תיק עבודות · ניהול'),
      h('div', { class: 'group' }, 'תוכן'),
      nav('video', '🎬', 'סרטונים', count('video')), nav('site', '🌐', 'אתרים', count('site')), nav('skillgroup', '🧰', 'כלים', count('skillgroup')),
      h('div', { class: 'group' }, 'תוכן האתר'),
      h('button', { class: 'nav', onclick: () => (location.href = 'editor.html') }, h('span', {}, '🎨'), 'עורך העמוד'),
      h('div', { class: 'group' }, 'ניהול'),
      nav('settings', '⚙️', 'הגדרות'), nav('trash', '🗑️', 'סל המיחזור', trashN),
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn', href: './', target: '_blank', rel: 'noopener' }, 'צפייה באתר ↗'),
      h('div', { class: 'me' }, state.user.email),
      h('button', { class: 'btn ghost', onclick: () => showNewPassword(true) }, '🔑 שינוי סיסמה'),
      h('button', { class: 'btn ghost', onclick: () => sb.auth.signOut() }, 'יציאה'));
    const main = h('main', { class: 'main' });
    root.append(h('div', { class: 'app' }, side, h('div', {},
      h('div', { class: 'mobile-bar' }, h('button', { class: 'icon-btn', 'aria-label': 'תפריט', onclick: () => side.classList.toggle('open') }, '☰'), h('b', {}, 'תיק עבודות · ניהול')),
      main)));
    if (TYPES[state.view]) renderList(main, state.view);
    else if (state.view === 'trash') renderTrash(main);
    else if (state.view === 'settings') renderSettings(main);
  }
  function go(view) { if (state.dirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return; state.dirty = false; state.view = view; setUrl(view); closeDrawer(true); render(); }

  // ---------- רשימות ----------
  function thumbOf(e) { return e.data.poster || ''; }
  function statusTag(e) { return e.status === 'publish' ? h('span', { class: 'tag ok' }, 'מוצג') : h('span', { class: 'tag off' }, 'מוסתר'); }
  function renderList(main, type) {
    const T = TYPES[type];
    main.append(h('div', { class: 'topbar' },
      h('div', {}, h('div', { class: 'crumbs' }, 'תוכן'), h('h2', {}, T.many)),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => newItem(type) }, '+ ' + T.one + ' חדש' + (type === 'skillgroup' ? 'ה' : ''))));
    const search = h('input', { type: 'search', placeholder: 'חיפוש לפי שם…', value: state.q, oninput: (e) => { state.q = e.target.value; draw(); } });
    main.append(h('div', { class: 'filters' }, search, h('span', { class: 'hint', style: 'color:var(--muted);font-size:13px' }, 'גוררים כרטיס כדי לשנות את הסדר באתר')));
    const grid = h('div', { class: 'grid' });
    main.append(grid);
    function draw() {
      grid.innerHTML = '';
      const items = state.entries.filter((e) => e.type === type && e.status !== 'trash').sort((a, b) => a.sort - b.sort);
      const shown = items.filter((e) => !state.q || (e.data.title || '').includes(state.q));
      if (!items.length) {
        grid.replaceWith(Object.assign(h('div', { class: 'empty' }, h('div', {}, `עוד אין ${T.many}.`), h('button', { class: 'btn primary', onclick: () => newItem(type) }, '+ הוספה')), {}));
        return;
      }
      if (!shown.length) grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'לא נמצא כלום בחיפוש.'));
      shown.forEach((e) => grid.append(cardFor(e, items)));
    }
    draw();
  }
  function cardFor(e, items) {
    const th = thumbOf(e);
    const card = h('div', { class: 'card', draggable: 'true', 'data-id': e.id, tabindex: '0', onkeydown: (ev) => { if (ev.key === 'Enter') openEditor(e.id); } },
      e.type === 'skillgroup'
        ? h('div', { class: 'body' }, h('div', { class: 'title' }, e.data.title || '(בלי שם)'), h('div', { class: 'chips' }, (e.data.tags || []).map((t) => h('span', { class: 'tag' }, t))), h('div', { class: 'meta' }, statusTag(e)))
        : [h('div', { class: 'thumb' + (th ? '' : ' none'), style: th ? `background-image:url("${encodeURI(th)}")` : '' }, th ? '' : 'אין תמונה'),
          h('div', { class: 'body' }, h('div', { class: 'title' }, e.data.title || '(בלי שם)'),
            h('div', { class: 'meta' }, statusTag(e), e.data.featured ? h('span', { class: 'tag star' }, '★ ראשי') : null))],
      h('button', { class: 'icon-btn more', 'aria-label': 'פעולות', onclick: (ev) => { ev.stopPropagation(); openMenu(ev.currentTarget, e); } }, '⋯'));
    card.addEventListener('click', () => openEditor(e.id));
    // גרירה לסידור
    card.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', e.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (ev) => { ev.preventDefault(); card.classList.add('drop-before'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
    card.addEventListener('drop', async (ev) => {
      ev.preventDefault(); card.classList.remove('drop-before');
      const fromId = ev.dataTransfer.getData('text/plain'); if (fromId === e.id) return;
      const order = items.map((x) => x.id).filter((id) => id !== fromId);
      order.splice(order.indexOf(e.id), 0, fromId);
      await saveOrder(order);
    });
    return card;
  }
  async function saveOrder(order) {
    const changed = order.map((id, i) => ({ id, i })).filter(({ id, i }) => state.entries.find((x) => x.id === id).sort !== i);
    changed.forEach(({ id, i }) => (state.entries.find((x) => x.id === id).sort = i));
    render();
    const res = await Promise.all(changed.map(({ id, i }) => sb.from('pf_entries').update({ sort: i, updated_at: new Date().toISOString() }).eq('id', id)));
    const bad = res.find((r) => r.error);
    toast(bad ? errText(bad.error) : '✓ הסדר נשמר');
  }
  function openMenu(anchor, e) {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    const r = anchor.getBoundingClientRect();
    const m = h('div', { class: 'menu', role: 'menu', style: `top:${r.bottom + 4}px;left:${Math.max(8, r.left)}px` },
      h('button', { onclick: () => { m.remove(); openEditor(e.id); } }, 'עריכה'),
      h('button', { onclick: () => { m.remove(); setStatus(e, e.status === 'publish' ? 'hidden' : 'publish'); } }, e.status === 'publish' ? 'הסתרה מהאתר' : 'הצגה באתר'),
      h('button', { onclick: () => { m.remove(); duplicate(e); } }, 'שכפול'),
      h('button', { class: 'danger', onclick: () => { m.remove(); trash(e); } }, 'מחיקה'));
    document.body.append(m);
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
  }
  async function setStatus(e, status, silent) {
    if (e.status === 'publish' && status === 'hidden' && !silent && !(await confirmBox('להסתיר מהאתר?', `"${e.data.title}" לא יוצג באתר עד שתחזירו אותו.`, 'הסתרה'))) return;
    const prev = e.status;
    const { data, error } = await sb.from('pf_entries').update({ status, revision: e.revision + 1, updated_at: new Date().toISOString() }).eq('id', e.id).eq('revision', e.revision).select();
    if (error) return toast(errText(error));
    if (!data.length) return toast('התוכן השתנה בחלון אחר. רעננו את העמוד.');
    Object.assign(e, data[0]); render();
    return prev;
  }
  async function trash(e) {
    if (!(await confirmBox('למחוק?', `"${e.data.title}" יעבור לסל המיחזור, ואפשר יהיה לשחזר אותו.`, 'מחיקה', true))) return;
    const prev = e.status;
    const { data, error } = await sb.from('pf_entries').update({ status: 'trash', data: { ...e.data, _prevStatus: prev }, revision: e.revision + 1, updated_at: new Date().toISOString() }).eq('id', e.id).eq('revision', e.revision).select();
    if (error || !data.length) return toast(error ? errText(error) : 'התוכן השתנה בחלון אחר. רעננו את העמוד.');
    Object.assign(e, data[0]); render();
    toast('הועבר לסל המיחזור', () => restore(e));
  }
  async function restore(e) {
    const back = e.data._prevStatus === 'publish' ? 'publish' : 'hidden';
    const d = { ...e.data }; delete d._prevStatus;
    const { data, error } = await sb.from('pf_entries').update({ status: back, data: d, revision: e.revision + 1, updated_at: new Date().toISOString() }).eq('id', e.id).select();
    if (error) return toast(errText(error));
    Object.assign(e, data[0]); render(); toast('✓ שוחזר');
  }
  async function duplicate(e) {
    const copy = { id: newId(e.type), type: e.type, status: 'hidden', sort: maxSort(e.type) + 1, data: { ...e.data, title: (e.data.title || '') + ' (עותק)', featured: false } };
    const { data, error } = await sb.from('pf_entries').insert(copy).select();
    if (error) return toast(errText(error));
    state.entries.push(data[0]); render(); toast('✓ נוצר עותק (מוסתר)');
  }
  const newId = (type) => `${type}-${crypto.randomUUID().slice(0, 8)}`;
  const maxSort = (type) => Math.max(-1, ...state.entries.filter((x) => x.type === type).map((x) => x.sort));

  function renderTrash(main) {
    main.append(h('div', { class: 'topbar' }, h('div', {}, h('div', { class: 'crumbs' }, 'ניהול'), h('h2', {}, 'סל המיחזור'))));
    const items = state.entries.filter((e) => e.status === 'trash');
    if (!items.length) { main.append(h('div', { class: 'empty' }, 'הסל ריק. פריט שמוחקים מגיע לכאן, ואפשר לשחזר אותו.')); return; }
    const grid = h('div', { class: 'grid' });
    items.forEach((e) => grid.append(h('div', { class: 'card', style: 'cursor:default' },
      e.type !== 'skillgroup' ? h('div', { class: 'thumb' + (thumbOf(e) ? '' : ' none'), style: thumbOf(e) ? `background-image:url("${encodeURI(thumbOf(e))}")` : '' }) : null,
      h('div', { class: 'body' }, h('div', { class: 'title' }, e.data.title || '(בלי שם)'), h('div', { class: 'meta' }, h('span', { class: 'tag' }, TYPES[e.type].one)),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => restore(e) }, 'שחזור'),
          h('button', { class: 'btn danger', onclick: () => destroy(e) }, 'מחיקה לתמיד'))))));
    main.append(grid);
  }
  async function destroy(e) {
    if (!(await confirmBox('למחוק לתמיד?', `"${e.data.title}" יימחק ואי אפשר יהיה לשחזר אותו. הקבצים שהועלו נשארים בתיקיית הקבצים.`, 'מחיקה לתמיד', true))) return;
    const { error } = await sb.from('pf_entries').delete().eq('id', e.id);
    if (error) return toast(errText(error));
    state.entries = state.entries.filter((x) => x !== e); render(); toast('נמחק');
  }

  // ---------- העלאת קבצים ----------
  const OK_TYPES = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  async function upload(file, folder, onProgress) {
    const ext = OK_TYPES[file.type];
    if (!ext) throw new Error('סוג הקובץ לא נתמך. אפשר: MP4, JPG, PNG, WEBP, PDF.');
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`הקובץ גדול מדי (עד ${MAX_MB}MB).`);
    const path = `${folder}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    onProgress && onProgress(15);
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (error) throw error;
    onProgress && onProgress(100);
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  // תמונת כיסוי אוטומטית: פריים מהשנייה הראשונה
  function posterFromVideo(file) {
    return new Promise((res, rej) => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); });
      v.addEventListener('seeked', () => {
        const w = Math.min(720, v.videoWidth), hh = Math.round(w * v.videoHeight / v.videoWidth);
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        c.getContext('2d').drawImage(v, 0, 0, w, hh);
        c.toBlob((b) => { URL.revokeObjectURL(v.src); b ? res(new File([b], 'poster.jpg', { type: 'image/jpeg' })) : rej(new Error('לא הצלחתי ליצור תמונת כיסוי')); }, 'image/jpeg', 0.85);
      }, { once: true });
      v.addEventListener('error', () => rej(new Error('לא הצלחתי לקרוא את הסרטון')));
    });
  }

  // ---------- פקדים ----------
  function field(label, input, hint) { return h('div', { class: 'field' }, typeof label === 'string' ? h('label', {}, label) : label, input, hint ? h('div', { class: 'hint' }, hint) : null); }
  function textInput(obj, key, opts = {}) {
    const el = h(opts.multi ? 'textarea' : 'input', { type: opts.type || 'text', dir: opts.ltr ? 'ltr' : null, placeholder: opts.placeholder || '' });
    el.value = obj[key] || ''; el.addEventListener('input', () => { obj[key] = el.value; markDirty(); }); return el;
  }
  function switchInput(obj, key, label, onchange) {
    const cb = h('input', { type: 'checkbox' }); cb.checked = !!obj[key];
    cb.addEventListener('change', () => { obj[key] = cb.checked; markDirty(); onchange && onchange(cb.checked); });
    return h('label', { class: 'switch' }, cb, label);
  }
  function segInput(obj, key, options) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup' });
    const draw = () => { wrap.innerHTML = ''; options.forEach((o) => wrap.append(h('button', { type: 'button', class: obj[key] === o ? 'on' : '', 'aria-pressed': obj[key] === o ? 'true' : 'false', onclick: () => { obj[key] = o; markDirty(); draw(); } }, o))); };
    if (!obj[key]) obj[key] = options[0]; draw(); return wrap;
  }
  function chipsInput(obj, key) {
    obj[key] = obj[key] || [];
    const wrap = h('div', { class: 'chips-edit' });
    const input = h('input', { placeholder: 'כותבים ולוחצים Enter' });
    let dragI = null;
    const draw = () => {
      wrap.innerHTML = '';
      obj[key].forEach((t, i) => {
        const chip = h('span', { class: 'chip', draggable: 'true' }, t, h('button', { type: 'button', 'aria-label': 'הסרת ' + t, onclick: () => { obj[key].splice(i, 1); markDirty(); draw(); } }, '×'));
        chip.addEventListener('dragstart', () => (dragI = i));
        chip.addEventListener('dragover', (e) => e.preventDefault());
        chip.addEventListener('drop', () => { if (dragI == null) return; const [x] = obj[key].splice(dragI, 1); obj[key].splice(i, 0, x); dragI = null; markDirty(); draw(); });
        wrap.append(chip);
      });
      wrap.append(input);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = input.value.trim(); if (v) { obj[key].push(v); input.value = ''; markDirty(); draw(); input.focus(); } }
      if (e.key === 'Backspace' && !input.value && obj[key].length) { obj[key].pop(); markDirty(); draw(); input.focus(); }
    });
    draw(); return wrap;
  }
  function mediaInput(obj, opts) {
    // opts: { videoKey, posterKey, folder, accept }
    const pv = h('div', { class: 'pv' });
    const bar = h('div', { class: 'progress hidden' }, h('div', {}));
    const msg = h('div', { class: 'hint' });
    const drawPv = () => { const p = obj[opts.posterKey]; pv.className = 'pv' + (p ? '' : ' none'); pv.style.backgroundImage = p ? `url("${encodeURI(p)}")` : ''; };
    const prog = (n) => { bar.classList.toggle('hidden', n >= 100); bar.firstChild.style.width = n + '%'; };
    const pick = (accept, cb) => { const f = h('input', { type: 'file', accept }); f.addEventListener('change', () => f.files[0] && cb(f.files[0])); f.click(); };
    const onVideo = async (file) => {
      try {
        msg.textContent = 'מעלה סרטון…'; prog(5);
        const poster = await posterFromVideo(file).catch(() => null);
        obj[opts.videoKey] = await upload(file, opts.folder, prog);
        if (poster) { msg.textContent = 'יוצר תמונת כיסוי…'; obj[opts.posterKey] = await upload(poster, opts.folder + '/posters'); }
        msg.textContent = '✓ הסרטון הועלה'; markDirty(); drawPv();
      } catch (e) { prog(100); msg.textContent = errText(e); }
    };
    const onPoster = async (file) => {
      try { msg.textContent = 'מעלה תמונה…'; obj[opts.posterKey] = await upload(file, opts.folder + '/posters', prog); msg.textContent = '✓ התמונה הוחלפה'; markDirty(); drawPv(); }
      catch (e) { prog(100); msg.textContent = errText(e); }
    };
    drawPv();
    return h('div', { class: 'media-pick' }, pv, h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn', onclick: () => pick('video/mp4', onVideo) }, obj[opts.videoKey] ? 'החלפת סרטון' : 'העלאת סרטון (MP4)'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => pick('image/jpeg,image/png,image/webp', onPoster) }, 'החלפת תמונת כיסוי'),
      bar, msg,
      h('div', { class: 'hint' }, 'עד 50MB. תמונת הכיסוי נוצרת לבד מהסרטון.')));
  }

  // ---------- מגירת עריכה ----------
  let drawerEl = null;
  function markDirty() { state.dirty = true; const s = $('.savebar'); if (s) { s.textContent = 'יש שינויים שלא נשמרו'; s.className = 'savebar'; } }
  function closeDrawer(force) {
    if (!force && state.dirty && !window.confirm('יש שינויים שלא נשמרו. לסגור בלי לשמור?')) return false;
    state.dirty = false; drawerEl && drawerEl.remove(); drawerEl = null; return true;
  }
  function newItem(type) {
    const base = { video: { title: '', description: '' }, site: { title: '', description: '', href: '', cta: 'לאתר ←' }, skillgroup: { title: '', tags: [] } }[type];
    openEditor(null, { id: newId(type), type, status: 'publish', sort: maxSort(type) + 1, data: base, revision: 0, _new: true });
  }
  function openEditor(id, fresh) {
    const e = fresh || state.entries.find((x) => x.id === id);
    if (!e) return;
    if (drawerEl) closeDrawer(true);
    if (!fresh) setUrl(state.view, e.id);
    const d = JSON.parse(JSON.stringify(e.data));
    const T = TYPES[e.type];
    const errs = h('div', { class: 'err', role: 'alert' });
    const content = h('div', { class: 'content' });
    if (e.type === 'video') {
      content.append(
        field('שם הסרטון', textInput(d, 'title')),
        field('תיאור', textInput(d, 'description', { multi: true }), 'שורה או שתיים: מה זה ומה עשית.'),
        h('div', { class: 'field' }, h('div', { class: 'label' }, 'הסרטון'), mediaInput(d, { videoKey: 'video', posterKey: 'poster', folder: 'videos' })),
        h('div', { class: 'section-box' }, h('h4', {}, 'קישור (לא חובה)'),
          h('div', { class: 'row2' }, field('כתובת', textInput(d.link = d.link || {}, 'href', { type: 'url', ltr: true, placeholder: 'https://youtube.com/…' })), field('טקסט הקישור', textInput(d.link, 'label', { placeholder: 'ביוטיוב ←' })))));
      const featBox = h('div', { class: 'section-box' + (d.featured ? '' : ' hidden') }, h('h4', {}, 'מה מוצג בסרטון הראשי'),
        field('תגית', textInput(d, 'badge', { placeholder: 'סרטון תדמית' })),
        field('ציטוט', textInput(d, 'quote', { placeholder: '"האתר שלך הוצאה? השקעה."' }), 'מילה בזהב: <span class="gold">מילה</span>'),
        field(h('div', { class: 'label' }, 'תגיות'), chipsInput(d, 'tags')));
      content.append(field(h('div', { class: 'label' }, 'סרטון ראשי'), switchInput(d, 'featured', 'להציג בגדול בראש אזור הסרטונים', (on) => featBox.classList.toggle('hidden', !on)), 'רק סרטון אחד יכול להיות ראשי. אם תדליקו כאן, הקודם יחזור לרשת.'), featBox);
    } else if (e.type === 'site') {
      content.append(
        field('שם האתר', textInput(d, 'title')),
        field('תיאור', textInput(d, 'description', { multi: true })),
        field('כתובת האתר', textInput(d, 'href', { type: 'url', ltr: true, placeholder: 'https://…' })),
        field(h('div', { class: 'label' }, 'טקסט הכפתור'), segInput(d, 'cta', ['לאתר ←', 'למערכת ←', 'לכלי ←'])),
        h('div', { class: 'field' }, h('div', { class: 'label' }, 'סרטון גלילה'), mediaInput(d, { videoKey: 'video', posterKey: 'poster', folder: 'sites' })));
      const featSite = h('div', { class: 'section-box' + (d.featured ? '' : ' hidden') }, h('h4', {}, 'מה מוצג באתר הראשי'),
        field('תגית', textInput(d, 'badge', { placeholder: 'אתר תדמית' })),
        field('משפט מודגש (לא חובה)', textInput(d, 'quote'), 'מילה בזהב: <span class="gold">מילה</span>'),
        field(h('div', { class: 'label' }, 'תגיות'), chipsInput(d, 'tags')));
      content.append(field(h('div', { class: 'label' }, 'אתר ראשי'), switchInput(d, 'featured', 'להציג בגדול בראש אזור האתרים', (on) => featSite.classList.toggle('hidden', !on)), 'רק אתר אחד יכול להיות ראשי. אם תדליקו כאן, הקודם יחזור לרשת.'), featSite);
    } else {
      content.append(field('שם הקבוצה', textInput(d, 'title')), field(h('div', { class: 'label' }, 'כלים'), chipsInput(d, 'tags'), 'גוררים כדי לסדר. Backspace מוחק את האחרון.'));
    }
    const statusBox = { on: e.status === 'publish' };
    content.append(field(h('div', { class: 'label' }, 'באתר'), switchInput(statusBox, 'on', 'מוצג באתר')));
    content.append(errs);

    const savebar = h('span', { class: 'savebar' }, e._new ? 'חדש – עוד לא נשמר' : '');
    const saveBtn = h('button', { class: 'btn primary', onclick: save }, 'שמירה');
    drawerEl = h('div', {},
      h('div', { class: 'scrim', onclick: () => closeDrawer() && setUrl(state.view) }),
      h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': (e._new ? 'הוספת ' : 'עריכת ') + T.one },
        h('header', {}, h('h3', {}, (e._new ? T.one + ' חדש' + (e.type === 'skillgroup' ? 'ה' : '') : d.title || T.one)), h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: () => closeDrawer() && setUrl(state.view) }, '✕')),
        content,
        h('footer', {}, saveBtn, savebar, h('div', { class: 'grow' }),
          !e._new ? h('button', { class: 'btn danger', onclick: () => { closeDrawer(true); setUrl(state.view); trash(e); } }, 'מחיקה') : null)));
    document.body.append(drawerEl);
    drawerEl.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeDrawer() && setUrl(state.view); if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); save(); } });
    (content.querySelector('input,textarea') || saveBtn).focus();

    async function save() {
      errs.textContent = '';
      if (!String(d.title || '').trim()) { errs.textContent = 'חסר שם.'; return; }
      if (e.type === 'site' && !Site.safeUrl(d.href)) { errs.textContent = 'כתובת האתר לא תקינה (צריכה להתחיל ב-https://).'; return; }
      if (e.type === 'video' && d.link && d.link.href && !Site.safeUrl(d.link.href)) { errs.textContent = 'כתובת הקישור לא תקינה.'; return; }
      if ((e.type === 'video' || e.type === 'site') && !d.video) { errs.textContent = 'צריך להעלות סרטון.'; return; }
      if (d.link && !d.link.href) delete d.link;
      saveBtn.disabled = true; savebar.textContent = 'שומר…'; savebar.className = 'savebar';
      const status = statusBox.on ? 'publish' : 'hidden';
      let res;
      if (e._new) res = await sb.from('pf_entries').insert({ id: e.id, type: e.type, status, sort: e.sort, data: d }).select();
      else res = await sb.from('pf_entries').update({ data: d, status, revision: e.revision + 1, updated_at: new Date().toISOString() }).eq('id', e.id).eq('revision', e.revision).select();
      saveBtn.disabled = false;
      if (res.error) { savebar.textContent = errText(res.error); savebar.className = 'savebar err'; return; }
      if (!res.data.length) { savebar.textContent = 'התוכן השתנה בחלון אחר. רעננו את העמוד.'; savebar.className = 'savebar err'; return; }
      const saved = res.data[0];
      if (e._new) { state.entries.push(saved); delete e._new; Object.assign(e, saved); setUrl(state.view, e.id); } else Object.assign(e, saved);
      // סרטון ראשי / אתר ראשי – אחד בלבד
      if ((e.type === 'video' || e.type === 'site') && d.featured) {
        const others = state.entries.filter((x) => x.type === e.type && x.id !== e.id && x.data.featured);
        for (const o of others) {
          const r = await sb.from('pf_entries').update({ data: { ...o.data, featured: false }, revision: o.revision + 1 }).eq('id', o.id).select();
          if (!r.error && r.data[0]) Object.assign(o, r.data[0]);
        }
      }
      state.dirty = false; savebar.textContent = '✓ נשמר – מופיע באתר'; savebar.className = 'savebar ok';
      render();
    }
  }

  // ---------- הגדרות ----------
  function renderSettings(main) {
    const contact = { whatsapp: '', phone: '', email: '', ...(state.settings.contact || {}) };
    const cv = { url: '', ...(state.settings.cv || {}) };
    const seo = { title: '', description: '', image: '', ...(state.settings.seo || {}) };
    const msg = h('span', { class: 'savebar' });
    const counter = (obj, key, max) => { const c = h('span', { class: 'counter' }); const upd = () => { const n = (obj[key] || '').length; c.textContent = `${n}/${max}`; c.classList.toggle('over', n > max); }; upd(); return [c, upd]; };
    const [tc, tu] = counter(seo, 'title', 60); const [dc, du] = counter(seo, 'description', 155);
    const gT = h('div', { class: 't' }), gD = h('div', { class: 'd' });
    const gUpd = () => { gT.textContent = seo.title || 'בתיה מנביץ · תיק עבודות'; gD.textContent = seo.description; tu(); du(); };
    const titleIn = textInput(seo, 'title'); titleIn.addEventListener('input', gUpd);
    const descIn = textInput(seo, 'description', { multi: true }); descIn.addEventListener('input', gUpd);
    gUpd();
    const cvMsg = h('div', { class: 'hint' }, cv.url ? 'קובץ נוכחי: ' + decodeURIComponent(cv.url.split('/').pop()) : 'אין קובץ');
    main.append(h('div', { class: 'topbar' }, h('div', {}, h('div', { class: 'crumbs' }, 'ניהול'), h('h2', {}, 'הגדרות')), h('div', { class: 'grow' }), msg,
      h('button', { class: 'btn primary', onclick: saveAll }, 'שמירה')));
    main.append(h('div', { style: 'display:grid;gap:18px;max-width:720px' },
      h('div', { class: 'section-box' }, h('h4', {}, 'פרטי קשר (מתעדכנים בכל האתר)'),
        h('div', { class: 'row2' }, field('טלפון לתצוגה', textInput(contact, 'phone', { ltr: true })), field('וואטסאפ', textInput(contact, 'whatsapp', { ltr: true }), 'בלי + ובלי 0 בהתחלה: 9725…')),
        field('מייל', textInput(contact, 'email', { type: 'email', ltr: true }))),
      h('div', { class: 'section-box' }, h('h4', {}, 'קורות חיים (הקישור בפוטר)'),
        h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: () => { const f = h('input', { type: 'file', accept: 'application/pdf' }); f.addEventListener('change', async () => { try { cvMsg.textContent = 'מעלה…'; cv.url = await upload(f.files[0], 'cv'); cvMsg.textContent = '✓ הועלה. לחצו "שמירה".'; } catch (e) { cvMsg.textContent = errText(e); } }); f.click(); } }, 'העלאת PDF חדש'),
          cv.url ? h('a', { href: cv.url, target: '_blank', rel: 'noopener' }, 'פתיחת הקובץ') : null), cvMsg),
      h('div', { class: 'section-box' }, h('h4', {}, 'קידום בגוגל ושיתוף'),
        field(h('div', { class: 'label', style: 'display:flex;justify-content:space-between' }, h('span', {}, 'כותרת'), tc), titleIn),
        field(h('div', { class: 'label', style: 'display:flex;justify-content:space-between' }, h('span', {}, 'תיאור'), dc), descIn),
        h('div', { class: 'field' }, h('div', { class: 'label' }, 'כך זה ייראה בגוגל'), h('div', { class: 'gprev' }, h('div', { class: 'u' }, 'batyamanevitz-debug.github.io › portfolio'), gT, gD)))));
    async function saveAll() {
      if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) { msg.textContent = 'המייל לא תקין.'; msg.className = 'savebar err'; return; }
      contact.whatsapp = String(contact.whatsapp || '').replace(/\D/g, '');
      msg.textContent = 'שומר…'; msg.className = 'savebar';
      const rows = [{ key: 'contact', value: contact }, { key: 'cv', value: cv }, { key: 'seo', value: seo }].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      const { error } = await sb.from('pf_settings').upsert(rows);
      if (error) { msg.textContent = errText(error); msg.className = 'savebar err'; return; }
      rows.forEach((r) => (state.settings[r.key] = r.value)); state.dirty = false;
      msg.textContent = '✓ נשמר – מופיע באתר'; msg.className = 'savebar ok';
    }
  }

  boot();
})();
