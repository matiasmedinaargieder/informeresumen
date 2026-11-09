/* ===== Formato ===== */
const nf = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtP = v => nf(Math.abs(v) * 100, 1);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const COL = { idx: '#2563eb', fix: '#2a9d8f', neg: '#e5484d', act: '#9aa3b2' };
const EPS = 0.005;
const E = v => nf(v, 2) + ' €';
const kw = v => nf(v, Number.isInteger(v) ? 0 : 2);

const S = { file: null, sheets: [], sel: null, pfile: null, psheets: [], psel: null,
            opts: { client: '', period: '', showNames: true, types: {}, pick: '' } };
const $ = id => document.getElementById(id);

/* ===== Piezas del informe ===== */
// Diferencia "antes − ahora": positiva = el cliente paga menos
const delta = v => v > EPS ? { cls: 'pos', txt: '+' + E(v) } : v < -EPS ? { cls: 'neg', txt: '−' + E(-v) } : { cls: 'muted', txt: 'Sin cambios' };

function tile(name, color, before, after, d, subTxt) {
  const x = delta(d);
  return `<div class="tl"><div class="tn"><i style="background:${color}"></i>${esc(name)}</div>
    <div class="tv ${x.cls}">${x.txt}</div><div class="ts">${subTxt || `${E(before)} → ${E(after)}`}</div></div>`;
}

function squares(todayLabel, todaySub, newLabel, newSub, newVal, todayVal, sav, pct, annualTxt, savLabelGood, noteBad) {
  const good = sav > EPS, bad = sav < -EPS;
  return `<div class="trio">
    <div class="sq"><div class="l">${todayLabel}</div><div class="v">${E(todayVal)}</div><div class="s">${todaySub}</div></div>
    <div class="sq"><div class="l">${newLabel}</div><div class="v">${E(newVal)}</div><div class="s">${newSub}</div></div>
    <div class="sq ${good ? 'win' : bad ? 'bad' : ''}"><div class="l">${good ? savLabelGood : bad ? noteBad : 'Sin ahorro'}</div>
      <div class="v">${good || bad ? E(Math.abs(sav)) : '—'}</div>
      <div class="s">${good ? fmtP(pct) + '% menos que hoy' : bad ? fmtP(pct) + '% más que hoy' : 'El importe no cambia'}${annualTxt ? `<br><b>${annualTxt}</b>` : ''}</div></div>
  </div>`;
}

/* ===== Parte: comparativa de comercializadoras ===== */
function compModel() {
  const m = buildModel(S.sel, { types: S.opts.types });
  if (!S.opts.showNames) m.offers.forEach(o => { o.label = 'Oferta ' + o.rank; });
  return m;
}
function chosenOffer(m) {
  if (S.opts.pick) { const o = m.offers.find(x => x.letter === S.opts.pick); if (o) return o; }
  return m.offers[0] || null;
}

