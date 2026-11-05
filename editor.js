/* העורך הוויזואלי: תצוגה חיה, מבנה, הוספה, אלמנט (תוכן + עיצוב לפי מכשיר), עמוד. */
(function () {
  'use strict';
  const sb = window.supabase.createClient(Site.SUPABASE_URL, Site.SUPABASE_KEY);
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
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const DOCS = ['header', 'home', 'footer'];
  const PART_NAMES = { header: 'תפריט עליון', home: 'העמוד', footer: 'פוטר' };
  const DEVICES = { desktop: { label: 'מחשב', w: 1280 }, tablet: { label: 'טאבלט', w: 834 }, mobile: { label: 'טלפון', w: 390 } };
  const DEV_ORDER = ['desktop', 'tablet', 'mobile'];
  const TYPE_NAMES = { section: 'אזור', container: 'קונטיינר', heading: 'כותרת', text: 'טקסט', button: 'כפתור', image: 'תמונה', video: 'וידאו', tags: 'תגיות', menu: 'תפריט', divider: 'קו מפריד', listing: 'רשימה' };
  const BRAND = [
    ['זהב', 'var(--gold)', '#d4af37'], ['זהב בהיר', 'var(--gold-l)', '#f3e5ab'], ['לבן', 'var(--text)', '#fdfbf7'],
    ['אפור', 'var(--muted)', '#bdb3a2'], ['חום כהה', 'var(--ink-dark)', '#1a1208'], ['רקע', 'var(--bg)', '#140d07'],
  ];

  const S = {
    user: null, docs: {}, published: {}, draftRev: {}, entries: [], settings: {},
    sel: null, part: 'home', device: 'desktop', state: 'base', tab: 'structure', sub: 'content',
    undo: [], redo: [], dirtyDocs: new Set(), saving: false, saveTimer: null, frameReady: false, collapsed: new Set(),
  };

  // ---------- עזרי עץ ----------
  function walk(nodes, fn, parent = null) { (nodes || []).forEach((n, i) => { fn(n, parent, i); walk(n.children, fn, n); }); }
  function find(id) {
    for (const d of DOCS) {
      let res = null;
      const visit = (list, parent) => list.forEach((n, i) => { if (res) return; if (n.id === id) res = { node: n, list, index: i, parent, doc: d }; else if (n.children) visit(n.children, n); });
      visit(S.docs[d].nodes, null);
      if (res) return res;
    }
    return null;
  }
  const rid = (type) => `${(type || 'n').slice(0, 4)}-${Math.random().toString(36).slice(2, 8)}`;
  function reId(node) { node.id = rid(node.type); (node.children || []).forEach(reId); delete node.anchor; return node; }
  function labelOf(n) {
    if (n.name) return `${TYPE_NAMES[n.type] || n.type} · ${n.name}`;
    const p = n.props || {};
    const txt = (p.html ? p.html.replace(/<[^>]+>/g, '') : p.text || (p.items && p.items.map((x) => x.label || x).join(', ')) || '').trim();
    if (n.type === 'listing') return 'רשימה · ' + ({ featured: 'סרטון ראשי', video: 'סרטונים', site: 'אתרים', 'featured-site': 'אתר ראשי', skillgroup: 'כלים' }[p.source] || '');
    return (TYPE_NAMES[n.type] || n.type) + (txt ? ' · ' + txt.slice(0, 26) : '');
  }
  function layoutOf(n) {
    const st = (n.style && n.style.base && n.style.base.desktop) || {};
    const disp = st.display; const cls = (n.classes || []).join(' ');
    if (disp === 'grid' || /\b(videos|sites|skills)\b/.test(cls)) return 'רשת';
    if (disp === 'flex' ? (st['flex-direction'] || 'row') === 'row' : /\b(hero|btns|links|tags)\b/.test(cls)) return 'שורה';
    if (n.type === 'container' || n.type === 'section') return 'עמודה';
    return '';
  }

  // ---------- היסטוריה (undo) ----------
  function snapshot() { return JSON.stringify(DOCS.map((d) => S.docs[d])); }
  function change(docIds, fn, opts = {}) {
    S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); S.redo = [];
    fn();
    [].concat(docIds).forEach((d) => S.dirtyDocs.add(d));
    scheduleSave();
    if (opts.css) pushCss(); else if (opts.replace) replaceInFrame(opts.replace); else pushFull();
    if (!opts.keepPanel) renderPanel(); else renderTreeOnly();
    updateUndoBtns();
  }
  function applySnap(str) {
    const arr = JSON.parse(str); DOCS.forEach((d, i) => { S.docs[d] = arr[i]; S.dirtyDocs.add(d); });
    if (S.sel && !find(S.sel)) S.sel = null;
    scheduleSave(); pushFull(); renderPanel(); updateUndoBtns();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); applySnap(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); applySnap(S.redo.pop()); }
  function updateUndoBtns() { const u = $('#bUndo'), r = $('#bRedo'); if (u) u.disabled = !S.undo.length; if (r) r.disabled = !S.redo.length; }

  // ---------- תצוגה ----------
  let frame;
  const dataNow = () => ({ docs: S.docs, entries: S.entries.filter((e) => e.status === 'publish'), settings: S.settings });
  const post = (m) => frame && S.frameReady && frame.contentWindow.postMessage(m, location.origin);
  function pushFull() { post({ t: 'full', data: dataNow() }); syncSel(false); }
  function pushCss() { post({ t: 'css', css: Site.docsCss(DOCS.map((d) => S.docs[d])) }); }
  function replaceInFrame(id) {
    const f = find(id); if (!f) return pushFull();
    post({ t: 'replace', id, html: Site.renderNode(f.node, dataNow()) }); pushCss(); syncSel(false);
  }
  function syncSel(scroll) { const f = S.sel && find(S.sel); post({ t: 'select', id: S.sel, label: f ? labelOf(f.node) : '', scroll }); }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.t === 'ready') { S.frameReady = true; pushFull(); }
    if (m.t === 'select') select(m.id, { from: 'frame' });
    if (m.t === 'dblclick') { select(m.id, { from: 'frame' }); S.tab = 'element'; S.sub = 'content'; renderPanel(); }
    if (m.t === 'key') onKey(m);
  });
  function select(id, opts = {}) {
    S.sel = id; const f = id && find(id);
    if (f && f.doc !== S.part) S.part = f.doc;
    if (f && f.node) { let p = f.parent; while (p) { S.collapsed.delete(p.id); p = find(p.id).parent; } }
    if (opts.from === 'frame' && S.tab !== 'element') S.tab = 'element';
    syncSel(opts.from !== 'frame'); renderPanel();
  }
  function fitFrame() {
    const stage = $('.stage'); if (!stage || !frame) return;
    const w = DEVICES[S.device].w; const avail = stage.clientWidth - 32;
    const scale = Math.min(1, avail / w);
    const wrap = $('.frame-wrap');
    frame.style.width = w + 'px'; frame.style.height = Math.round((stage.clientHeight - 32) / scale) + 'px';
    wrap.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fitFrame);

  // ---------- שמירה ופרסום ----------
  function setStatus(txt, cls) { const s = $('#status'); if (s) { s.textContent = txt; s.className = 'status ' + (cls || ''); } }
  function scheduleSave() { setStatus('יש שינויים…'); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveDrafts, 1200); }
  async function saveDrafts() {
    if (S.saving) { scheduleSave(); return; }
    if (!S.dirtyDocs.size) return true;
    S.saving = true; setStatus('שומר טיוטה…');
    const ids = [...S.dirtyDocs]; S.dirtyDocs.clear();
    try {
      for (const id of ids) {
        const { data, error } = await sb.rpc('pf_save_draft', { p_id: id, p_doc: S.docs[id], p_revision: S.draftRev[id] || 0 });
        if (error) throw error;
        S.draftRev[id] = data;
      }
      setStatus('✓ נשמר כטיוטה · עוד לא באתר', 'ok'); S.saving = false; markPublishBtn(); return true;
    } catch (e) {
      ids.forEach((id) => S.dirtyDocs.add(id)); S.saving = false;
      setStatus(/השתנה בחלון אחר/.test(e.message) ? 'התוכן השתנה בחלון אחר. רעננו את העמוד.' : 'השמירה נכשלה: ' + (e.message || e), 'err');
      return false;
    }
  }
  const unpublished = () => DOCS.filter((d) => JSON.stringify(S.docs[d]) !== JSON.stringify(S.published[d]));
  function markPublishBtn() { const b = $('#bPublish'); if (b) { const n = unpublished().length; b.disabled = !n; b.textContent = n ? 'פרסום' : '✓ מפורסם'; } }
  async function publish() {
    clearTimeout(S.saveTimer);
    const ok = await saveDrafts(); if (ok === false) return;
    const ids = unpublished(); if (!ids.length) return;
    setStatus('מפרסם…');
    for (const id of ids) {
      if (!S.draftRev[id]) { const r = await sb.rpc('pf_save_draft', { p_id: id, p_doc: S.docs[id], p_revision: 0 }); if (r.error) return setStatus('הפרסום נכשל: ' + r.error.message, 'err'); S.draftRev[id] = r.data; }
      const { error } = await sb.rpc('pf_publish_doc', { p_id: id, p_revision: S.draftRev[id] });
      if (error) return setStatus('הפרסום נכשל: ' + error.message, 'err');
      S.published[id] = clone(S.docs[id]);
    }
    setStatus('✓ פורסם – מופיע באתר', 'ok'); markPublishBtn(); toast('✓ השינויים פורסמו באתר');
  }
  window.addEventListener('beforeunload', (e) => { if (S.dirtyDocs.size || S.saving) { e.preventDefault(); e.returnValue = ''; } });

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000); }

  // ---------- טעינה ----------
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.href = 'admin.html'; return; }
    S.user = data.session.user;
    const { data: ok } = await sb.rpc('pf_is_admin');
    if (!ok) { $('#root').textContent = 'אין הרשאה.'; return; }
    const [docs, drafts, entries, settings] = await Promise.all([
      sb.from('pf_site_docs').select('id,doc,revision'),
      sb.from('pf_site_drafts').select('id,doc,revision'),
      sb.from('pf_entries').select('*').order('sort'),
      sb.from('pf_settings').select('key,value'),
    ]);
    const err = [docs, drafts, entries, settings].find((r) => r.error);
    if (err) { $('#root').textContent = 'שגיאה בטעינה: ' + err.error.message; return; }
    docs.data.forEach((r) => { S.published[r.id] = r.doc; S.docs[r.id] = clone(r.doc); });
    drafts.data.forEach((r) => { S.docs[r.id] = r.doc; S.draftRev[r.id] = r.revision; });
    DOCS.forEach((d) => { if (!S.docs[d]) S.docs[d] = { id: d, kind: d === 'home' ? 'page' : d, nodes: [] }; if (!S.published[d]) S.published[d] = { id: d, nodes: [] }; });
    S.entries = entries.data; settings.data.forEach((r) => (S.settings[r.key] = r.value));
    shell();
  }

  // ---------- שלד ----------
  function shell() {
    const root = $('#root'); root.innerHTML = '';
    const devBtns = h('div', { class: 'devices', role: 'group', 'aria-label': 'מכשיר' },
      DEV_ORDER.map((d) => h('button', { class: S.device === d ? 'on' : '', onclick: () => { S.device = d; shellTopDevices(); fitFrame(); renderPanel(); } }, DEVICES[d].label)));
    frame = h('iframe', { src: 'editor-frame.html', title: 'תצוגה חיה של האתר' });
    root.append(h('div', { class: 'ed-app' },
      h('div', { class: 'ed-top' },
        h('a', { class: 'btn ghost', href: 'admin.html', onclick: (e) => { if ((S.dirtyDocs.size || S.saving) && !confirm('יש שינויים שעוד נשמרים. לצאת?')) e.preventDefault(); } }, '→ חזרה'),
        h('span', { class: 'name' }, 'תיק עבודות'), h('span', { class: 'tag', id: 'pubTag' }, 'טיוטה'),
        h('div', { class: 'grow' }), devBtns, h('div', { class: 'grow' }),
        h('button', { class: 'icon-btn', id: 'bUndo', title: 'ביטול (Ctrl+Z)', 'aria-label': 'ביטול', onclick: undo }, '↶'),
        h('button', { class: 'icon-btn', id: 'bRedo', title: 'חזרה (Ctrl+Y)', 'aria-label': 'חזרה', onclick: redo }, '↷'),
        h('span', { class: 'status', id: 'status' }, ''),
        h('button', { class: 'btn', onclick: async () => { clearTimeout(S.saveTimer); await saveDrafts(); } }, 'שמירה'),
        h('a', { class: 'btn ghost', href: './', target: '_blank', rel: 'noopener' }, 'האתר ↗'),
        h('button', { class: 'btn primary', id: 'bPublish', onclick: publish }, 'פרסום')),
      h('div', { class: 'ed-body' },
        h('div', { class: 'stage' }, h('div', { class: 'frame-wrap' }, frame)),
        h('div', { class: 'panel' },
          h('div', { class: 'tabs', role: 'tablist' }, [['structure', 'מבנה'], ['add', 'הוספה'], ['element', 'אלמנט'], ['page', 'עמוד']].map(([k, l]) =>
            h('button', { role: 'tab', 'data-tab': k, onclick: () => { S.tab = k; renderPanel(); } }, l))),
          h('div', { class: 'pbody', id: 'pbody' })))));
    setTimeout(fitFrame); renderPanel(); updateUndoBtns(); markPublishBtn();
    document.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' && S.sel) removeNode(S.sel);
    });
  }
  function onKey(m) { if (m.key === 'z') m.shift ? redo() : undo(); if (m.key === 'y') redo(); if (m.key === 'delete' && S.sel) removeNode(S.sel); }
  function shellTopDevices() { document.querySelectorAll('.devices button').forEach((b, i) => b.classList.toggle('on', DEV_ORDER[i] === S.device)); }

  function renderPanel() {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const pb = $('#pbody'); if (!pb) return; const keep = pb.scrollTop; pb.innerHTML = '';
    ({ structure: panelStructure, add: panelAdd, element: panelElement, page: panelPage })[S.tab](pb);
    if (S.tab === 'element') pb.scrollTop = keep;
    markPublishBtn();
  }
  function renderTreeOnly() { if (S.tab === 'structure') renderPanel(); }

  // ---------- לשונית מבנה ----------
  function partPicker() {
    return h('div', { class: 'part-pick' }, DOCS.map((d) => h('button', { class: S.part === d ? 'on' : '', onclick: () => { S.part = d; renderPanel(); } }, PART_NAMES[d])));
  }
  function panelStructure(pb) {
    pb.append(partPicker());
    const nodes = S.docs[S.part].nodes;
    if (!nodes.length) { pb.append(h('div', { class: 'empty' }, 'אין כאן אזורים.', h('button', { class: 'btn primary', onclick: () => { S.tab = 'add'; renderPanel(); } }, '+ הוספת אזור'))); return; }
    const tree = h('div', { class: 'tree', role: 'tree' });
    const row = (n, depth, list, i) => {
      const hasKids = (n.children || []).length > 0;
      const closed = S.collapsed.has(n.id);
      const lay = layoutOf(n);
      const hidden = n.hide && (n.hide.desktop || n.hide.tablet || n.hide.mobile);
      const el = h('div', { class: 'tnode' + (S.sel === n.id ? ' on' : ''), role: 'treeitem', style: `padding-inline-start:${6 + depth * 14}px`, onclick: () => select(n.id) },
        h('span', { class: 'tw', onclick: (e) => { if (!hasKids) return; e.stopPropagation(); closed ? S.collapsed.delete(n.id) : S.collapsed.add(n.id); renderPanel(); } }, hasKids ? (closed ? '◂' : '▾') : '·'),
        h('span', { class: 'tl' + (hidden ? ' hid' : '') }, labelOf(n), hidden ? h('small', {}, ' (מוסתר במכשיר)') : null),
        lay ? h('span', { class: 'lay' }, lay) : null,
        h('span', { class: 'ta' },
          h('button', { title: 'שינוי שם', onclick: (e) => { e.stopPropagation(); rename(n.id); } }, '✎'),
          h('button', { title: 'למעלה', onclick: (e) => { e.stopPropagation(); moveNode(n.id, -1); } }, '↑'),
          h('button', { title: 'למטה', onclick: (e) => { e.stopPropagation(); moveNode(n.id, 1); } }, '↓'),
          h('button', { title: 'שכפול', onclick: (e) => { e.stopPropagation(); duplicateNode(n.id); } }, '⧉'),
          h('button', { title: 'מחיקה', onclick: (e) => { e.stopPropagation(); removeNode(n.id); } }, '🗑')));
      // גרירה: למעלה/למטה בשורה = לפני/אחרי, באמצע = לתוך (אזור / קונטיינר)
      el.draggable = true;
      el.addEventListener('dragstart', (e) => { S.dragId = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); setTimeout(() => el.classList.add('dragging')); });
      el.addEventListener('dragend', () => { S.dragId = null; el.classList.remove('dragging'); clearDrop(); });
      el.addEventListener('dragover', (e) => {
        if (!S.dragId || S.dragId === n.id) return;
        const zone = dropZone(e, el, n);
        if (!canDrop(S.dragId, n.id, zone)) { clearDrop(); e.dataTransfer.dropEffect = 'none'; return; }
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        clearDrop(); el.classList.add('drop-' + zone); el.dataset.zone = zone;
        showDropHint(el, zone, n);
      });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) { el.classList.remove('drop-before', 'drop-after', 'drop-inside'); } });
      el.addEventListener('drop', (e) => { e.preventDefault(); const zone = el.dataset.zone; clearDrop(); if (S.dragId && zone) moveTo(S.dragId, n.id, zone); S.dragId = null; });
      tree.append(el);
      if (hasKids && !closed) n.children.forEach((c, j) => row(c, depth + 1, n.children, j));
    };
    nodes.forEach((n, i) => row(n, 0, nodes, i));
    pb.append(h('div', { class: 'drop-hint', id: 'dropHint', 'aria-live': 'polite' }), tree,
      h('div', { class: 'pnote' }, 'גוררים שורה כדי להזיז: למעלה או למטה בשורה = לפני / אחרי, באמצע של אזור או קונטיינר = לתוכו. אזור זז רק בין אזורים.'),
      h('div', { class: 'pnote' }, 'לחיצה על אלמנט בתצוגה בוחרת אותו. לחיצה כפולה פותחת את התוכן שלו.'));
  }
  const isBoxType = (n) => n.type === 'section' || n.type === 'container';
  function dropZone(e, el, n) {
    const r = el.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
    if (isBoxType(n) && y > 0.28 && y < 0.72) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  }
  function isInside(childId, ancestorId) {
    let f = find(childId);
    while (f && f.parent) { if (f.parent.id === ancestorId) return true; f = find(f.parent.id); }
    return false;
  }
  function canDrop(dragId, targetId, zone) {
    const d = find(dragId), t = find(targetId); if (!d || !t) return false;
    if (dragId === targetId || isInside(targetId, dragId)) return false; // לא לתוך עצמו
    const toTop = zone !== 'inside' && !t.parent; // יעד = רמת האזורים
    if (d.node.type === 'section') return toTop;             // אזור נשאר בין אזורים
    if (toTop) return false;                                  // אלמנט לא עומד מחוץ לאזור
    if (zone === 'inside') return isBoxType(t.node);
    return true;
  }
  function clearDrop() {
    document.querySelectorAll('.tnode.drop-before,.tnode.drop-after,.tnode.drop-inside').forEach((x) => { x.classList.remove('drop-before', 'drop-after', 'drop-inside'); delete x.dataset.zone; });
    const hint = $('#dropHint'); if (hint) hint.textContent = '';
  }
  function showDropHint(el, zone, n) {
    const hint = $('#dropHint'); if (!hint) return;
    hint.textContent = (zone === 'inside' ? 'לתוך ' : zone === 'before' ? 'לפני ' : 'אחרי ') + labelOf(n);
  }
  function moveTo(dragId, targetId, zone) {
    if (!canDrop(dragId, targetId, zone)) return;
    const d = find(dragId), t0 = find(targetId);
    change([d.doc, t0.doc], () => {
      const [node] = d.list.splice(d.index, 1);
      const t = find(targetId); // המיקום אחרי ההוצאה
      if (zone === 'inside') { t.node.children = t.node.children || []; t.node.children.push(node); S.collapsed.delete(t.node.id); }
      else t.list.splice(t.index + (zone === 'after' ? 1 : 0), 0, node);
    });
    S.sel = dragId; syncSel(true); renderPanel(); toast('✓ הוזז · אפשר לבטל עם ↶');
  }
  function rename(id) {
    const f = find(id); const v = prompt('שם לאלמנט (מופיע רק בעורך):', f.node.name || '');
    if (v == null) return; change(f.doc, () => { if (v.trim()) f.node.name = v.trim().slice(0, 40); else delete f.node.name; }, { keepPanel: true, css: true });
    renderPanel();
  }
  function moveNode(id, dir) {
    const f = find(id); const j = f.index + dir; if (j < 0 || j >= f.list.length) return;
    change(f.doc, () => { const [x] = f.list.splice(f.index, 1); f.list.splice(j, 0, x); });
  }
  function duplicateNode(id) {
    const f = find(id); const copy = reId(clone(f.node));
    change(f.doc, () => f.list.splice(f.index + 1, 0, copy)); select(copy.id);
  }
  function removeNode(id) {
    const f = find(id); if (!f) return;
    if (f.node.type === 'listing' && !confirm('למחוק את הרשימה? הפריטים עצמם לא נמחקים, רק המקום שלהם בעמוד.')) return;
    change(f.doc, () => f.list.splice(f.index, 1));
    S.sel = null; S.tab = 'structure'; syncSel(false); renderPanel(); toast('נמחק · אפשר לבטל עם ↶');
  }

  // ---------- לשונית הוספה ----------
  const ELEMENTS = [
    ['heading', 'כותרת', '𝐇', () => ({ type: 'heading', props: { level: 2, html: 'כותרת חדשה' } })],
    ['text', 'טקסט', '¶', () => ({ type: 'text', props: { html: 'כתבו כאן טקסט…' } })],
    ['button', 'כפתור', '⬭', () => ({ type: 'button', classes: ['btn', 'primary'], props: { text: 'כפתור', href: '#contact' } })],
    ['image', 'תמונה', '🖼', () => ({ type: 'image', props: { src: '', alt: '' }, style: { base: { desktop: { width: '100%', 'border-radius': 'var(--r-media)' } } } })],
    ['video', 'וידאו', '🎬', () => ({ type: 'video', props: { src: '', poster: '', controls: true, zoom: true }, style: { base: { desktop: { width: '100%', 'border-radius': 'var(--r-media)' } } } })],
    ['tags', 'תגיות', '🏷', () => ({ type: 'tags', props: { items: ['תגית'] } })],
    ['divider', 'קו מפריד', '―', () => ({ type: 'divider', style: { base: { desktop: { border: '0', 'border-top': '1px solid var(--line)', margin: '24px 0' } } } })],
    ['row', 'קונטיינר · שורה', '⇆', () => ({ type: 'container', name: 'שורה', style: { base: { desktop: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'flex-wrap': 'wrap', 'align-items': 'center' } } }, children: [] })],
    ['col', 'קונטיינר · עמודה', '⇅', () => ({ type: 'container', name: 'עמודה', style: { base: { desktop: { display: 'flex', 'flex-direction': 'column', gap: '12px' } } }, children: [] })],
    ['grid', 'קונטיינר · רשת 3', '▦', () => ({ type: 'container', name: 'רשת', style: { base: { desktop: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: 'var(--gap-grid)' }, mobile: { 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' } } }, children: [] })],
  ];
  const LISTINGS = [['video', 'רשת סרטונים'], ['featured', 'סרטון ראשי'], ['site', 'רשת אתרים'], ['featured-site', 'אתר ראשי'], ['skillgroup', 'כלים']];
  const LIB_CLASSES = { video: 'videos', site: 'sites', skillgroup: 'skills', featured: '', 'featured-site': '' };
  function sig(n) { return n.type + '[' + (n.classes || []).join('.') + ']' + '(' + (n.children || []).map(sig).join(',') + ')'; }
  function buildLibrary() {
    // נבנית מהעמודים של האתר עצמו: אזורים וקבוצות, בלי כפילויות לפי מבנה
    const groups = [], sections = [], seen = new Set();
    DOCS.forEach((d) => (S.docs[d].nodes || []).forEach((sec) => {
      if (d === 'home') { const k = sig(sec); if (!seen.has(k)) { seen.add(k); sections.push({ name: labelOf(sec).replace(/^אזור · /, ''), node: sec }); } }
      walk(sec.children, (n) => {
        if (n.type !== 'container' || !(n.children || []).length || (n.classes || []).includes('wrap')) return;
        const k = sig(n); if (seen.has(k)) return; seen.add(k);
        groups.push({ name: n.name || labelOf(n), node: n });
      });
    }));
    sections.push({ name: 'אזור ריק', node: { type: 'section', name: 'אזור חדש', children: [{ type: 'container', classes: ['wrap'], children: [] }] } });
    return { groups, sections };
  }
  let libLevel = 'element', libQ = '';
  function insertTarget(level) {
    // מחזיר {list, index, doc, label}
    const f = S.sel && find(S.sel);
    if (level === 'section' || !f) {
      let top = f; while (top && top.parent) top = find(top.parent.id);
      const doc = top ? top.doc : 'home'; const list = S.docs[doc].nodes;
      const index = top ? top.index + 1 : list.length;
      return { list, index, doc, label: top ? labelOf(top.node) : 'סוף העמוד', wrap: level !== 'section' };
    }
    if ((f.node.type === 'container' || f.node.type === 'section') && f.node.children) return { list: f.node.children, index: f.node.children.length, doc: f.doc, label: 'בתוך ' + labelOf(f.node) };
    return { list: f.list, index: f.index + 1, doc: f.doc, label: labelOf(f.node) };
  }
  function insert(node, level) {
    const t = insertTarget(level);
    let n = reId(clone(node));
    if (t.wrap && n.type !== 'section') n = { id: rid('section'), type: 'section', name: 'אזור חדש', children: [{ id: rid('container'), type: 'container', classes: ['wrap'], children: [n] }] };
    if (level !== 'section' && n.type === 'section' && t.list !== S.docs[t.doc].nodes) { toast('אזור נכנס רק בין אזורים'); return; }
    change(t.doc, () => t.list.splice(t.index, 0, n));
    select(n.id); S.tab = 'element'; renderPanel();
  }
  function previewTile(node, name) {
    const lp = h('div', { class: 'lp' });
    const item = h('button', { class: 'lib-item', type: 'button', onclick: () => insert(node, libLevel) }, lp, h('div', { class: 'ln' }, name));
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return; io.disconnect();
      const html = Site.renderNode(node, dataNow());
      const css = Site.docsCss([{ nodes: [node] }]);
      const ifr = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy' });
      ifr.srcdoc = `<!doctype html><html dir="rtl" lang="he"><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800;900&display=swap"><link rel="stylesheet" href="${new URL('site.css', location.href)}"><style>${css}body{margin:0;padding:12px;overflow:hidden}body::before{display:none}</style></head><body><div id="app">${html}</div></body></html>`;
      const W = 1100, sc = (lp.clientWidth || item.clientWidth || 300) / W;
      ifr.style.width = W + 'px'; ifr.style.height = Math.round((lp.clientHeight || 110) / sc) + 'px'; ifr.style.transform = `scale(${sc})`;
      lp.append(ifr);
    });
    setTimeout(() => io.observe(lp));
    return item;
  }
  function panelAdd(pb) {
    const t = insertTarget(libLevel);
    pb.append(h('div', { class: 'sub-tabs', style: 'grid-template-columns:1fr 1fr 1fr' }, [['element', 'אלמנט'], ['group', 'קבוצה'], ['section', 'אזור שלם']].map(([k, l]) =>
      h('button', { class: libLevel === k ? 'on' : '', onclick: () => { libLevel = k; renderPanel(); } }, l))));
    const q = h('input', { type: 'search', placeholder: 'חיפוש…', value: libQ, oninput: (e) => { libQ = e.target.value; draw(); } });
    pb.append(q, h('div', { class: 'after-line' }, 'יתווסף ' + (t.label.startsWith('בתוך') ? '' : 'אחרי ') + t.label));
    const grid = h('div', { class: 'lib-grid' }); pb.append(grid);
    const lib = buildLibrary();
    function draw() {
      grid.innerHTML = ''; grid.className = 'lib-grid' + (libLevel === 'element' ? '' : ' one');
      const m = (s) => !libQ || s.includes(libQ);
      if (libLevel === 'element') {
        ELEMENTS.filter(([, l]) => m(l)).forEach(([, l, icon, make]) => grid.append(h('button', { class: 'lib-item', type: 'button', onclick: () => insert(make(), 'element') }, h('div', { class: 'lp icon' }, icon), h('div', { class: 'ln' }, l))));
        LISTINGS.filter(([, l]) => m(l)).forEach(([src, l]) => grid.append(h('button', { class: 'lib-item', type: 'button', onclick: () => insert({ type: 'listing', classes: LIB_CLASSES[src] ? [LIB_CLASSES[src]] : [], name: l, props: { source: src } }, 'element') }, h('div', { class: 'lp icon' }, '☰'), h('div', { class: 'ln' }, l))));
      } else (libLevel === 'group' ? lib.groups : lib.sections).filter((g) => m(g.name)).forEach((g) => grid.append(previewTile(g.node, g.name)));
      if (!grid.children.length) grid.append(h('div', { class: 'pnote' }, 'לא נמצא.'));
    }
    draw();
  }

  // ---------- לשונית אלמנט ----------
  function panelElement(pb) {
    const f = S.sel && find(S.sel);
    if (!f) { pb.append(h('div', { class: 'empty' }, 'בחרו אלמנט בתצוגה או בלשונית "מבנה".')); return; }
    const n = f.node;
    pb.append(h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1' }, labelOf(n)),
      h('button', { class: 'icon-btn', title: 'שכפול', onclick: () => duplicateNode(n.id) }, '⧉'),
      h('button', { class: 'icon-btn', title: 'מחיקה', onclick: () => removeNode(n.id) }, '🗑')));
    pb.append(h('div', { class: 'sub-tabs' }, [['content', 'תוכן'], ['style', 'עיצוב ופריסה']].map(([k, l]) => h('button', { class: S.sub === k ? 'on' : '', onclick: () => { S.sub = k; renderPanel(); } }, l))));
    if (S.sub === 'content') contentPanel(pb, f); else stylePanel(pb, f);
  }
  const fieldEl = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
  function propInput(f, key, opts = {}) {
    const p = f.node.props = f.node.props || {};
    const el = h(opts.multi ? 'textarea' : 'input', { type: opts.type || 'text', dir: opts.ltr ? 'ltr' : null, placeholder: opts.placeholder || '' });
    el.value = p[key] ?? '';
    let first = true;
    el.addEventListener('input', () => {
      if (first) { S.undo.push(snapshot()); S.redo = []; first = false; updateUndoBtns(); }
      p[key] = el.value; S.dirtyDocs.add(f.doc); scheduleSave(); debounceReplace(f.node.id);
    });
    return el;
  }
  let repT; function debounceReplace(id) { clearTimeout(repT); repT = setTimeout(() => replaceInFrame(id), 150); }
  function propToggle(f, key, label) {
    const p = f.node.props = f.node.props || {};
    const cb = h('input', { type: 'checkbox' }); cb.checked = !!p[key];
    cb.addEventListener('change', () => change(f.doc, () => { p[key] = cb.checked; }, { replace: f.node.id, keepPanel: true }));
    return h('label', { class: 'switch' }, cb, label);
  }
  function contentPanel(pb, f) {
    const n = f.node, p = n.props = n.props || {};
    if (n.type === 'heading' || n.type === 'text') {
      if (n.type === 'heading') pb.append(fieldEl('רמת כותרת', segBtns(['1', '2', '3', '4'].map((x) => [x, 'H' + x]), String(p.level || 2), (v) => change(f.doc, () => (p.level = +v)))));
      pb.append(fieldEl('טקסט', richText(f), 'בוחרים מילים ולוחצים על כפתור עיצוב. {{phone}} / {{email}} מתחלפים בפרטי הקשר.'));
    } else if (n.type === 'button') {
      if (p.action === 'sound') { pb.append(fieldEl('טקסט', propInput(f, 'text')), h('div', { class: 'pnote' }, 'כפתור הסאונד של השואוריל.')); return; }
      pb.append(fieldEl('טקסט הכפתור', propInput(f, 'text')), fieldEl('כתובת', propInput(f, 'href', { ltr: true, placeholder: 'https://… או #contact' }), 'קישור לאזור בעמוד: #video, #sites, #skills, #contact'), propToggle(f, 'newTab', 'פתיחה בחלון חדש'));
      const variants = [['btn primary', 'זהב'], ['btn', 'מסגרת'], ['', 'קישור פשוט']];
      const cur = (n.classes || []).filter((c) => c === 'btn' || c === 'primary').join(' ');
      pb.append(fieldEl('סגנון', segBtns(variants, cur, (v) => change(f.doc, () => { n.classes = (n.classes || []).filter((c) => c !== 'btn' && c !== 'primary').concat(v ? v.split(' ') : []); }, { replace: n.id }))));
    } else if (n.type === 'image') {
      pb.append(mediaField(f, 'src', 'image', 'תמונה'), fieldEl('טקסט חלופי', propInput(f, 'alt'), 'תיאור קצר של התמונה, לנגישות ולגוגל.'));
    } else if (n.type === 'video') {
      pb.append(mediaField(f, 'src', 'video', 'סרטון (MP4)'), mediaField(f, 'poster', 'image', 'תמונת כיסוי'),
        propToggle(f, 'controls', 'כפתורי ניגון'), propToggle(f, 'autoplay', 'ניגון אוטומטי (רק עם השתקה)'), propToggle(f, 'muted', 'מושתק'), propToggle(f, 'loop', 'בלולאה'), propToggle(f, 'zoom', 'כפתור הגדלה'));
    } else if (n.type === 'tags') {
      pb.append(fieldEl('תגיות', listEditor(f, 'items', false)));
    } else if (n.type === 'menu') {
      pb.append(fieldEl('פריטי התפריט', listEditor(f, 'items', true)));
    } else if (n.type === 'listing') {
      pb.append(fieldEl('מה מוצג', segBtns(LISTINGS.map(([k, l]) => [k, l]), p.source, (v) => {
        if (v === p.source) return;
        const name = (x) => (LISTINGS.find(([k]) => k === x) || [, x])[1];
        if (!confirm(`להחליף את מה שמוצג כאן מ"${name(p.source)}" ל"${name(v)}"?`)) return;
        change(f.doc, () => { p.source = v; }, { replace: n.id });
      })),
        h('div', { class: 'pnote' }, 'הכרטיסים עצמם (שם, תיאור, סרטון) נערכים ב', h('a', { href: 'admin.html?view=' + ({ featured: 'video', 'featured-site': 'site' }[p.source] || p.source) }, 'ניהול התוכן'), '. כאן משנים איפה הרשימה מופיעה ואיך היא מסודרת (בלשונית "עיצוב ופריסה").'));
    } else if (n.type === 'section' || n.type === 'container') {
      pb.append(fieldEl('שם (רק בעורך)', (() => { const el = h('input', { type: 'text' }); el.value = n.name || ''; el.addEventListener('change', () => change(f.doc, () => { n.name = el.value.trim().slice(0, 40) || undefined; }, { css: true, keepPanel: true })); return el; })()));
      if (n.type === 'section') pb.append(fieldEl('עוגן (לקישורים בתפריט)', (() => { const el = h('input', { type: 'text', dir: 'ltr', placeholder: 'video' }); el.value = n.anchor || ''; el.addEventListener('change', () => { const v = el.value.trim(); if (v && !Site.ID_RE.test(v)) { toast('רק אותיות באנגלית, מספרים ומקף'); return; } change(f.doc, () => { n.anchor = v || undefined; }, { replace: n.id, keepPanel: true }); }); return el; })(), 'כתובת האזור: #' + (n.anchor || '…')));
      pb.append(h('div', { class: 'pnote' }, 'את הסידור (שורה / עמודה / רשת), הריווח והרקע משנים בלשונית "עיצוב ופריסה".'),
        h('button', { class: 'btn', onclick: () => { S.tab = 'add'; libLevel = 'element'; renderPanel(); } }, '+ הוספת אלמנט לכאן'));
    } else if (n.type === 'divider') pb.append(h('div', { class: 'pnote' }, 'לקו מפריד אין תוכן. העיצוב בלשונית "עיצוב ופריסה".'));
  }
  function segBtns(options, cur, onPick) {
    return h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { type: 'button', class: v === cur ? 'on' : '', 'aria-pressed': v === cur ? 'true' : 'false', onclick: () => onPick(v) }, l)));
  }
  function listEditor(f, key, links) {
    const p = f.node.props; p[key] = p[key] || [];
    const wrap = h('div', { class: 'list-edit' });
    const commit = () => change(f.doc, () => {}, { replace: f.node.id, keepPanel: true });
    const draw = () => {
      wrap.innerHTML = '';
      p[key].forEach((it, i) => {
        const label = h('input', { type: 'text', value: links ? it.label : it }); const href = links ? h('input', { type: 'text', dir: 'ltr', value: it.href }) : null;
        label.addEventListener('change', () => { if (links) it.label = label.value; else p[key][i] = label.value; commit(); });
        if (href) href.addEventListener('change', () => { it.href = href.value; commit(); });
        wrap.append(h('div', { class: 'li', style: links ? '' : 'grid-template-columns:1fr auto auto' }, label, href,
          h('span', {}, h('button', { class: 'icon-btn', title: 'למעלה', onclick: () => { if (i) { p[key].splice(i - 1, 0, p[key].splice(i, 1)[0]); commit(); draw(); } } }, '↑'),
            h('button', { class: 'icon-btn', title: 'הסרה', onclick: () => { p[key].splice(i, 1); commit(); draw(); } }, '×'))));
      });
      wrap.append(h('button', { class: 'btn', type: 'button', onclick: () => { p[key].push(links ? { label: 'פריט', href: '#' } : 'חדש'); commit(); draw(); } }, '+ הוספה'));
    };
    draw(); return wrap;
  }
  // טקסט עשיר: זוכרים את הבחירה ומשחזרים לפני כל פעולה. צבע וגודל = span עם style מותר.
  function richText(f) {
    const p = f.node.props;
    const ed = h('div', { class: 'rte', contenteditable: 'true', dir: 'rtl' }); ed.innerHTML = Site.sanitizeHtml(p.html || '');
    let range = null, first = true;
    const save = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', save);
    const restore = () => { if (!range) return false; const s = getSelection(); s.removeAllRanges(); s.addRange(range); return !range.collapsed; };
    const commit = () => {
      if (first) { S.undo.push(snapshot()); S.redo = []; first = false; updateUndoBtns(); }
      p.html = Site.sanitizeHtml(ed.innerHTML.replace(/&nbsp;/g, ' ')); S.dirtyDocs.add(f.doc); scheduleSave(); debounceReplace(f.node.id);
    };
    ed.addEventListener('input', commit);
    ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    const wrapSel = (make) => {
      if (!restore()) { toast('קודם בוחרים מילים בטקסט'); return; }
      const r = getSelection().getRangeAt(0); const el = make();
      el.append(r.extractContents()); r.insertNode(el);
      const s = getSelection(); s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); s.addRange(nr); range = nr.cloneRange();
      commit();
    };
    const span = (style, cls) => () => { const s = document.createElement('span'); if (style) s.setAttribute('style', style); if (cls) s.className = cls; return s; };
    const bar = h('div', { class: 'rte-bar' },
      h('button', { type: 'button', title: 'מודגש', onmousedown: (e) => e.preventDefault(), onclick: () => wrapSel(() => document.createElement('b')) }, h('b', {}, 'B')),
      h('button', { type: 'button', title: 'נטוי', onmousedown: (e) => e.preventDefault(), onclick: () => wrapSel(() => document.createElement('i')) }, h('i', {}, 'I')),
      h('button', { type: 'button', title: 'זהב (כמו בכותרות)', onmousedown: (e) => e.preventDefault(), onclick: () => wrapSel(span(null, 'gold')) }, '✦ זהב'),
      h('button', { type: 'button', title: 'קישור', onmousedown: (e) => e.preventDefault(), onclick: () => { const u = prompt('כתובת הקישור:', 'https://'); if (!u) return; if (!Site.safeUrl(u)) { toast('כתובת לא תקינה'); return; } wrapSel(() => { const a = document.createElement('a'); a.href = u; a.target = '_blank'; return a; }); } }, '🔗'),
      ...BRAND.slice(0, 4).map(([name, , hex]) => h('button', { type: 'button', title: 'צבע: ' + name, style: `background:${hex};width:24px;min-width:24px;border-radius:50%`, onmousedown: (e) => e.preventDefault(), onclick: () => wrapSel(span('color:' + hex)) })),
      h('select', { title: 'גודל', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) wrapSel(span('font-size:' + v)); } },
        h('option', { value: '' }, 'גודל'), h('option', { value: '0.85em' }, 'קטן'), h('option', { value: '1.25em' }, 'גדול'), h('option', { value: '1.6em' }, 'גדול מאוד')),
      h('button', { type: 'button', title: 'ניקוי עיצוב', onmousedown: (e) => e.preventDefault(), onclick: () => { if (!confirm('להסיר את כל העיצוב מהטקסט?')) return; ed.textContent = ed.textContent; commit(); } }, '⌫'));
    return h('div', { style: 'display:grid;gap:6px' }, bar, ed);
  }
  // העלאה
  const OK_TYPES = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  async function upload(file, folder) {
    const ext = OK_TYPES[file.type]; if (!ext) throw new Error('סוג קובץ לא נתמך');
    if (file.size > 50 * 1024 * 1024) throw new Error('הקובץ גדול מדי (עד 50MB)');
    const path = `${folder}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await sb.storage.from('portfolio').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from('portfolio').getPublicUrl(path).data.publicUrl;
  }
  function mediaField(f, key, kind, label) {
    const p = f.node.props; const msg = h('div', { class: 'hint' });
    const url = h('input', { type: 'text', dir: 'ltr', value: p[key] || '', placeholder: 'קישור, או העלאה' });
    url.addEventListener('change', () => { if (url.value && !Site.safeUrl(url.value)) { msg.textContent = 'כתובת לא תקינה'; return; } change(f.doc, () => { p[key] = url.value; }, { replace: f.node.id, keepPanel: true }); });
    const up = h('button', { class: 'btn', type: 'button', onclick: () => {
      const inp = h('input', { type: 'file', accept: kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp' });
      inp.addEventListener('change', async () => { try { msg.textContent = 'מעלה…'; const u = await upload(inp.files[0], 'editor'); url.value = u; change(f.doc, () => { p[key] = u; }, { replace: f.node.id, keepPanel: true }); msg.textContent = '✓ הועלה'; } catch (e) { msg.textContent = e.message; } });
      inp.click();
    } }, 'העלאה');
    return h('div', { class: 'field' }, h('label', {}, label), h('div', { style: 'display:flex;gap:6px' }, url, up), msg);
  }

  // ---------- עיצוב לפי מכשיר ----------
  function styleObj(n, state, dev, create) {
    if (!n.style) { if (!create) return null; n.style = {}; }
    if (!n.style[state]) { if (!create) return null; n.style[state] = {}; }
    if (!n.style[state][dev]) { if (!create) return null; n.style[state][dev] = {}; }
    return n.style[state][dev];
  }
  function resolve(n, prop) {
    // ערך בפועל למכשיר הנוכחי + מאיפה הגיע
    const upto = DEV_ORDER.slice(0, DEV_ORDER.indexOf(S.device) + 1).reverse();
    for (const d of upto) { const o = styleObj(n, S.state, d); if (o && o[prop] != null && o[prop] !== '') return { v: o[prop], from: d }; }
    return { v: '', from: null };
  }
  function setProp(f, prop, value, opts = {}) {
    change(f.doc, () => {
      const o = styleObj(f.node, S.state, S.device, true);
      if (value === '' || value == null) delete o[prop]; else o[prop] = String(value);
      cleanStyle(f.node);
    }, { css: true, keepPanel: true });
    if (!opts.noRerender) renderPanel();
  }
  function cleanStyle(n) {
    if (!n.style) return;
    for (const st of Object.keys(n.style)) { for (const d of Object.keys(n.style[st])) if (!Object.keys(n.style[st][d]).length) delete n.style[st][d]; if (!Object.keys(n.style[st]).length) delete n.style[st]; }
    if (!Object.keys(n.style).length) delete n.style;
  }
  function srcLabel(r) {
    if (!r.from) return h('span', { class: 'src' }, '');
    if (r.from === S.device) return h('span', { class: 'src set' }, 'הוגדר ל' + DEVICES[r.from].label);
    return h('span', { class: 'src' }, 'יורש מ' + DEVICES[r.from].label);
  }
  function ctl(label, f, prop, input, extra) {
    const r = resolve(f.node, prop);
    return h('div', { class: 'ctl' }, h('div', { class: 'cl' }, label, srcLabel(r), extra), input(r));
  }
  function stepper(f, prop, units = ['px', '%', 'vw', 'em'], step = 1) {
    return (r) => {
      const m = String(r.v).match(/^(-?[\d.]+)([a-z%]*)$/);
      const num = h('input', { type: 'number', step: String(step), value: m ? m[1] : '', placeholder: r.v && !m ? r.v : '' });
      if (r.from && r.from !== S.device) num.classList.add('inherited');
      const unit = h('select', {}, units.map((u) => h('option', { value: u, selected: m && m[2] === u ? true : null }, u || '—')));
      const commit = () => setProp(f, prop, num.value === '' ? '' : num.value + unit.value);
      num.addEventListener('change', commit); unit.addEventListener('change', () => num.value !== '' && commit());
      const bump = (d) => { num.value = String((+num.value || 0) + d * step); commit(); };
      return h('div', { class: 'stepper' }, h('button', { type: 'button', onclick: () => bump(-1) }, '−'), num, h('button', { type: 'button', onclick: () => bump(1) }, '+'), unit,
        r.from === S.device ? h('button', { type: 'button', title: 'איפוס', onclick: () => setProp(f, prop, '') }, '↺') : null);
    };
  }
  function seg(f, prop, options) {
    return (r) => h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { type: 'button', class: String(r.v) === v ? 'on' : '', title: l, onclick: () => setProp(f, prop, String(r.v) === v && r.from === S.device ? '' : v) }, l)));
  }
  function swatches(f, prop, withGradients) {
    return (r) => {
      const row = h('div', { class: 'swatches' },
        h('button', { type: 'button', class: 'sw none' + (!r.v ? ' on' : ''), title: 'בלי', onclick: () => setProp(f, prop, '') }),
        BRAND.map(([name, v, hex]) => h('button', { type: 'button', class: 'sw' + (r.v === v ? ' on' : ''), title: name, style: `background:${hex}`, onclick: () => setProp(f, prop, v) })),
        withGradients ? [['זהב מבריק', 'var(--goldbg)', 'linear-gradient(135deg,#f3e7c4,#d4af37,#aa7c11)'], ['כרטיס', 'var(--card)', 'linear-gradient(180deg,#23180f,#140d07)']].map(([name, v, css]) =>
          h('button', { type: 'button', class: 'sw' + (r.v === v ? ' on' : ''), title: name, style: `background:${css}`, onclick: () => setProp(f, prop, v) })) : null);
      const other = h('input', { type: 'color', title: '+ אחר', value: /^#[0-9a-f]{6}$/i.test(r.v) ? r.v : '#ffffff', style: 'width:32px;height:28px;padding:0;border:0;background:none' });
      other.addEventListener('change', () => setProp(f, prop, other.value));
      row.append(h('label', { style: 'font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px' }, other, 'אחר'));
      return row;
    };
  }
  function presets(f, prop, list, previewStyle) {
    return (r) => h('div', { class: 'presets' }, list.map(([l, v]) => h('button', { type: 'button', class: r.v === v ? 'on' : '', onclick: () => setProp(f, prop, v) }, h('span', { class: 'pv', style: previewStyle(v) }), l)));
  }
  function group(title, f, props, body, openDefault) {
    const set = props.some((p) => { const o = styleObj(f.node, S.state, S.device); return o && o[p] != null; });
    const key = 'g:' + title;
    const d = h('details', { class: 'grp', open: openDefault || openGroups.has(key) ? true : null, ontoggle: () => (d.open ? openGroups.add(key) : openGroups.delete(key)) },
      h('summary', {}, title, set ? h('span', { class: 'dot', title: 'יש כאן שינוי במכשיר הזה' }) : null,
        set ? h('button', { class: 'reset', type: 'button', onclick: (e) => { e.preventDefault(); change(f.doc, () => { const o = styleObj(f.node, S.state, S.device); if (o) props.forEach((p) => delete o[p]); cleanStyle(f.node); }, { css: true }); } }, 'איפוס') : null),
      h('div', { class: 'gbody' }, body));
    return d;
  }
  const openGroups = new Set();
  function stylePanel(pb, f) {
    const n = f.node;
    pb.append(h('div', { class: 'editing-for' }, 'עורכים עכשיו: ', h('b', {}, DEVICES[S.device].label),
      h('span', { style: 'flex:1' }),
      h('div', { class: 'seg' }, [['base', 'רגיל'], ['hover', 'ריחוף']].map(([k, l]) => h('button', { type: 'button', class: S.state === k ? 'on' : '', onclick: () => { S.state = k; renderPanel(); } }, l)))),
    h('div', { class: 'pnote' }, S.device === 'desktop' ? 'מה שמגדירים במחשב עובר גם לטאבלט ולטלפון, אלא אם משנים שם.' : `שינוי כאן משפיע רק על ${DEVICES[S.device].label}${S.device === 'tablet' ? ' (ועובר גם לטלפון)' : ''}.`));
    const isBox = n.type === 'section' || n.type === 'container' || n.type === 'listing';
    const textual = ['heading', 'text', 'button', 'tags', 'menu'].includes(n.type) || isBox;
    if (textual) pb.append(group('טקסט', f, ['font-size', 'font-weight', 'line-height', 'text-align', 'color', 'letter-spacing'], [
      ctl('גודל', f, 'font-size', stepper(f, 'font-size', ['px', 'em', 'rem', 'vw'])),
      ctl('משקל', f, 'font-weight', seg(f, 'font-weight', [['400', 'רגיל'], ['500', 'בינוני'], ['700', 'בולט'], ['900', 'עבה']])),
      ctl('גובה שורה', f, 'line-height', stepper(f, 'line-height', ['', 'em', 'px'], 0.1)),
      ctl('יישור', f, 'text-align', seg(f, 'text-align', [['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']])),
      ctl('צבע', f, 'color', swatches(f, 'color')),
    ], !isBox));
    pb.append(group('רקע', f, ['background'], [ctl('צבע / גרדיאנט', f, 'background', swatches(f, 'background', true))]));
    pb.append(group('מסגרת', f, ['border'], [ctl('קו', f, 'border', presets(f, 'border', [['בלי', 'none'], ['דק', '1px solid var(--line)'], ['זהב', '1px solid var(--line2)'], ['עבה', '2px solid var(--gold)']], (v) => `border:${v.replace(/var\(--line2?\)|var\(--gold\)/, '#d4af37')};background:#fff`))]));
    let manualR = false;
    const radiusBody = h('div', { style: 'display:grid;gap:8px' });
    const drawRadius = () => {
      radiusBody.innerHTML = '';
      radiusBody.append(ctl('פינות', f, 'border-radius', presets(f, 'border-radius', [['ישר', '0'], ['קטן', '8px'], ['בינוני', 'var(--r-media)'], ['גדול', 'var(--r-card)'], ['עגול', '999px']], (v) => `border-radius:${v.replace('var(--r-media)', '6px').replace('var(--r-card)', '9px').replace('999px', '9px')}`),
        h('button', { class: 'manual', type: 'button', onclick: () => { manualR = !manualR; drawRadius(); } }, 'הגדרה ידנית')));
      if (manualR) {
        const r = resolve(f.node, 'border-radius'); const parts = String(r.v || '0').split(/\s+/);
        const all = [0, 1, 2, 3].map((i) => parts[i] ?? parts[0]);
        const inputs = ['ימין־למעלה', 'שמאל־למעלה', 'שמאל־למטה', 'ימין־למטה'].map((l, i) => h('label', { style: 'display:grid;gap:2px;font-size:11.5px' }, l, h('input', { type: 'text', dir: 'ltr', value: all[i] })));
        // סדר CSS: top-left top-right bottom-right bottom-left; ב-RTL מציגים בעברית
        const commit = () => { const v = inputs.map((x) => x.querySelector('input').value || '0'); setProp(f, 'border-radius', [v[1], v[0], v[3], v[2]].join(' ')); };
        inputs.forEach((x) => x.querySelector('input').addEventListener('change', commit));
        radiusBody.append(h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px' }, inputs));
      }
    };
    drawRadius();
    pb.append(group('פינות', f, ['border-radius'], [radiusBody]));
    let manualS = false;
    const shadowBody = h('div', { style: 'display:grid;gap:8px' });
    const drawShadow = () => {
      shadowBody.innerHTML = '';
      shadowBody.append(ctl('צל', f, 'box-shadow', presets(f, 'box-shadow', [['בלי', 'none'], ['רך', '0 10px 30px rgba(0,0,0,0.35)'], ['חזק', '0 30px 80px rgba(0,0,0,0.6)'], ['זוהר', '0 0 40px rgba(212,175,55,0.35)']], (v) => `box-shadow:${v === 'none' ? 'none' : v.replace(/(\d+)px/g, (m, x) => Math.ceil(x / 6) + 'px')};background:#fff`),
        h('button', { class: 'manual', type: 'button', onclick: () => { manualS = !manualS; drawShadow(); } }, 'הגדרה ידנית')));
      if (manualS) {
        const vals = { x: 0, y: 10, blur: 30, spread: 0, color: '#000000', alpha: 35 };
        const m = String(resolve(f.node, 'box-shadow').v).match(/(-?\d+)px\s+(-?\d+)px\s+(\d+)px(?:\s+(-?\d+)px)?\s+rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (m) Object.assign(vals, { x: +m[1], y: +m[2], blur: +m[3], spread: +(m[4] || 0), color: '#' + [m[5], m[6], m[7]].map((c) => (+c).toString(16).padStart(2, '0')).join(''), alpha: Math.round(+m[8] * 100) });
        const mk = (k, l, type = 'number') => { const i = h('input', { type, value: vals[k] }); i.addEventListener('change', () => { vals[k] = type === 'number' ? +i.value : i.value; commitS(); }); return h('label', { style: 'display:grid;gap:2px;font-size:11.5px' }, l, i); };
        const commitS = () => { const c = vals.color.match(/\w\w/g).map((x) => parseInt(x, 16)); setProp(f, 'box-shadow', `${vals.x}px ${vals.y}px ${vals.blur}px ${vals.spread}px rgba(${c.join(',')},${(vals.alpha / 100).toFixed(2)})`); };
        shadowBody.append(h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px' }, mk('x', 'לצד'), mk('y', 'למטה'), mk('blur', 'טשטוש'), mk('spread', 'התפשטות'), mk('color', 'צבע', 'color'), mk('alpha', 'שקיפות %')));
      }
    };
    drawShadow();
    pb.append(group('צל', f, ['box-shadow'], [shadowBody]));
    pb.append(group('שקיפות', f, ['opacity'], [ctl('שקיפות', f, 'opacity', (r) => { const i = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: r.v === '' ? 1 : r.v }); i.addEventListener('change', () => setProp(f, 'opacity', i.value === '1' ? '' : i.value)); return i; })]));
    // פריסה
    pb.append(group('גודל', f, ['width', 'max-width', 'min-height'], [
      ctl('רוחב', f, 'width', (r) => h('div', { style: 'display:grid;gap:6px' }, seg(f, 'width', [['auto', 'אוטומטי'], ['100%', 'מלא']])(r), stepper(f, 'width', ['px', '%', 'vw'])(r))),
      ctl('רוחב מקסימלי', f, 'max-width', stepper(f, 'max-width', ['px', '%', 'vw'])),
      ctl('גובה מינימלי', f, 'min-height', stepper(f, 'min-height', ['px', 'vh'])),
    ]));
    pb.append(group('ריווח', f, ['margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right'], [boxModel(f)]));
    if (isBox) pb.append(group('סידור התוכן', f, ['display', 'flex-direction', 'justify-content', 'align-items', 'gap', 'flex-wrap', 'grid-template-columns'], layoutControls(f), true));
    pb.append(group('מיקום מתקדם (צף, נעוץ, שכבות)', f, ['position', 'top', 'z-index'], [
      h('div', { class: 'pnote' }, 'רגיל: במקום הטבעי. יחסי: אפשר להזיז קצת. נעוץ: נשאר למעלה בגלילה (כמו התפריט). מוחלט: רק לקישוטים.'),
      ctl('מיקום', f, 'position', seg(f, 'position', [['static', 'רגיל'], ['relative', 'יחסי'], ['sticky', 'נעוץ'], ['absolute', 'מוחלט']])),
      ctl('מרחק מלמעלה', f, 'top', stepper(f, 'top')), ctl('שכבה (z-index)', f, 'z-index', stepper(f, 'z-index', [''])),
    ]));
    // הסתרה לפי מכשיר
    const hide = n.hide || {};
    pb.append(h('details', { class: 'grp' }, h('summary', {}, 'הצגה והסתרה לפי מכשיר', (hide.desktop || hide.tablet || hide.mobile) ? h('span', { class: 'dot' }) : null),
      h('div', { class: 'gbody' }, DEV_ORDER.map((d) => { const cb = h('input', { type: 'checkbox' }); cb.checked = !hide[d]; cb.addEventListener('change', () => change(f.doc, () => { n.hide = { ...(n.hide || {}), [d]: !cb.checked }; if (!n.hide.desktop && !n.hide.tablet && !n.hide.mobile) delete n.hide; }, { css: true, keepPanel: true })); return h('label', { class: 'switch' }, cb, 'מוצג ב' + DEVICES[d].label); }))));
  }
  function boxModel(f) {
    const inp = (prop) => { const r = resolve(f.node, prop); const i = h('input', { type: 'text', dir: 'ltr', value: r.from === S.device ? r.v : '', placeholder: r.v || '0', title: r.from ? (r.from === S.device ? 'הוגדר ל' : 'יורש מ') + DEVICES[r.from].label : '' }); i.addEventListener('change', () => setProp(f, prop, i.value.trim() && /^-?[\d.]+$/.test(i.value.trim()) ? i.value.trim() + 'px' : i.value.trim())); return i; };
    const pre = h('div', { class: 'presets' }, [['בלי', '0'], ['קטן', '12px'], ['בינוני', '24px'], ['גדול', '56px']].map(([l, v]) => h('button', { type: 'button', onclick: () => change(f.doc, () => { const o = styleObj(f.node, S.state, S.device, true); ['top', 'bottom'].forEach((s) => (o['padding-' + s] = v)); }, { css: true }) }, h('span', { class: 'pv' }), l)));
    return h('div', { style: 'display:grid;gap:8px' },
      h('div', { class: 'boxmodel' }, 'מרווח חיצוני (margin)',
        h('div', { class: 'bm-row' }, h('span'), inp('margin-top'), h('span')),
        h('div', { class: 'bm-row' }, inp('margin-right'),
          h('div', { class: 'inner' }, 'ריפוד פנימי (padding)', h('div', { class: 'bm-row' }, h('span'), inp('padding-top'), h('span')), h('div', { class: 'bm-row' }, inp('padding-right'), h('span', {}, '▭'), inp('padding-left')), h('div', { class: 'bm-row' }, h('span'), inp('padding-bottom'), h('span'))),
          inp('margin-left')),
        h('div', { class: 'bm-row' }, h('span'), inp('margin-bottom'), h('span'))),
      h('div', { class: 'cl', style: 'font-size:13px' }, 'ריפוד למעלה ולמטה:'), pre);
  }
  function layoutControls(f) {
    const disp = resolve(f.node, 'display').v; const dir = resolve(f.node, 'flex-direction').v || 'row';
    const mode = disp === 'grid' ? 'grid' : disp === 'flex' ? (dir === 'column' ? 'col' : 'row') : 'block';
    const setMode = (m) => change(f.doc, () => {
      const o = styleObj(f.node, S.state, S.device, true);
      if (m === 'block') { o.display = 'block'; delete o['flex-direction']; }
      if (m === 'row') { o.display = 'flex'; o['flex-direction'] = 'row'; }
      if (m === 'col') { o.display = 'flex'; o['flex-direction'] = 'column'; }
      if (m === 'grid') { o.display = 'grid'; if (!resolve(f.node, 'grid-template-columns').v) o['grid-template-columns'] = 'repeat(3, minmax(0, 1fr))'; }
    }, { css: true });
    const out = [h('div', { class: 'ctl' }, h('div', { class: 'cl' }, 'סידור', srcLabel(resolve(f.node, 'display'))),
      segBtns([['block', 'רגיל'], ['col', '⇅ עמודה'], ['row', '⇆ שורה'], ['grid', '▦ רשת']], mode, setMode))];
    if (mode === 'row' || mode === 'col') {
      const jc = resolve(f.node, 'justify-content').v || 'flex-start', ai = resolve(f.node, 'align-items').v || 'stretch';
      const J = ['flex-start', 'center', 'flex-end'], A = ['flex-start', 'center', 'flex-end'];
      const grid9 = h('div', { class: 'align9', role: 'group', 'aria-label': 'יישור' });
      A.forEach((a) => J.forEach((j) => {
        const on = (mode === 'row' ? (jc === j && ai === a) : (jc === a && ai === j));
        grid9.append(h('button', { type: 'button', class: on ? 'on' : '', onclick: () => change(f.doc, () => { const o = styleObj(f.node, S.state, S.device, true); if (mode === 'row') { o['justify-content'] = j; o['align-items'] = a; } else { o['justify-content'] = a; o['align-items'] = j; } }, { css: true }) }));
      }));
      out.push(h('div', { class: 'ctl' }, h('div', { class: 'cl' }, 'יישור'), grid9));
      out.push(ctl('פיזור', f, 'justify-content', seg(f, 'justify-content', [['space-between', 'פרוס'], ['space-around', 'מרווח שווה']])));
      const wr = resolve(f.node, 'flex-wrap').v === 'wrap';
      const cb = h('input', { type: 'checkbox' }); cb.checked = wr; cb.addEventListener('change', () => setProp(f, 'flex-wrap', cb.checked ? 'wrap' : 'nowrap'));
      out.push(h('label', { class: 'switch' }, cb, 'לרדת שורה כשאין מקום'));
    }
    if (mode === 'grid') {
      const cur = resolve(f.node, 'grid-template-columns'); const m = String(cur.v).match(/repeat\((\d+)/);
      out.push(h('div', { class: 'ctl' }, h('div', { class: 'cl' }, 'עמודות', srcLabel(cur)),
        segBtns(['1', '2', '3', '4'].map((x) => [x, x]), m ? m[1] : '', (v) => setProp(f, 'grid-template-columns', `repeat(${v}, minmax(0, 1fr))`))));
    }
    if (mode !== 'block') out.push(ctl('רווח בין פריטים', f, 'gap', stepper(f, 'gap', ['px', 'em', '%'])));
    return out;
  }

  // ---------- לשונית עמוד ----------
  function panelPage(pb) {
    pb.append(h('div', { class: 'field' }, h('div', { class: 'label' }, 'חלק לעריכה'), partPicker(), h('div', { class: 'hint' }, 'התפריט העליון והפוטר משותפים לכל העמודים.')));
    // SEO
    const seo = { title: '', description: '', image: '', ...(S.settings.seo || {}) };
    const cnt = (k, max) => { const c = h('span', { class: 'counter' }); const u = () => { const n = (seo[k] || '').length; c.textContent = n + '/' + max; c.classList.toggle('over', n > max); }; u(); return [c, u]; };
    const [tc, tu] = cnt('title', 60), [dc, du] = cnt('description', 155);
    const gT = h('div', { class: 't' }), gD = h('div', { class: 'd' });
    const g = () => { gT.textContent = seo.title; gD.textContent = seo.description; tu(); du(); }; g();
    const ti = h('input', { type: 'text', value: seo.title }); ti.addEventListener('input', () => { seo.title = ti.value; g(); });
    const di = h('textarea', {}); di.value = seo.description; di.addEventListener('input', () => { seo.description = di.value; g(); });
    const msg = h('span', { class: 'savebar' });
    pb.append(h('div', { class: 'section-box' }, h('h4', {}, 'קידום בגוגל ושיתוף'),
      h('div', { class: 'field' }, h('div', { class: 'label', style: 'display:flex;justify-content:space-between' }, 'כותרת', tc), ti),
      h('div', { class: 'field' }, h('div', { class: 'label', style: 'display:flex;justify-content:space-between' }, 'תיאור', dc), di),
      h('div', { class: 'gprev' }, h('div', { class: 'u' }, 'batyamanevitz-debug.github.io › portfolio'), gT, gD),
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('button', { class: 'btn', onclick: async () => { const { error } = await sb.from('pf_settings').upsert({ key: 'seo', value: seo, updated_at: new Date().toISOString() }); msg.textContent = error ? error.message : '✓ נשמר'; msg.className = 'savebar ' + (error ? 'err' : 'ok'); if (!error) S.settings.seo = seo; } }, 'שמירת הגדרות גוגל'), msg)));
    // רקע העמוד
    const home = S.docs.home; const bg = (home.settings && home.settings.background) || '';
    pb.append(h('div', { class: 'section-box' }, h('h4', {}, 'רקע העמוד'),
      h('div', { class: 'swatches' },
        h('button', { type: 'button', class: 'sw none' + (!bg ? ' on' : ''), title: 'ברירת המחדל (חום-זהב)', onclick: () => setBg('') }),
        [['שחור', '#070402'], ['חום', '#140d07'], ['קרם', '#fdfbf7'], ['זוהר זהב', 'radial-gradient(circle at 50% 0%, #3a2610 0%, #140d07 45%, #070402 100%)']].map(([l, v]) =>
          h('button', { type: 'button', class: 'sw' + (bg === v ? ' on' : ''), title: l, style: `background:${v}`, onclick: () => setBg(v) })))));
    function setBg(v) { change('home', () => { home.settings = { ...(home.settings || {}) }; if (v) home.settings.background = v; else delete home.settings.background; }, { css: true }); }
    // היסטוריה
    const hist = h('div', { class: 'hist' }, h('div', { class: 'pnote' }, 'טוען…'));
    pb.append(h('div', { class: 'section-box' }, h('h4', {}, 'היסטוריית פרסומים · ' + PART_NAMES[S.part]), hist));
    sb.from('pf_revisions').select('id,created_at').eq('doc_id', S.part).order('created_at', { ascending: false }).limit(15).then(({ data, error }) => {
      hist.innerHTML = '';
      if (error) { hist.append(h('div', { class: 'pnote' }, error.message)); return; }
      if (!data || !data.length) { hist.append(h('div', { class: 'pnote' }, 'עוד לא היו פרסומים מהעורך.')); return; }
      data.forEach((r) => hist.append(h('div', { class: 'hi' }, h('span', {}, new Date(r.created_at).toLocaleString('he-IL')),
        h('button', { class: 'btn', onclick: async () => {
          if (!confirm('לשחזר את הגרסה הזו? היא תיכנס לטיוטה, ותופיע באתר רק אחרי "פרסום".')) return;
          const { data: row, error: e2 } = await sb.from('pf_revisions').select('doc').eq('id', r.id).single();
          if (e2) return toast(e2.message);
          change(S.part, () => { S.docs[S.part] = row.doc; }); toast('✓ שוחזר לטיוטה');
        } }, 'שחזור'))));
    });
  }

  boot().catch((e) => { $('#root').textContent = 'שגיאה: ' + (e.message || e); });
})();
