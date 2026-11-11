// JAZ Trading FIMC — interface de l'optimiseur
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => parseFloat(String(s ?? '').replace(',', '.'));
const pidOf = (p) => p.group + '|' + p.label;
const IS_TAB = new URLSearchParams(location.search).has('tab');
if (IS_TAB) document.body.classList.add('tab');

const DEF_OPTS = { settleMs: 700, noChangeMs: 3000, timeoutMs: 30000, mode: 'live', secPerTest: 2, labels: {} };
const S = { screen: 'strategies', tabId: null, list: null, scan: null, byPid: {}, setup: null, opts: { ...DEF_OPTS }, run: null, view: null, busy: null, err: null, alive: null, diag: '' };
const view = $('#view');

/* ---------- Communication avec l'onglet TradingView ---------- */
async function findTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.tradingview.com/chart*', 'https://tradingview.com/chart*'] });
  if (!tabs.length) return null;
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find((t) => t.id === cur?.id) || tabs.find((t) => t.active) || tabs[0];
}
async function send(msg) {
  if (!S.tabId) {
    const t = await findTab();
    if (!t) throw new Error('Ouvrez un graphique TradingView (tradingview.com/chart) dans ce navigateur, puis cliquez sur « Actualiser ».');
    S.tabId = t.id;
  }
  let r;
  try {
    try { r = await chrome.tabs.sendMessage(S.tabId, msg); }
    catch {
      await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: ['shared.js', 'content.js'] });
      await sleep(300);
      r = await chrome.tabs.sendMessage(S.tabId, msg);
    }
  } catch (e) { S.tabId = null; throw new Error('Impossible de joindre l\'onglet TradingView. Rechargez la page du graphique puis réessayez.'); }
  if (!r) throw new Error('Pas de réponse de TradingView. Rechargez la page du graphique.');
  if (!r.ok) throw new Error(r.error);
  return r;
}

/* ---------- Réglages mémorisés par stratégie ---------- */
const DEF_SETUP = () => ({ sel: {}, order: [], ranges: {}, criterion: 'ratio', maxDD: '', minTrades: '', minPF: '', passes: 1, keep: true });
async function loadSetup(strategy) {
  const all = (await chrome.storage.local.get('jaz_setups')).jaz_setups || {};
  S.setup = { ...DEF_SETUP(), ...(all[strategy] || {}) };
  for (const g of Object.keys(S.setup.sel)) S.setup.sel[g] = S.setup.sel[g].filter((pid) => S.byPid[pid]);
}
let saveT;
function saveSetup() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const all = (await chrome.storage.local.get('jaz_setups')).jaz_setups || {};
    all[S.scan.strategy] = S.setup;
    await chrome.storage.local.set({ jaz_setups: all });
  }, 300);
}

/* ---------- Paramètres ---------- */
const optimizable = (p) => !p.disabled && ['number', 'bool', 'select'].includes(p.type);
const typeName = (p) => p.type === 'bool' ? 'Oui/Non' : p.type === 'select' ? 'Liste' : p.type === 'number' ? (p.isFloat ? 'Décimal' : 'Entier') : 'Texte';
const fmtVal = (v) => v === true ? 'Oui' : v === false ? 'Non' : String(v ?? '—');

function groups() {
  const out = [], m = {};
  S.scan.params.forEach((p) => {
    if (!m[p.group]) { m[p.group] = { name: p.group, params: [] }; out.push(m[p.group]); }
    m[p.group].params.push(p);
  });
  return out;
}
function orderedGroups() {
  const gs = groups();
  const ord = S.setup.order.filter((n) => gs.some((g) => g.name === n));
  gs.forEach((g) => { if (!ord.includes(g.name)) ord.push(g.name); });
  S.setup.order = ord;
  return ord.map((n) => gs.find((g) => g.name === n));
}
function selectedSteps() {
  const out = [];
  orderedGroups().forEach((g) => (S.setup.sel[g.name] || []).forEach((pid) => { if (S.byPid[pid]) out.push(S.byPid[pid]); }));
  return out;
}
function rangeOf(p) {
  const pid = pidOf(p);
  let r = S.setup.ranges[pid];
  if (!r) {
    r = p.type === 'number'
      ? (p.isFloat ? { mode: 'range', start: 0.5, end: 10, step: 0.5, list: '' } : { mode: 'range', start: 1, end: 200, step: 1, list: '' })
      : { mode: 'range', opts: [...(p.options || [])], list: '' };
    S.setup.ranges[pid] = r;
  }
  if (!r.opts) r.opts = [];
  return r;
}
function valuesOf(p) {
  const r = rangeOf(p);
  if (p.type === 'bool') return [true, false];
  if (p.type === 'number') {
    if (r.mode === 'fixed') return [];
    if (r.mode === 'values') return JAZ.listValues(r.list, 'number');
    return JAZ.rangeValues(num(r.start), num(r.end), num(r.step));
  }
  return p.options?.length ? r.opts.slice() : JAZ.listValues(r.list, 'text');
}
function rangeText(p) {
  const r = rangeOf(p);
  if (p.type === 'bool') return 'Oui / Non';
  if (p.type === 'number') return r.mode === 'range' ? `${r.start} → ${r.end} (pas ${r.step})` : r.mode === 'values' ? r.list : 'fixe';
  return valuesOf(p).join(', ');
}
function avgSec() {
  const r = S.run;
  if (r && r.done > 5) return Math.max(0.3, ((r.endedAt || Date.now()) - r.startedAt - (r.pausedMs || 0)) / r.done / 1000);
  return num(S.opts.secPerTest) || 2;
}