function compParts() {
  const sh = S.sel, m = compModel(), best = chosenOffer(m);
  const gas = m.kind === 'gas', period = (S.opts.period || '').trim();
  const sv = best.saving, annual = best.annual && best.annual > 0 ? best.annual : null;
  const isTop = best === m.offers[0];
  const desc = `${isTop ? 'La oferta que más ahorra' : 'Oferta elegida'} entre las ${m.offers.length} analizadas${period ? ' · ' + esc(period) : ''}.`;
  const alts = [['Mejor precio fijo', m.bestFix], ['Mejor indexado', m.bestIdx]]
    .filter(([, o]) => o && o !== best && o.saving > EPS)
    .map(([t, o]) => `<span class="pill">${t}: <b>${esc(o.label)}</b> ahorra ${E(o.saving)}</span>`).join('');

  const top = `<div class="blk"><div class="box">
    <h2>Cambio de comercializadora de ${gas ? 'gas' : 'luz'}</h2><p class="d">${desc}</p>
    ${squares('Pagas hoy', `${period ? esc(period) + ', ' : ''}IVA incluido`,
              'Pagarías con ' + esc(best.label), `${esc(best.sub)} · IVA incluido`,
              best.total, m.actual.total, sv, best.pct, annual ? `≈ ${nf(annual, 0)} € al año` : '',
              'Ahorras', 'Pagarías de más')}
    ${alts ? `<div class="pills">${alts}</div>` : ''}
  </div></div>`;

  // ---- ¿De dónde sale?
  const CON = gas
    ? [['pot', 'Término fijo', '#2563eb'], ['ene', 'Consumo de gas', '#f59e0b'], ['ie', 'Imp. hidrocarburos', '#8b5cf6'], ['iva', 'IVA', '#94a3b8'], ['otros', 'Otros', '#d4d8df']]
    : [['pot', 'Potencia', '#2563eb'], ['ene', 'Energía', '#f59e0b'], ['serv', 'Servicios de ajuste', '#14b8a6'], ['ie', 'Imp. eléctrico', '#8b5cf6'], ['iva', 'IVA', '#94a3b8'], ['otros', 'Otros', '#d4d8df']];
  const con = CON.filter(([k]) => Math.abs(m.actual[k]) >= EPS || Math.abs(best[k]) >= EPS);
  const tiles = con.map(([k, t, c]) => tile(t, c, m.actual[k], best[k], m.actual[k] - best[k])).join('');
  const origin = `<div class="sh">En tu factura de ${gas ? 'gas' : 'luz'} <small>· ${E(m.actual.total)} hoy → ${E(best.total)} con ${esc(best.label)}</small></div>
    <div class="tiles t3">${tiles}</div>`;

  return { top, origin, saving: sv, annual, gas, tariff: sh.tariff };
}

/* ===== Parte: ajuste de potencia ===== */
function powerParts() {
  const p = S.psel;
  const days = p.days ? nf(p.days, Number.isInteger(p.days) ? 0 : 2) : '';
  const pct = p.totalOldIva ? (p.totalOldIva - p.totalNewIva) / p.totalOldIva : 0;
  const per = p.periods.filter(x => x.kwOld > 0 || x.kwNew > 0);
  const annual = p.savAIva > EPS ? p.savAIva : null;

  const pills = per.map(x => {
    const d = x.kwNew - x.kwOld;
    const cls = Math.abs(d) < 1e-9 ? '' : d < 0 ? 'pos' : 'neg';
    return `<span class="pill ${cls}">${x.label}: <b>${kw(x.kwOld)} → ${kw(x.kwNew)} kW</b></span>`;
  }).join('');

  const top = `<div class="blk"><div class="box">
    <h2>Ajuste de potencia contratada</h2><p class="d">Potencia que pagas hoy frente a la que se contrataría, por periodo${days ? ` (${days} días facturados)` : ''}.</p>
    ${squares('Pagas hoy por potencia', 'IVA incluido', 'Pagarías con el ajuste', 'IVA incluido',
              p.totalNewIva, p.totalOldIva, p.savMIva, pct, annual ? `≈ ${E(annual)} al año` : '',
              'Ahorras al mes', 'Sobrecoste al mes')}
    <div class="pills">${pills}</div>
  </div></div>`;

  const changed = per.filter(x => Math.abs(x.costOld - x.costNew) > EPS || Math.abs(x.kwNew - x.kwOld) > 1e-9);
  const tiles = (changed.length ? changed : per).map(x => tile(x.label, COL.fix, x.costOld, x.costNew, x.costOld - x.costNew,
      `${kw(x.kwOld)} → ${kw(x.kwNew)} kW`)).join('')
    + tile('IVA', '#94a3b8', p.ivaOld, p.ivaNew, p.ivaOld - p.ivaNew);
  const origin = `<div class="sh">En la potencia contratada <small>· ${E(p.totalOldIva)} hoy → ${E(p.totalNewIva)} con el ajuste${changed.length && changed.length < per.length ? ' (solo periodos que cambian)' : ''}</small></div>
    <div class="tiles t4">${tiles}</div>`;

  return { top, origin, saving: p.savMIva, annual: p.savAIva, tariff: p.tariff, p };
}

