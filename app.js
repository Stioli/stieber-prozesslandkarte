/*  Prozesslandkarte Autohaus Stieber
 *
 *  Daten: Supabase (Frankfurt), Tabellen mit Praefix pl_.
 *  Zugriff: nur nach Anmeldung und nur, wenn die E-Mail in pl_berechtigt steht.
 *  Row Level Security in der Datenbank setzt das durch - diese Seite ist nur
 *  die Oberflaeche, sie kann keine Rechte umgehen.
 *
 *  Anmeldung: E-Mail und Passwort, wie in den uebrigen Stieber-Apps. Alle Apps
 *  teilen dieselbe Benutzerverwaltung, wer hier angemeldet ist, ist es dort auch.
 *
 *  Aenderungen werden sofort gespeichert (beim Tippen kurz verzoegert).
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://mnglpqeqmoxccqnztqez.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CDpY6_W07WdHFKYv0cx59g_GDm7UlZF';

/*  detectSessionInUrl ist bewusst aus: der Automatismus arbeitet asynchron und
 *  hat nicht zuverlaessig gegriffen. Wir werten die Adresszeile selbst aus,
 *  siehe anmeldungAusAdresse() weiter unten. */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: false, flowType: 'implicit' }
});

/* ============================ Grundlagen ============================ */

const AMPEL = {
  rot:   { text: 'manuell',           lang: 'Vollständig manuell. Kein KI-Einsatz, obwohl er möglich wäre.' },
  gelb:  { text: 'teilautomatisiert', lang: 'KI unterstützt und bereitet vor, ein Mensch entscheidet oder prüft.' },
  gruen: { text: 'KI-automatisiert',  lang: 'KI erledigt den Schritt, ein Mensch greift nur bei Ausnahmen ein.' },
  grau:  { text: 'bewusst manuell',   lang: 'Bleibt bewusst beim Menschen — Beratung, Übergabe, Vertrauen.' }
};
const ORDNUNG = ['rot', 'gelb', 'gruen', 'grau'];
const DOKU = { offen: 'offen', arbeit: 'in Arbeit', dokumentiert: 'dokumentiert' };
const POTENZIAL = { '': 'nicht bewertet', kein: 'kein', gering: 'gering', mittel: 'mittel', hoch: 'hoch' };
const PRAEFIX = { 'Service': 'SER', 'Verkauf': 'VK', 'Teile & Lager': 'TL', 'Verwaltung': 'VW', 'Marketing': 'MK' };
const BEREICHE = Object.keys(PRAEFIX);

const S = {
  benutzer: null, rolle: null, darfSchreiben: false, istAdmin: false,
  prozesse: [], ansicht: 'uebersicht', offen: null,
  bereich: 'Alle', ampel: 'Alle', suche: '', sortierung: 'std',
  berechtigte: [], loeschfrage: null
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const de = (n, k) => Number(n || 0).toFixed(k === undefined ? 1 : k).replace('.', ',');
const stunden = (p) => (Number(p.dauer_min) || 0) * (Number(p.volumen_monat) || 0) / 60;
const zahlAus = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/* Ampel zusaetzlich ueber die Form erkennbar, nicht nur ueber die Farbe */
function glyph(k, g) {
  const s = g || 12;
  const kopf = `<svg width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true">`;
  if (k === 'rot')   return kopf + '<circle cx="6" cy="6" r="5" fill="currentColor"/></svg>';
  if (k === 'gelb')  return kopf + '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 1.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor"/></svg>';
  if (k === 'gruen') return kopf + '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.7 6.2 5.3 7.8 8.4 4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return kopf + '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.9 6h4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
}
const pille = (k) => `<span class="st ${k}">${glyph(k)}${esc(AMPEL[k].text)}</span>`;

const alleSchritte = (p) => (p.phasen || []).flatMap((ph) => ph.schritte || []);

/* Die Prozessampel ergibt sich aus den Schritten, sobald welche erfasst sind */
function ampelVon(p) {
  const s = alleSchritte(p);
  if (!s.length) return p.ampel || 'rot';
  const ohneGrau = s.filter((x) => x.ampel !== 'grau');
  if (!ohneGrau.length) return 'grau';
  if (ohneGrau.some((x) => x.ampel === 'rot')) return 'rot';
  if (ohneGrau.some((x) => x.ampel === 'gelb')) return 'gelb';
  return 'gruen';
}

let toastTimer = null;
function melde(text, art) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'toast' + (art === 'warn' ? ' warn' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, art === 'warn' ? 6000 : 2200);
}

function fehler(e, was) {
  console.error(was, e);
  const m = e && e.message ? e.message : String(e);
  melde(was + ': ' + m, 'warn');
}

/* ============================ Anmeldung ============================ */

const tor = document.getElementById('tor');
const app = document.getElementById('app');

function torMeldung(text, art) {
  const el = document.getElementById('tor-meldung');
  el.innerHTML = text;
  el.className = 'tor-meldung ' + (art || 'ok');
  el.hidden = false;
}

/* Verstaendliche Texte statt der englischen Rueckmeldungen von Supabase */
function anmeldeFehlerText(err) {
  const m = (err && err.message ? err.message : String(err)).toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-Mail-Adresse oder Passwort stimmt nicht.';
  if (m.includes('email not confirmed')) return 'Diese Adresse ist noch nicht bestätigt.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Zu viele Versuche. Bitte einen Moment warten.';
  return err && err.message ? err.message : String(err);
}

/* Anmeldung mit E-Mail und Passwort */
document.getElementById('anmeldung').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mail = document.getElementById('mail').value.trim().toLowerCase();
  const pw = document.getElementById('pw').value;
  const knopf = document.getElementById('knopf-anmelden');
  if (!mail || !pw) return;

  knopf.disabled = true;
  knopf.textContent = 'Wird geprüft …';
  document.getElementById('tor-meldung').hidden = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: mail, password: pw });
    if (error) throw error;
    document.getElementById('pw').value = '';
    gestartet = false;
    await starten(data.session);
  } catch (err) {
    torMeldung('<b>Anmeldung nicht möglich.</b><br>' + esc(anmeldeFehlerText(err)), 'warn');
    knopf.disabled = false;
    knopf.textContent = 'Anmelden';
  }
});