/* ---------- Navigation ---------- */
const SCREENS = {
  strategies: { title: 'Choisir une stratégie' },
  params: { title: 'Indicateurs et paramètres', steps: 1, top: ['← Changer de stratégie', 'strategies'] },
  ranges: { title: 'Plages de test', steps: 2, top: ['← Changer de stratégie', 'strategies'] },
  confirm: { title: 'Confirmer et lancer', steps: 3, top: ['← Changer de stratégie', 'strategies'] },
  run: { title: 'Optimisation' },
  results: { title: 'Résultats', top: ['← Historique', 'history'] },
  history: { title: 'Historique des résultats' },
  options: { title: 'Options' },
  help: { title: 'Aide' }
};
function go(screen) {
  $('#menu').classList.add('hidden');
  if (screen === 'newtab') { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }); if (!IS_TAB) window.close(); return; }
  S.screen = screen; S.err = null;
  if (screen === 'strategies') loadList();
  if (screen === 'run') checkAlive();
  render();
}
// Connexion automatique : si aucun graphique TradingView n'est ouvert, on l'ouvre
async function openTradingView() {
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tv = /^https:\/\/([a-z]+\.)?tradingview\.com\//.test(cur?.url || '');
  if (tv && !IS_TAB) await chrome.tabs.update(cur.id, { url: 'https://www.tradingview.com/chart/' });
  else await chrome.tabs.create({ url: 'https://www.tradingview.com/chart/' });
  if (!IS_TAB) window.close();
}
async function loadList() {
  S.list = null; render();
  try {
    if (!S.tabId && !(await findTab())) { S.busy = 'Ouverture de TradingView…'; render(); return openTradingView(); }
    S.list = await send({ cmd: 'list' });
  }
  catch (e) { S.err = e.message; S.list = { items: [], dialog: null }; }
  render();
}
async function checkAlive() {
  try { S.alive = (await send({ cmd: 'ping' })).running; } catch { S.alive = false; }
  if (S.screen === 'run') render();
}

function render() {
  const sc = SCREENS[S.screen];
  $('#title').textContent = sc.title;
  $('#stepsBar').innerHTML = sc.steps ? [1, 2, 3].map((i) => `<i class="${i <= sc.steps ? 'on' : ''}"></i>`).join('') : '';
  const tl = $('#topLink');
  if (sc.top) { tl.textContent = sc.top[0]; tl.dataset.go = sc.top[1]; tl.classList.remove('hidden'); } else tl.classList.add('hidden');
  const fa = $('#footAction');
  if (S.screen === 'strategies') { fa.textContent = '🔄 Actualiser'; fa.classList.remove('hidden'); } else fa.classList.add('hidden');
  $('#menuRun').classList.toggle('hidden', !S.run);

  let h = S.update ? `<div class="card small" style="border-color:var(--blue)">🔔 Nouvelle version <b>${esc(S.update.version)}</b> disponible. <a class="blue" href="${esc(S.update.url)}" target="_blank">Télécharger</a></div>` : '';
  h += S.err ? `<div class="err">${esc(S.err)}</div>` : '';
  if (S.busy) h += `<div class="spin"></div><p class="muted" style="text-align:center">${esc(S.busy)}</p>`;
  else h += ({ strategies: vStrategies, params: vParams, ranges: vRanges, confirm: vConfirm, run: vRun, results: vResults, history: vHistory, options: vOptions, help: vHelp })[S.screen]();
  const y = view.scrollTop;
  view.innerHTML = h;
  view.scrollTop = y;
}

/* ---------- Écrans ---------- */
function vStrategies() {
  if (!S.list) return `<div class="spin"></div><p class="muted" style="text-align:center">Recherche des stratégies sur le graphique…</p>`;
  let h = `<p class="muted">Si aucune stratégie n'apparaît, ajoutez une stratégie valide sur votre graphique TradingView.</p>`;
  if (!S.list.items.length) h += `<div class="empty">Aucune stratégie détectée sur le graphique.</div>`;
  S.list.items.forEach((n, i) => { h += `<div class="row"><b title="${esc(n)}">${esc(n)}</b><button class="btn sm primary" data-act="pick" data-i="${i}">Optimiser</button></div>`; });
  h += `<div class="card small"><h3>Votre stratégie n'est pas dans la liste ?</h3>
    <p class="muted">Sur TradingView, ouvrez sa fenêtre de paramètres (roue dentée ⚙ à côté de son nom), puis :</p>
    <button class="btn sm ghost" data-act="useOpen">Utiliser la fenêtre ouverte${S.list.dialog ? ' — ' + esc(S.list.dialog) : ''}</button></div>`;
  return h;
}

