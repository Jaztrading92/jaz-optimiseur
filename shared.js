// Fonctions communes (popup + moteur)
var JAZ = (() => {
  const CRITERIA = {
    ratio: 'Meilleur profit net avec le drawdown le plus bas (profit ÷ drawdown)',
    net: 'Profit net maximum',
    dd: 'Drawdown le plus bas (profit positif)',
    pf: 'Profit factor maximum',
    win: 'Taux de réussite maximum'
  };

  function rawScore(m, crit) {
    if (!m || m.net == null) return -Infinity;
    const dd = Math.abs(m.dd ?? 0);
    switch (crit) {
      case 'net': return m.net;
      case 'dd': return m.net > 0 ? -dd : -1e12 + m.net;
      case 'pf': return m.pf ?? -Infinity;
      case 'win': return m.win ?? -Infinity;
      default: return m.net > 0 ? m.net / Math.max(dd, 1e-9) : m.net - 1e9;
    }
  }

  function passes(m, f) {
    if (!m || !f) return true;
    if (f.minTrades && (m.trades ?? 0) < f.minTrades) return false;
    if (f.maxDD && m.ddPct != null && Math.abs(m.ddPct) > f.maxDD) return false;
    if (f.minPF && (m.pf ?? 0) < f.minPF) return false;
    return true;
  }

  // Score avec filtres (-Infinity si le test ne respecte pas les filtres)
  function score(m, crit, f) { return passes(m, f) ? rawScore(m, crit) : -Infinity; }

  // a meilleur que b ? (départage : profit net puis drawdown)
  function better(a, b) {
    if (!b) return true;
    if (a.score !== b.score) return a.score > b.score;
    const an = a.m?.net ?? -Infinity, bn = b.m?.net ?? -Infinity;
    if (an !== bn) return an > bn;
    return Math.abs(a.m?.dd ?? Infinity) < Math.abs(b.m?.dd ?? Infinity);
  }

  const decs = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

  function rangeValues(start, end, step) {
    start = +start; end = +end; step = Math.abs(+step);
    if (!isFinite(start)) return [];
    if (!isFinite(end) || !(step > 0)) return [start];
    const d = Math.max(decs(start), decs(end), decs(step));
    const dir = end >= start ? 1 : -1;
    const n = Math.floor(Math.abs(end - start) / step + 1e-9);
    const out = [];
    for (let i = 0; i <= n && out.length < 20000; i++) out.push(+(start + dir * i * step).toFixed(d));
    return out;
  }

  function listValues(txt, type) {
    return String(txt || '').split(/[;\n|]+/).map(s => s.trim()).filter(Boolean)
      .map(s => type === 'number' ? parseFloat(s.replace(',', '.')) : s)
      .filter(v => type !== 'number' || isFinite(v));
  }

  function fmt(v, d = 2) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtDur(ms) {
    if (!isFinite(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h} h ${m} min` : m ? `${m} min ${r} s` : `${r} s`;
  }

  return { CRITERIA, rawScore, passes, score, better, rangeValues, listValues, fmt, fmtDur };
})();
