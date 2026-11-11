// JAZ Trading FIMC — moteur d'optimisation (s'exécute dans la page TradingView)
// Principe : aucune dépendance aux classes CSS générées par TradingView (elles changent à chaque mise à jour).
// Les éléments sont repérés par leur rôle (input, case à cocher, liste), leur position et leur texte, avec plusieurs secours.
(() => {
  if (window.__JAZ_OPT__) return;
  window.__JAZ_OPT__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0);
  // Vrai clic souris (TradingView ignore souvent un simple element.click())
  function realClick(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    }
  }
  // Repères TradingView : data-qa-id (actuel) ou data-name (ancien)
  const Q = (k) => `[data-qa-id~="${k}"],[data-name="${k}"]`;

  const DEF_OPTS = { settleMs: 700, noChangeMs: 3000, timeoutMs: 30000, mode: 'live', labels: {} };
  let OPTS = { ...DEF_OPTS };
  async function loadOpts() {
    const o = (await chrome.storage.local.get('jaz_opts')).jaz_opts || {};
    OPTS = { ...DEF_OPTS, ...o, labels: { ...(o.labels || {}) } };
  }

  /* ================= Nombres ================= */
  let decimalComma = null; // détecté à partir du rapport
  function detectDecimal(txt) {
    const c = (txt.match(/\d,\d{2}(?!\d)/g) || []).length, d = (txt.match(/\d\.\d{2}(?!\d)/g) || []).length;
    if (c || d) decimalComma = c > d;
  }
  function parseNum(raw) {
    if (raw == null) return null;
    let s = String(raw).replace(/[\s  ']/g, '').replace(/[−–]/g, '-');
    const m = s.match(/[+-]?\d[\d.,]*/);
    if (!m) return null;
    let n = m[0];
    const suf = (s[m.index + n.length] || '').toUpperCase();
    n = n.replace(/[.,]$/, '');
    const hasC = n.includes(','), hasD = n.includes('.');
    if (hasC && hasD) n = n.lastIndexOf(',') > n.lastIndexOf('.') ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
    else if (hasC) {
      const p = n.split(',');
      const dec = p.length === 2 && (p[1].length !== 3 || decimalComma === true ||
        (decimalComma == null && /^(fr|de|es|it|pt|ru|tr|pl|nl|id|vi|cs|sv|da|nb|fi|uk|ro|hu|el)/i.test(document.documentElement.lang || navigator.language)));
      n = dec ? p.join('.') : p.join('');
    } else if (hasD) { const p = n.split('.'); if (p.length > 2) n = p.join(''); }
    let v = parseFloat(n);
    if (!isFinite(v)) return null;
    if (suf === 'K') v *= 1e3; else if (suf === 'M') v *= 1e6; else if (suf === 'B') v *= 1e9;
    return v;
  }
  function parseVals(txt) {
    const re = /([+\-−]?\s?\d+(?:[\s  ]\d{3}(?!\d))*(?:[.,']\d+)*\s?[KMB]?)(\s*%)?/g;
    let m, v = null, pct = null;
    while ((m = re.exec(txt))) {
      const x = parseNum(m[1]);
      if (x == null) continue;
      if (m[2]) { if (pct == null) pct = x; } else if (v == null) v = x;
      if (v != null && pct != null) break;
    }
    return { v, pct };
  }

  /* ================= Rapport de stratégie (métriques) ================= */
  const LABELS = {
    net: [/^(total\s*p\s*&?\s*n?\s*l|p\s*&?\s*n?\s*l\s*total|net\s*profit|profit\s*net|bénéfice\s*net|gain\s*net|résultat\s*net|total\s*profit)$/i],
    dd: [/max.*drawdown|drawdown.*max/i, /aspiration\s*max/i, /(baisse|repli|perte)\s*max/i, /drawdown/i],
    win: [/^(profitable\s*trades|percent\s*profitable|win\s*rate)$/i, /(transactions|trades)\s*rentables|%\s*rentable|pourcentage\s*rentable|taux\s*de\s*réussite|gagnant/i, /profitable/i],
    pf: [/profit\s*factor|facteur\s*de\s*profit/i],
    trades: [/^total\s*(closed\s*)?trades$/i, /^(nombre\s*)?(total\s*)?(de\s*|des\s*)?(transactions|trades)(\s*total(es)?|\s*clôturée?s?|\s*fermée?s?)?$/i]
  };
  function labelRegexes(key) {
    const custom = norm(OPTS.labels?.[key]);
    const list = [...LABELS[key]];
    if (custom) custom.split('|').map(norm).filter(Boolean).reverse()
      .forEach((c) => list.unshift(new RegExp('^' + c.replace(/[.*+?^${}()[\]\\]/g, '\\$&') + '$', 'i')));
    return list;
  }
  const ownText = (el) => norm([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));

  function reportScopes() {
    const out = [];
    const b = document.querySelector('#bottom-area');
    if (b) out.push(b);
    out.push(document.body);
    return out;
  }
  function findLabel(re, scope) {
    let hidden = null;
    for (const el of scope.querySelectorAll('div,span,td,th,p,label,dt,dd,button')) {
      if (el.childElementCount > 3) continue;
      const t = ownText(el) || (el.childElementCount === 0 ? norm(el.textContent) : '');
      if (!t || t.length > 40 || !re.test(t)) continue;
      if (el.closest('[role="dialog"],[data-name="indicator-properties-dialog"]')) continue;
      if (visible(el)) return el;
      hidden = hidden || el;
    }
    return hidden;
  }
  function textAfter(container, label, max = 90) {
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let seen = false, out = '';
    while (w.nextNode()) {
      const n = w.currentNode;
      if (label.contains(n)) { seen = true; continue; }
      if (!seen) {
        if (label.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) seen = true; else continue;
      }
      out += ' ' + n.textContent;
      if (out.length > max) break;
    }
    return norm(out);
  }
  function valueTextFor(label) {
    let c = label;
    for (let i = 0; i < 5 && c.parentElement; i++) {
      c = c.parentElement;
      const t = textAfter(c, label);
      if (/\d/.test(t)) return t;
    }
    return null;
  }
  // Taux de réussite en % + nombre de trades gagnants / total (ex. « 29,67 % 62/209 »)
  function winsTrades(winPct, rawWin, totalTrades) {
    const f = (rawWin || '').match(/(\d+)\s*\/\s*(\d+)/);
    const trades = totalTrades ?? (f ? +f[2] : null);
    let wins = f ? +f[1] : null;
    if (wins == null && winPct != null && trades != null) wins = Math.round((winPct * trades) / 100);
    const win = winPct ?? (wins != null && trades ? (wins / trades) * 100 : null);
    return { win, wins, trades };
  }
  function readMetrics() {
    const raw = {}, labels = {};
    for (const key of Object.keys(LABELS)) {
      let lab = null;
      for (const scope of reportScopes()) {
        for (const re of labelRegexes(key)) { lab = findLabel(re, scope); if (lab) break; }
        if (lab) break;
      }
      if (lab) { labels[key] = norm(lab.textContent); raw[key] = valueTextFor(lab); }
    }
    detectDecimal(Object.values(raw).filter(Boolean).join(' '));
    const net = parseVals(raw.net || ''), dd = parseVals(raw.dd || ''), win = parseVals(raw.win || ''),
      pf = parseVals(raw.pf || ''), tr = parseVals(raw.trades || '');
    return {
      net: net.v, netPct: net.pct,
      dd: dd.v != null ? Math.abs(dd.v) : null, ddPct: dd.pct != null ? Math.abs(dd.pct) : null,
      ...winsTrades(win.pct ?? win.v, raw.win, tr.v), pf: pf.v,
      _sig: JSON.stringify(raw), _labels: labels
    };
  }
  // Ouvre le panneau « Rapport de stratégie » s'il est replié
  async function ensureReport() {
    if (clickStaleUpdate()) await sleep(1500);
    if (readMetrics().net != null) return true;
    const btn = document.querySelector('[data-qa-id="backtesting"],[data-name="backtesting"]') ||
      [...document.querySelectorAll('#bottom-area button,[class*="bottom"] button')].find((b) => /rapport de stratégie|strategy (tester|report)|backtest/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    if (btn) realClick(btn);
    for (let i = 0; i < 40; i++) { await sleep(250); if (readMetrics().net != null) return true; }
    return false;
  }
  // « Le rapport est obsolète — Mettre à jour » : TradingView ne recalcule qu'après ce clic (plages de dates longues, Deep Backtesting…)
  const STALE_RE = /obsol[eè]te|out of date|outdated|not up to date|veraltet|desactualizado/i;
  // Le texte du bouton peut être « Mettre à jour », « Mettre à jour le rapport », « Update report »… et pas forcément un <button>
  const UPDATE_RE = /^(mettre [àa] jour|actualiser|rafra[iî]chir|update|refresh|recalculate|recalculer|aktualisieren|actualizar|atualizar|aggiorna)/i;
  let lastStaleClick = 0;
  function clickStaleUpdate() {
    if (Date.now() - lastStaleClick < 800) return false;
    // 1) on part du texte « obsolète » et on cherche le bouton à côté
    for (const el of document.querySelectorAll('div,span,p')) {
      if (el.childElementCount > 2 || !STALE_RE.test(ownText(el) || (el.childElementCount === 0 ? el.textContent : '')) || !visible(el)) continue;
      if (el.closest('[data-name="indicator-properties-dialog"]')) continue;
      let p = el.parentElement;
      for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
        const cand = [...p.querySelectorAll('button,[role="button"],a,span,div')].find((b) => b !== el && visible(b) && UPDATE_RE.test(norm(b.textContent)) && norm(b.textContent).length < 40);
        if (cand) {
          const target = cand.closest('button,[role="button"],a') || cand;
          realClick(target);
          lastStaleClick = Date.now();
          return true;
        }
      }
    }
    return false;
  }
  function isLoading() {
    const scope = document.querySelector('#bottom-area') || document.body;
    return [...scope.querySelectorAll('[class*="loader"],[class*="spinner"],[role="progressbar"],[aria-busy="true"]')].some(visible);
  }
  // TradingView n'affiche aucun signal « calcul en cours » : on mesure le temps de recalcul
  // réel de la stratégie et on attend toujours assez longtemps avant de conclure « résultat identique ».
  const latencies = [];
  function noChangeLimit() {
    if (latencies.length < 2) return Math.max(OPTS.noChangeMs, 8000);
    const s = [...latencies].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)], max = s[s.length - 1];
    return Math.min(OPTS.timeoutMs, Math.max(OPTS.noChangeMs, med * 2 + 800, max + 800));
  }
  async function waitForResult(beforeSig) {
    const t0 = Date.now(), limit = noChangeLimit();
    let lastSig = readMetrics()._sig, lastChange = Date.now(), lastLoad = isLoading(), first = null;
    while (true) {
      await sleep(120);
      if (clickStaleUpdate()) { lastChange = Date.now(); await sleep(300); continue; }   // force la mise à jour du rapport
      const m = readMetrics(), load = isLoading(), now = Date.now();
      if (m._sig !== lastSig || load !== lastLoad) { lastSig = m._sig; lastLoad = load; lastChange = now; }
      if (first == null && m._sig !== beforeSig) first = now - t0;
      if (!load && now - lastChange >= OPTS.settleMs) {
        if (m._sig !== beforeSig) {                               // résultat mis à jour et stable
          latencies.push(first ?? now - t0); if (latencies.length > 15) latencies.shift();
          return m;
        }
        if (now - t0 >= limit) return m;                          // résultat réellement identique
      }
      if (now - t0 >= OPTS.timeoutMs) return m;
    }
  }

  /* ================= Légende du graphique (stratégies) ================= */
  function legendItems() {
    let els = [...document.querySelectorAll(Q('legend-source-item'))];
    return els.map((el, i) => {
      const t = el.querySelector(Q('legend-source-title')) || el.querySelector('[class*="title"]');
      return { el, i, name: norm(t ? t.textContent : (el.textContent || '').split('\n')[0]) };
    }).filter((x) => x.name);
  }
  async function openFromLegend(name) {
    const items = legendItems();
    const it = items.find((x) => x.name === name) || items.find((x) => x.name.startsWith(name) || name.startsWith(x.name));
    if (!it) throw new Error(`Stratégie « ${name} » introuvable sur le graphique. Ouvrez sa fenêtre de paramètres (roue dentée) puis réessayez.`);
    ['mouseover', 'mouseenter', 'mousemove'].forEach((t) => it.el.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    await sleep(150);
    const btn = it.el.querySelector(Q('legend-settings-action')) ||
      [...it.el.querySelectorAll('[role="button"],button,[class*="button"]')].find((b) => /param|setting|réglage/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || b.dataset.name || ''));
    if (btn) realClick(btn);
    else {
      const t = it.el.querySelector(Q('legend-source-title')) || it.el;
      realClick(t);
      t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }
    for (let i = 0; i < 40; i++) { const d = getDialog(); if (d) return d; await sleep(150); }
    throw new Error('La fenêtre de paramètres ne s\'est pas ouverte.');
  }

  /* ================= Fenêtre de paramètres ================= */
  const TAB_INPUTS = /^(inputs?|entrées|entrees|paramètres d'entrée|eingaben|entradas|input|ingressi|входные данные|girdiler)$/i;
  function getDialog() {
    const d = document.querySelector('[data-name="indicator-properties-dialog"]');
    if (d && visible(d)) return d;
    return [...document.querySelectorAll('[role="dialog"],[data-dialog-name],[class*="dialog"]')]
      .filter(visible)
      .find((x) => x.querySelector('input') && [...x.querySelectorAll('[role="tab"],button,div,span')].some((t) => TAB_INPUTS.test(ownText(t) || '')));
  }
  function dialogTitle(d) {
    if (d.getAttribute('data-dialog-name')) return norm(d.getAttribute('data-dialog-name')).slice(0, 80);
    const t = d.querySelector('[data-name="dialog-title"],[class*="title"]');
    return norm(t ? t.textContent : '').slice(0, 80) || 'Stratégie';
  }
  async function ensureInputsTab(d) {
    const t = d.querySelector('#inputs[role="tab"]') ||
      [...d.querySelectorAll('[role="tab"],button,[class*="tab"]')].find((x) => TAB_INPUTS.test(norm(x.textContent)) || /^paramètres en entrée/i.test(norm(x.textContent)));
    if (t && t.getAttribute('aria-selected') !== 'true') { realClick(t); await sleep(400); }
  }
  function footerButton(d, kind) {
    const named = kind === 'ok' ? d.querySelector('button[name="submit"],[data-name="submit-button"]') : d.querySelector('button[name="cancel"],[data-name="cancel-button"]');
    if (named) return named;
    const re = kind === 'ok' ? /^(ok|valider|appliquer|apply|okay)$/i : /^(cancel|annuler|abbrechen|cancelar|annulla)$/i;
    return [...d.querySelectorAll('button')].find((b) => re.test(norm(b.textContent)));
  }
  async function closeDialog(d, ok) {
    const b = footerButton(d, ok ? 'ok' : 'cancel');
    if (b) b.click();
    else d.querySelector('[data-name="close"],[class*="close"]')?.click();
    for (let i = 0; i < 20 && d.isConnected && visible(d); i++) await sleep(100);
  }
  // Enregistre la mise en page TradingView (sinon les réglages sont perdus au rechargement si l'enregistrement auto est désactivé)
  async function saveLayout() {
    const b = document.querySelector('[data-qa-id="save-load-button"]') ||
      [...document.querySelectorAll('button[aria-label]')].find((x) => /enregistrer tous les graphiques|save all charts/i.test(x.getAttribute('aria-label')));
    if (!b) return false;
    await sleep(500);
    realClick(b);
    await sleep(1500);
    return true;
  }
  function inFrame(el) { return !!el.closest('[role="tablist"],[class*="footer"],[data-name="footer"],[class*="header"],[data-name="dialog-title"]'); }

  // Liste ordonnée des champs de la fenêtre, avec libellé, groupe (= indicateur) et type
  function getControls(d) {
    const sel = 'input:not([type=hidden]),[role="combobox"],[aria-haspopup="listbox"],[data-role="listbox"],[role="button"][class*="select"],button[class*="select"]';
    let els = [...d.querySelectorAll(sel)].filter((e) => !inFrame(e) && e.type !== 'color' && e.type !== 'radio');
    els = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    if (!els.length) return [];

    // Conteneur commun des champs
    let root = els[0].parentElement;
    while (root && !els.every((e) => root.contains(e))) root = root.parentElement;
    root = root || d;

    // Titres de groupes (= indicateurs dans votre script Pine)
    let heads = [...root.querySelectorAll('[class*="checkableTitle"],[class*="groupTitle"],[class*="titleWrap"],[class*="sectionTitle"],[class*="group-title"],[class*="groupHeader"]')];
    root.querySelectorAll('[class*="cell"]').forEach((c) => {
      if (/fill|full|span/i.test(c.className) && !c.querySelector('input,[role=combobox],[aria-haspopup],button') && norm(c.textContent)) heads.push(c);
    });
    heads = heads.filter((h) => norm(h.textContent) && !inFrame(h) && !h.querySelector('input:not([type=checkbox]),[role=combobox]'));
    heads = heads.filter((h) => !heads.some((o) => o !== h && o.contains(h)));
    const headName = (h) => norm((h.querySelector('[class*="titleText"]') || h).textContent);

    const counts = {};
    let rowCount = new Map();
    return els.map((el, key) => {
      let type = 'text', value, isFloat = false, sep = '.';
      if (el.tagName === 'INPUT' && el.type === 'checkbox') { type = 'bool'; value = el.checked; }
      else if (el.tagName === 'INPUT' && el.getAttribute('role') === 'combobox') { type = 'select'; value = norm(el.value); }
      else if (el.tagName === 'INPUT') {
        value = el.value;
        const v = String(value).trim();
        if (/^[+-]?\d+([.,]\d+)?$/.test(v)) {
          type = 'number'; isFloat = /[.,]/.test(v) || el.inputMode === 'decimal'; sep = v.includes(',') ? ',' : '.';
          value = parseFloat(v.replace(',', '.'));
        }
      } else { type = 'select'; value = norm(el.textContent || el.value); }

      // Libellé
      let label = '';
      if (type === 'bool') label = norm(el.closest('label')?.textContent);
      const cell = el.closest('[class*="cell"]');
      if (!label && cell) {
        let prev = cell.previousElementSibling;
        if (prev && !prev.querySelector('input,[role=combobox],[aria-haspopup]')) label = norm(prev.textContent);
        if (!label && type === 'bool') label = norm(cell.textContent);
        if (label) {
          const n = (rowCount.get(cell) || 0) + 1; rowCount.set(cell, n);
          if (n > 1) label += ` (${n})`;
        }
      }
      if (!label) {
        let p = el.parentElement;
        for (let i = 0; i < 4 && p && !label; i++, p = p.parentElement) {
          const t = norm([...p.childNodes].map((n) => (n === el || n.contains?.(el)) ? '' : n.textContent).join(' '));
          if (t && t.length < 80) label = t;
        }
      }
      label = label || `Paramètre ${key + 1}`;

      // Groupe = dernier titre placé avant le champ
      let group = 'Général';
      for (const h of heads) if (h.contains(el) || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) group = headName(h);

      counts[group + '|' + label] = (counts[group + '|' + label] || 0) + 1;
      if (counts[group + '|' + label] > 1) label += ` .${counts[group + '|' + label]}`;
      return { key, el, label, group, type, value, isFloat, sep, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' };
    });
  }

  function findControl(d, step) {
    const ctrls = getControls(d);
    const c = ctrls[step.key];
    if (c && c.label === step.label) return c;
    return ctrls.find((x) => x.label === step.label && x.group === step.group) || ctrls.find((x) => x.label === step.label) || c;
  }

  function menuOptions(ctrl) {
    const lb = ctrl && ctrl.getAttribute('aria-controls') && document.getElementById(ctrl.getAttribute('aria-controls'));
    if (lb) { const o = [...lb.querySelectorAll('[role="option"]')].filter((x) => norm(x.textContent)); if (o.length) return o; }
    return [...document.querySelectorAll('[role="option"],[role="menuitem"],[data-role="menuitem"],[role="listbox"] [class*="item"],[data-name="popup-menu-container"] [class*="item"]')]
      .filter(visible).filter((o) => norm(o.textContent));
  }
  async function readOptions(c) {
    realClick(c.el);
    let opts = [];
    for (let i = 0; i < 10 && !opts.length; i++) { await sleep(120); opts = menuOptions(c.el); }
    const list = [...new Set(opts.map((o) => norm(o.textContent)))];
    realClick(c.el); await sleep(200);
    if (c.el.getAttribute('aria-expanded') === 'true') c.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return list;
  }

  async function setControl(c, v) {
    const el = c.el;
    if (c.type === 'bool') {
      const want = v === true || v === 'true' || v === 'Oui';
      if (el.checked !== want) el.click();
      return;
    }
    if (c.type === 'select') {
      if (norm(el.textContent || el.value) === String(v)) return;
      realClick(el);
      let opt = null;
      for (let i = 0; i < 12 && !opt; i++) {
        await sleep(120);
        const opts = menuOptions(el);
        opt = opts.find((o) => norm(o.textContent) === String(v)) || opts.find((o) => norm(o.textContent).startsWith(String(v)));
      }
      if (!opt) { realClick(el); throw new Error(`Option « ${v} » introuvable pour ${c.label}`); }
      realClick(opt);
      await sleep(150);
      return;
    }
    const s = c.type === 'number' && c.sep === ',' ? String(v).replace('.', ',') : String(v);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, s);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  /* ================= Moteur d'optimisation ================= */
  const ctl = { running: false, pause: false, stop: false };
  let ST = null;
  let saveT = 0;
  async function save(force) {
    const now = Date.now();
    if (!force && now - saveT < 400) return;
    saveT = now;
    ST.updatedAt = now;
    await chrome.storage.local.set({ jaz_run: ST });
  }

  async function dialogFor(state) {
    let d = getDialog();
    if (d) { await ensureInputsTab(d); return { d, reopened: false }; }
    d = await openFromLegend(state.strategy);
    await ensureInputsTab(d);
    await sleep(300);
    return { d, reopened: true };
  }

  // Réapplique toutes les valeurs déjà retenues (après réouverture de la fenêtre)
  async function syncAll(d, state) {
    for (const st of state.config.steps) {
      const v = state.current[st.key];
      if (v === undefined) continue;
      const c = findControl(d, st);
      if (c && String(c.value) !== String(v)) await setControl(c, v);
    }
  }

  async function applyValue(state, st, v) {
    let { d, reopened } = await dialogFor(state);
    if (reopened && OPTS.mode === 'live') await syncAll(d, state);
    const c = findControl(d, st);
    if (!c) throw new Error(`Paramètre « ${st.label} » introuvable dans la fenêtre.`);
    const before = readMetrics()._sig;
    await setControl(c, v);
    if (OPTS.mode === 'ok') await closeDialog(d, true);
    return before;
  }

  async function checkPause() {
    let p0 = 0;
    while (ctl.pause && !ctl.stop) {
      if (!p0) { p0 = Date.now(); ST.status = 'paused'; await save(true); }
      await sleep(300);
    }
    if (p0) { ST.pausedMs = (ST.pausedMs || 0) + (Date.now() - p0); ST.status = 'running'; await save(true); }
  }

  function pickBest(list, crit, f) {
    let pool = list.filter((r) => r.score > -Infinity);
    const usable = pool.length ? pool : list.map((r) => ({ ...r, score: JAZ.rawScore(r.m, crit) }));
    let best = null;
    for (const r of usable) if (JAZ.better(r, best)) best = r;
    return best;
  }

  async function runEngine() {
    const state = ST;
    const cfg = state.config;
    ctl.running = true; ctl.stop = false; ctl.pause = false;
    state.status = 'running'; state.error = null;
    try {
      await loadOpts();
      let { d } = await dialogFor(state);

      if (!state.baseline) {
        // Valeurs de départ
        state.initial = {}; state.current = {};
        for (const st of cfg.steps) {
          const c = findControl(d, st);
          state.initial[st.key] = c ? c.value : null;
          state.current[st.key] = c ? c.value : null;
        }
        await ensureReport();
        const m = readMetrics();
        if (m.net == null) throw new Error('Rapport de stratégie introuvable : ouvrez le panneau « Rapport de stratégie / Strategy Tester » sous le graphique, puis relancez.');
        state.baseline = { m, score: JAZ.score(m, cfg.criterion, cfg.filters) };
        state.best = { ...state.baseline };
        state.msg = 'Mesure de départ effectuée';
        await save(true);
      } else {
        state.msg = 'Reprise de l\'optimisation';
      }

      for (; state.cursor.pass < cfg.passes; state.cursor.pass++, state.cursor.step = 0) {
        for (; state.cursor.step < cfg.steps.length; state.cursor.step++, state.cursor.val = 0) {
          const si = state.cursor.step, st = cfg.steps[si], p = state.cursor.pass;
          for (; state.cursor.val < st.values.length; state.cursor.val++) {
            await checkPause();
            if (ctl.stop) break;
            const v = st.values[state.cursor.val];
            state.curValue = v;
            state.msg = `${st.group} › ${st.label} = ${v}`;
            await save();
            const before = await applyValue(state, st, v);
            const m = await waitForResult(before);
            const score = JAZ.score(m, cfg.criterion, cfg.filters);
            delete m._sig; delete m._labels;
            state.results.push({ p, s: si, v, m, score });
            state.done++;
            await save();
          }
          if (ctl.stop) break;

          // Choix de la meilleure valeur pour ce paramètre
          const list = state.results.filter((r) => r.p === p && r.s === si);
          const best = pickBest(list, cfg.criterion, cfg.filters);
          const prev = state.current[st.key];
          let chosen = prev, kept = true, cm = state.best.m, cs = state.best.score;
          if (best && (!cfg.keepIfNoImprove || JAZ.better(best, state.best) || prev == null)) {
            chosen = best.v; kept = false; cm = best.m; cs = best.score;
          }
          state.current[st.key] = chosen;
          state.best = { m: cm, score: cs };
          state.chosen.push({ p, s: si, key: st.key, label: st.label, group: st.group, before: prev, value: chosen, kept, m: cm });
          state.msg = `${st.label} → ${chosen}${kept ? ' (valeur actuelle conservée)' : ''}`;
          const before = await applyValue(state, st, chosen);
          await waitForResult(before);
          await save(true);
        }
        if (ctl.stop) break;
      }

      // Validation finale des meilleurs réglages (bouton OK)
      if (ctl.stop) {
        state.msg = 'Arrêt demandé : application des meilleurs réglages trouvés';
        for (const st of cfg.steps) {
          const before = await applyValue(state, st, state.current[st.key]);
          if (OPTS.mode === 'live') await sleep(100); else await waitForResult(before);
        }
      }
      const dd = getDialog();
      if (dd) await closeDialog(dd, true);
      await saveLayout();
      state.status = ctl.stop ? 'stopped' : 'done';
      state.endedAt = Date.now();
      state.msg = ctl.stop ? 'Optimisation arrêtée — meilleurs réglages appliqués' : 'Optimisation terminée — meilleurs réglages appliqués';
      await save(true);
      const h = (await chrome.storage.local.get('jaz_history')).jaz_history || [];
      h.unshift(state);
      await chrome.storage.local.set({ jaz_history: h.slice(0, 30) });
      const b = state.baseline?.m?.net, a = state.best?.m?.net;
      chrome.runtime.sendMessage({ type: 'notify', title: 'Optimisation terminée', message: `${state.strategy} : profit net ${JAZ.fmt(b)} → ${JAZ.fmt(a)}` }).catch(() => {});
    } catch (e) {
      state.status = 'error';
      state.error = e.message || String(e);
      await save(true);
    } finally {
      ctl.running = false;
    }
  }

  /* ================= Diagnostic ================= */
  function diagnostic() {
    const out = ['JAZ Optimiseur — diagnostic', 'URL: ' + location.href, 'Langue: ' + (document.documentElement.lang || navigator.language)];
    out.push('', 'Légende : ' + legendItems().map((x) => x.name).join(' | '));
    const d = getDialog();
    out.push('', 'Fenêtre ouverte : ' + (d ? dialogTitle(d) : 'aucune'));
    if (d) getControls(d).forEach((c) => out.push(`  [${c.key}] ${c.group} › ${c.label} = ${c.value} (${c.type})`));
    const m = readMetrics();
    out.push('', 'Métriques lues : ' + JSON.stringify({ net: m.net, netPct: m.netPct, dd: m.dd, ddPct: m.ddPct, win: m.win, wins: m.wins, pf: m.pf, trades: m.trades }));
    out.push('Libellés trouvés : ' + JSON.stringify(m._labels));
    const stale = [...document.querySelectorAll('div,span,p')].filter((e) => e.childElementCount <= 2 && STALE_RE.test(ownText(e)));
    stale.slice(0, 2).forEach((e) => { let b = e; for (let i = 0; i < 4 && b.parentElement; i++) b = b.parentElement; out.push('Message obsolète : ' + b.outerHTML.replace(/ class="[^"]*"/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').slice(0, 600)); });
    out.push('Textes bruts : ' + m._sig);
    const b = document.querySelector('#bottom-area');
    if (b) {
      const texts = [];
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while (w.nextNode() && texts.length < 120) { const t = norm(w.currentNode.textContent); if (t) texts.push(t); }
      out.push('', 'Textes du panneau inférieur : ' + texts.join(' ¦ '));
    }
    return out.join('\n');
  }

  /* ================= Messages du popup ================= */
  const handlers = {
    async ping() { return { running: ctl.running, paused: ctl.pause }; },

    async list() {
      const d = getDialog();
      return { items: legendItems().map((x) => x.name), dialog: d ? dialogTitle(d) : null };
    },

    async scan({ name, useOpen }) {
      await loadOpts();
      if (ctl.running) throw new Error('Une optimisation est déjà en cours.');
      let d = getDialog(), opened = false;
      let strategy = name;
      if (useOpen) {
        if (!d) throw new Error('Aucune fenêtre de paramètres ouverte sur TradingView.');
        strategy = dialogTitle(d);
      } else if (!d || !dialogTitle(d).includes(name)) {
        if (d) await closeDialog(d, false);
        d = await openFromLegend(name); opened = true;
      }
      await ensureInputsTab(d);
      await sleep(300);
      const ctrls = getControls(d);
      if (!ctrls.length) throw new Error('Aucun paramètre trouvé dans l\'onglet « Entrées ».');
      const params = [];
      for (const c of ctrls) {
        const p = { key: c.key, label: c.label, group: c.group, type: c.type, value: c.value, isFloat: c.isFloat, disabled: c.disabled };
        if (c.type === 'select' && !c.disabled) { try { p.options = await readOptions(c); } catch { p.options = []; } }
        params.push(p);
      }
      if (opened) await closeDialog(d, false);
      await ensureReport();
      const m = readMetrics();
      return { strategy, params, report: m.net != null, useOpen: !!useOpen };
    },

    async start({ strategy, config }) {
      if (ctl.running) throw new Error('Une optimisation est déjà en cours.');
      const total = config.steps.reduce((a, s) => a + s.values.length, 0) * config.passes;
      ST = {
        id: Date.now(), status: 'running', strategy, config, total, done: 0,
        cursor: { pass: 0, step: 0, val: 0 }, results: [], chosen: [],
        startedAt: Date.now(), pausedMs: 0, initial: {}, current: {}, baseline: null, best: null, msg: 'Démarrage…'
      };
      await save(true);
      runEngine();
      return { started: true };
    },

    async resume() {
      if (ctl.running) { ctl.pause = false; return { resumed: true }; }
      const s = (await chrome.storage.local.get('jaz_run')).jaz_run;
      if (!s || !['running', 'paused', 'error'].includes(s.status)) throw new Error('Aucune optimisation à reprendre.');
      ST = s;
      runEngine();
      return { resumed: true };
    },
    async pause() { ctl.pause = true; return {}; },
    async unpause() { ctl.pause = false; return {}; },
    async stop() { ctl.stop = true; ctl.pause = false; return {}; },

    async apply({ strategy, values, steps }) {
      if (ctl.running) throw new Error('Une optimisation est en cours.');
      await loadOpts();
      let d = getDialog();
      if (!d) d = await openFromLegend(strategy);
      await ensureInputsTab(d);
      await sleep(300);
      for (const st of steps) {
        const c = findControl(d, st);
        if (c && values[st.key] != null) await setControl(c, values[st.key]);
      }
      await closeDialog(d, true);
      await saveLayout();
      return { applied: true };
    },

    async diag() { await loadOpts(); return { text: diagnostic() }; }
  };

  // Porte de test : active seulement si localStorage.jaz_debug === '1' sur la page TradingView
  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || !m.__jazReq) return;
    let dbg = false; try { dbg = localStorage.getItem('jaz_debug') === '1'; } catch { }
    if (!dbg) return;
    let res;
    try {
      if (m.cmd === 'reloadExt') { chrome.runtime.sendMessage({ type: 'reload' }); res = { ok: true }; }
      else if (m.cmd === 'checkSelf') { chrome.runtime.sendMessage({ type: 'checkSelf' }); res = { ok: true }; }
      else if (m.cmd === 'get') res = { ok: true, ...(await chrome.storage.local.get(m.keys)) };
      else if (m.cmd === 'state') res = { ok: true, run: (await chrome.storage.local.get('jaz_run')).jaz_run, ctl };
      else if (m.cmd === 'setOpts') { await chrome.storage.local.set({ jaz_opts: m.opts }); res = { ok: true }; }
      else if (handlers[m.cmd]) res = { ok: true, ...(await handlers[m.cmd](m)) };
      else res = { ok: false, error: 'commande inconnue' };
    } catch (e) { res = { ok: false, error: e.message || String(e) }; }
    window.postMessage({ __jazRes: m.__jazReq, res: JSON.parse(JSON.stringify(res)) }, '*');
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    const h = handlers[msg?.cmd];
    if (!h) return false;
    h(msg).then((r) => reply({ ok: true, ...r })).catch((e) => reply({ ok: false, error: e.message || String(e) }));
    return true;
  });
})();