/* ===== Informe completo (una hoja) ===== */
function renderReport() {
  const c = S.sel ? compParts() : null;
  const w = S.psel ? powerParts() : null;
  if (!c && !w) return;
  const period = (S.opts.period || '').trim();

  const title = c && w ? 'Resumen de tu ahorro'
    : c ? `Resumen de ahorro en tu factura de ${c.gas ? 'gas' : 'luz'}` : 'Resumen de ahorro con el ajuste de potencia';
  const tariffs = [...new Set([c && 'Tarifa ' + c.tariff, w && 'Tarifa ' + w.tariff].filter(Boolean))];
  const sub = [(S.opts.client || '').trim(), !c && w && w.p.cups ? 'CUPS ' + w.p.cups : '', ...tariffs, period].filter(Boolean).join(' · ');

  let hero = '';
  if (c && w) {
    const tot = c.saving + w.saving, bad = tot < -EPS;
    const yr = c.annual && w.annual ? c.annual + w.annual : null;
    hero = `<div class="blk"><div class="hero${bad ? ' bad' : ''}">
      <div><div class="l">Ahorro total estimado</div>
        <div class="s">${E(c.saving)} por cambiar de comercializadora<br>${E(w.saving)} al mes por ajustar la potencia</div></div>
      <div class="big">${tot < -EPS ? '−' : ''}${E(Math.abs(tot))}${yr ? `<small>≈ ${nf(yr, 0)} € al año</small>` : '<small>IVA incluido</small>'}</div>
    </div></div>`;
  }

  const adv = (S.sel && S.sel.advisor) || {};
  const advTxt = adv.name ? `<br><b>Tu asesor:</b> ${esc([adv.name, adv.email, adv.mobile || adv.office].filter(Boolean).join(' · '))}` : '';
  const contact = !advTxt && w && w.p.contact && w.p.contact.length ? `<br><b>Argieder</b> · ${esc(w.p.contact.join(' · '))}` : '';
  const note = w && w.p.note ? `<br><b>A tener en cuenta:</b> ${esc(w.p.note)}` : '';
  const foot = [
    c ? `El ahorro de la comercializadora se calcula con ${period ? 'el consumo de ' + esc(period) : 'el consumo de la factura analizada'}; las ofertas indexadas dependen del mercado y pueden variar cada mes.` : '',
    w ? 'El ahorro anual de potencia se estima a partir del mensual.' : '',
    c && w ? 'El ahorro total suma ambos cálculos, que son independientes.' : '',
    'Simulación orientativa: los precios pueden cambiar hasta la contratación.'
  ].filter(Boolean).join(' ');

  $('report').innerHTML = `<div class="rep one">
    <div class="blk"><div class="head"><div><h1>${title}</h1><div class="sub">${esc(sub)}</div></div><img class="logo" src="${LOGO}" alt=""></div></div>
    ${hero}
    ${c ? c.top : ''}
    ${w ? w.top : ''}
    <div class="blk"><div class="box"><h2>¿De dónde sale el ahorro?</h2>
      <p class="d">Cada cuadro es una parte de tu factura: en verde pagas menos que hoy, en rojo pagas más.</p>
      ${c ? c.origin : ''}${w ? w.origin : ''}</div></div>
    <div class="blk"><div class="foot">${foot}${note}${advTxt}${contact}</div></div>
  </div>`;
  $('previewWrap').hidden = false;
}

