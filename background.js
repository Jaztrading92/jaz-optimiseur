// Dépôt GitHub de l'extension (propriétaire/nom) — sert à prévenir des nouvelles versions
const JAZ_REPO = 'Jaztrading92/jaz-optimiseur';

// Notification de fin d'optimisation
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'reload') { chrome.runtime.reload(); return; }
  if (msg && msg.type === 'checkSelf') { checkSelf(); return; }
  if (msg && msg.type === 'notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: msg.title || 'JAZ Optimiseur',
      message: msg.message || ''
    });
  }
});

// Vérification des mises à jour sur GitHub (au démarrage puis toutes les 6 h)
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
async function checkUpdate() {
  if (!JAZ_REPO) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${JAZ_REPO}/releases/latest`);
    if (!r.ok) return;
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/i, '');
    const mine = chrome.runtime.getManifest().version;
    if (latest && newer(latest, mine)) {
      await chrome.storage.local.set({ jaz_update: { version: latest, url: j.html_url } });
      chrome.action.setBadgeText({ text: 'MAJ' });
      chrome.action.setBadgeBackgroundColor({ color: '#0078b7' });
    } else {
      await chrome.storage.local.remove('jaz_update');
      chrome.action.setBadgeText({ text: '' });
    }
  } catch { /* hors ligne : on réessaiera */ }
}
// Mise à jour automatique : jaz-update.ps1 remplace les fichiers sur le disque,
// l'extension le détecte (manifest.json du disque ≠ version chargée) et se recharge seule.
async function checkSelf() {
  try {
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' })).json();
    const loaded = chrome.runtime.getManifest().version;
    if (!disk.version || disk.version === loaded) return;
    const run = (await chrome.storage.local.get('jaz_run')).jaz_run;
    if (run && ['running', 'paused'].includes(run.status) && Date.now() - (run.updatedAt || 0) < 10 * 60e3) return; // jamais pendant une optimisation
    await chrome.storage.local.set({ jaz_selfupdate: { from: loaded, to: disk.version, at: Date.now() } });
    chrome.runtime.reload();
  } catch { /* fichiers en cours de copie : on réessaiera */ }
}
function schedule() {
  chrome.alarms.create('jaz-update', { periodInMinutes: 360 });
  chrome.alarms.create('jaz-self', { periodInMinutes: 5 });
}
chrome.runtime.onStartup.addListener(() => { schedule(); checkUpdate(); checkSelf(); });
chrome.runtime.onInstalled.addListener(async (d) => {
  schedule();
  checkUpdate();
  const su = (await chrome.storage.local.get('jaz_selfupdate')).jaz_selfupdate;
  if (d.reason === 'update' && su && su.to === chrome.runtime.getManifest().version) {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'JAZ Optimiseur mis à jour', message: `Version ${su.from} → ${su.to}` });
  }
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'jaz-update') checkUpdate(); if (a.name === 'jaz-self') checkSelf(); });