/* Notweg: Anmeldelink per E-Mail, falls das Passwort fehlt */
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-akt="linkstatt"]')) return;
  const mail = document.getElementById('mail').value.trim().toLowerCase();
  if (!mail) { torMeldung('Bitte zuerst Ihre E-Mail-Adresse eintragen.', 'warn'); return; }
  try {
    const { error } = await sb.auth.signInWithOtp({
      email: mail,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    torMeldung('<b>Anmeldelink verschickt.</b><br>Wir haben einen Link an ' + esc(mail)
      + ' geschickt. Er gilt eine Stunde. Bitte in <b>diesem</b> Browser öffnen.', 'ok');
  } catch (err) {
    torMeldung('<b>Der Anmeldelink konnte nicht versendet werden.</b><br>'
      + esc(anmeldeFehlerText(err)), 'warn');
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-akt="datenschutz-tor"]')) return;
  torMeldung(datenschutzKurz(), 'ok');
});

/* ============================ Daten laden ============================ */

async function ladeAlles() {
  const [pr, ph, sc] = await Promise.all([
    sb.from('pl_prozess').select('*').order('sortierung', { ascending: true }),
    sb.from('pl_phase').select('*').order('position', { ascending: true }),
    sb.from('pl_schritt').select('*').order('position', { ascending: true })
  ]);
  if (pr.error) throw pr.error;
  if (ph.error) throw ph.error;
  if (sc.error) throw sc.error;

  const schritteJePhase = {};
  for (const s of sc.data) (schritteJePhase[s.phase_id] = schritteJePhase[s.phase_id] || []).push(s);
  const phasenJeProzess = {};
  for (const p of ph.data) {
    p.schritte = schritteJePhase[p.id] || [];
    (phasenJeProzess[p.prozess_id] = phasenJeProzess[p.prozess_id] || []).push(p);
  }
  S.prozesse = pr.data.map((p) => ({ ...p, phasen: phasenJeProzess[p.id] || [] }));
}

async function ladeBerechtigte() {
  const { data, error } = await sb.from('pl_berechtigt').select('*').order('email');
  if (error) throw error;
  S.berechtigte = data;
}

/* ============================ Speichern ============================ */

const wartend = new Map();
function spaeterSpeichern(schluessel, fn) {
  clearTimeout(wartend.get(schluessel));
  wartend.set(schluessel, setTimeout(async () => {
    wartend.delete(schluessel);
    try { await fn(); melde('Gespeichert'); }
    catch (e) { fehler(e, 'Speichern fehlgeschlagen'); }
  }, 700));
}

const speichereProzess = (id, aenderung) =>
  sb.from('pl_prozess').update(aenderung).eq('id', id).then(({ error }) => { if (error) throw error; });
const speicherePhase = (id, aenderung) =>
  sb.from('pl_phase').update(aenderung).eq('id', id).then(({ error }) => { if (error) throw error; });
const speichereSchritt = (id, aenderung) =>
  sb.from('pl_schritt').update(aenderung).eq('id', id).then(({ error }) => { if (error) throw error; });

/* ============================ Ansicht: Übersicht ============================ */