function vParams() {
  const gs = orderedGroups();
  const active = gs.filter((g) => (S.setup.sel[g.name] || []).length);
  let h = `<p>Stratégie : <b class="blue">${esc(S.scan.strategy)}</b></p>`;
  if (!S.scan.report) h += `<div class="err">Le rapport de stratégie n'est pas visible : ouvrez le panneau « Rapport de stratégie » sous le graphique avant de lancer.</div>`;
  h += `<p class="muted small">① Cochez les indicateurs à optimiser · ② choisissez leurs paramètres (le numéro = ordre de passage) · ③ réglez l'ordre des indicateurs avec ▲▼.</p>
    <div class="toggle-all"><button class="btn sm ghost" data-act="none">Tout décocher</button></div>`;
  gs.forEach((g, gi) => {
    const sel = S.setup.sel[g.name] || [];
    const on = sel.length > 0, ai = active.indexOf(g);
    const nOpt = g.params.filter(optimizable).length;
    h += `<section class="grp ${on ? 'on' : ''}"><div class="grp-h">
      <label><input type="checkbox" data-act="grp" data-g="${gi}" ${on ? 'checked' : ''} ${nOpt ? '' : 'disabled'}>${on ? `<span class="ord">${ai + 1}</span>` : ''}<span class="name" title="${esc(g.name)}">${esc(g.name)}</span></label>
      <span class="cnt">${sel.length}/${nOpt}</span>
      <div class="mv"><button data-act="up" data-g="${gi}" ${gi === 0 ? 'disabled' : ''} title="Monter">▲</button><button data-act="down" data-g="${gi}" ${gi === gs.length - 1 ? 'disabled' : ''} title="Descendre">▼</button></div>
      </div><div class="chips">`;
    g.params.forEach((p) => {
      const pid = pidOf(p), k = sel.indexOf(pid), ok = optimizable(p);
      h += `<button class="chip ${k >= 0 ? 'on' : ''} ${ok ? '' : 'off'}" data-act="chip" data-g="${gi}" data-pid="${esc(pid)}" ${ok ? '' : 'disabled title="Non optimisable (texte ou désactivé)"'}>${k >= 0 ? `<i class="badge">${k + 1}</i>` : ''}${esc(p.label)} <small>${esc(fmtVal(p.value))}</small></button>`;
    });
    h += `</div></section>`;
  });
  const n = selectedSteps().length;
  h += `<div class="actions"><span class="muted small" style="align-self:center">${n} paramètre(s) dans ${active.length} indicateur(s)</span><button class="btn primary" data-act="to" data-s="ranges" ${n ? '' : 'disabled'}>Continuer</button></div>`;
  return h;
}

