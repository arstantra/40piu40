/* 40+40 — conteggio ore attività funzionali (CCNL scuola)
   Tutto locale: nessun server, nessun account. I dati vivono in localStorage
   sul telefono; il file data/piano.json contiene il calendario precaricato
   dal Piano Annuale della scuola. */

const LS_STATO = "40piu40_stato";      // { [id]: {fatto, ore?, categoria?, inizio?, fine?, nascosto?, giustificato?} }
const LS_EXTRA = "40piu40_extra";      // [ {id, data, titolo, categoria, ore, classe?, sede?, extra:true} ]
const LS_SETTINGS = "40piu40_settings"; // { targetCollegio, targetConsigli, mieClassi:[], nome }
const LS_MODIFICATO = "40piu40_modificato"; // ora dell'ultima modifica ai dati: serve al confronto con Drive

let PIANO = null;      // contenuto data/piano.json
let STATO = {};
let EXTRA = [];
let SETTINGS = { targetCollegio: 40, targetConsigli: 40, mieClassi: [], nome: "", promemoria: 60, ultimoBackup: "" };
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
function etichettaGiust(n){
  return `${fmtOre(n)} giustificat${n === 1 ? "a" : "e"}`;
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
let driveZitto = false;   // true solo mentre applico un file scaricato da Drive
function save(key, val){
  let testo;
  try{ testo = JSON.stringify(val); }catch(e){ return; }
  // Riscrivere lo stesso identico contenuto non e' una modifica: aprire il
  // prospetto risalva le impostazioni tali e quali, e senza questo controllo
  // quel gesto farebbe sembrare questo dispositivo il piu' aggiornato.
  let uguale = false;
  try{ uguale = (localStorage.getItem(key) === testo); }catch(e){}
  try{ localStorage.setItem(key, testo); }
  catch(e){ console.warn("Salvataggio non riuscito", e); }
  // Ogni modifica vera segna l'ora e fa ripartire il conto alla rovescia del
  // salvataggio su Drive. Mentre applico un file appena scaricato sto zitto,
  // altrimenti lo rimanderei su' un istante dopo.
  if (!uguale && !driveZitto && (key === LS_STATO || key === LS_EXTRA || key === LS_SETTINGS)){
    segnaModifica();
  }
}
function segnaModifica(){
  try{ localStorage.setItem(LS_MODIFICATO, new Date().toISOString()); }catch(e){}
  programmaDrive();
}
function loadState(){
  STATO = load(LS_STATO, {});
  EXTRA = load(LS_EXTRA, []);
  SETTINGS = Object.assign({targetCollegio:40, targetConsigli:40, mieClassi:[], nome:"", promemoria:60, ultimoBackup:""}, load(LS_SETTINGS, {}));
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
function effectiveTitolo(a){
  const st = getStato(a.id);
  return (st.titolo && st.titolo.trim()) ? st.titolo : a.titolo;
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
// Assenza giustificata: la riunione c'era, io no. Le ore non sono svolte, ma
// restano recintate dentro il tetto e nessuno me le puo' piu' chiedere.
// Vale solo per collegio e consigli: "altro" e' fuori tetto, non ha un tetto.
function isGiustificato(a){
  return !!getStato(a.id).giustificato;
}
function classeVisibile(a){
  if (a.extra) return true; // le attivita' aggiunte a mano sono sempre visibili
  if (!a.classe) return true;
  if (!SETTINGS.mieClassi || SETTINGS.mieClassi.length === 0) return true;
  return SETTINGS.mieClassi.some(c => c.toLowerCase() === a.classe.toLowerCase());
}

function computeTotals(){
  const tot = { collegio:0, consigli:0, altro:0, giustificate:{ collegio:0, consigli:0 } };
  for (const a of allActivities()){
    // Una voce nascosta non scala niente: "nascosto" prevale su tutto.
    if (isNascosto(a)) continue;
    const cat = effectiveCategoria(a);
    const ore = effectiveOre(a) || 0;
    // Le assenze si contano a parte e non arrivano mai alle ore svolte.
    // Le ore sono sempre quelle previste dal calendario: non c'e' stato timer.
    if (isGiustificato(a) && tot.giustificate[cat] != null){
      tot.giustificate[cat] += ore;
      continue;
    }
    if (!isFatto(a)) continue;
    if (tot[cat] != null) tot[cat] += ore; else tot.altro += ore;
  }
  return tot;
}

/* ---------------------------------------------------------- render: contatori */
function renderContatori(){
  const tot = computeTotals();
  fillCounter("collegio", tot.collegio, SETTINGS.targetCollegio, tot.giustificate.collegio);
  fillCounter("consigli", tot.consigli, SETTINGS.targetConsigli, tot.giustificate.consigli);
}
function fillCounter(cat, fatte, target, giust){
  giust = giust || 0;
  // Il tetto resta 40: sono le ore ancora disponibili a scendere. L'app mostra
  // tutti e due i numeri e lascia l'interpretazione a chi legge.
  const disponibile = Math.max(0, target - giust);
  const entro = Math.min(fatte, disponibile);
  const oltre = Math.max(0, fatte - disponibile);
  const residuo = Math.max(0, disponibile - fatte);
  const scala = Math.max(target, fatte + giust, 1);

  document.getElementById(`c-${cat}-fatte`).textContent = fmtOre(fatte);
  document.getElementById(`c-${cat}-target`).textContent = fmtOre(target);
  const nota = document.getElementById(`c-${cat}-giust`);
  nota.textContent = giust > 0 ? ` · ${etichettaGiust(giust)}` : "";

  // Seconda colonna: quante ore restano da svolgere (sul monte disponibile);
  // se il tetto e' superato, mostra invece di quanto si e' andati oltre.
  const rest = document.getElementById(`c-${cat}-restanti`);
  const restLab = document.getElementById(`lab-${cat}-restanti`);
  rest.classList.toggle("over", oltre > 0);
  if (oltre > 0){
    rest.textContent = "+" + fmtOre(oltre);
    restLab.textContent = "oltre";
  } else {
    rest.textContent = fmtOre(residuo);
    restLab.textContent = "da svolgere";
  }

  // Barra: blu (svolte) | grigio vuoto (ancora da fare) | tratteggio
  // (giustificate, tappo fisso in fondo al tetto) | rosso (oltre).
  // Il grigio e' uno spacer in flex: si mangia lo spazio che avanza e collassa
  // da solo quando non ne resta, cosi' il rosso esce oltre il tetto.
  const barBlue = document.getElementById(`bar-${cat}-blue`);
  const barJust = document.getElementById(`bar-${cat}-just`);
  const barRed = document.getElementById(`bar-${cat}-red`);
  barBlue.style.width = (entro/scala*100) + "%";
  barJust.style.width = (giust/scala*100) + "%";
  barRed.style.width = (oltre/scala*100) + "%";
  // Linea di stacco solo se c'e' davvero qualcosa da recintare: su un div a
  // larghezza zero un bordo resterebbe visibile come una tacca parassita.
  barJust.classList.toggle("on", giust > 0);
  barBlue.classList.toggle("full", disponibile > 0 && fatte >= disponibile);
}

/* ---------------------------------------------------------- render: card */
function tagLabel(cat){
  return cat === "collegio" ? "Collegio" : cat === "consigli" ? "Consigli" : "Altro";
}
function creaCard(a, opts){
  opts = opts || {};
  const div = document.createElement("div");
  const nascosto = isNascosto(a);
  const giust = isGiustificato(a);
  const fatto = isFatto(a);
  const inCorso = isInCorso(a);
  const st = getStato(a.id);
  div.className = "card" + (fatto || giust ? " done" : "") + (nascosto ? " nascosta" : "");
  div.dataset.id = a.id;

  const top = document.createElement("div");
  top.className = "card-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = effectiveTitolo(a) + (a.classe ? ` · ${a.classe}` : "");
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
  } else if (giust){
    // Dicitura, non pulsante: un tocco toglie l'assenza e rimette l'attivita'
    // in gioco. Sulle extra ripristina anche il "svolta di default".
    const btn = document.createElement("button");
    btn.className = "btn btn-assente";
    btn.textContent = "assente";
    btn.onclick = (e) => {
      e.stopPropagation();
      setStato(a.id, a.extra ? {giustificato:false, fatto:undefined} : {giustificato:false});
      refreshAll();
    };
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
    // Se ho segnato che non ci sarò, oggi non ho niente da fare: la ritrovo
    // in Calendario, dove posso anche cambiare idea.
    .filter(a => !isGiustificato(a))
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
    .filter(a => soloNascoste || statoSel === "tutte" || (statoSel === "fatte") === (isFatto(a) || isGiustificato(a)))
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
  document.getElementById("input-promemoria").value = String(SETTINGS.promemoria ?? 60);
  if (PIANO){
    document.getElementById("info-piano").textContent =
      `${PIANO.istituto || ""} — a.s. ${PIANO.anno_scolastico || ""}. Fonte: ${PIANO.fonte || ""}.`;
  }
  renderDrive();
  mostraUltimoBackup();
  mostraMemoria();
  mostraVersione();
}
// La versione non e' scritta a mano da nessuna parte: si legge dal nome della
// cache da cui l'app si sta davvero servendo. Cosi' questa riga non dice quale
// versione dovrebbe esserci, dice quale c'e' — che e' l'unica cosa utile
// quando si sospetta che il telefono abbia ancora la vecchia in cache.
async function mostraVersione(){
  const el = document.getElementById("info-versione");
  if (!el) return;
  let versione = "—";
  try{
    const nomi = (await caches.keys()).filter(n => /^40piu40-v\d+$/.test(n));
    if (nomi.length){
      // Durante un aggiornamento puo' esserci piu' di una cache per qualche
      // istante: vale la piu' recente, ed e' un confronto numerico (v10 > v9).
      const num = n => parseInt(n.match(/-v(\d+)$/)[1], 10);
      versione = nomi.sort((a,b) => num(a) - num(b)).pop().replace("40piu40-", "");
    }
  }catch(e){ /* niente cache (o niente service worker): resta il trattino */ }
  el.textContent = `Versione installata: ${versione}`;
}
function salvaImpostazioni(){
  SETTINGS.targetCollegio = parseFloat(document.getElementById("input-target-collegio").value) || 0;
  SETTINGS.targetConsigli = parseFloat(document.getElementById("input-target-consigli").value) || 0;
  SETTINGS.mieClassi = document.getElementById("input-mie-classi").value
    .split(",").map(s => s.trim()).filter(Boolean);
  SETTINGS.nome = document.getElementById("input-nome").value.trim();
  SETTINGS.promemoria = parseInt(document.getElementById("input-promemoria").value, 10) || 0;
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
    // Le assenze restano in tabella: il registro non si falsifica. Non entrano
    // pero' nel totale (il reduce in sezioneProspetto le salta).
    .filter(a => isFatto(a) || isGiustificato(a))
    .filter(a => effectiveCategoria(a) === cat)
    .sort((a,b) => (a.data + (a.ora||"")).localeCompare(b.data + (b.ora||"")));
}
function rigaSintesi(label, fatte, target, giust){
  giust = giust || 0;
  let valore, nota, cls = "pr-dx";
  if (target == null){
    valore = `${fmtOre(fatte)} ore`;
    nota = "fuori dai tetti";
  } else {
    const disponibile = Math.max(0, target - giust);
    valore = `${fmtOre(fatte)} / ${fmtOre(target)} ore`;
    if (giust > 0) valore += `<span class="pr-giust"> · ${etichettaGiust(giust)}</span>`;
    if (fatte > disponibile){ nota = `oltre di ${fmtOre(fatte - disponibile)}`; cls += " pr-over"; }
    else nota = `restano ${fmtOre(disponibile - fatte)}`;
  }
  return `<div class="pr-riga"><span class="pr-lab">${label}</span>` +
         `<span class="pr-val">${valore}</span><span class="${cls}">${nota}</span></div>`;
}
function sezioneProspetto(titolo, cat, target, giust){
  giust = giust || 0;
  const righe = righeSvolte(cat);
  const totale = righe.reduce((s,a) => s + (isGiustificato(a) ? 0 : (effectiveOre(a) || 0)), 0);
  const corpo = righe.length
    ? righe.map(a => {
        // Per un'assenza non ci sono orari da dichiarare: non c'ero.
        const ass = isGiustificato(a);
        const [ini, fin] = ass ? ["\u2014", "\u2014"] : orariRiga(a);
        return `<tr>` +
          `<td>${dataBreve(a.data)}</td>` +
          `<td>${escapeHtml(effectiveTitolo(a))}${a.classe ? " \u00b7 " + escapeHtml(a.classe) : ""}</td>` +
          `<td class="pr-c">${ini}</td>` +
          `<td class="pr-c">${fin}</td>` +
          (ass ? `<td class="pr-n pr-assente">assente</td>`
               : `<td class="pr-n">${fmtOre(effectiveOre(a) || 0)}</td>`) +
        `</tr>`;
      }).join("")
    : `<tr><td colspan="5" class="pr-vuoto">Nessuna ora registrata.</td></tr>`;

  let piede = `<tr class="pr-tot"><td colspan="4">Totale ore svolte</td>` +
              `<td class="pr-n">${fmtOre(totale)}</td></tr>`;
  if (giust > 0){
    piede += `<tr class="pr-tot2"><td colspan="4">Ore di assenza giustificata</td>` +
             `<td class="pr-n">${fmtOre(giust)}</td></tr>`;
  }
  if (target != null){
    // La sottrazione va scritta per esteso: chi legge il foglio deve poter
    // rifare il conto da solo, senza chiedere spiegazioni.
    const disponibile = Math.max(0, target - giust);
    const quota = giust > 0
      ? `${fmtOre(target)} ore (${fmtOre(target)} − ${etichettaGiust(giust)})`
      : `${fmtOre(target)} ore`;
    piede += totale > disponibile
      ? `<tr class="pr-tot2"><td colspan="4">Oltre il tetto di ${quota}</td>` +
        `<td class="pr-n pr-over">+${fmtOre(totale - disponibile)}</td></tr>`
      : `<tr class="pr-tot2"><td colspan="4">Ancora da svolgere sul tetto di ${quota}</td>` +
        `<td class="pr-n">${fmtOre(disponibile - totale)}</td></tr>`;
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
      ${rigaSintesi("Collegio", tot.collegio, SETTINGS.targetCollegio, tot.giustificate.collegio)}
      ${rigaSintesi("Consigli", tot.consigli, SETTINGS.targetConsigli, tot.giustificate.consigli)}
      ${rigaSintesi("Fuori tetto", tot.altro, null)}
    </div>
    ${sezioneProspetto("Collegio", "collegio", SETTINGS.targetCollegio, tot.giustificate.collegio)}
    ${sezioneProspetto("Consigli", "consigli", SETTINGS.targetConsigli, tot.giustificate.consigli)}
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
  const giust = isGiustificato(a);
  const html = `
    <h2>Modifica</h2>
    <div class="hint">${formatDataLunga(a.data)}${a.ora ? " · " + a.ora : ""}${a.sede ? " · " + a.sede : ""}${a.classe ? " · " + escapeHtml(a.classe) : ""}</div>
    <label>Titolo</label>
    <input type="text" id="d-titolo" value="${escapeHtml(effectiveTitolo(a))}">
    <label>Categoria</label>
    <select id="d-categoria">
      <option value="collegio" ${cat==="collegio"?"selected":""}>Collegio (40h)</option>
      <option value="consigli" ${cat==="consigli"?"selected":""}>Consigli (40h)</option>
      <option value="altro" ${cat==="altro"?"selected":""}>Altro (fuori tetto)</option>
    </select>
    <label id="d-giust-riga"><input type="checkbox" id="d-giustificato" ${giust?"checked":""}> Assente giustificato</label>
    <div id="d-orari-box">
      <label>Ora inizio / ora fine (facoltativo)</label>
      <div style="display:flex;gap:10px;">
        <input type="time" id="d-inizio" value="${st.inizio || ""}" style="flex:1;">
        <input type="time" id="d-fine" value="${st.fine || ""}" style="flex:1;">
      </div>
    </div>
    <label id="d-ore-lab">Ore effettive</label>
    <input type="number" id="d-ore" min="0" step="0.05" value="${ore}">
    <label id="d-fatto-riga"><input type="checkbox" id="d-fatto" ${fatto?"checked":""}> Attività svolta</label>
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

  // "Assente giustificato" non esiste per "altro" (fuori tetto, non ha tetto).
  // Quando e' attiva non ci sono orari da registrare ne' una spunta "svolta".
  const aggiornaGiust = () => {
    const isAltro = document.getElementById("d-categoria").value === "altro";
    const chk = document.getElementById("d-giustificato");
    if (isAltro) chk.checked = false;
    document.getElementById("d-giust-riga").classList.toggle("hidden", isAltro);
    const on = chk.checked && !isAltro;
    document.getElementById("d-orari-box").classList.toggle("hidden", on);
    document.getElementById("d-fatto-riga").classList.toggle("hidden", on);
    document.getElementById("d-ore-lab").textContent = on ? "Ore previste" : "Ore effettive";
  };
  document.getElementById("d-categoria").addEventListener("change", aggiornaGiust);
  document.getElementById("d-giustificato").addEventListener("change", aggiornaGiust);
  aggiornaGiust();

  document.getElementById("d-salva").onclick = () => {
    const nuovoTitolo = document.getElementById("d-titolo").value.trim() || a.titolo;
    const nuovaCat = document.getElementById("d-categoria").value;
    const nuoveOre = parseFloat(document.getElementById("d-ore").value) || 0;
    // undefined, non false: cosi' una voce mai giustificata resta identica a
    // com'era prima di questo aggiornamento.
    const assente = nuovaCat !== "altro" && document.getElementById("d-giustificato").checked;
    const nuovoFatto = assente ? false : document.getElementById("d-fatto").checked;
    const nuovoInizio = assente ? undefined : (document.getElementById("d-inizio").value || undefined);
    const nuovaFine = assente ? undefined : (document.getElementById("d-fine").value || undefined);
    if (a.extra){
      const idx = EXTRA.findIndex(x => x.id === a.id);
      if (idx >= 0){ EXTRA[idx].titolo = nuovoTitolo; EXTRA[idx].categoria = nuovaCat; EXTRA[idx].ore = nuoveOre; save(LS_EXTRA, EXTRA); }
      setStato(a.id, {fatto:nuovoFatto, inizio:nuovoInizio, fine:nuovaFine, giustificato: assente ? true : undefined});
    } else {
      setStato(a.id, {
        // undefined = "come da Piano Annuale": cosi' un titolo riportato
        // all'originale non resta salvato come personalizzazione.
        titolo: nuovoTitolo === a.titolo ? undefined : nuovoTitolo,
        categoria: nuovaCat === a.categoria ? undefined : nuovaCat,
        ore: nuoveOre === a.ore ? undefined : nuoveOre,
        fatto: nuovoFatto,
        inizio: nuovoInizio,
        fine: nuovaFine,
        giustificato: assente ? true : undefined
      });
    }
    closeSheet();
    refreshAll();
  };
  const delBtn = document.getElementById("d-elimina");
  if (delBtn) delBtn.onclick = () => {
    EXTRA = EXTRA.filter(x => x.id !== a.id);
    save(LS_EXTRA, EXTRA);
    // Lapide invece di cancellazione secca: cosi' la cancellazione viaggia
    // fino all'altro dispositivo e la sincronizzazione non la fa tornare a galla.
    STATO[a.id] = { eliminato: true };
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
    <label id="a-giust-riga"><input type="checkbox" id="a-giustificato"> Assente giustificato</label>
    <div id="a-orari-box">
      <label>Ora inizio / ora fine (facoltativo)</label>
      <div style="display:flex;gap:10px;">
        <input type="time" id="a-inizio" style="flex:1;">
        <input type="time" id="a-fine" style="flex:1;">
      </div>
    </div>
    <label id="a-ore-lab">Ore</label>
    <input type="number" id="a-ore" min="0" step="0.25" value="1">
    <label>Classe (facoltativo)</label>
    <input type="text" id="a-classe" placeholder="es. 2A">
    <label id="a-fatto-riga"><input type="checkbox" id="a-fatto" checked> Segna già come svolta</label>
    <div class="sheet-actions">
      <button class="btn btn-primary" id="a-salva">Aggiungi</button>
    </div>
  `;
  showSheet(html);

  // Se si mettono inizio e fine, le ore si calcolano da sole (come in Modifica).
  const ricalcolaNuova = () => {
    const i = document.getElementById("a-inizio").value;
    const f = document.getElementById("a-fine").value;
    const calcolate = oreDaOrari(i, f);
    if (calcolate != null) document.getElementById("a-ore").value = calcolate;
  };
  document.getElementById("a-inizio").addEventListener("change", ricalcolaNuova);
  document.getElementById("a-fine").addEventListener("change", ricalcolaNuova);

  // Stessa casella e stesse regole dello sheet "Modifica": i due vanno allineati.
  const aggiornaGiustNuova = () => {
    const isAltro = document.getElementById("a-categoria").value === "altro";
    const chk = document.getElementById("a-giustificato");
    if (isAltro) chk.checked = false;
    document.getElementById("a-giust-riga").classList.toggle("hidden", isAltro);
    const on = chk.checked && !isAltro;
    document.getElementById("a-orari-box").classList.toggle("hidden", on);
    document.getElementById("a-fatto-riga").classList.toggle("hidden", on);
    document.getElementById("a-ore-lab").textContent = on ? "Ore previste" : "Ore";
  };
  document.getElementById("a-categoria").addEventListener("change", aggiornaGiustNuova);
  document.getElementById("a-giustificato").addEventListener("change", aggiornaGiustNuova);
  aggiornaGiustNuova();

  document.getElementById("tpl-generica").onclick = () => {
    document.getElementById("a-titolo").value = "Attività";
    document.getElementById("a-categoria").value = "consigli";
    document.getElementById("a-glo-box").classList.add("hidden");
    aggiornaGiustNuova();
  };
  document.getElementById("tpl-glo").onclick = () => {
    document.getElementById("a-titolo").value = "GLO";
    document.getElementById("a-categoria").value = "consigli";
    document.getElementById("a-glo-box").classList.remove("hidden");
    aggiornaOreGlo();
    aggiornaGiustNuova();
  };
  document.getElementById("a-salva").onclick = () => {
    const assente = document.getElementById("a-categoria").value !== "altro"
                 && document.getElementById("a-giustificato").checked;
    const inizio = assente ? undefined : (document.getElementById("a-inizio").value || undefined);
    const fine = assente ? undefined : (document.getElementById("a-fine").value || undefined);
    const nuovo = {
      id: "extra-" + Date.now(),
      data: document.getElementById("a-data").value || todayISO(),
      titolo: document.getElementById("a-titolo").value.trim() || "Attività",
      categoria: document.getElementById("a-categoria").value,
      ore: parseFloat(document.getElementById("a-ore").value) || 0,
      classe: document.getElementById("a-classe").value.trim() || undefined,
      ora: inizio,
      extra: true
    };
    EXTRA.push(nuovo);
    save(LS_EXTRA, EXTRA);
    // fatto:false esplicito: per le extra isFatto() vale true di default.
    setStato(nuovo.id, assente
      ? {giustificato:true, fatto:false}
      : {fatto: document.getElementById("a-fatto").checked, inizio, fine});
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
  // Un'assenza non compare in Oggi: mandarci l'utente sarebbe mandarlo davanti
  // a una lista vuota. Resta in Calendario, dove la ritrova sempre.
  if (isGiustificato(nuovo)){ /* resta in Calendario */ }
  else if (nuovo.data === todayISO()){ vista = "oggi"; contenitore = "oggi-lista"; }
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

/* ---------------------------------------------------------- Calendario .ics
   Esporta gli impegni futuri in un file standard iCalendar: si apre con il
   calendario del telefono, che poi gestisce lui i promemoria. Nessun server,
   nessuna push: e' il calendario di Android a suonare. */
function icsEsc(s){
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
// Le righe .ics non devono superare i 75 ottetti: si spezzano con uno spazio.
function icsFold(riga){
  if (riga.length <= 74) return riga;
  let out = riga.slice(0, 74), resto = riga.slice(74);
  while (resto.length > 73){ out += "\r\n " + resto.slice(0, 73); resto = resto.slice(73); }
  return out + "\r\n " + resto;
}
function icsStampUTC(d){
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}T` +
         `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}
// Ora "fluttuante" (senza fuso): il calendario la legge come ora locale.
function icsOra(dataISO, minuti){
  const d = parseISO(dataISO);
  d.setMinutes(d.getMinutes() + minuti);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}T` +
         `${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}
function icsGiorno(dataISO, piuGiorni){
  const d = parseISO(dataISO);
  d.setDate(d.getDate() + (piuGiorni || 0));
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}
// Da esportare: quello che vedi in app, da oggi in avanti. Le nascoste no.
function attivitaDaEsportare(){
  const oggi = todayISO();
  return allActivities()
    .filter(a => !isNascosto(a))
    .filter(a => !isGiustificato(a))
    .filter(classeVisibile)
    .filter(a => a.data >= oggi)
    .sort((a,b) => (a.data + (a.ora||"")).localeCompare(b.data + (b.ora||"")));
}
function generaICS(){
  const promemoria = parseInt(SETTINGS.promemoria, 10) || 0;
  const stamp = icsStampUTC(new Date());
  const righe = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//40piu40//Impegni//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Impegni ${(PIANO && PIANO.anno_scolastico) || ""}`.trim()
  ];
  for (const a of attivitaDaEsportare()){
    const ore = effectiveOre(a) || 1;
    const inizio = getStato(a.id).inizio || a.ora;
    const titolo = effectiveTitolo(a) + (a.classe ? ` ${a.classe}` : "");
    righe.push("BEGIN:VEVENT");
    righe.push(`UID:40piu40-${a.id}@arstantra.github.io`);
    righe.push(`DTSTAMP:${stamp}`);
    if (inizio != null && orarioInMinuti(inizio) != null){
      const m = orarioInMinuti(inizio);
      righe.push(`DTSTART:${icsOra(a.data, m)}`);
      righe.push(`DTEND:${icsOra(a.data, m + Math.round(ore * 60))}`);
    } else {
      righe.push(`DTSTART;VALUE=DATE:${icsGiorno(a.data, 0)}`);
      righe.push(`DTEND;VALUE=DATE:${icsGiorno(a.data, 1)}`);
    }
    righe.push(`SUMMARY:${icsEsc(titolo)}`);
    if (a.sede) righe.push(`LOCATION:${icsEsc(a.sede)}`);
    righe.push(`DESCRIPTION:${icsEsc(`${tagLabel(effectiveCategoria(a))} · ${fmtOre(ore)} ore`)}`);
    if (promemoria > 0){
      righe.push("BEGIN:VALARM", "ACTION:DISPLAY",
                 `TRIGGER:-PT${promemoria}M`,
                 `DESCRIPTION:${icsEsc(titolo)}`, "END:VALARM");
    }
    righe.push("END:VEVENT");
  }
  righe.push("END:VCALENDAR");
  return righe.map(icsFold).join("\r\n") + "\r\n";
}
function fileICS(){
  return new File([generaICS()], `impegni-40piu40-${todayISO()}.ics`, {type:"text/calendar"});
}
function scaricaICS(){
  const n = attivitaDaEsportare().length;
  if (!n){ alert("Non ci sono impegni da oggi in avanti."); return; }
  const f = fileICS();
  const url = URL.createObjectURL(f);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert(`${n} impegni nel file. Aprilo dalle notifiche o dalla cartella Download per aggiungerli al calendario.`);
}
async function condividiICS(){
  const n = attivitaDaEsportare().length;
  if (!n){ alert("Non ci sono impegni da oggi in avanti."); return; }
  try{ await navigator.share({ files:[fileICS()], title:"Impegni 40+40" }); }
  catch(e){ /* condivisione annullata */ }
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
  SETTINGS.ultimoBackup = new Date().toISOString();
  save(LS_SETTINGS, SETTINGS);
  mostraUltimoBackup();
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

/* ---------------------------------------------------------- Google Drive
   Sincronizzazione fra telefono e tablet. Un solo file nel Drive di Andrea,
   40piu40-dati.json, con lo stesso contenuto del backup JSON piu' un campo
   aggiornatoIl. I dati locali restano sempre la fonte sicura: se Drive non
   risponde, o il permesso e' scaduto, l'app continua a funzionare come prima
   e in Impostazioni compare la riga "Da riconnettere". Nessun errore a
   schermo, mai.

   Autenticazione: redirect di primo livello, non popup. Nella PWA installata
   il popup e' il punto debole (puo' aprirsi fuori dall'app e non tornare piu'
   indietro); una navigazione normale esce e rientra senza problemi. Il
   permesso scade dopo un'ora: il rinnovo si tenta in silenzio con un iframe
   nascosto verso accounts.google.com — se riesce non si vede niente, se non
   riesce resta la riga "Da riconnettere" e basta. */

const DRIVE_CLIENT_ID = "281391122896-plt2cibtuafj71455u6o96me0deupada.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_NOME_FILE = "40piu40-dati.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_ATTESA = 4000;      // quanto aspetto, dopo una modifica, prima di salvare
const DRIVE_RISYNC = 30000;     // ogni quanto, al massimo, risincronizzo tornando sull'app

const LS_DRIVE = "40piu40_drive";
const LS_PRIMA_SYNC = "40piu40_prima_sync";
const LS_OAUTH = "40piu40_oauth_ritorno";
const LS_OAUTH_STATE = "40piu40_oauth_state";

let DRIVE = { attivo:false, token:"", scadenza:0, email:"", fileId:"", salvatoIl:"", remotoVisto:"", localeVisto:"" };
let driveTimer = null;
let driveOccupato = false;
let driveUltimaSync = 0;

function driveCollegato(){ return !!DRIVE.attivo; }
function driveCaricaConf(){
  DRIVE = Object.assign({attivo:false, token:"", scadenza:0, email:"", fileId:"", salvatoIl:"", remotoVisto:"", localeVisto:""}, load(LS_DRIVE, {}));
}
function driveSalvaConf(){
  try{ localStorage.setItem(LS_DRIVE, JSON.stringify(DRIVE)); }catch(e){}
}

/* --- permesso --- */
// Il redirect_uri deve combaciare alla lettera con quello registrato in
// Google Cloud: https://40piu40.nuovadidattica.eu/oauth.html
function driveRedirectUri(){
  return location.origin + location.pathname.replace(/[^/]*$/, "") + "oauth.html";
}
function driveUrlAuth(silenzioso){
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try{ localStorage.setItem(LS_OAUTH_STATE, nonce); }catch(e){}
  const p = new URLSearchParams({
    client_id: DRIVE_CLIENT_ID,
    redirect_uri: driveRedirectUri(),
    response_type: "token",
    scope: DRIVE_SCOPE,
    include_granted_scopes: "true",
    state: nonce
  });
  // Silenzioso: nessuna schermata, o niente. Interattivo: il selettore
  // dell'account SEMPRE. Senza, Google prende in silenzio l'unico account
  // con cui il browser e' gia' connesso — che sul telefono e' quello
  // personale — e non c'e' modo di cambiarlo da dentro l'app.
  if (silenzioso) p.set("prompt", "none");
  else p.set("prompt", "select_account");
  if (DRIVE.email) p.set("login_hint", DRIVE.email);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
function driveAccetta(d){
  if (!d || d.errore || !d.token) return false;
  let atteso = "";
  try{ atteso = localStorage.getItem(LS_OAUTH_STATE) || ""; }catch(e){}
  if (atteso && d.stato !== atteso) return false;   // risposta che non ho chiesto io
  DRIVE.token = d.token;
  // Due minuti di margine: meglio rinnovare un po' prima che scoprire
  // a meta' salvataggio che il permesso e' scaduto.
  DRIVE.scadenza = Date.now() + (Math.max(120, d.scade || 3600) - 120) * 1000;
  driveSalvaConf();
  return true;
}
function driveCollega(){
  location.assign(driveUrlAuth(false));
}
// Rinnovo silenzioso: iframe nascosto, prompt=none. Se Google non puo'
// rispondere senza interazione torna un errore, e noi non insistiamo.
function driveRinnovo(){
  return new Promise((risolvi) => {
    let finito = false;
    let ifr = null;
    const tempo = setTimeout(() => chiudi(false), 12000);
    function chiudi(ok){
      if (finito) return;
      finito = true;
      clearTimeout(tempo);
      window.removeEventListener("message", ascolta);
      if (ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr);
      risolvi(ok);
    }
    function ascolta(ev){
      if (ev.origin !== location.origin) return;
      const d = ev.data;
      if (!d || d.tipo !== "40piu40-oauth") return;
      chiudi(driveAccetta(d));
    }
    window.addEventListener("message", ascolta);
    try{
      ifr = document.createElement("iframe");
      ifr.setAttribute("aria-hidden", "true");
      ifr.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;border:0;";
      ifr.src = driveUrlAuth(true);
      document.body.appendChild(ifr);
    }catch(e){ chiudi(false); }
  });
}
async function driveToken(){
  if (!driveCollegato()) return "";
  if (DRIVE.token && Date.now() < DRIVE.scadenza) return DRIVE.token;
  const ok = await driveRinnovo();
  renderDrive();
  return ok ? DRIVE.token : "";
}
function driveScollega(){
  const ok = confirm("Scollegare Google Drive?\n\nI dati restano su questo dispositivo e il file sul Drive non viene toccato.");
  if (!ok) return;
  const vecchio = DRIVE.token;
  DRIVE = { attivo:false, token:"", scadenza:0, email:"", fileId:"", salvatoIl:"", remotoVisto:"", localeVisto:"" };
  driveSalvaConf();
  if (vecchio){
    try{ fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(vecchio), {method:"POST", mode:"no-cors"}); }catch(e){}
  }
  renderDrive();
}

/* --- chiamate --- */
// Ogni chiamata passa da qui: se il permesso e' scaduto tenta un rinnovo
// silenzioso e riprova una volta sola. Se non va, torna null e chi chiama
// rinuncia in silenzio.
async function driveChiama(url, opzioni, giaRiprovato){
  const token = await driveToken();
  if (!token) return null;
  const o = Object.assign({}, opzioni || {});
  o.headers = Object.assign({}, o.headers || {}, { Authorization: "Bearer " + token });
  let r;
  try{ r = await fetch(url, o); }catch(e){ return null; }
  if (r.status === 401 && !giaRiprovato){
    DRIVE.token = ""; DRIVE.scadenza = 0;
    const ok = await driveRinnovo();
    renderDrive();
    if (ok) return driveChiama(url, opzioni, true);
    return null;
  }
  if (!r.ok) return null;
  return r;
}
// Con drive.file l'app vede solo i file che ha creato lei: la ricerca per
// nome e' sicura, e se Andrea cestina il file ne viene creato un altro.
async function driveFile(){
  if (DRIVE.fileId) return DRIVE.fileId;
  const q = encodeURIComponent("name='" + DRIVE_NOME_FILE + "' and trashed=false");
  const r = await driveChiama(DRIVE_API + "/files?q=" + q + "&fields=files(id)&pageSize=10", {});
  if (r){
    try{
      const d = await r.json();
      if (d.files && d.files.length){ DRIVE.fileId = d.files[0].id; driveSalvaConf(); return DRIVE.fileId; }
    }catch(e){}
  }
  const c = await driveChiama(DRIVE_API + "/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_NOME_FILE, mimeType: "application/json" })
  });
  if (!c) return "";
  try{
    const d = await c.json();
    DRIVE.fileId = d.id || "";
  }catch(e){ return ""; }
  driveSalvaConf();
  return DRIVE.fileId;
}
async function driveChiSono(){
  const r = await driveChiama(DRIVE_API + "/about?fields=user(emailAddress)", {});
  if (!r) return;
  try{
    const d = await r.json();
    if (d.user && d.user.emailAddress){ DRIVE.email = d.user.emailAddress; driveSalvaConf(); }
  }catch(e){}
  renderDrive();
}
function drivePayload(){
  return {
    stato: STATO,
    extra: EXTRA,
    settings: SETTINGS,
    aggiornatoIl: localStorage.getItem(LS_MODIFICATO) || new Date().toISOString(),
    esportato: new Date().toISOString()
  };
}

/* --- salvataggio --- */
function programmaDrive(){
  if (!driveCollegato()) return;
  if (driveTimer) clearTimeout(driveTimer);
  driveTimer = setTimeout(() => { driveTimer = null; driveSalva(); }, DRIVE_ATTESA);
}
function driveSalvaSubito(){
  // L'app viene chiusa o messa via: se c'era un salvataggio in attesa,
  // parte adesso. Senza questo l'ultima modifica puo' non partire mai.
  if (driveTimer){ clearTimeout(driveTimer); driveTimer = null; driveSalva(); }
}
async function driveSalva(){
  if (!driveCollegato() || driveOccupato) return;
  driveOccupato = true;
  let esito = "no";
  try{ esito = await driveSalvaInterno(); }
  catch(e){ /* rete assente: si riprova alla prossima modifica */ }
  driveOccupato = false;
  renderDrive();
  if (esito === "riconcilia") await driveSincronizza();
}
async function driveSalvaInterno(){
  const id = await driveFile();
  if (!id) return "no";
  // Guardia: qualcun altro ha scritto dopo l'ultima volta che ho guardato?
  // Allora non sovrascrivo — scarico e riconcilio. E' lo scenario del tablet
  // lasciato aperto che cancella il lavoro fatto sul telefono.
  const m = await driveChiama(DRIVE_API + "/files/" + id + "?fields=modifiedTime", {});
  if (m){
    try{
      const meta = await m.json();
      if (DRIVE.remotoVisto && meta.modifiedTime && meta.modifiedTime > DRIVE.remotoVisto) return "riconcilia";
    }catch(e){}
  }
  const payload = drivePayload();
  const r = await driveChiama(DRIVE_UPLOAD + "/files/" + id + "?uploadType=media&fields=modifiedTime", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload, null, 2)
  });
  if (!r) return "no";
  try{
    const d = await r.json();
    DRIVE.remotoVisto = d.modifiedTime || DRIVE.remotoVisto;
  }catch(e){}
  // Il punto in cui i due lati erano d'accordo. Serve a distinguere "ho
  // cambiato io" da "non ho cambiato niente": senza, l'unica cosa che si puo'
  // fare quando cambiano tutti e due e' scegliere chi perde.
  DRIVE.localeVisto = payload.aggiornatoIl || "";
  DRIVE.salvatoIl = new Date().toISOString();
  driveSalvaConf();
  return "ok";
}

/* --- sincronizzazione --- */
async function driveSincronizza(){
  if (!driveCollegato() || driveOccupato) return;
  driveOccupato = true;
  driveUltimaSync = Date.now();
  let esito = "no";
  try{ esito = await driveSincronizzaInterno(); }
  catch(e){ /* niente rete: restano i dati di qui */ }
  driveOccupato = false;
  if (esito === "applicato" || esito === "fuso"){ renderImpostazioni(); refreshAll(); }
  renderDrive();
  if (esito === "carica" || esito === "fuso") await driveSalva();
}
async function driveSincronizzaInterno(){
  const id = await driveFile();
  if (!id) return "no";
  const r = await driveChiama(DRIVE_API + "/files/" + id + "?alt=media", {});
  if (!r) return "no";
  let remoto = null;
  try{ remoto = await r.json(); }catch(e){ remoto = null; }
  let modificato = "";
  const m = await driveChiama(DRIVE_API + "/files/" + id + "?fields=modifiedTime", {});
  if (m){ try{ modificato = (await m.json()).modifiedTime || ""; }catch(e){} }
  const vistoPrima = DRIVE.remotoVisto;
  if (modificato){ DRIVE.remotoVisto = modificato; driveSalvaConf(); }

  // File appena creato, o vuoto: ci metto quello che c'e' qui.
  if (!remoto || (!remoto.stato && !remoto.extra && !remoto.aggiornatoIl)) return "carica";

  const localeOra = localStorage.getItem(LS_MODIFICATO) || "";

  // Primo incontro con questo file su questo dispositivo: non c'e' una storia
  // da cui capire chi ha cambiato cosa. Se hanno dei dati tutti e due non si
  // sceglie lo stesso — vale la regola di sempre, si tiene tutto.
  // ⚠️ Serve soprattutto dopo che il telefono e' stato ripulito (aggiornamento
  // di sistema, "ottimizzazione" del produttore): la pulizia porta via anche
  // la configurazione di Drive, quindi chi riapre l'app vuota, riscrive due
  // ore a memoria e SOLO DOPO ricollega Drive risulterebbe "il piu' recente"
  // e cancellerebbe mesi di lavoro. Succede con la sequenza piu' naturale che
  // ci sia, quindi non basta sperare che non succeda.
  if (!vistoPrima || !DRIVE.localeVisto){
    if (!driveHaDati(remoto)) return "carica";
    driveCopiaPrima();     // rete di sicurezza prima di toccare i dati di qui
    if (!driveHaDatiQui()){
      driveApplica(remoto);
      return "applicato";
    }
    driveFondi(remoto);
    return "fuso";
  }

  // Qui invece so da dove siamo partiti, e posso distinguere i quattro casi.
  const remotoCambiato = !modificato || modificato > vistoPrima;
  const localeCambiato = localeOra > DRIVE.localeVisto;
  if (remotoCambiato && localeCambiato){
    // Tutti e due hanno lavorato da quando ci siamo visti. Scegliere il piu'
    // recente qui vorrebbe dire buttare via il lavoro dell'altro dispositivo:
    // e' esattamente il modo in cui il tablet lasciato aperto cancella le ore
    // segnate sul telefono. Quindi non si sceglie, si tiene tutto.
    driveCopiaPrima();
    driveFondi(remoto);
    return "fuso";
  }
  if (remotoCambiato){
    driveCopiaPrima();
    driveApplica(remoto);
    return "applicato";
  }
  if (localeCambiato) return "carica";
  return "no";
}
function driveQuanteVoci(stato){
  let n = 0;
  for (const k in (stato || {})) n++;
  return n;
}
function driveHaDati(d){
  return !!d && (driveQuanteVoci(d.stato) > 0 || (Array.isArray(d.extra) && d.extra.length > 0));
}
function driveHaDatiQui(){
  return driveQuanteVoci(STATO) > 0 || (Array.isArray(EXTRA) && EXTRA.length > 0);
}
// Unione voce per voce. Quello che e' stato toccato solo di la' arriva,
// quello toccato solo di qua resta, e per le voci toccate da tutte e due
// vince questo dispositivo — quello in mano a chi sta guardando.
function driveFondi(remoto){
  driveZitto = true;
  try{
    const statoFuso = Object.assign({}, remoto.stato || {}, STATO);
    const extraFuso = (EXTRA || []).slice();
    const gia = {};
    extraFuso.forEach(a => { if (a && a.id) gia[a.id] = true; });
    (remoto.extra || []).forEach(a => { if (a && a.id && !gia[a.id]) extraFuso.push(a); });
    STATO = statoFuso;
    // Le attivita' cancellate a mano lasciano una lapide in STATO: cosi' la
    // cancellazione viaggia come qualunque altra modifica e l'unione non le
    // fa tornare a galla.
    EXTRA = extraFuso.filter(a => !(a && a.id && STATO[a.id] && STATO[a.id].eliminato));
    SETTINGS = Object.assign({}, remoto.settings || {}, SETTINGS);
    save(LS_STATO, STATO);
    save(LS_EXTRA, EXTRA);
    save(LS_SETTINGS, SETTINGS);
    try{ localStorage.setItem(LS_MODIFICATO, new Date().toISOString()); }catch(e){}
  } finally { driveZitto = false; }
}
function driveApplica(d){
  driveZitto = true;      // altrimenti rimanderei su' subito quello che ho appena scaricato
  try{
    if (d.stato) { STATO = d.stato; save(LS_STATO, STATO); }
    if (d.extra) { EXTRA = d.extra; save(LS_EXTRA, EXTRA); }
    if (d.settings){ SETTINGS = Object.assign(SETTINGS, d.settings); save(LS_SETTINGS, SETTINGS); }
    const quando = d.aggiornatoIl || new Date().toISOString();
    try{ localStorage.setItem(LS_MODIFICATO, quando); }catch(e){}
    DRIVE.localeVisto = quando;
    driveSalvaConf();
  } finally { driveZitto = false; }
}
// Prima di rimpiazzare i dati di questo dispositivo con quelli scaricati,
// ne tengo una copia. Si recupera dalla riga in Impostazioni.
function driveCopiaPrima(){
  try{
    localStorage.setItem(LS_PRIMA_SYNC, JSON.stringify({
      stato: STATO, extra: EXTRA, settings: SETTINGS, salvatoIl: new Date().toISOString()
    }));
  }catch(e){}
}
function driveRipristinaPrima(){
  let c = null;
  try{ c = JSON.parse(localStorage.getItem(LS_PRIMA_SYNC) || "null"); }catch(e){}
  if (!c) return;
  const ok = confirm("Rimettere i dati che c'erano su questo dispositivo prima della sincronizzazione?\n\nQuelli scaricati da Drive vengono sostituiti, qui e sul Drive.");
  if (!ok) return;
  if (c.stato) { STATO = c.stato; save(LS_STATO, STATO); }
  if (c.extra) { EXTRA = c.extra; save(LS_EXTRA, EXTRA); }
  if (c.settings){ SETTINGS = Object.assign(SETTINGS, c.settings); save(LS_SETTINGS, SETTINGS); }
  try{ localStorage.removeItem(LS_PRIMA_SYNC); }catch(e){}
  segnaModifica();
  renderImpostazioni();
  refreshAll();
}

/* --- riga in Impostazioni --- */
function statoDrive(){
  if (!DRIVE.attivo) return "spento";
  if (DRIVE.token && Date.now() < DRIVE.scadenza) return "ok";
  return "scaduto";
}
function oraBreve(iso){
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const ora = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  if (d.toDateString() === new Date().toDateString()) return "alle " + ora;
  return "il " + d.toLocaleDateString("it-IT", {day:"numeric", month:"long"}) + " alle " + ora;
}
function renderDrive(){
  const riga = document.getElementById("drive-stato");
  if (!riga) return;
  const btn = document.getElementById("btn-drive");
  const off = document.getElementById("btn-drive-off");
  const rip = document.getElementById("btn-drive-ripristina");
  const s = statoDrive();
  const chi = DRIVE.email ? escapeHtml(DRIVE.email) + "<br>" : "";
  if (s === "spento"){
    riga.innerHTML = "Non collegato.";
    btn.textContent = "Collega";
    btn.classList.remove("hidden");
    off.classList.add("hidden");
  } else if (s === "ok"){
    const q = oraBreve(DRIVE.salvatoIl);
    riga.innerHTML = chi + (q ? "Salvato " + q + "." : "Collegato.");
    btn.classList.add("hidden");
    off.classList.remove("hidden");
  } else {
    riga.innerHTML = chi + "Da riconnettere.";
    btn.textContent = "Riconnetti";
    btn.classList.remove("hidden");
    off.classList.remove("hidden");
  }
  let copia = null;
  try{ copia = localStorage.getItem(LS_PRIMA_SYNC); }catch(e){}
  rip.classList.toggle("hidden", !copia);
}

/* --- avvio del modulo --- */
// Torna true se siamo appena rientrati dal consenso di Google.
function driveInit(){
  driveCaricaConf();
  let ritorno = null;
  try{
    const raw = localStorage.getItem(LS_OAUTH);
    if (raw){ localStorage.removeItem(LS_OAUTH); ritorno = JSON.parse(raw); }
  }catch(e){}
  let appena = false;
  if (ritorno && driveAccetta(ritorno)){
    DRIVE.attivo = true;
    driveSalvaConf();
    appena = true;
  }
  const btn = document.getElementById("btn-drive");
  const off = document.getElementById("btn-drive-off");
  const rip = document.getElementById("btn-drive-ripristina");
  if (btn) btn.addEventListener("click", driveCollega);
  if (off) off.addEventListener("click", driveScollega);
  if (rip) rip.addEventListener("click", driveRipristinaPrima);
  renderDrive();
  return appena;
}

/* ---------------------------------------------------------- Memoria del telefono */
// Senza questo, quando lo spazio scarseggia il browser puo' buttare via
// localStorage senza avvisare nessuno. Qui chiediamo di trattare questi dati
// come da conservare. Chrome per Android lo concede da solo alle app
// installate. Dove la funzione non esiste, la riga non compare affatto.
let MEMORIA = "";
async function proteggiMemoria(){
  if (!navigator.storage || !navigator.storage.persist){ MEMORIA = ""; mostraMemoria(); return; }
  try{
    if (await navigator.storage.persisted()) MEMORIA = "ok";
    else MEMORIA = (await navigator.storage.persist()) ? "ok" : "no";
  }catch(e){ MEMORIA = ""; }
  mostraMemoria();
}
function mostraMemoria(){
  const el = document.getElementById("info-memoria");
  if (!el) return;
  if (MEMORIA === "ok"){
    el.textContent = "Memoria protetta: il browser non cancella questi dati per fare spazio.";
    el.classList.remove("hidden");
  } else if (MEMORIA === "no"){
    el.textContent = "Memoria non protetta: se lo spazio del telefono finisce, il browser puo' cancellare questi dati. Installare l'app dalla schermata home di solito basta a proteggerla.";
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}
function mostraUltimoBackup(){
  const el = document.getElementById("info-backup");
  if (!el) return;
  const iso = SETTINGS.ultimoBackup || "";
  if (!iso){ el.textContent = "Non hai mai esportato un backup."; return; }
  const d = new Date(iso);
  if (isNaN(d.getTime())){ el.textContent = ""; return; }
  const quando = d.toLocaleDateString("it-IT", {day:"numeric", month:"long"});
  const giorni = Math.floor((Date.now() - d.getTime()) / 86400000);
  el.textContent = giorni >= 30
    ? "Ultimo backup: " + quando + ". E' passato un po': ne vale la pena uno nuovo."
    : "Ultimo backup: " + quando + ".";
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
  document.getElementById("input-promemoria").addEventListener("change", salvaImpostazioni);

  document.getElementById("btn-ics").addEventListener("click", () => {
    salvaImpostazioni();
    scaricaICS();
  });
  // "Invia il file" solo dove il telefono sa condividere allegati.
  try{
    const provaFile = new File([""], "x.ics", {type:"text/calendar"});
    if (navigator.canShare && navigator.canShare({files:[provaFile]})){
      const btnShare = document.getElementById("btn-ics-share");
      btnShare.classList.remove("hidden");
      btnShare.addEventListener("click", () => { salvaImpostazioni(); condividiICS(); });
    }
  }catch(e){ /* niente condivisione: resta solo il download */ }

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

  // Google Drive. Se siamo appena rientrati dal consenso apro Impostazioni,
  // cosi' l'esito si vede subito; poi sincronizzo, in silenzio.
  const appenaCollegato = driveInit();
  if (appenaCollegato){
    renderImpostazioni();
    showView("impostazioni");
  }
  if (driveCollegato()){
    if (!DRIVE.email) driveChiSono();
    driveSincronizza();
  }
  // Quando l'app viene messa via, il salvataggio in attesa parte adesso: fra
  // quattro secondi il telefono potrebbe averla gia' congelata. Al ritorno,
  // invece, ricontrollo il Drive: potrei aver segnato qualcosa altrove.
  document.addEventListener("visibilitychange", () => {
    if (!driveCollegato()) return;
    if (document.visibilityState === "hidden") driveSalvaSubito();
    else if (Date.now() - driveUltimaSync > DRIVE_RISYNC) driveSincronizza();
  });
  window.addEventListener("pagehide", () => { if (driveCollegato()) driveSalvaSubito(); });

  proteggiMemoria();

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