function vUebersicht() {
  const alle = S.prozesse;
  const q = S.suche.trim().toLowerCase();
  let zeilen = alle.filter((p) => {
    if (S.bereich !== 'Alle' && p.bereich !== S.bereich) return false;
    if (S.ampel !== 'Alle' && ampelVon(p) !== S.ampel) return false;
    if (q && !((p.name + ' ' + p.id + ' ' + p.verantwortlich + ' ' + p.systeme).toLowerCase().includes(q))) return false;
    return true;
  });
  zeilen = zeilen.slice().sort((a, b) => {
    if (S.sortierung === 'id') return a.id.localeCompare(b.id, 'de');
    if (S.sortierung === 'name') return a.name.localeCompare(b.name, 'de');
    return stunden(b) - stunden(a);
  });

  let imRahmen = 0, automatisiert = 0, hebel = 0, rot = 0, dok = 0;
  for (const p of alle) {
    const a = ampelVon(p), h = stunden(p);
    if (a !== 'grau') imRahmen += h;
    if (a === 'gruen') automatisiert += h;
    if (a === 'rot' || a === 'gelb') hebel += h;
    if (a === 'rot') rot++;
    if (p.doku === 'dokumentiert') dok++;
  }

  const chips = (art, werte, aktiv, beschriften, mitGlyph) => werte.map((k) => {
    const n = k === 'Alle' ? alle.length
      : alle.filter((p) => (art === 'bereich' ? p.bereich : ampelVon(p)) === k).length;
    const an = aktiv === k;
    const g = (mitGlyph && k !== 'Alle') ? `<span style="color:var(--${k});display:flex">${glyph(k, 11)}</span>` : '';
    return `<button class="chip" aria-pressed="${an}" data-akt="filter" data-art="${art}" data-wert="${esc(k)}">${g}${esc(beschriften(k))}<span class="n">${n}</span></button>`;
  }).join('');

  const koerper = zeilen.length ? zeilen.map((p) => {
    const a = ampelVon(p), ausSchritten = alleSchritte(p).length;
    const ampelZelle = ausSchritten
      ? pille(a) + `<span class="abgeleitet">aus ${ausSchritten} Schritten</span>`
      : `<select class="amp ${a}" data-akt="ampel" data-id="${esc(p.id)}"${S.darfSchreiben ? '' : ' disabled'}>`
        + ORDNUNG.map((k) => `<option value="${k}"${k === a ? ' selected' : ''}>${esc(AMPEL[k].text)}</option>`).join('')
        + '</select>';
    return `<tr>
      <td class="mono">${esc(p.id)}</td>
      <td class="pname"><button data-akt="oeffnen" data-id="${esc(p.id)}">${esc(p.name)}</button></td>
      <td>${esc(p.bereich)}</td>
      <td>${esc(p.verantwortlich)}</td>
      <td>${esc(p.haeufigkeit)}</td>
      <td class="num">${de(stunden(p))}</td>
      <td>${ampelZelle}</td>
      <td>${esc(DOKU[p.doku] || 'offen')}</td>
      <td>${esc(p.potenzial || '—')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="leer">Kein Prozess passt zu dieser Auswahl.</td></tr>';

  return `
  <div class="kpis">
    ${kpi('Prozesse erfasst', alle.length, dok + ' vollständig dokumentiert')}
    ${kpi('Noch manuell', rot, 'ohne jeden KI-Einsatz', 'var(--rot)')}
    ${kpi('Automatisierungsgrad', (imRahmen > 0 ? Math.round(automatisiert / imRahmen * 100) : 0) + '&thinsp;%', 'der Stunden, die KI erledigen könnte')}
    ${kpi('Hebel pro Monat', de(hebel, 0) + '&thinsp;h', 'stecken in roten und gelben Prozessen', null, true)}
  </div>

  <div class="filter">
    <div class="freihe"><span class="eyebrow">Bereich</span>${chips('bereich', ['Alle'].concat(BEREICHE), S.bereich, (k) => k, false)}</div>
    <div class="freihe"><span class="eyebrow">KI-Status</span>${chips('ampel', ['Alle'].concat(ORDNUNG), S.ampel, (k) => k === 'Alle' ? 'Alle' : AMPEL[k].text, true)}
      <input class="suche" type="search" placeholder="Suchen nach Name, ID, Verantwortlichem …" value="${esc(S.suche)}" data-akt="suche">
      <button class="knopf schlank klein" data-akt="csv">CSV exportieren</button>
      ${S.darfSchreiben ? '<button class="knopf klein" data-akt="neu">+ Neuer Prozess</button>' : ''}
    </div>
  </div>

  <div class="karte-flach"><div class="tabellenrahmen"><table>
    <thead><tr>
      <th class="sortierbar" data-akt="sort" data-wert="id">ID</th>
      <th class="sortierbar" data-akt="sort" data-wert="name">Prozess</th>
      <th>Bereich</th><th>Verantwortlich</th><th>Häufigkeit</th>
      <th class="num sortierbar" data-akt="sort" data-wert="std">Std./Mon.</th>
      <th>KI-Status heute</th><th>Doku</th><th>Potenzial</th>
    </tr></thead>
    <tbody>${koerper}</tbody>
  </table></div></div>

  <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--grau3)">
    <span>${zeilen.length} von ${alle.length} Prozessen sichtbar · auf einen Namen klicken, um die Schritte zu öffnen</span>
    <span>Std./Mon. = Dauer je Durchlauf × Durchläufe pro Monat</span>
  </div>`;
}

function kpi(titel, wert, sub, farbe, dunkel) {
  return `<div class="kpi${dunkel ? ' dunkel' : ''}"><span class="eyebrow">${esc(titel)}</span>
    <span class="num"${farbe ? ` style="color:${farbe}"` : ''}>${wert}</span>
    <span class="sub">${esc(sub)}</span></div>`;
}

/* ============================ Ansicht: Prozess ============================ */

function vProzess() {
  const p = S.prozesse.find((x) => x.id === S.offen);
  if (!p) { S.ansicht = 'uebersicht'; return vUebersicht(); }
  const ro = S.darfSchreiben ? '' : ' disabled';
  const schritte = alleSchritte(p);
  const a = ampelVon(p);

  const feld = (label, schluessel, tipp, breit) => `
    <div class="feld${breit ? ' breit' : ''}"><label>${esc(label)}</label>
      <input value="${esc(p[schluessel])}" data-akt="pfeld" data-feld="${schluessel}"${ro}>
      ${tipp ? `<span class="tipp">${esc(tipp)}</span>` : ''}</div>`;
  const auswahl = (label, schluessel, optionen, tipp) => `
    <div class="feld"><label>${esc(label)}</label>
      <select data-akt="pfeld" data-feld="${schluessel}"${ro}>
        ${optionen.map(([w, t]) => `<option value="${esc(w)}"${(p[schluessel] || '') === w ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select>${tipp ? `<span class="tipp">${esc(tipp)}</span>` : ''}</div>`;

  let verteilung = '';
  if (schritte.length) {
    const n = {}; ORDNUNG.forEach((k) => { n[k] = schritte.filter((s) => s.ampel === k).length; });
    const teile = ORDNUNG.filter((k) => n[k] > 0);
    verteilung = `<div style="display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <span class="eyebrow">KI-Status der ${schritte.length} Schritte</span>
        <span style="font-size:12.5px;color:var(--grau3)">Die Prozess-Ampel ergibt sich aus den Schritten</span></div>
      <div class="bar">${teile.map((k) => `<i style="flex:${n[k]};background:var(--${k})"></i>`).join('')}</div>
      <div class="legende">${teile.map((k) => `<span style="color:var(--${k})">${glyph(k, 11)}<span style="color:var(--sek)">${n[k]} × ${esc(AMPEL[k].text)} (${Math.round(n[k] / schritte.length * 100)} %)</span></span>`).join('')}</div>
    </div>`;
  }

  let lauf = 0;
  const phasen = (p.phasen || []).map((ph, pi) => {
    const reihen = (ph.schritte || []).map((s) => {
      lauf++;
      return `<div class="schritt">
        <span class="snum">${String(lauf).padStart(2, '0')}</span>
        <div class="sfelder">
          <textarea class="stext" rows="1" placeholder="Was ist zu tun?" data-akt="sfeld" data-feld="text" data-id="${s.id}"${ro}>${esc(s.text)}</textarea>
          <textarea class="swort" rows="1" placeholder="Wortlaut gegenüber dem Kunden (optional)" data-akt="sfeld" data-feld="wortlaut" data-id="${s.id}"${ro}>${esc(s.wortlaut)}</textarea>
          <input class="smeta" placeholder="Rolle · System · Vorgabe" value="${esc(s.meta)}" data-akt="sfeld" data-feld="meta" data-id="${s.id}"${ro}>
        </div>
        <select class="amp ${s.ampel}" data-akt="sampel" data-id="${s.id}"${ro}>
          ${ORDNUNG.map((k) => `<option value="${k}"${k === s.ampel ? ' selected' : ''}>${esc(AMPEL[k].text)}</option>`).join('')}
        </select>
        ${S.darfSchreiben ? `<div class="werkzeug">
          ${wknopf('hoch', s.id, 'Nach oben', 'M7 3.5 3 8h8z')}
          ${wknopf('runter', s.id, 'Nach unten', 'M7 10.5 3 6h8z')}
          ${wknopf('sweg', s.id, 'Schritt löschen', 'M3 3l8 8M11 3l-8 8', true)}
        </div>` : '<span></span>'}
      </div>`;
    }).join('');
    return `<section class="phase">
      <div class="pkopf"><span class="pnum">${pi + 1}</span>
        <input value="${esc(ph.titel)}" placeholder="Name der Phase" data-akt="ptitel" data-id="${ph.id}"${ro}>
        <span class="zahl">${(ph.schritte || []).length} Schritte</span>
        ${S.darfSchreiben ? `<button class="knopf warn klein" data-akt="pweg" data-id="${ph.id}">Phase löschen</button>` : ''}
      </div>
      ${reihen || '<div class="leer">Noch keine Schritte in dieser Phase.</div>'}
      ${S.darfSchreiben ? `<div class="pfuss"><button class="knopf schlank klein" data-akt="sneu" data-id="${ph.id}">+ Schritt</button></div>` : ''}
    </section>`;
  }).join('');

  const loeschen = S.loeschfrage === p.id
    ? `<div class="karte-flach pad" style="border-color:var(--rot-rand);background:var(--rot-bg);display:flex;gap:12px;align-items:center;flex-wrap:wrap">
         <span style="flex-grow:1;font-size:14px"><b>${esc(p.id)} ${esc(p.name)}</b> wirklich löschen? Alle Phasen und Schritte werden mitgelöscht.</span>
         <button class="knopf warn" data-akt="pdel-ja">Endgültig löschen</button>
         <button class="knopf schlank" data-akt="pdel-nein">Abbrechen</button></div>` : '';

  return `
  <button class="zurueck" data-akt="uebersicht">← Zurück zur Übersicht</button>
  ${loeschen}
  <div class="karte-flach pad" style="display:flex;flex-direction:column;gap:18px">
    <div class="dkopf">
      <div>
        <span class="eyebrow">${esc(p.id)} · ${esc(p.bereich)}</span>
        <h1 class="dtitel">${esc(p.name)}</h1>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        ${pille(a)}
        <span style="font-size:12.5px;color:var(--grau3)">${de(stunden(p))} Std./Monat · ${schritte.length} Schritte</span>
        ${p.geaendert_von ? `<span style="font-size:12px;color:var(--grau3)">zuletzt geändert von ${esc(p.geaendert_von)}</span>` : ''}
      </div>
    </div>
    <div class="gitter">
      ${feld('Prozessname', 'name')}
      ${auswahl('Bereich', 'bereich', BEREICHE.map((b) => [b, b]))}
      ${feld('Verantwortlich', 'verantwortlich', 'Wer hält den Prozess aktuell')}
      ${feld('Beteiligte Rollen', 'rollen')}
      ${feld('Häufigkeit', 'haeufigkeit')}
      ${feld('Dauer je Durchlauf in Minuten', 'dauer_min', 'Schätzung genügt')}
      ${feld('Durchläufe pro Monat', 'volumen_monat', 'Schätzung genügt')}
      ${auswahl('Dokumentationsstand', 'doku', Object.entries(DOKU))}
      ${auswahl('Automatisierungspotenzial', 'potenzial', Object.entries(POTENZIAL))}
      ${schritte.length ? '' : auswahl('KI-Status heute', 'ampel', ORDNUNG.map((k) => [k, AMPEL[k].text]), 'Sobald Schritte erfasst sind, ergibt sich der Status daraus')}
      ${feld('Auslöser', 'ausloeser', 'Was startet den Prozess', true)}
      ${feld('Ergebnis', 'ergebnis', 'Was liegt am Ende vor', true)}
      ${feld('Systeme', 'systeme', 'Repdoc, Kalender, …', true)}
      <div class="feld breit"><label>Anmerkung</label>
        <textarea rows="2" data-akt="pfeld" data-feld="anmerkung"${ro}>${esc(p.anmerkung)}</textarea></div>
    </div>
    ${verteilung}
  </div>
  ${phasen}
  ${S.darfSchreiben ? `<div style="display:flex;gap:9px;flex-wrap:wrap">
    <button class="knopf schlank" data-akt="pneu">+ Phase hinzufügen</button>
    <button class="knopf warn" style="margin-left:auto" data-akt="pdel-frage">Prozess löschen</button></div>` : ''}`;
}

function wknopf(akt, id, titel, d, weg) {
  return `<button class="${weg ? 'weg' : ''}" data-akt="${akt}" data-id="${id}" title="${esc(titel)}" aria-label="${esc(titel)}">
    <svg width="13" height="13" viewBox="0 0 14 14" fill="${weg ? 'none' : 'currentColor'}" stroke="${weg ? 'currentColor' : 'none'}" stroke-width="1.7" stroke-linecap="round"><path d="${d}"/></svg></button>`;
}

/* ============================ Ansicht: Auswertung ============================ */

function vAuswertung() {
  const alle = S.prozesse;
  const jeBereich = BEREICHE.filter((b) => alle.some((p) => p.bereich === b)).map((b) => {
    const teil = alle.filter((p) => p.bereich === b);
    return { b, n: teil.length, teile: ORDNUNG.map((k) => ({ k, n: teil.filter((p) => ampelVon(p) === k).length })) };
  });
  const rote = alle.filter((p) => ampelVon(p) === 'rot').sort((x, y) => stunden(y) - stunden(x)).slice(0, 12);
  const max = rote.length ? stunden(rote[0]) : 1;
  const dokuStufen = Object.entries(DOKU).map(([k, l]) => ({ l, n: alle.filter((p) => (p.doku || 'offen') === k).length }));

  return `<div class="zwei">
    <div class="karte-flach pad">
      <h2 class="sec">KI-Status je Bereich</h2><p class="sec">Balkenbreite = Anzahl Prozesse.</p>
      ${jeBereich.map((r) => `<div class="brow"><span class="lbl">${esc(r.b)}</span>
        <div class="stapel">${r.teile.filter((t) => t.n > 0).map((t) => `<i style="flex:${t.n};background:var(--${t.k})"></i>`).join('')}</div>
        <span class="tot">${r.n}</span></div>`).join('')}
      <div class="legende" style="margin-top:15px">${ORDNUNG.map((k) => `<span style="color:var(--${k})">${glyph(k, 11)}<span style="color:var(--sek)">${esc(AMPEL[k].text)}</span></span>`).join('')}</div>
    </div>

    <div class="karte-flach pad">
      <h2 class="sec">Größte Hebel nach Zeitaufwand</h2><p class="sec">Nur rote Prozesse, Stunden pro Monat. Hier zuerst ansetzen.</p>
      ${rote.length ? rote.map((p) => `<div class="brow" style="grid-template-columns:minmax(0,220px) 1fr 66px">
        <span class="lbl" style="text-align:left">${esc(p.name)}</span>
        <div class="spur"><i style="width:${(stunden(p) / max * 100).toFixed(1)}%;background:var(--rot)"></i></div>
        <span class="tot" style="text-align:right">${de(stunden(p), 0)} h</span></div>`).join('')
      : '<div class="leer">Kein roter Prozess mehr.</div>'}
    </div>

    <div class="karte-flach pad">
      <h2 class="sec">Fortschritt der Erfassung</h2><p class="sec">„Noch nicht aufgeschrieben" ist etwas anderes als „noch nicht automatisiert".</p>
      ${dokuStufen.map((d) => `<div class="brow" style="grid-template-columns:118px 1fr 44px">
        <span class="lbl">${esc(d.l)}</span>
        <div class="spur" style="border-radius:8px"><i style="width:${(d.n / Math.max(alle.length, 1) * 100).toFixed(1)}%;background:var(--sek);border-radius:8px"></i></div>
        <span class="tot">${d.n}</span></div>`).join('')}
    </div>

    <div class="karte-flach pad">
      <h2 class="sec">Was die Ampel bedeutet</h2><p class="sec">Sie zeigt den heutigen Zustand, nicht das Potenzial.</p>
      <div style="display:flex;flex-direction:column;gap:11px">
        ${ORDNUNG.map((k) => `<div style="display:flex;gap:12px;align-items:flex-start">
          <span style="flex-shrink:0;width:158px">${pille(k)}</span>
          <span style="font-size:13.5px;color:var(--sek)">${esc(AMPEL[k].lang)}</span></div>`).join('')}
      </div>
      <div class="notiz" style="margin-top:15px">Graue Prozesse zählen nicht in den Automatisierungsgrad — sie sollen bewusst manuell bleiben.</div>
    </div>
  </div>`;
}

/* ============================ Ansicht: Zugriff ============================ */

function vZugriff() {
  return `<div class="karte-flach pad">
    <h2 class="sec">Wer darf auf die Prozesslandkarte zugreifen</h2>
    <p class="sec">Nur die hier eingetragenen Firmen-Adressen sehen Daten. Ohne Eintrag bleibt die Anmeldung wirkungslos.</p>

    <div class="zeile" style="font-weight:600;color:var(--sek);font-size:12px;text-transform:uppercase;letter-spacing:.05em">
      <span>E-Mail</span><span class="name">Name</span><span>Rolle</span><span></span></div>
    <div class="liste">
      ${S.berechtigte.map((b) => `<div class="zeile">
        <span class="mail">${esc(b.email)}</span>
        <span class="name" style="font-size:13.5px;color:var(--sek)">${esc(b.name || '—')}</span>
        <select data-akt="rolle" data-mail="${esc(b.email)}">
          ${[['leser', 'nur lesen'], ['bearbeiter', 'bearbeiten'], ['admin', 'Administrator']]
            .map(([w, t]) => `<option value="${w}"${b.rolle === w ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <div class="werkzeug"><button class="weg" data-akt="bweg" data-mail="${esc(b.email)}" title="Zugang entziehen" aria-label="Zugang entziehen">✕</button></div>
      </div>`).join('')}
    </div>

    <div style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="feld" style="flex-grow:1;min-width:250px"><label>Neue Person freischalten</label>
        <input id="neu-mail" type="email" placeholder="vorname.nachname@autohaus-stieber.de" spellcheck="false"></div>
      <div class="feld" style="width:180px"><label>Name (optional)</label><input id="neu-name" placeholder="Vorname Nachname"></div>
      <div class="feld" style="width:170px"><label>Rolle</label>
        <select id="neu-rolle"><option value="leser">nur lesen</option><option value="bearbeiter">bearbeiten</option><option value="admin">Administrator</option></select></div>
      <button class="knopf" data-akt="bneu">Freischalten</button>
    </div>

    <div class="notiz" style="margin-top:20px">
      <b>Datenschutz:</b> Wenn jemand das Unternehmen verlässt, entziehen Sie hier den Zugang. Damit ist der Zugriff sofort beendet.
      Für die vollständige Löschung des Benutzerkontos ist zusätzlich ein Löschen in der Supabase-Benutzerverwaltung nötig.
    </div>
  </div>`;
}

/* ============================ Ansicht: Datenschutz ============================ */

function datenschutzKurz() {
  return '<b>Datenschutz in Kürze.</b><br>Diese Anwendung speichert betriebliche Prozessbeschreibungen, keine Kundendaten. '
    + 'Von Ihnen werden Ihre dienstliche E-Mail-Adresse und Ihre Änderungen gespeichert. Server: Frankfurt am Main. '
    + 'Ausführliche Hinweise finden Sie nach der Anmeldung unter „Datenschutz".';
}

function vDatenschutz() {
  return `<div class="karte-flach pad text">
    <h2>Datenschutzhinweis für Mitarbeiterinnen und Mitarbeiter</h2>
    <p><strong>Entwurf — vor dem Einsatz durch die Geschäftsführung und den Datenschutzbeauftragten zu prüfen und freizugeben.</strong></p>

    <h3>Verantwortlich</h3>
    <p>Autohaus Stieber GmbH. Fragen zum Datenschutz richten Sie bitte an die Geschäftsführung.</p>

    <h3>Zweck der Anwendung</h3>
    <p>Die Prozesslandkarte dokumentiert die Arbeitsabläufe des Unternehmens und hält fest, welche Abläufe bereits
    durch KI unterstützt werden. Sie dient der Qualitätssicherung, der Einarbeitung neuer Kolleginnen und Kollegen
    sowie der Planung von Automatisierungsvorhaben.</p>

    <h3>Welche Daten verarbeitet werden</h3>
    <ul>
      <li><strong>Prozessbeschreibungen</strong> — betriebliche Inhalte ohne Personenbezug. <em>Kundendaten werden in dieser Anwendung nicht gespeichert.</em></li>
      <li><strong>Ihre dienstliche E-Mail-Adresse</strong> und optional Ihr Name, um Ihnen Zugang zu geben.</li>
      <li><strong>Anmeldedaten</strong> — Zeitpunkt der Anmeldung, technisch notwendig.</li>
      <li><strong>Änderungsprotokoll</strong> — bei jeder Änderung wird gespeichert, wer sie wann vorgenommen hat und was sich geändert hat.</li>
    </ul>

    <h3>Zum Änderungsprotokoll</h3>
    <p>Das Protokoll dient ausschließlich der Nachvollziehbarkeit verbindlicher Prozesse — etwa um zu klären, seit wann
    eine Vorgabe in einer bestimmten Fassung gilt. Es wird <strong>nicht zur Verhaltens- oder Leistungskontrolle
    ausgewertet</strong>. Einsehen können es nur Personen mit der Rolle „Administrator".</p>
    <p>Der Personenbezug wird <strong>nach zwölf Monaten automatisch entfernt</strong>; die sachliche Änderung bleibt
    ohne Namensangabe erhalten. Das läuft als monatlicher Automatismus in der Datenbank.</p>

    <h3>Rechtsgrundlage</h3>
    <p>Die Verarbeitung erfolgt zur Durchführung des Beschäftigungsverhältnisses (§ 26 BDSG) sowie auf Grundlage des
    berechtigten Interesses des Unternehmens an dokumentierten und nachvollziehbaren Arbeitsabläufen
    (Art. 6 Abs. 1 lit. f DSGVO).</p>

    <h3>Wo die Daten liegen</h3>
    <p>Die Daten werden bei <strong>Supabase</strong> in einem Rechenzentrum in <strong>Frankfurt am Main</strong>
    gespeichert und ausschließlich verschlüsselt übertragen. Die Oberfläche wird über GitHub Pages ausgeliefert;
    dabei fallen dort technische Zugriffsdaten an. Mit beiden Anbietern besteht ein Vertrag zur Auftragsverarbeitung.</p>

    <h3>Wer Zugriff hat</h3>
    <p>Ausschließlich Beschäftigte, die von der Geschäftsführung freigeschaltet wurden. Ohne Freischaltung gibt die
    Datenbank keinerlei Daten heraus. Es gibt drei Rollen: nur lesen, bearbeiten und Administrator.</p>

    <h3>Speicherdauer</h3>
    <ul>
      <li>Prozessbeschreibungen: solange sie betrieblich gebraucht werden.</li>
      <li>Zugangsberechtigung: bis zum Entzug, spätestens beim Ausscheiden aus dem Unternehmen.</li>
      <li>Änderungsprotokoll: Personenbezug zwölf Monate, danach anonymisiert.</li>
    </ul>

    <h3>Ihre Rechte</h3>
    <p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung sowie
    Datenübertragbarkeit und ein Beschwerderecht bei der Aufsichtsbehörde. Wenden Sie sich dazu bitte an die
    Geschäftsführung.</p>

    <h3>Keine automatisierte Entscheidung</h3>
    <p>Es findet keine automatisierte Entscheidungsfindung und kein Profiling statt.</p>

    <div class="notiz" style="margin-top:24px">
      <b>Offene Punkte für die Freigabe:</b> Auftragsverarbeitungsverträge mit Supabase und GitHub abschließen,
      diese Anwendung in das Verzeichnis von Verarbeitungstätigkeiten aufnehmen, Text durch den
      Datenschutzbeauftragten prüfen lassen.
    </div>
  </div>`;
}

/* ============================ Zeichnen ============================ */

function zeichne() {
  const nav = [
    ['uebersicht', 'Übersicht'],
    ['auswertung', 'Auswertung'],
    ...(S.istAdmin ? [['zugriff', 'Zugriff']] : []),
    ['datenschutz', 'Datenschutz']
  ];
  document.getElementById('nav').innerHTML = nav.map(([k, t]) =>
    `<button data-akt="nav" data-wert="${k}" aria-current="${S.ansicht === k || (k === 'uebersicht' && S.ansicht === 'prozess')}">${t}</button>`).join('');
  document.getElementById('wer').textContent =
    S.benutzer + (S.darfSchreiben ? '' : ' · nur lesen');

  const inhalt =
    S.ansicht === 'prozess' ? vProzess() :
    S.ansicht === 'auswertung' ? vAuswertung() :
    S.ansicht === 'zugriff' ? vZugriff() :
    S.ansicht === 'datenschutz' ? vDatenschutz() : vUebersicht();
  document.getElementById('inhalt').innerHTML = inhalt;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ============================ Bedienung ============================ */

function prozess() { return S.prozesse.find((x) => x.id === S.offen); }
function findeSchritt(id) {
  for (const p of S.prozesse) for (const ph of p.phasen || []) {
    const s = (ph.schritte || []).find((x) => x.id === id);
    if (s) return { p, ph, s };
  }
  return null;
}

document.getElementById('app').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-akt]');
  if (!el) return;
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return;
  const akt = el.dataset.akt;
  const id = el.dataset.id;

  try {
    if (akt === 'nav') { S.ansicht = el.dataset.wert; S.offen = null; S.loeschfrage = null;
      if (S.ansicht === 'zugriff') await ladeBerechtigte();
      zeichne(); return; }
    if (akt === 'uebersicht') { S.ansicht = 'uebersicht'; S.offen = null; S.loeschfrage = null; zeichne(); return; }
    if (akt === 'oeffnen') { S.offen = id; S.ansicht = 'prozess'; S.loeschfrage = null; zeichne(); return; }
    if (akt === 'filter') { if (el.dataset.art === 'bereich') S.bereich = el.dataset.wert; else S.ampel = el.dataset.wert; zeichne(); return; }
    if (akt === 'sort') { S.sortierung = el.dataset.wert; zeichne(); return; }
    if (akt === 'csv') { csvHerunterladen(); return; }

    if (!S.darfSchreiben) return;

    if (akt === 'neu') {
      const b = S.bereich !== 'Alle' ? S.bereich : 'Service';
      const pre = PRAEFIX[b];
      const nummern = S.prozesse.filter((x) => x.id.startsWith(pre + '-')).map((x) => parseInt(x.id.split('-')[1], 10) || 0);
      const nr = (nummern.length ? Math.max(...nummern) : 0) + 1;
      const neuId = pre + '-' + String(nr).padStart(2, '0');
      const { error } = await sb.from('pl_prozess').insert({
        id: neuId, name: 'Neuer Prozess', bereich: b,
        sortierung: Math.max(0, ...S.prozesse.map((x) => x.sortierung || 0)) + 1
      });
      if (error) throw error;
      await ladeAlles(); S.offen = neuId; S.ansicht = 'prozess'; zeichne(); melde('Prozess angelegt'); return;
    }

    const p = prozess();

    if (akt === 'pneu' && p) {
      const pos = (p.phasen.length ? Math.max(...p.phasen.map((x) => x.position)) : 0) + 1;
      const { error } = await sb.from('pl_phase').insert({ prozess_id: p.id, titel: 'Neue Phase', position: pos });
      if (error) throw error;
      await ladeAlles(); zeichne(); return;
    }
    if (akt === 'sneu') {
      const ph = p.phasen.find((x) => x.id === id);
      const pos = (ph.schritte.length ? Math.max(...ph.schritte.map((x) => x.position)) : 0) + 1;
      const { error } = await sb.from('pl_schritt').insert({ phase_id: id, text: '', ampel: 'rot', position: pos });
      if (error) throw error;
      await ladeAlles(); zeichne(); return;
    }
    if (akt === 'sweg') {
      const { error } = await sb.from('pl_schritt').delete().eq('id', id);
      if (error) throw error;
      await ladeAlles(); zeichne(); melde('Schritt gelöscht'); return;
    }
    if (akt === 'pweg') {
      const { error } = await sb.from('pl_phase').delete().eq('id', id);
      if (error) throw error;
      await ladeAlles(); zeichne(); melde('Phase gelöscht'); return;
    }
    if (akt === 'hoch' || akt === 'runter') {
      const t = findeSchritt(id); if (!t) return;
      const liste = t.ph.schritte;
      const i = liste.findIndex((x) => x.id === id);
      const j = akt === 'hoch' ? i - 1 : i + 1;
      if (j < 0 || j >= liste.length) return;
      const a = liste[i], b = liste[j];
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        sb.from('pl_schritt').update({ position: b.position }).eq('id', a.id),
        sb.from('pl_schritt').update({ position: a.position }).eq('id', b.id)
      ]);
      if (e1 || e2) throw (e1 || e2);
      await ladeAlles(); zeichne(); return;
    }
    if (akt === 'pdel-frage') { S.loeschfrage = p.id; zeichne(); return; }
    if (akt === 'pdel-nein') { S.loeschfrage = null; zeichne(); return; }
    if (akt === 'pdel-ja') {
      const { error } = await sb.from('pl_prozess').delete().eq('id', p.id);
      if (error) throw error;
      await ladeAlles(); S.offen = null; S.ansicht = 'uebersicht'; S.loeschfrage = null; zeichne();
      melde('Prozess gelöscht'); return;
    }

    if (akt === 'bneu' && S.istAdmin) {
      const mail = document.getElementById('neu-mail').value.trim().toLowerCase();
      const name = document.getElementById('neu-name').value.trim();
      const rolle = document.getElementById('neu-rolle').value;
      if (!mail) return;
      if (!mail.endsWith('@autohaus-stieber.de')) { melde('Nur Adressen @autohaus-stieber.de', 'warn'); return; }
      const { error } = await sb.from('pl_berechtigt').insert({ email: mail, name: name || null, rolle });
      if (error) throw error;
      await ladeBerechtigte(); zeichne(); melde('Freigeschaltet'); return;
    }
    if (akt === 'bweg' && S.istAdmin) {
      const mail = el.dataset.mail;
      if (mail === S.benutzer) { melde('Sie können sich nicht selbst entfernen.', 'warn'); return; }
      const { error } = await sb.from('pl_berechtigt').delete().eq('email', mail);
      if (error) throw error;
      await ladeBerechtigte(); zeichne(); melde('Zugang entzogen'); return;
    }
  } catch (err) { fehler(err, 'Vorgang fehlgeschlagen'); }
});

/* Tippen: Zustand pflegen, verzoegert speichern, nicht neu zeichnen */
document.getElementById('app').addEventListener('input', (e) => {
  const el = e.target.closest('[data-akt]');
  if (!el) return;
  const akt = el.dataset.akt;

  if (akt === 'suche') {
    S.suche = el.value; zeichne();
    const f = document.querySelector('[data-akt="suche"]');
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    return;
  }
  if (!S.darfSchreiben) return;

  if (akt === 'pfeld') {
    const p = prozess(); if (!p) return;
    const feld = el.dataset.feld;
    const wert = (feld === 'dauer_min' || feld === 'volumen_monat') ? zahlAus(el.value) : el.value;
    p[feld] = wert;
    spaeterSpeichern('p:' + p.id + ':' + feld, () => speichereProzess(p.id, { [feld]: wert }));
  } else if (akt === 'sfeld') {
    const t = findeSchritt(el.dataset.id); if (!t) return;
    t.s[el.dataset.feld] = el.value;
    spaeterSpeichern('s:' + t.s.id + ':' + el.dataset.feld, () => speichereSchritt(t.s.id, { [el.dataset.feld]: el.value }));
  } else if (akt === 'ptitel') {
    const p = prozess(); if (!p) return;
    const ph = p.phasen.find((x) => x.id === el.dataset.id); if (!ph) return;
    ph.titel = el.value;
    spaeterSpeichern('ph:' + ph.id, () => speicherePhase(ph.id, { titel: el.value }));
  }
});

document.getElementById('app').addEventListener('change', async (e) => {
  const el = e.target.closest('[data-akt]');
  if (!el || !S.darfSchreiben) return;
  const akt = el.dataset.akt;
  try {
    if (akt === 'ampel') {
      const p = S.prozesse.find((x) => x.id === el.dataset.id); if (!p) return;
      p.ampel = el.value; await speichereProzess(p.id, { ampel: el.value }); zeichne(); melde('Gespeichert'); return;
    }
    if (akt === 'sampel') {
      const t = findeSchritt(el.dataset.id); if (!t) return;
      t.s.ampel = el.value; await speichereSchritt(t.s.id, { ampel: el.value }); zeichne(); melde('Gespeichert'); return;
    }
    if (akt === 'rolle' && S.istAdmin) {
      const { error } = await sb.from('pl_berechtigt').update({ rolle: el.value }).eq('email', el.dataset.mail);
      if (error) throw error;
      await ladeBerechtigte(); melde('Rolle geändert'); return;
    }
    if (akt === 'pfeld') {
      const p = prozess(); if (!p) return;
      const feld = el.dataset.feld;
      p[feld] = el.value;
      await speichereProzess(p.id, { [feld]: el.value });
      zeichne(); melde('Gespeichert');
    }
  } catch (err) { fehler(err, 'Speichern fehlgeschlagen'); }
});

/* Abmelden */
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-akt="abmelden"]')) return;
  await sb.auth.signOut();
  location.replace(location.origin + location.pathname);
});

/* ============================ CSV ============================ */

function csvHerunterladen() {
  const kopf = ['ID', 'Prozessname', 'Bereich', 'Verantwortlich', 'Beteiligte_Rollen', 'Ausloeser', 'Ergebnis',
    'Haeufigkeit', 'Dauer_Min', 'Volumen_Monat', 'Std_Monat', 'Systeme', 'KI_Ampel', 'Doku_Stand',
    'Automatisierungspotenzial', 'Prioritaet', 'Schritte', 'Anmerkung'];
  const q = (v) => {
    const s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    return (s.includes(';') || s.includes('"')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const zeilen = [kopf.join(';')];
  for (const p of S.prozesse) {
    zeilen.push([p.id, p.name, p.bereich, p.verantwortlich, p.rollen, p.ausloeser, p.ergebnis, p.haeufigkeit,
      String(p.dauer_min).replace('.', ','), String(p.volumen_monat).replace('.', ','), de(stunden(p)),
      p.systeme, ampelVon(p), DOKU[p.doku] || 'offen', p.potenzial, p.prioritaet,
      alleSchritte(p).length, p.anmerkung].map(q).join(';'));
  }
  const blob = new Blob(['﻿' + zeilen.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Prozess-Register.csv';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ============================ Start ============================ */

let gestartet = false;

async function starten(session) {
  if (gestartet) return;
  gestartet = true;
  document.getElementById('tor-laden').hidden = true;

  if (!session) {
    document.getElementById('anmeldung').hidden = false;
    return;
  }

  S.benutzer = (session.user.email || '').toLowerCase();

  const { data: recht, error } = await sb.from('pl_berechtigt')
    .select('rolle,name').eq('email', S.benutzer).maybeSingle();

  if (error) { torMeldung('<b>Die Datenbank ist nicht erreichbar.</b><br>' + esc(error.message), 'warn'); return; }

  if (!recht) {
    document.getElementById('anmeldung').hidden = false;
    torMeldung('<b>Sie sind angemeldet, aber noch nicht freigeschaltet.</b><br>'
      + esc(S.benutzer) + ' ist für die Prozesslandkarte noch nicht freigegeben. '
      + 'Melden Sie sich mit einer freigeschalteten Adresse an oder wenden Sie sich an Oliver Stieber.<br><br>'
      + '<button class="knopf schlank" data-akt="abmelden">Abmelden</button>', 'warn');
    return;
  }

  S.rolle = recht.rolle;
  S.darfSchreiben = recht.rolle === 'bearbeiter' || recht.rolle === 'admin';
  S.istAdmin = recht.rolle === 'admin';

  try { await ladeAlles(); }
  catch (e) { torMeldung('<b>Die Prozesse konnten nicht geladen werden.</b><br>' + esc(e.message), 'warn'); return; }

  tor.hidden = true;
  app.hidden = false;
  zeichne();
}

/*  Anmeldung aus der Adresszeile einloesen (Notweg ueber Anmeldelink).
 *
 *  Nach dem Klick auf einen Anmeldelink haengen die Zugangsdaten hinter dem
 *  Rautezeichen in der Adresse. Wir uebergeben sie an den Client und raeumen
 *  die Adresse anschliessend auf, damit sie nicht im Verlauf stehen bleibt.
 */
async function anmeldungAusAdresse() {
  const sauber = () => history.replaceState({}, document.title, location.pathname);
  try {
    const raute = new URLSearchParams(location.hash.replace(/^#/, ''));
    const frage = new URLSearchParams(location.search);

    const abgelehnt = raute.get('error_description') || frage.get('error_description');
    if (abgelehnt) {
      sauber();
      torMeldung('<b>Die Anmeldung wurde abgelehnt.</b><br>' + esc(abgelehnt)
        + '<br><br>Meist ist der Link abgelaufen. Bitte mit Passwort anmelden.', 'warn');
      return;
    }

    const zugang = raute.get('access_token');
    const erneuern = raute.get('refresh_token');
    if (zugang && erneuern) {
      const { error } = await sb.auth.setSession({ access_token: zugang, refresh_token: erneuern });
      sauber();
      if (error) throw error;
      return;
    }

    if (frage.get('code')) {
      const { error } = await sb.auth.exchangeCodeForSession(frage.get('code'));
      sauber();
      if (error) throw error;
    }
  } catch (e) {
    torMeldung('<b>Die Anmeldung konnte nicht abgeschlossen werden.</b><br>'
      + esc(e && e.message ? e.message : String(e))
      + '<br><br>Bitte mit E-Mail und Passwort anmelden.', 'warn');
  }
}

(async function () {
  await anmeldungAusAdresse();
  const { data } = await sb.auth.getSession();
  starten(data ? data.session : null);
})();