function vRanges() {
  const steps = selectedSteps();
  let h = `<p class="muted small">Pour chaque paramètre : début, fin et pas du décompte. Ils seront testés un par un, dans cet ordre.</p>
    <div class="card"><h3>Remplir tous les paramètres numériques</h3><div class="quick">
      <div><label class="muted small">Début</label><input id="qS" value="1"></div>
      <div><label class="muted small">Fin</label><input id="qE" value="200"></div>
      <div><label class="muted small">Pas</label><input id="qP" value="1"></div>
      <button class="btn sm primary" data-act="quick">Appliquer</button></div></div>`;
  steps.forEach((p, i) => {
    const pid = esc(pidOf(p)), r = rangeOf(p);
    h += `<div class="pcard"><div class="hd"><span class="num">#${i + 1}</span><b title="${esc(p.label)}">${esc(p.label)}</b><span class="tag">${typeName(p)}</span></div>
      <div class="muted small" style="margin:-4px 0 8px">${esc(p.group)} · valeur actuelle : ${esc(fmtVal(p.value))}</div>`;
    if (p.type === 'number') {
      h += `<div class="seg">${[['range', '↔ Plage'], ['values', '# Valeurs'], ['fixed', '🔒 Fixe']].map(([m, l]) => `<button class="${r.mode === m ? 'on' : ''}" data-act="mode" data-pid="${pid}" data-m="${m}">${l}</button>`).join('')}</div>`;
      if (r.mode === 'range') h += `<div class="grid3">
        <div><label>Début</label><input data-f="start" data-pid="${pid}" value="${esc(r.start)}" inputmode="decimal"></div>
        <div><label>Fin</label><input data-f="end" data-pid="${pid}" value="${esc(r.end)}" inputmode="decimal"></div>
        <div><label>Pas (incrément)</label><input data-f="step" data-pid="${pid}" value="${esc(r.step)}" inputmode="decimal"></div></div>`;
      else if (r.mode === 'values') h += `<div class="fld"><label>Valeurs à tester, séparées par ;</label><input data-f="list" data-pid="${pid}" placeholder="ex : 5; 9; 14; 21" value="${esc(r.list)}"></div>`;
      else h += `<p class="muted small">Ce paramètre garde sa valeur actuelle (aucun test).</p>`;
    } else if (p.type === 'bool') {
      h += `<p class="muted small">Teste « Activé » puis « Désactivé » et garde le meilleur.</p>`;
    } else if (p.options?.length) {
      h += `<div class="opts">${p.options.map((o) => `<label><input type="checkbox" data-f="opt" data-pid="${pid}" data-o="${esc(o)}" ${r.opts.includes(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
    } else {
      h += `<div class="fld"><label>Choix à tester, séparés par ; (exactement comme dans TradingView)</label><input data-f="list" data-pid="${pid}" placeholder="ex : close; open; hl2" value="${esc(r.list)}"></div>`;
    }
    h += `<div class="runs" data-runs="${pid}">${valuesOf(p).length} test(s)</div></div>`;
  });
  const tot = steps.reduce((a, p) => a + valuesOf(p).length, 0);
  h += `<div class="actions"><button class="btn ghost" data-act="to" data-s="params">Retour</button><button class="btn primary" data-act="to" data-s="confirm" id="toConfirm" ${tot ? '' : 'disabled'}>Continuer</button></div>`;
  return h;
}

function vConfirm() {
  const steps = selectedSteps().filter((p) => valuesOf(p).length);
  const passes = Math.max(1, parseInt(S.setup.passes) || 1);
  const per = steps.reduce((a, p) => a + valuesOf(p).length, 0);
  const total = per * passes;
  const grid = steps.reduce((a, p) => a * valuesOf(p).length, 1);
  const st = S.setup;
  let h = `<p>Stratégie : <b class="blue">${esc(S.scan.strategy)}</b></p>
    <div class="card"><h3>Ordre d'optimisation</h3><table><tr><th>#</th><th>Indicateur</th><th>Paramètre</th><th>Plage</th><th class="r">Tests</th></tr>
    ${steps.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.group)}</td><td><b>${esc(p.label)}</b></td><td class="small">${esc(rangeText(p))}</td><td class="r">${valuesOf(p).length}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>Comment choisir la meilleure valeur</h3>
      <div class="fld"><select data-f="criterion">${Object.entries(JAZ.CRITERIA).map(([k, l]) => `<option value="${k}" ${st.criterion === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="grid3">
        <div><label>Drawdown max (%)</label><input data-f="maxDD" value="${esc(st.maxDD)}" placeholder="aucun"></div>
        <div><label>Trades minimum</label><input data-f="minTrades" value="${esc(st.minTrades)}" placeholder="aucun"></div>
        <div><label>Profit factor min</label><input data-f="minPF" value="${esc(st.minPF)}" placeholder="aucun"></div>
      </div>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" data-f="keep" ${st.keep ? 'checked' : ''}> Garder la valeur actuelle si aucun test ne fait mieux</label>
      <div class="fld"><label>Nombre de passes (refaire tout le cycle pour affiner)</label><input data-f="passes" value="${esc(st.passes)}" inputmode="numeric" style="width:90px"></div>
    </div>
    <div class="card"><div class="stats">
      <div><span>Tests à effectuer</span><b class="blue">${total.toLocaleString('fr-FR')}</b></div>
      <div><span>Durée estimée</span><b class="blue">~${JAZ.fmtDur((total + steps.length * passes + 1) * avgSec() * 1000)}</b></div>
      <div><span>Grille complète</span><b>${grid > 1e12 ? '> 10¹²' : grid.toLocaleString('fr-FR')}</b></div>
    </div><p class="muted small" style="margin:8px 0 0">Optimisation paramètre par paramètre : ${total.toLocaleString('fr-FR')} tests au lieu de ${grid > 1e12 ? 'plus de mille milliards' : grid.toLocaleString('fr-FR')} pour tester toutes les combinaisons.</p></div>
    <div class="actions"><button class="btn ghost" data-act="to" data-s="ranges">Retour</button><button class="btn primary" data-act="start" ${steps.length ? '' : 'disabled'}>🚀 Lancer l'optimisation</button></div>`;
  return h;
}

// Montant + pourcentage pour profit net, drawdown et taux de réussite
const money = (v) => (v == null ? '—' : JAZ.fmt(v, 2));
const pctTxt = (v) => (v == null ? '—' : JAZ.fmt(v, 2) + ' %');
const winsTxt = (m) => (m.wins != null && m.trades != null ? `${m.wins}/${m.trades} trades` : m.trades != null ? `${m.trades} trades` : '—');
const MET = {
  net: (m) => [money(m.net), pctTxt(m.netPct)],
  dd: (m) => [money(m.dd), pctTxt(m.ddPct)],
  win: (m) => [pctTxt(m.win), winsTxt(m)],
  pf: (m) => [m.pf == null ? '—' : JAZ.fmt(m.pf, 3), '']
};
function metricCell(label, key, m, base) {
  const [a, b] = MET[key](m || {}), [c, d] = MET[key](base || {});
  const cls = key === 'dd' ? 'red' : (m?.net ?? 0) < 0 && key === 'net' ? 'neg' : 'pos';
  return `<div><span>${label}</span><b class="${cls}">${a}</b><span class="small">${b}</span>${base ? `<span class="small muted">départ : ${c}${d ? ' · ' + d : ''}</span>` : ''}</div>`;
}
const two = (key, m, cls = '') => { const [a, b] = MET[key](m || {}); return `<span class="${cls}">${a}</span>${b ? `<div class="muted small">${b}</div>` : ''}`; };

function vRun() {
  const r = S.run;
  if (!r) return `<div class="empty">Aucune optimisation en cours.</div><div class="actions"><span></span><button class="btn primary" data-act="to" data-s="strategies">Choisir une stratégie</button></div>`;
  const steps = r.config.steps, cur = steps[Math.min(r.cursor.step, steps.length - 1)];
  const live = ['running', 'paused'].includes(r.status);
  const status = live && S.alive === false ? 'interrupted' : r.status;
  const L = { running: 'En cours', paused: 'En pause', done: 'Terminée', stopped: 'Arrêtée', error: 'Erreur', interrupted: 'Interrompue' };
  const el = (r.endedAt || Date.now()) - r.startedAt - (r.pausedMs || 0);
  const sp = r.done ? el / r.done : null;
  const pct = r.total ? Math.min(100, (r.done / r.total) * 100) : 0;
  const bm = r.best?.m || {}, b0 = r.baseline?.m || {};
  let h = `<div class="row"><div style="min-width:0"><div class="muted small">Stratégie</div><b>${esc(r.strategy)}</b></div><span class="status ${status}">${L[status] || status}</span></div>`;
  if (status === 'error') h += `<div class="err"><b>Erreur :</b> ${esc(r.error)}<br><span class="small">Corrigez puis cliquez sur « Reprendre ». En cas de doute : Options → Diagnostic.</span></div>`;
  if (status === 'interrupted') h += `<div class="err">L'optimisation s'est interrompue (page TradingView rechargée ou fermée). Laissez le graphique ouvert puis cliquez sur « Reprendre » : elle repart où elle s'était arrêtée.</div>`;
  if (cur && live) h += `<div class="card"><div class="kv">
      <span>Indicateur</span><b>${esc(cur.group)}</b>
      <span>Paramètre</span><b>${esc(cur.label)} <span class="muted small">(${r.cursor.step + 1}/${steps.length}${r.config.passes > 1 ? ` · passe ${r.cursor.pass + 1}/${r.config.passes}` : ''})</span></b>
      <span>Valeur testée</span><b class="blue">${esc(fmtVal(r.curValue))}</b></div>
      <div class="bar"><i style="width:${cur.values.length ? (r.cursor.val / cur.values.length) * 100 : 0}%"></i></div>
      <div class="muted small">${r.cursor.val} / ${cur.values.length} valeurs pour ce paramètre</div></div>`;
  // Détail en direct de chaque valeur testée pour le paramètre en cours
  if (cur && live) {
    const list = r.results.filter((x) => x.p === r.cursor.pass && x.s === r.cursor.step);
    if (list.length) {
      let best = null; for (const x of list) if (JAZ.better(x, best)) best = x;
      h += `<div class="card"><h3>Tests de « ${esc(cur.label)} » — meilleure valeur pour l'instant : <span class="blue">${esc(fmtVal(best.v))}</span></h3>
        <table><tr><th>Valeur</th><th class="r">Profit net</th><th class="r">Drawdown</th><th class="r">Réussite</th><th class="r">PF</th></tr>
        ${list.slice(-40).reverse().map((x) => `<tr class="${x === best ? 'best' : ''}"><td>${esc(fmtVal(x.v))}${x === best ? ' ★' : ''}</td><td class="r">${two('net', x.m, x.m.net < 0 ? 'neg' : '')}</td><td class="r">${two('dd', x.m)}</td><td class="r">${two('win', x.m)}</td><td class="r">${JAZ.fmt(x.m.pf, 3)}</td></tr>`).join('')}
        </table>${list.length > 40 ? `<p class="muted small">40 derniers tests affichés sur ${list.length}.</p>` : ''}</div>`;
    }
  }
  h += `<div class="card"><div class="muted small">Progression globale : ${r.done} / ${r.total} tests</div><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="stats"><div><span>Écoulé</span><b>${JAZ.fmtDur(el)}</b></div><div><span>Vitesse</span><b>${sp ? (sp / 1000).toFixed(1) + ' s/test' : '—'}</b></div><div><span>Restant</span><b>${sp && live ? '~' + JAZ.fmtDur(sp * (r.total - r.done)) : '—'}</b></div></div></div>
    <div class="card"><h3>Meilleur résultat actuel</h3><div class="stats two">
      ${metricCell('Profit net', 'net', bm, b0)}${metricCell('Drawdown', 'dd', bm, b0)}${metricCell('Taux de réussite', 'win', bm, b0)}${metricCell('Profit factor', 'pf', bm, b0)}</div></div>`;
  if (r.chosen.length) h += `<div class="card"><h3>Paramètres terminés</h3><table>${r.chosen.map((c) => `<tr><td>${esc(c.label)}<div class="muted small">${esc(c.group)}</div></td><td class="r">${esc(fmtVal(c.before))} → <b class="blue">${esc(fmtVal(c.value))}</b>${c.kept ? ' <span class="muted small">(conservée)</span>' : ''}</td></tr>`).join('')}</table></div>`;
  h += `<p class="muted small">${esc(r.msg || '')}</p>`;
  if (live && status !== 'interrupted') h += `<p class="muted small">Vous pouvez fermer cette fenêtre : l'optimisation continue dans l'onglet TradingView (gardez-le ouvert).</p>`;
  h += `<div class="actions">`;
  if (status === 'running') h += `<button class="btn warn" data-act="pause">⏸ Pause</button><button class="btn danger" data-act="stop">⏹ Arrêter</button>`;
  else if (status === 'paused') h += `<button class="btn primary" data-act="unpause">▶ Reprendre</button><button class="btn danger" data-act="stop">⏹ Arrêter</button>`;
  else if (status === 'interrupted' || status === 'error') h += `<button class="btn ghost" data-act="results">Résultats partiels</button><button class="btn primary" data-act="resume">▶ Reprendre</button>`;
  else h += `<button class="btn ghost" data-act="to" data-s="strategies">Nouvelle optimisation</button><button class="btn primary" data-act="results">Voir les résultats</button>`;
  return h + `</div>`;
}

function vResults() {
  const r = S.view;
  if (!r) return `<div class="empty">Aucun résultat.</div>`;
  const a = r.best?.m || {}, b = r.baseline?.m || {};
  const line = (l, key) => `<tr><td>${l}</td><td class="r">${two(key, b)}</td><td class="r"><b>${two(key, a, 'blue')}</b></td></tr>`;
  let h = `<p>Stratégie : <b class="blue">${esc(r.strategy)}</b> <span class="muted small">· ${new Date(r.startedAt).toLocaleString('fr-FR')} · ${r.done} tests</span></p>
    <div class="card"><h3>Avant / après</h3><table><tr><th></th><th class="r">Avant</th><th class="r">Après</th></tr>
      ${line('Profit net', 'net')}${line('Drawdown', 'dd')}${line('Taux de réussite', 'win')}${line('Profit factor', 'pf')}</table></div>
    <div class="card"><h3>Réglages retenus</h3><table><tr><th>Paramètre</th><th class="r">Avant</th><th class="r">Après</th></tr>
      ${r.config.steps.map((s) => { const x = r.initial?.[s.key], y = r.current?.[s.key], ch = String(x) !== String(y); return `<tr><td>${esc(s.label)}<div class="muted small">${esc(s.group)}</div></td><td class="r">${esc(fmtVal(x))}</td><td class="r">${ch ? `<b class="blue">${esc(fmtVal(y))}</b>` : esc(fmtVal(y))}</td></tr>`; }).join('')}</table></div>
    <h3 style="font-size:13px;margin:12px 0 8px">Détail des tests</h3>`;
  r.config.steps.forEach((s, si) => {
    for (let p = 0; p < r.config.passes; p++) {
      const list = r.results.filter((x) => x.s === si && x.p === p);
      if (!list.length) continue;
      const ch = r.chosen.find((c) => c.s === si && c.p === p);
      const sorted = list.slice().sort((x, y) => (JAZ.better(x, y) ? -1 : 1));
      h += `<details><summary><b>${esc(s.label)}</b> <span class="muted small">${esc(s.group)}${r.config.passes > 1 ? ' · passe ' + (p + 1) : ''} · ${list.length} tests · retenu : ${esc(fmtVal(ch?.value))}</span></summary><div><table>
        <tr><th>Valeur</th><th class="r">Profit net</th><th class="r">Drawdown</th><th class="r">Réussite</th><th class="r">PF</th></tr>
        ${sorted.slice(0, 100).map((x) => `<tr class="${ch && String(ch.value) === String(x.v) ? 'best' : ''}"><td>${esc(fmtVal(x.v))}</td><td class="r">${two('net', x.m, x.m.net < 0 ? 'neg' : '')}</td><td class="r">${two('dd', x.m)}</td><td class="r">${two('win', x.m)}</td><td class="r">${JAZ.fmt(x.m.pf, 3)}</td></tr>`).join('')}
        </table>${sorted.length > 100 ? `<p class="muted small">… 100 meilleurs affichés sur ${sorted.length} (tout est dans l'export CSV).</p>` : ''}</div></details>`;
    }
  });
  h += `<div class="actions"><button class="btn ghost" data-act="csv">⬇ Exporter CSV</button><button class="btn primary" data-act="apply">Appliquer ces réglages</button></div>`;
  return h;
}

function vHistory() {
  const list = S.history || [];
  if (!S.history) { loadHistory(); return `<div class="spin"></div>`; }
  if (!list.length) return `<div class="empty">Aucun résultat enregistré pour l'instant.</div>`;
  let h = '';
  list.forEach((r, i) => {
    const b = r.baseline?.m || {}, a = r.best?.m || {};
    h += `<div class="row"><div style="min-width:0"><b>${esc(r.strategy)}</b><div class="muted small">${new Date(r.startedAt).toLocaleString('fr-FR')} · ${r.done} tests · ${r.status === 'done' ? 'terminée' : 'arrêtée'}</div><div class="small">Profit net : ${money(b.net)} (${pctTxt(b.netPct)}) → <b class="blue">${money(a.net)} (${pctTxt(a.netPct)})</b></div><div class="small">Drawdown : ${money(a.dd)} (${pctTxt(a.ddPct)}) · Réussite : ${pctTxt(a.win)} (${winsTxt(a)})</div></div><button class="btn sm primary" data-act="openHist" data-i="${i}">Voir</button></div>`;
  });
  h += `<div class="actions"><span></span><button class="btn sm ghost" data-act="clearHist">Effacer l'historique</button></div>`;
  return h;
}
async function loadHistory() { S.history = (await chrome.storage.local.get('jaz_history')).jaz_history || []; render(); }

function vOptions() {
  const o = S.opts, lb = o.labels || {};
  const fld = (k, l, ph = '') => `<div class="fld"><label>${l}</label><input data-o="${k}" value="${esc(o[k])}" placeholder="${esc(ph)}"></div>`;
  const lab = (k, l, ph) => `<div class="fld"><label>${l}</label><input data-l="${k}" value="${esc(lb[k] || '')}" placeholder="${esc(ph)}"></div>`;
  return `<div class="card"><h3>Vitesse et attente</h3>
      ${fld('settleMs', 'Stabilité du résultat avant lecture (ms)')}
      ${fld('noChangeMs', 'Attente si le résultat ne change pas (ms)')}
      ${fld('timeoutMs', 'Attente maximale par test (ms)')}
      ${fld('secPerTest', 'Secondes par test pour l\'estimation')}
      <div class="fld"><label>Méthode d'application des valeurs</label><select data-o="mode">
        <option value="live" ${o.mode === 'live' ? 'selected' : ''}>Rapide : fenêtre de paramètres ouverte (recommandé)</option>
        <option value="ok" ${o.mode === 'ok' ? 'selected' : ''}>Sûre : valider avec OK à chaque test (plus lent)</option></select></div></div>
    <div class="card"><h3>Libellés du rapport (si TradingView les change)</h3>
      <p class="muted small">À remplir seulement si le diagnostic ne trouve pas une métrique. Écrivez le libellé exact affiché dans votre rapport (plusieurs possibles avec |).</p>
      ${lab('net', 'Profit net', 'ex : Total PnL')}${lab('dd', 'Drawdown', 'ex : Aspiration maximale')}${lab('win', 'Taux de réussite', 'ex : Trades rentables')}${lab('pf', 'Profit factor', 'ex : Facteur de profit')}${lab('trades', 'Nombre de trades', 'ex : Total des trades')}</div>
    <div class="card"><h3>Diagnostic</h3><p class="muted small">Vérifie ce que l'extension lit sur votre page TradingView (stratégies, paramètres, métriques). Le texte est copié : envoyez-le si quelque chose ne marche pas.</p>
      <button class="btn sm ghost" data-act="diag">Lancer le diagnostic</button>${S.diag ? `<textarea readonly style="margin-top:8px">${esc(S.diag)}</textarea>` : ''}</div>
    <div class="actions"><button class="btn ghost" data-act="resetOpts">Valeurs par défaut</button><button class="btn primary" data-act="saveOpts">Enregistrer</button></div>`;
}

function vHelp() {
  return `<div class="card small"><h3>Utilisation</h3><ol style="margin:0;padding-left:18px">
    <li>Ouvrez votre graphique TradingView avec votre stratégie et le panneau <b>Rapport de stratégie</b> visible.</li>
    <li>Cliquez sur l'icône JAZ → <b>Optimiser</b> à côté de votre stratégie.</li>
    <li>Cochez les <b>indicateurs</b>, puis les <b>paramètres</b> de votre choix. Réglez l'ordre des indicateurs avec ▲▼.</li>
    <li>Pour chaque paramètre : <b>début</b>, <b>fin</b> et <b>pas</b> (ex. 1 → 200, pas 1).</li>
    <li>Choisissez le critère puis <b>Lancer</b>. Le 1er paramètre du 1er indicateur est testé du début à la fin, la meilleure valeur est gardée, puis on passe au paramètre suivant, puis à l'indicateur suivant.</li>
    <li>À la fin, les meilleurs réglages sont appliqués à la stratégie (bouton OK de TradingView).</li></ol></div>
    <div class="card small"><h3>Conseils</h3><ul style="margin:0;padding-left:18px">
    <li>Les « indicateurs » sont les groupes de l'onglet <b>Entrées</b> de votre script (option <code>group=</code> en Pine Script).</li>
    <li>Gardez l'onglet TradingView ouvert et visible pendant l'optimisation.</li>
    <li>Si quelque chose n'est pas lu correctement : Options → Diagnostic.</li>
    <li>Un réglage trop optimisé sur le passé peut moins bien marcher en réel : vérifiez-le sur une autre période.</li></ul></div>`;
}

/* ---------- Actions ---------- */
async function scanStrategy(name, useOpen) {
  S.busy = 'Lecture des indicateurs et paramètres…'; S.err = null; render();
  try {
    const r = await send({ cmd: 'scan', name, useOpen });
    S.scan = r; S.byPid = {};
    r.params.forEach((p) => { S.byPid[pidOf(p)] = p; });
    await loadSetup(r.strategy);
    S.busy = null; go('params');
  } catch (e) { S.busy = null; S.err = e.message; render(); }
}

async function startRun() {
  const steps = selectedSteps().filter((p) => valuesOf(p).length)
    .map((p) => ({ key: p.key, label: p.label, group: p.group, type: p.type, values: valuesOf(p) }));
  const st = S.setup;
  const config = {
    steps, criterion: st.criterion, passes: Math.max(1, parseInt(st.passes) || 1), keepIfNoImprove: !!st.keep,
    filters: { maxDD: num(st.maxDD) || 0, minTrades: num(st.minTrades) || 0, minPF: num(st.minPF) || 0 }
  };
  S.busy = 'Démarrage de l\'optimisation…'; render();
  try {
    await send({ cmd: 'start', strategy: S.scan.strategy, config });
    await chrome.storage.local.set({ jaz_runTab: S.tabId });
    S.run = (await chrome.storage.local.get('jaz_run')).jaz_run;
    S.alive = true; S.busy = null; go('run');
  } catch (e) { S.busy = null; S.err = e.message; render(); }
}

function csvCell(v) {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  const s = String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv(r) {
  const L = [['Passe', 'Indicateur', 'Paramètre', 'Valeur', 'Profit net', 'Profit net %', 'Drawdown', 'Drawdown %', 'Réussite %', 'Trades gagnants', 'Profit factor', 'Trades', 'Retenu'].join(';')];
  r.results.forEach((x) => {
    const s = r.config.steps[x.s], ch = r.chosen.find((c) => c.p === x.p && c.s === x.s);
    L.push([x.p + 1, s.group, s.label, x.v, x.m.net, x.m.netPct, x.m.dd, x.m.ddPct, x.m.win, x.m.wins, x.m.pf, x.m.trades, ch && String(ch.value) === String(x.v) ? 'oui' : ''].map(csvCell).join(';'));
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `JAZ_${r.strategy.replace(/[^\w-]+/g, '_')}_${new Date(r.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click();
}

view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const a = t.dataset.act;
  const gs = S.scan && S.setup ? orderedGroups() : [];
  try {
    switch (a) {
      case 'pick': return scanStrategy(S.list.items[+t.dataset.i], false);
      case 'useOpen': return scanStrategy(null, true);
      case 'to': S.screen = t.dataset.s; S.err = null; render(); view.scrollTop = 0; return;
      case 'grp': {
        const g = gs[+t.dataset.g];
        S.setup.sel[g.name] = (S.setup.sel[g.name] || []).length ? [] : g.params.filter(optimizable).map(pidOf);
        break;
      }
      case 'chip': {
        const g = gs[+t.dataset.g], pid = t.dataset.pid, sel = S.setup.sel[g.name] || [];
        S.setup.sel[g.name] = sel.includes(pid) ? sel.filter((x) => x !== pid) : [...sel, pid];
        break;
      }
      case 'up': case 'down': {
        const i = +t.dataset.g, j = a === 'up' ? i - 1 : i + 1, o = S.setup.order;
        [o[i], o[j]] = [o[j], o[i]];
        break;
      }
      case 'none': S.setup.sel = {}; break;
      case 'mode': rangeOf(S.byPid[t.dataset.pid]).mode = t.dataset.m; break;
      case 'quick': selectedSteps().filter((p) => p.type === 'number').forEach((p) => Object.assign(rangeOf(p), { mode: 'range', start: $('#qS').value, end: $('#qE').value, step: $('#qP').value })); break;
      case 'start': return startRun();
      case 'pause': case 'unpause': case 'stop':
        if (a === 'stop' && !confirm('Arrêter l\'optimisation ? Les meilleurs réglages trouvés jusqu\'ici seront appliqués.')) return;
        await send({ cmd: a }); return;
      case 'resume': await send({ cmd: 'resume' }); S.alive = true; render(); return;
      case 'results': S.view = S.run; S.screen = 'results'; render(); view.scrollTop = 0; return;
      case 'openHist': S.view = S.history[+t.dataset.i]; S.screen = 'results'; render(); view.scrollTop = 0; return;
      case 'clearHist': if (confirm('Effacer tout l\'historique ?')) { await chrome.storage.local.set({ jaz_history: [] }); S.history = []; render(); } return;
      case 'csv': return exportCsv(S.view);
      case 'apply':
        S.busy = 'Application des réglages…'; render();
        try { await send({ cmd: 'apply', strategy: S.view.strategy, values: S.view.current, steps: S.view.config.steps }); S.busy = null; S.err = null; render(); alert('Réglages appliqués à la stratégie.'); }
        catch (err) { S.busy = null; S.err = err.message; render(); }
        return;
      case 'diag':
        S.diag = 'Analyse…'; render();
        try { S.diag = (await send({ cmd: 'diag' })).text; navigator.clipboard?.writeText(S.diag).catch(() => {}); }
        catch (err) { S.diag = 'Erreur : ' + err.message; }
        render(); return;
      case 'saveOpts': {
        const o = { ...S.opts, labels: {} };
        view.querySelectorAll('[data-o]').forEach((i) => { o[i.dataset.o] = i.tagName === 'SELECT' ? i.value : (num(i.value) || DEF_OPTS[i.dataset.o]); });
        view.querySelectorAll('[data-l]').forEach((i) => { if (i.value.trim()) o.labels[i.dataset.l] = i.value.trim(); });
        S.opts = o; await chrome.storage.local.set({ jaz_opts: o }); S.err = null; render(); alert('Options enregistrées.');
        return;
      }
      case 'resetOpts': S.opts = { ...DEF_OPTS }; await chrome.storage.local.set({ jaz_opts: S.opts }); render(); return;
      default: return;
    }
    saveSetup(); render();
  } catch (err) { S.err = err.message; render(); }
});

function refreshCounts() {
  let tot = 0;
  selectedSteps().forEach((p) => {
    const n = valuesOf(p).length; tot += n;
    const el = view.querySelector(`[data-runs="${CSS.escape(pidOf(p))}"]`);
    if (el) el.textContent = `${n} test(s)`;
  });
  const b = $('#toConfirm'); if (b) b.disabled = !tot;
}
view.addEventListener('input', (e) => {
  const t = e.target, f = t.dataset.f;
  if (!f || !S.setup) return;
  if (t.dataset.pid && ['start', 'end', 'step', 'list'].includes(f)) { rangeOf(S.byPid[t.dataset.pid])[f] = t.value; refreshCounts(); saveSetup(); }
});
view.addEventListener('change', (e) => {
  const t = e.target, f = t.dataset.f;
  if (!f || !S.setup) return;
  if (f === 'opt') {
    const r = rangeOf(S.byPid[t.dataset.pid]), o = t.dataset.o;
    r.opts = t.checked ? [...new Set([...r.opts, o])] : r.opts.filter((x) => x !== o);
    refreshCounts();
  } else if (['criterion', 'maxDD', 'minTrades', 'minPF', 'passes'].includes(f)) { S.setup[f] = t.value; render(); }
  else if (f === 'keep') S.setup.keep = t.checked;
  saveSetup();
});

$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
$('#menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  if (b.dataset.go === 'history') S.history = null;
  if (b.dataset.go === 'run') checkAlive();
  go(b.dataset.go);
});
$('#topLink').addEventListener('click', (e) => { if (e.currentTarget.dataset.go === 'history') S.history = null; go(e.currentTarget.dataset.go); });
$('#footAction').addEventListener('click', () => loadList());

chrome.storage.onChanged.addListener((ch) => {
  if (ch.jaz_run) { S.run = ch.jaz_run.newValue || null; if (S.screen === 'run') render(); }
});
setInterval(() => { if (S.screen === 'run' && S.run?.status === 'running') render(); }, 1000);
setInterval(() => { if (S.screen === 'run' && S.run && ['running', 'paused'].includes(S.run.status)) checkAlive(); }, 5000);

(async () => {
  const st = await chrome.storage.local.get(['jaz_opts', 'jaz_run', 'jaz_runTab', 'jaz_update']);
  S.update = st.jaz_update || null;
  S.opts = { ...DEF_OPTS, ...(st.jaz_opts || {}) };
  S.run = st.jaz_run || null;
  if (S.run && ['running', 'paused', 'error'].includes(S.run.status)) {
    S.tabId = st.jaz_runTab || null;
    go('run');
  } else go('strategies');
})();