/* ===== PDF (siempre una sola hoja A4) ===== */
async function makePdf() {
  if (!window.html2canvas || !window.jspdf) throw new Error('lib');
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const { jsPDF } = window.jspdf;
  const rep = document.querySelector('#report > .rep');
  const W = 210, H = 297, M = 12;
  const cv = await html2canvas(rep, { scale: 2, backgroundColor: '#f5f6f8', useCORS: true, logging: false });
  let w = W - 2 * M, h = cv.height * w / cv.width;
  const maxH = H - 2 * M;
  if (h > maxH) { const k = maxH / h; w *= k; h = maxH; }   // si no cabe, se reduce para entrar en la hoja
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFillColor(245, 246, 248);
  doc.rect(0, 0, W, H, 'F');
  doc.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', (W - w) / 2, M, w, h);

  const slug = (S.opts.client || (S.sel && S.sel.client) || (S.psel && S.psel.holder) || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'cliente';
  const filename = `Resumen_ahorro_${slug}.pdf`;
  let dl = null;
  try { if (window.claude && typeof window.claude.use === 'function') dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
  if (dl) { await dl.save({ filename, data: doc.output('blob') }); }
  else { doc.save(filename); }
}
function pdfError(e) {
  if (e && e.code === 'declined') return ['Descarga cancelada.', ''];
  if (e && e.message === 'lib') return ['No se han podido cargar las herramientas de PDF. Revisa la conexión y recarga la página.', 'err'];
  return ['No he podido generar el PDF. Inténtalo de nuevo.', 'err'];
}

/* ===== Interfaz ===== */
function status(msg, cls) { const s = $('status'); s.textContent = msg || ''; s.className = cls || ''; }
const fmtSize = b => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB');

function refreshState() {
  const any = S.sheets.length || S.psheets.length;
  $('adv').hidden = true; $('previewWrap').hidden = true; $('go').disabled = !any;
}
function resetComp() {
  S.file = null; S.sheets = []; S.sel = null; S.opts = { client: '', period: '', showNames: true, types: {}, pick: '' };
  $('file').value = ''; $('fileInfo').hidden = true; $('picker').hidden = true;
  refreshState(); status('');
}
function resetPow() {
  S.pfile = null; S.psheets = []; S.psel = null;
  $('fileP').value = ''; $('fileInfoP').hidden = true; $('pickerP').hidden = true;
  refreshState(); status('');
}

async function loadFile(f) {
  if (!f) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) { status('Ese archivo no es un Excel (.xlsx). Prueba con otro.', 'err'); return; }
  resetComp(); S.file = f;
  $('fnm').textContent = f.name; $('fsz').textContent = fmtSize(f.size); $('fileInfo').hidden = false;
  if (!window.XLSX) { status('No se ha podido cargar el lector de Excel. Revisa la conexión y recarga la página.', 'err'); return; }
  status('Leyendo el Excel…');
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const all = parseWorkbook(wb);
    S.sheets = all.filter(s => !s.error);
    if (!S.sheets.length) {
      if (!all.length && parsePowerWorkbook(wb).some(s => !s.error)) { status('Este Excel es de ajuste de potencia. Súbelo en el cuadro “Ajuste de potencia”.', 'err'); return; }
      status(all.some(s => s.error)
        ? 'El Excel no trae los importes calculados. Ábrelo en Excel, guárdalo (Ctrl+G) y vuelve a subirlo.'
        : 'No he encontrado ninguna simulación de luz o gas en este archivo.', 'err');
      return;
    }
    status(`${S.sheets.length === 1 ? 'Simulación encontrada' : S.sheets.length + ' simulaciones encontradas'}. Pulsa “Convertir a PDF”.`);
    $('go').disabled = false;
  } catch (e) { status('No he podido leer el archivo. ¿Está dañado o protegido con contraseña?', 'err'); }
}

