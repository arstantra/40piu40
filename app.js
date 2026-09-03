/* 40+40 — conteggio ore attività funzionali (CCNL scuola)
   Tutto locale: nessun server, nessun account. I dati vivono in localStorage
   sul telefono; il file data/piano.json contiene il calendario precaricato
   dal Piano Annuale della scuola. */

const LS_STATO = "40piu40_stato";      // { [id]: {fatto, ore?, categoria?, inizio?, fine?, nascosto?} }
const LS_EXTRA = "40piu40_extra";      // [ {id, data, titolo, categoria, ore, classe?, sede?, extra:true} ]
const LS_SETTINGS = "40piu40_settings"; // { targetCollegio, targetConsigli, mieClassi:[], nome }

let PIANO = null;      // contenuto data/piano.json
let STATO = {};
let EXTRA = [];
let SETTINGS = { targetCollegio: 40, targetConsigli: 40, mieClassi: [], nome: "" };
let currentMainView = "oggi";

/* ---------------------------------------------------------- utilità date */
function pad2(n){ return String(n).padStart(2,"0"); }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function parseISO(s){
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function formatDataLunga(s){
  const d = parseISO(s);
  const txt = d.toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function formatMeseAnno(s){
  const d = parseISO(s);
  const txt = d.toLocaleDateString("it-IT", { month:"long", year:"numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function meseKey(s){ return s.slice(0,7); } // YYYY-MM

function fmtOre(n){
  n = Math.round(n*100)/100;
  return (n % 1 === 0) ? String(n) : String(n).replace(".", ",");
}
function oraOra(){
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function orarioInMinuti(hhmm){
  if (!hhmm) return null;
  const [h,m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60+m;
}
function oreDaOrari(inizio, fine){
  const a = orarioInMinuti(inizio), b = orarioInMinuti(fine);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24*60; // fine prima di inizio: riunione a cavallo di mezzanotte
  return Math.round((diff/60)*100)/100;
}

/* ---------------------------------------------------------- storage */
function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function save(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }
  catch(e){ console.warn("Salvataggio non riuscito", e); }
}
function loadState(){
  STATO = load(LS_STATO, {});
  EXTRA = load(LS_EXTRA, []);
  SETTINGS = Object.assign({targetCollegio:40, targetConsigli:40, mieClassi:[], nome:""}, load(LS_SETTINGS, {}));
}
function getStato(id){
  return STATO[id] || {};
}
function setStato(id, patch){
  STATO[id] = Object.assign({}, STATO[id], patch);
  save(LS_STATO, STATO);
}

/* ---------------------------------------------------------- dati unificati */
function allActivities(){
  const fromPiano = (PIANO && PIANO.attivita) ? PIANO.attivita : [];
  return fromPiano.concat(EXTRA);
}
function effectiveCategoria(a){
  const st = getStato(a.id);
  return st.categoria || a.categoria;
}
function effectiveOre(a){
  const st = getStato(a.id);
  return (st.ore != null) ? st.ore : a.ore;
}
function isFatto(a){
  const st = getStato(a.id);
  if (a.extra) return st.fatto !== false; // extra: di default già svolta
  return !!st.fatto;
}
function isInCorso(a){
  const st = getStato(a.id);
  return !!st.inizio && !st.fine && !isFatto(a);
}
function isNascosto(a){
  return !!getStato(a.id).nascosto;
}
function classeVisibile(a){
  if (a.extra) return true; // le attivita' aggiunte a mano sono sempre visibili
  if (!a.classe) return true;
  if (!SETTINGS.mieClassi || SETTINGS.mieClassi.length === 0) return true;
  return SETTINGS.mieClassi.some(c => c.toLowerCase() === a.classe.toLowerCase());
}

function computeTotals(){
  const tot = { collegio:0, consigli:0, altro:0 };
  for (const a of allActivities()){
    if (isNascosto(a)) continue;
    if (!isFatto(a)) continue;
    const cat = effectiveCategoria(a);
    const ore = effectiveOre(a) || 0;
    if (tot[cat] != null) tot[cat] += ore; else tot.altro += ore;
  }
  return tot;
}

/* ---------------------------------------------------------- render: contatori */
function renderContatori(){
  const tot = computeTotals();
  fillCounter("collegio", tot.collegio, SETTINGS.targetCollegio);
  fillCounter("consigli", tot.consigli, SETTINGS.targetConsigli);
}
function fillCounter(cat, fatte, target){
  const oltre = Math.max(0, fatte - target);
  document.getElementById(`c-${cat}-fatte`).textContent = fmtOre(fatte);
  document.getElementById(`c-${cat}-target`).textContent = fmtOre(target);

  // Seconda colonna: quante ore restano da svolgere; se il tetto e' superato,
  // mostra invece di quanto si e' andati oltre.
  const rest = document.getElementById(`c-${cat}-restanti`);
  const restLab = document.getElementById(`lab-${cat}-restanti`);
  rest.classList.toggle("over", oltre > 0);
  if (oltre > 0){
    rest.textContent = "+" + fmtOre(oltre);
    restLab.textContent = "oltre";
  } else {
    rest.textContent = fmtOre(target - fatte);
    restLab.textContent = "da svolgere";
  }

  // La barra rappresenta sempre il totale corrente (target oppure, se lo sforo
  // supera il target, le ore fatte): blu = entro il tetto, rosso = sforo.
  const scale = Math.max(target, fatte, 1);
  const entro = Math.min(fatte, target);
  const barBlue = document.getElementById(`bar-${cat}-blue`);
  const barRed = document.getElementById(`bar-${cat}-red`);
  barBlue.style.width = (entro/scale*100) + "%";
  barRed.style.width = (oltre/scale*100) + "%";
  barBlue.classList.toggle("full", target > 0 && fatte >= target);
}

/* ---------------------------------------------------------- render: card */
function tagLabel(cat){
  return cat === "collegio" ? "Collegio" : cat === "consigli" ? "Consigli" : "Altro";
}
function creaCard(a, opts){
  opts = opts || {};
  const div = document.createElement("div");
  const nascosto = isNascosto(a);
  const fatto = isFatto(a);
  const inCorso = isInCorso(a);
  const st = getStato(a.id);
  div.className = "card" + (fatto ? " done" : "") + (nascosto ? " nascosta" : "");
  div.dataset.id = a.id;

  const top = document.createElement("div");
  top.className = "card-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = a.titolo + (a.classe ? ` · ${a.classe}` : "");
  const meta = document.createElement("div");
  meta.className = "card-meta";
  const bits = [formatDataLunga(a.data)];
  if (a.ora) bits.push(a.ora);
  if (a.sede) bits.push(a.sede);
  meta.textContent = bits.join(" · ");
  left.appendChild(title); left.appendChild(meta);

  const tag = document.createElement("span");
  const cat = effectiveCategoria(a);
  tag.className = "tag tag-" + cat;
  tag.textContent = tagLabel(cat);

  top.appendChild(left); top.appendChild(tag);
  div.appendChild(top);

  if (inCorso){
    const badge = document.createElement("div");
    badge.className = "in-corso-badge";
    badge.textContent = `In corso dalle ${st.inizio}`;
    div.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (nascosto){
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Mostra";
    btn.onclick = (e) => { e.stopPropagation(); setStato(a.id, {nascosto:false}); refreshAll(); };
    actions.appendChild(btn);
  } else if (fatto){
    const orari = (st.inizio && st.fine) ? ` (${st.inizio}–${st.fine})` : "";
    const btn = document.createElement("button");
    btn.className = "btn btn-done";
    btn.textContent = `✓ ${fmtOre(effectiveOre(a))} ore${orari}`;
    btn.onclick = (e) => { e.stopPropagation(); setStato(a.id, {fatto:false}); refreshAll(); };
    actions.appendChild(btn);
  } else if (inCorso){
    const btn = document.createElement("button");
    btn.className = "btn btn-progress";
    btn.textContent = "Termina";
    btn.onclick = (e) => { e.stopPropagation(); terminaAttivita(a); };
    actions.appendChild(btn);
  } else if (a.data === todayISO()){
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Inizia";
    btn.onclick = (e) => { e.stopPropagation(); iniziaAttivita(a); };
    actions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Ho partecipato";
    btn.onclick = (e) => { e.stopPropagation(); setStato(a.id, {fatto:true}); refreshAll(); };
    actions.appendChild(btn);
  }
  if (!nascosto){
    const modBtn = document.createElement("button");
    modBtn.className = "btn btn-ghost";
    modBtn.textContent = "Modifica";
    modBtn.onclick = (e) => { e.stopPropagation(); openDetailSheet(a); };
    actions.appendChild(modBtn);

    if (opts.nascondibile){
      const hideBtn = document.createElement("button");
      hideBtn.className = "btn btn-ghost btn-mini";
      hideBtn.textContent = "Nascondi";
      hideBtn.onclick = (e) => { e.stopPropagation(); setStato(a.id, {nascosto:true}); refreshAll(); };
      actions.appendChild(hideBtn);
    }
  }

  div.appendChild(actions);
  if (!nascosto) div.onclick = () => openDetailSheet(a);
  return div;
}

/* ---------------------------------------------------------- timer riunione */
function iniziaAttivita(a){
  setStato(a.id, {inizio: oraOra(), fine: undefined});
  refreshAll();
}
function terminaAttivita(a){
  const st = getStato(a.id);
  const fine = oraOra();
  const ore = oreDaOrari(st.inizio, fine);
  setStato(a.id, {fine, ore: ore != null ? ore : effectiveOre(a), fatto:true});
  refreshAll();
}

/* ---------------------------------------------------------- render: Oggi */
function renderOggi(){
  document.getElementById("oggi-data").textContent = formatDataLunga(todayISO());
  const lista = document.getElementById("oggi-lista");
  lista.innerHTML = "";
  const oggi = allActivities()
    .filter(a => a.data === todayISO())
    .filter(a => !isNascosto(a))
    .filter(classeVisibile)
    .sort((a,b) => (a.ora||"").localeCompare(b.ora||""));
  if (oggi.length === 0){
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessuna attività in programma oggi.\nUsa + per registrarne una non prevista.";
    lista.appendChild(empty);
    return;
  }
  oggi.forEach(a => lista.appendChild(creaCard(a)));
}

/* ---------------------------------------------------------- render: Calendario */
function popolaFiltroMesi(){
  const sel = document.getElementById("filtro-mese");
  const precedente = sel.value;
  const mesi = [...new Set(allActivities()
    .filter(a => effectiveCategoria(a) === "collegio" || effectiveCategoria(a) === "consigli")
    .map(a => meseKey(a.data)))].sort();
  sel.innerHTML = `<option value="tutti">Tutti i mesi</option>` +
    mesi.map(m => `<option value="${m}">${formatMeseAnno(m+"-01")}</option>`).join("");
  // Mantiene il mese scelto dall'utente, se esiste ancora.
  sel.value = mesi.includes(precedente) ? precedente : "tutti";
}
function renderCalendario(){
  const lista = document.getElementById("calendario-lista");
  lista.innerHTML = "";
  const meseSel = document.getElementById("filtro-mese").value;
  const statoSel = document.getElementById("filtro-stato").value;

  // Il filtro "Nascoste" e' il ripostiglio: mostra tutto cio' che hai nascosto
  // (di qualsiasi categoria) per poterlo rimettere in lista.
  const soloNascoste = (statoSel === "nascoste");

  let items = allActivities()
    .filter(a => soloNascoste ? isNascosto(a) : !isNascosto(a))
    .filter(a => soloNascoste || effectiveCategoria(a) === "collegio" || effectiveCategoria(a) === "consigli")
    .filter(classeVisibile)
    .filter(a => meseSel === "tutti" || meseKey(a.data) === meseSel)
    .filter(a => soloNascoste || statoSel === "tutte" || (statoSel === "fatte") === isFatto(a))
    .sort((a,b) => (a.data+(a.ora||"")).localeCompare(b.data+(b.ora||"")));

  if (items.length === 0){
    lista.innerHTML = soloNascoste
      ? `<div class="empty-state">Nessuna attività nascosta.</div>`
      : `<div class="empty-state">Nessuna attività con questi filtri.</div>`;
    return;
  }
  let meseCorrente = null;
  for (const a of items){
    const mk = meseKey(a.data);
    if (mk !== meseCorrente){
      meseCorrente = mk;
      const h = document.createElement("div");
      h.className = "month-heading";
      h.textContent = formatMeseAnno(a.data);
      lista.appendChild(h);
    }
    lista.appendChild(creaCard(a, {nascondibile:true}));
  }
}

/* ---------------------------------------------------------- render: Altro (fuori tetto) */
function renderAltro(){
  const lista = document.getElementById("altro-lista");
  lista.innerHTML = "";
  const items = allActivities()
    .filter(a => effectiveCategoria(a) === "altro")
    .filter(a => !isNascosto(a))
    .filter(classeVisibile)
    .sort((a,b) => (a.data+(a.ora||"")).localeCompare(b.data+(b.ora||"")));
  if (items.length === 0){
    lista.innerHTML = `<div class="empty-state">Nessuna attività qui.</div>`;
    return;
  }
  let meseCorrente = null;
  for (const a of items){
    const mk = meseKey(a.data);
    if (mk !== meseCorrente){
      meseCorrente = mk;
      const h = document.createElement("div");
      h.className = "month-heading";
      h.textContent = formatMeseAnno(a.data);
      lista.appendChild(h);
    }
    lista.appendChild(creaCard(a, {nascondibile:true}));
  }
}

/* ---------------------------------------------------------- Impostazioni */
function renderImpostazioni(){
  document.getElementById("input-target-collegio").value = SETTINGS.targetCollegio;
  document.getElementById("input-target-consigli").value = SETTINGS.targetConsigli;
  document.getElementById("input-mie-classi").value = (SETTINGS.mieClassi || []).join(", ");
  document.getElementById("input-nome").value = SETTINGS.nome || "";
  if (PIANO){
    document.getElementById("info-piano").textContent =
      `${PIANO.istituto || ""} — a.s. ${PIANO.anno_scolastico || ""}. Fonte: ${PIANO.fonte || ""}.`;
  }
}
function salvaImpostazioni(){
  SETTINGS.targetCollegio = parseFloat(document.getElementById("input-target-collegio").value) || 0;
  SETTINGS.targetConsigli = parseFloat(document.getElementById("input-target-consigli").value) || 0;
  SETTINGS.mieClassi = document.getElementById("input-mie-classi").value
    .split(",").map(s => s.trim()).filter(Boolean);
  SETTINGS.nome = document.getElementById("input-nome").value.trim();
  save(LS_SETTINGS, SETTINGS);
  refreshAll();
}

/* ---------------------------------------------------------- Prospetto ore */
function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]);
}
function dataBreve(s){
  const d = parseISO(s);
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
}
function dataEstesa(s){
  return parseISO(s).toLocaleDateString("it-IT", { day:"numeric", month:"long", year:"numeric" });
}
// Orari da mettere in prospetto: quelli registrati col timer se ci sono,
// altrimenti quelli previsti dal Piano (inizio + durata).
function orariRiga(a){
  const st = getStato(a.id);
  if (st.inizio && st.fine) return [st.inizio, st.fine];
  const base = st.inizio || a.ora;
  const inizio = orarioInMinuti(base);
  if (inizio == null) return ["\u2014", "\u2014"];
  const fine = Math.round(inizio + (effectiveOre(a) || 0) * 60) % (24*60);
  return [base, `${pad2(Math.floor(fine/60))}:${pad2(fine%60)}`];
}
function righeSvolte(cat){
  return allActivities()
    .filter(a => !isNascosto(a))
    .filter(isFatto)
    .filter(a => effectiveCategoria(a) === cat)
    .sort((a,b) => (a.data + (a.ora||"")).localeCompare(b.data + (b.ora||"")));
}
function rigaSintesi(label, fatte, target){
  let valore, nota, cls = "pr-dx";
  if (target == null){
    valore = `${fmtOre(fatte)} ore`;
    nota = "fuori dai tetti";
  } else {
    valore = `${fmtOre(fatte)} / ${fmtOre(target)} ore`;
    if (fatte > target){ nota = `oltre di ${fmtOre(fatte - target)}`; cls += " pr-over"; }
    else nota = `restano ${fmtOre(target - fatte)}`;
  }
  return `<div class="pr-riga"><span class="pr-lab">${label}</span>` +
         `<span class="pr-val">${valore}</span><span class="${cls}">${nota}</span></div>`;
}
function sezioneProspetto(titolo, cat, target){
  const righe = righeSvolte(cat);
  const totale = righe.reduce((s,a) => s + (effectiveOre(a) || 0), 0);
  const corpo = righe.length
    ? righe.map(a => {
        const [ini, fin] = orariRiga(a);
        return `<tr>` +
          `<td>${dataBreve(a.data)}</td>` +
          `<td>${escapeHtml(a.titolo)}${a.classe ? " \u00b7 " + escapeHtml(a.classe) : ""}</td>` +
          `<td class="pr-c">${ini}</td>` +
          `<td class="pr-c">${fin}</td>` +
          `<td class="pr-n">${fmtOre(effectiveOre(a) || 0)}</td>` +
        `</tr>`;
      }).join("")
    : `<tr><td colspan="5" class="pr-vuoto">Nessuna ora registrata.</td></tr>`;

  let piede = `<tr class="pr-tot"><td colspan="4">Totale ore svolte</td>` +
              `<td class="pr-n">${fmtOre(totale)}</td></tr>`;
  if (target != null){
    const oltre = Math.max(0, totale - target);
    piede += oltre > 0
      ? `<tr class="pr-tot2"><td colspan="4">Oltre il tetto di ${fmtOre(target)} ore</td>` +
        `<td class="pr-n pr-over">+${fmtOre(oltre)}</td></tr>`
      : `<tr class="pr-tot2"><td colspan="4">Ancora da svolgere sul tetto di ${fmtOre(target)} ore</td>` +
        `<td class="pr-n">${fmtOre(target - totale)}</td></tr>`;
  }
  return `<h2 class="pr-h2">${titolo}</h2>` +
    `<table class="pr-tab">` +
    `<thead><tr><th>Data</th><th>Attivit\u00e0</th><th>Inizio</th><th>Fine</th><th>Ore</th></tr></thead>` +
    `<tbody>${corpo}${piede}</tbody></table>`;
}
function renderProspetto(){
  const tot = computeTotals();
  const intestazione = [];
  if (SETTINGS.nome) intestazione.push(escapeHtml(SETTINGS.nome));
  if (PIANO && PIANO.istituto) intestazione.push(escapeHtml(PIANO.istituto));
  if (PIANO && PIANO.anno_scolastico) intestazione.push("a.s. " + escapeHtml(PIANO.anno_scolastico));

  document.getElementById("prospetto-doc").innerHTML = `
    <div class="pr-head">
      <div class="pr-title">Ore attivit\u00e0 funzionali svolte</div>
      <div class="pr-sub">${intestazione.join(" \u00b7 ")}</div>
      <div class="pr-sub">Aggiornato al ${dataEstesa(todayISO())}</div>
    </div>
    <div class="pr-sintesi">
      ${rigaSintesi("Collegio", tot.collegio, SETTINGS.targetCollegio)}
      ${rigaSintesi("Consigli", tot.consigli, SETTINGS.targetConsigli)}
      ${rigaSintesi("Fuori tetto", tot.altro, null)}
    </div>
    ${sezioneProspetto("Collegio", "collegio", SETTINGS.targetCollegio)}
    ${sezioneProspetto("Consigli", "consigli", SETTINGS.targetConsigli)}
    ${sezioneProspetto("Fuori tetto 40+40", "altro", null)}
  `;
}
function apriProspetto(){
  renderProspetto();
  showView("prospetto");
}

/* ---------------------------------------------------------- Bottom sheet: dettaglio */
function openDetailSheet(a){
  const st = getStato(a.id);
  const cat = effectiveCategoria(a);
  const ore = effectiveOre(a);
  const fatto = isFatto(a);
  const html = `
    <h2>${a.titolo}${a.classe ? " · " + a.classe : ""}</h2>
    <div class="hint">${formatDataLunga(a.data)}${a.ora ? " · " + a.ora : ""}${a.sede ? " · " + a.sede : ""}</div>
    <label>Categoria</label>
    <select id="d-categoria">
      <option value="collegio" ${cat==="collegio"?"selected":""}>Collegio (40h)</option>
      <option value="consigli" ${cat==="consigli"?"selected":""}>Consigli (40h)</option>
      <option value="altro" ${cat==="altro"?"selected":""}>Altro (fuori tetto)</option>
    </select>
    <label>Ora inizio / ora fine (facoltativo)</label>
    <div style="display:flex;gap:10px;">
      <input type="time" id="d-inizio" value="${st.inizio || ""}" style="flex:1;">
      <input type="time" id="d-fine" value="${st.fine || ""}" style="flex:1;">
    </div>
    <label>Ore effettive</label>
    <input type="number" id="d-ore" min="0" step="0.05" value="${ore}">
    <label><input type="checkbox" id="d-fatto" ${fatto?"checked":""}> Attività svolta</label>
    <div class="sheet-actions">
      ${a.extra ? '<button class="btn btn-ghost" id="d-elimina">Elimina</button>' : ""}
      <button class="btn btn-primary" id="d-salva">Salva</button>
    </div>
  `;
  showSheet(html);

  const ricalcola = () => {
    const i = document.getElementById("d-inizio").value;
    const f = document.getElementById("d-fine").value;
    const calcolate = oreDaOrari(i, f);
    if (calcolate != null) document.getElementById("d-ore").value = calcolate;
  };
  document.getElementById("d-inizio").addEventListener("change", ricalcola);
  document.getElementById("d-fine").addEventListener("change", ricalcola);

  document.getElementById("d-salva").onclick = () => {
    const nuovaCat = document.getElementById("d-categoria").value;
    const nuoveOre = parseFloat(document.getElementById("d-ore").value) || 0;
    const nuovoFatto = document.getElementById("d-fatto").checked;
    const nuovoInizio = document.getElementById("d-inizio").value || undefined;
    const nuovaFine = document.getElementById("d-fine").value || undefined;
    if (a.extra){
      const idx = EXTRA.findIndex(x => x.id === a.id);
      if (idx >= 0){ EXTRA[idx].categoria = nuovaCat; EXTRA[idx].ore = nuoveOre; save(LS_EXTRA, EXTRA); }
      setStato(a.id, {fatto:nuovoFatto, inizio:nuovoInizio, fine:nuovaFine});
    } else {
      setStato(a.id, {
        categoria: nuovaCat === a.categoria ? undefined : nuovaCat,
        ore: nuoveOre === a.ore ? undefined : nuoveOre,
        fatto: nuovoFatto,
        inizio: nuovoInizio,
        fine: nuovaFine
      });
    }
    closeSheet();
    refreshAll();
  };
  const delBtn = document.getElementById("d-elimina");
  if (delBtn) delBtn.onclick = () => {
    EXTRA = EXTRA.filter(x => x.id !== a.id);
    save(LS_EXTRA, EXTRA);
    delete STATO[a.id];
    save(LS_STATO, STATO);
    closeSheet();
    refreshAll();
  };
}

/* ---------------------------------------------------------- Bottom sheet: aggiungi */
function openAddSheet(){
  const html = `
    <h2>Nuova attività</h2>
    <div class="sheet-actions" style="margin-top:0;margin-bottom:6px;">
      <button class="btn btn-ghost" id="tpl-generica">Generica</button>
      <button class="btn btn-ghost" id="tpl-glo">GLO</button>
    </div>
    <label>Titolo</label>
    <input type="text" id="a-titolo" value="Attività">
    <label>Data</label>
    <input type="date" id="a-data" value="${todayISO()}">
    <label>Categoria</label>
    <select id="a-categoria">
      <option value="collegio">Collegio (40h)</option>
      <option value="consigli" selected>Consigli (40h)</option>
      <option value="altro">Altro (fuori tetto)</option>
    </select>
    <div id="a-glo-box" class="hidden">
      <label>Alunni certificati</label>
      <input type="number" id="a-alunni" min="1" step="1" value="1">
    </div>
    <label>Ore</label>
    <input type="number" id="a-ore" min="0" step="0.25" value="1">
    <label>Classe (facoltativo)</label>
    <input type="text" id="a-classe" placeholder="es. 2A">
    <label><input type="checkbox" id="a-fatto" checked> Segna già come svolta</label>
    <div class="sheet-actions">
      <button class="btn btn-primary" id="a-salva">Aggiungi</button>
    </div>
  `;
  showSheet(html);

  document.getElementById("tpl-generica").onclick = () => {
    document.getElementById("a-titolo").value = "Attività";
    document.getElementById("a-categoria").value = "consigli";
    document.getElementById("a-glo-box").classList.add("hidden");
  };
  document.getElementById("tpl-glo").onclick = () => {
    document.getElementById("a-titolo").value = "GLO";
    document.getElementById("a-categoria").value = "consigli";
    document.getElementById("a-glo-box").classList.remove("hidden");
    aggiornaOreGlo();
  };
  document.getElementById("a-salva").onclick = () => {
    const nuovo = {
      id: "extra-" + Date.now(),
      data: document.getElementById("a-data").value || todayISO(),
      titolo: document.getElementById("a-titolo").value.trim() || "Attività",
      categoria: document.getElementById("a-categoria").value,
      ore: parseFloat(document.getElementById("a-ore").value) || 0,
      classe: document.getElementById("a-classe").value.trim() || undefined,
      extra: true
    };
    EXTRA.push(nuovo);
    save(LS_EXTRA, EXTRA);
    setStato(nuovo.id, {fatto: document.getElementById("a-fatto").checked});
    closeSheet();
    mostraNuova(nuovo);
  };
}
// Dopo un inserimento: i filtri del calendario potrebbero nascondere l'attivita'
// appena creata (es. filtro "Da fare" con attivita' gia' svolta). Li azzeriamo,
// apriamo la schermata giusta e la evidenziamo, cosi' si vede subito dov'e'.
function mostraNuova(nuovo){
  document.getElementById("filtro-mese").value = "tutti";
  document.getElementById("filtro-stato").value = "tutte";
  refreshAll();
  let vista = "calendario", contenitore = "calendario-lista";
  if (nuovo.data === todayISO()){ vista = "oggi"; contenitore = "oggi-lista"; }
  else if (nuovo.categoria === "altro"){ vista = "altro"; contenitore = "altro-lista"; }
  showView(vista);
  evidenzia(contenitore, nuovo.id);
}
function evidenzia(contenitoreId, id){
  const el = document.getElementById(contenitoreId).querySelector(`.card[data-id="${id}"]`);
  if (!el) return;
  el.classList.add("evidenzia");
  el.scrollIntoView({block:"center", behavior:"smooth"});
  setTimeout(() => el.classList.remove("evidenzia"), 2600);
}
function aggiornaOreGlo(){
  const box = document.getElementById("a-glo-box");
  if (box.classList.contains("hidden")) return;
  const alunni = parseFloat(document.getElementById("a-alunni").value) || 0;
  document.getElementById("a-ore").value = alunni;
}

/* ---------------------------------------------------------- Sheet generico */
function showSheet(html){
  document.getElementById("sheet-content").innerHTML = html;
  document.getElementById("sheet").classList.remove("hidden");
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  const gloAlunni = document.getElementById("a-alunni");
  if (gloAlunni) gloAlunni.oninput = aggiornaOreGlo;
}
function closeSheet(){
  document.getElementById("sheet").classList.add("hidden");
  document.getElementById("sheet-backdrop").classList.add("hidden");
}

/* ---------------------------------------------------------- Navigazione */
function showView(name){
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-" + name).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  const isSecondary = (name === "impostazioni" || name === "prospetto");
  document.getElementById("tabbar").classList.toggle("hidden", isSecondary);
  document.getElementById("btn-add").classList.toggle("hidden", isSecondary);
  if (!isSecondary) currentMainView = name;
  window.scrollTo(0,0);
}
function refreshAll(){
  renderContatori();
  renderOggi();
  popolaFiltroMesi();
  renderCalendario();
  renderAltro();
}

/* ---------------------------------------------------------- Backup */
function esportaBackup(){
  const payload = { stato: STATO, extra: EXTRA, settings: SETTINGS, esportato: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-40piu40-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function azzeraTutto(){
  const ok = confirm("Cancellare tutte le presenze registrate e le attività aggiunte a mano? Non si può annullare.\n\nIl calendario del Piano Annuale resta, solo lo storico di ciò che hai segnato viene azzerato.");
  if (!ok) return;
  STATO = {};
  EXTRA = [];
  save(LS_STATO, STATO);
  save(LS_EXTRA, EXTRA);
  refreshAll();
  alert("Dati azzerati.");
}
function importaBackup(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if (data.stato) { STATO = data.stato; save(LS_STATO, STATO); }
      if (data.extra) { EXTRA = data.extra; save(LS_EXTRA, EXTRA); }
      if (data.settings) { SETTINGS = Object.assign(SETTINGS, data.settings); save(LS_SETTINGS, SETTINGS); }
      renderImpostazioni();
      refreshAll();
      alert("Backup importato.");
    }catch(e){
      alert("Il file non sembra un backup valido.");
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------- Avvio */
async function init(){
  loadState();
  try{
    const res = await fetch("./data/piano.json");
    PIANO = await res.json();
    if (!load(LS_SETTINGS, null)){
      SETTINGS.targetCollegio = PIANO.target_ore?.collegio ?? 40;
      SETTINGS.targetConsigli = PIANO.target_ore?.consigli ?? 40;
      save(LS_SETTINGS, SETTINGS);
    }
  }catch(e){
    console.error("Impossibile caricare data/piano.json", e);
    PIANO = { attivita: [] };
  }

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => showView(currentMainView));
  });
  document.getElementById("btn-settings").addEventListener("click", () => {
    renderImpostazioni();
    showView("impostazioni");
  });
  document.getElementById("btn-add").addEventListener("click", openAddSheet);
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);

  document.getElementById("filtro-mese").addEventListener("change", renderCalendario);
  document.getElementById("filtro-stato").addEventListener("change", renderCalendario);

  document.getElementById("input-target-collegio").addEventListener("change", salvaImpostazioni);
  document.getElementById("input-target-consigli").addEventListener("change", salvaImpostazioni);
  document.getElementById("input-mie-classi").addEventListener("change", salvaImpostazioni);
  document.getElementById("input-nome").addEventListener("change", salvaImpostazioni);

  document.getElementById("btn-prospetto").addEventListener("click", () => {
    salvaImpostazioni();
    apriProspetto();
  });
  document.getElementById("prospetto-back").addEventListener("click", () => {
    renderImpostazioni();
    showView("impostazioni");
  });
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  document.getElementById("btn-export").addEventListener("click", esportaBackup);
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("input-import").click());
  document.getElementById("input-import").addEventListener("change", (e) => {
    if (e.target.files[0]) importaBackup(e.target.files[0]);
  });
  document.getElementById("btn-reset").addEventListener("click", azzeraTutto);

  refreshAll();
  showView("oggi");

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