async function loadPower(f) {
  if (!f) return;
  if (!/\.(xlsx|xlsm|xls)$/i.test(f.name)) { status('Ese archivo no es un Excel (.xlsx). Prueba con otro.', 'err'); return; }
  resetPow(); S.pfile = f;
  $('fnmP').textContent = f.name; $('fszP').textContent = fmtSize(f.size); $('fileInfoP').hidden = false;
  if (!window.XLSX) { status('No se ha podido cargar el lector de Excel. Revisa la conexión y recarga la página.', 'err'); return; }
  status('Leyendo el Excel…');
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const all = parsePowerWorkbook(wb);
    S.psheets = all.filter(s => !s.error);
    if (!S.psheets.length) {
      if (all.some(s => s.error)) status('El Excel no trae los importes calculados. Ábrelo en Excel, guárdalo (Ctrl+G) y vuelve a subirlo.', 'err');
      else if (parseWorkbook(wb).some(s => !s.error)) status('Este Excel es una comparativa de comercializadoras. Súbelo en el cuadro “Comparativa de comercializadoras”.', 'err');
      else status('No he encontrado datos de potencia. ¿Has rellenado la potencia contratada y la nueva?', 'err');
      return;
    }
    status(`Ajuste de potencia encontrado (${S.psheets.map(s => s.tariff).join(' y ')}). Pulsa “Convertir a PDF”.`);
    $('go').disabled = false;
  } catch (e) { status('No he podido leer el archivo. ¿Está dañado o protegido con contraseña?', 'err'); }
}

function showPicker(msg) {
  $('pickMsg').textContent = msg;
  $('chips').innerHTML = S.sheets.map((s, i) => `<button class="chip${S.sel === s ? ' on' : ''}" data-i="${i}">${esc(s.name)} <small>· ${esc(s.client || 'sin nombre de cliente')}</small></button>`).join('');
  $('picker').hidden = false;
}
function showPickerP(msg) {
  $('pickMsgP').textContent = msg;
  $('chipsP').innerHTML = S.psheets.map((s, i) => `<button class="chip${S.psel === s ? ' on' : ''}" data-i="${i}">${esc(s.name)} <small>· ${esc(s.holder || s.tariff || 'sin titular')}</small></button>`).join('');
  $('pickerP').hidden = false;
}

function prepareOptions() {
  const sh = S.sel, ps = S.psel;
  S.opts.client = S.opts.client || (sh && sh.client) || (ps && ps.holder) || '';
  $('oClient').value = S.opts.client; $('oPeriod').value = S.opts.period || '';
  $('oPeriod').closest('label').hidden = !sh;
  if (!sh) { $('namesRow').hidden = true; $('pickRow').hidden = true; $('typesTbl').innerHTML = ''; $('adv').hidden = false; return; }
  const hasBrand = sh.cols.some(c => c.brand);
  $('namesRow').hidden = !hasBrand; $('oNames').checked = S.opts.showNames;
  const m = compModel();
  $('typesTbl').innerHTML = `<thead><tr><th>Oferta</th><th>Columna</th><th>Tipo</th></tr></thead><tbody>` + m.offers.map(o =>
    `<tr><td>${esc(o.label)}${o.brand ? ` <span class="tag">(${esc(o.brand)})</span>` : ''}</td><td>${o.letter}${o.typeText ? ` <span class="tag">· ${esc(o.typeText)}</span>` : ''}</td>
     <td><select data-col="${o.letter}"><option value="fix"${o.type === 'fix' ? ' selected' : ''}>Precio fijo</option><option value="idx"${o.type === 'idx' ? ' selected' : ''}>Indexado</option></select></td></tr>`).join('') + '</tbody>';
  $('oPick').innerHTML = `<option value="">La que más ahorra (recomendada)</option>` + m.offers.map(o =>
    `<option value="${o.letter}">${esc(o.label)} · ${esc(o.sub)} · ${o.saving > 0 ? 'ahorra ' + E(o.saving) : 'sin ahorro'}</option>`).join('');
  $('oPick').value = S.opts.pick;
  $('pickRow').hidden = m.offers.length < 2;
  $('adv').hidden = false;
}
function prepareOptionsKeep() { const c = $('oClient').value, p = $('oPeriod').value; prepareOptions(); $('oClient').value = c; $('oPeriod').value = p; }

async function convert() {
  const btn = $('go'); btn.disabled = true;
  try {
    if (S.sheets.length && !S.sel) {
      const named = S.sheets.filter(s => s.client);
      if (S.sheets.length === 1) S.sel = S.sheets[0];
      else if (named.length === 1) S.sel = named[0];
      else { showPicker('Hay varias simulaciones en este Excel. ¿Cuál quieres convertir?'); status(''); btn.disabled = false; return; }
    }
    if (S.psheets.length && !S.psel) {
      if (S.psheets.length === 1) S.psel = S.psheets[0];
      else { showPickerP('Hay varias hojas de potencia en este Excel. ¿Cuál quieres convertir?'); status(''); btn.disabled = false; return; }
    }
    $('picker').hidden = S.sheets.length < 2;
    if (S.sheets.length > 1 && S.sel) showPicker('Simulación elegida (puedes cambiarla):');
    $('pickerP').hidden = S.psheets.length < 2;
    if (S.psheets.length > 1 && S.psel) showPickerP('Hoja de potencia elegida (puedes cambiarla):');
    status('Generando el informe…');
    prepareOptions(); renderReport();
    await new Promise(r => setTimeout(r, 60));
    await makePdf();
    status('PDF descargado ✓', 'ok');
  } catch (e) { const [m, c] = pdfError(e); status(m, c); }
  btn.disabled = false;
}

const drop = $('drop'), fin = $('file');
drop.addEventListener('click', () => fin.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin.click(); } });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { if (!drop.contains(e.target) && !$('dropP').contains(e.target)) e.preventDefault(); });
fin.addEventListener('change', () => loadFile(fin.files[0]));
$('rm').addEventListener('click', resetComp);
$('go').addEventListener('click', convert);
$('chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  S.sel = S.sheets[+b.dataset.i]; S.opts.client = ''; S.opts.types = {}; S.opts.pick = ''; convert();
});
$('chipsP').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  S.psel = S.psheets[+b.dataset.i]; convert();
});
$('oClient').addEventListener('input', e => { S.opts.client = e.target.value; renderReport(); });
$('oPeriod').addEventListener('input', e => { S.opts.period = e.target.value; renderReport(); });
$('oNames').addEventListener('change', e => { S.opts.showNames = e.target.checked; prepareOptionsKeep(); renderReport(); });
$('oPick').addEventListener('change', e => { S.opts.pick = e.target.value; renderReport(); });
$('typesTbl').addEventListener('change', e => {
  const s = e.target.closest('select'); if (!s) return;
  S.opts.types[s.dataset.col] = s.value; prepareOptionsKeep(); renderReport();
});
async function downloadNow() { status('Generando el PDF…'); try { await makePdf(); status('PDF descargado ✓', 'ok'); } catch (e) { const [m, c] = pdfError(e); status(m, c); } }
$('regen').addEventListener('click', () => { renderReport(); downloadNow(); });
$('dl').addEventListener('click', downloadNow);

/* ===== Cuadro del Excel de ajuste de potencia ===== */
const dropP = $('dropP'), finP = $('fileP');
dropP.addEventListener('click', () => finP.click());
dropP.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finP.click(); } });
['dragenter', 'dragover'].forEach(ev => dropP.addEventListener(ev, e => { e.preventDefault(); dropP.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dropP.addEventListener(ev, e => { e.preventDefault(); dropP.classList.remove('over'); }));
dropP.addEventListener('drop', e => loadPower(e.dataTransfer.files[0]));
finP.addEventListener('change', () => loadPower(finP.files[0]));
$('rmP').addEventListener('click', resetPow);
