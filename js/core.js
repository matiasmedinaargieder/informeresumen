/* ===== Lectura del Excel (formato original y formato actualizado) ===== */
const N = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[_\-]{3,}/g, '').replace(/\s+/g, ' ').trim();
const cellOf = (ws, r, c) => ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
const numAt = (ws, r, c) => { const x = cellOf(ws, r, c); return x && x.t === 'n' && isFinite(x.v) ? x.v : null; };
const strAt = (ws, r, c) => { const x = cellOf(ws, r, c); return x && typeof x.v === 'string' ? x.v.trim() : ''; };

function findRow(ws, re, maxR) {
  for (let r = 1; r <= maxR; r++)
    for (const c of [1, 2]) { const s = strAt(ws, r, c); if (s && re.test(N(s))) return r; }
  return 0;
}

const ROW_RE = {
  elec: { tpot: /^total pot/, tte: /^total (te|energia)/, tdto: /^(total dto|importe del descuento)/,
          ie: /^(i\. ?electrico|impuesto electrico)/, iva: /^iva$/, cm: /^(total )?costes? (de )?mercad/,
          total: /^total factura/, sav: /^ahorro (en esta )?factura/, ann: /^ahorro anual/ },
  gas:  { ttf: /^total (tf|termino fijo)/, ttv: /^total (tv|termino variable)/, hid: /hidrocarb/,
          iva: /^iva$/, total: /^total factura/, sav: /^ahorro (en esta )?factura/, ann: /^ahorro anual/ }
};

function parseSheet(name, ws) {
  if (!ws || !ws['!ref']) return null;
  const rg = XLSX.utils.decode_range(ws['!ref']);
  const maxR = rg.e.r + 1, maxC = rg.e.c + 1;
  const R = {};
  for (const k in ROW_RE.gas) R[k] = findRow(ws, ROW_RE.gas[k], maxR);
  const gas = R.ttf && R.ttv && R.total;
  let kind, rows;
  if (gas) { kind = 'gas'; rows = R; }
  else {
    rows = {};
    for (const k in ROW_RE.elec) rows[k] = findRow(ws, ROW_RE.elec[k], maxR);
    if (!(rows.tpot && rows.tte && rows.total)) return null;
    kind = 'elec';
  }
  if (numAt(ws, rows.total, 3) === null) return { name, kind, error: 'sin_valores' };
  const g = (r, c) => (r ? (numAt(ws, r, c) || 0) : 0);
  // ---- cabeceras: tipo (fijo/indexado) y nombre de comercializadora
  let typeRow = 0, best = 0;
  for (let r = 1; r <= 14; r++) {
    let n = 0;
    for (let c = 3; c <= maxC; c++) if (/fijo|index|omie/i.test(strAt(ws, r, c))) n++;
    if (n > best) { best = n; typeRow = r; }
  }
  let hdrRow = 0;
  for (let r = 1; r <= 14; r++) if (N(strAt(ws, r, 2)) === 'actual' || N(strAt(ws, r, 3)).startsWith('actual')) { hdrRow = r; break; }
  const cols = [];
  for (let c = 3; c <= maxC; c++) {
    const t = numAt(ws, rows.total, c);
    if (t === null || t <= 0) continue;
    const pot = g(kind === 'gas' ? rows.ttf : rows.tpot, c);
    const ene = kind === 'gas' ? g(rows.ttv, c) : g(rows.tte, c) + g(rows.tdto, c);
    const serv = kind === 'gas' ? 0 : g(rows.cm, c);
    const ie = kind === 'gas' ? g(rows.hid, c) : g(rows.ie, c);
    const iva = g(rows.iva, c);
    let otros = t - (pot + ene + serv + ie + iva); if (Math.abs(otros) < 0.005) otros = 0;
    const typeText = typeRow ? strAt(ws, typeRow, c) : '';
    let nm = strAt(ws, 9, c).replace(/^actual\s*/i, '').trim();
    if (/^oferta [a-z]$/i.test(nm)) nm = '';
    cols.push({ c, letter: XLSX.utils.encode_col(c - 1), total: t, pot, ene, serv, ie, iva, otros, typeText, brand: nm,
                annual: rows.ann ? numAt(ws, rows.ann, c) : null });
  }
  if (!cols.length || cols[0].c !== 3 || cols.length < 2) return null;
  // ---- datos del cliente / asesor / consumo
  const clientRaw = strAt(ws, 6, 1);
  const client = /^cliente:/i.test(clientRaw) ? '' : clientRaw;
  const adv = {};
  for (let r = 2; r <= 4; r++) {
    const l = N(strAt(ws, r, 3));
    if (l.startsWith('asesor')) { adv.name = strAt(ws, r, 4); adv.email = strAt(ws, r, 5); }
    else if (l.startsWith('movil')) adv.mobile = strAt(ws, r, 4) || (numAt(ws, r, 4) || '');
    else if (l.startsWith('oficina')) adv.office = strAt(ws, r, 4) || (numAt(ws, r, 4) || '');
  }
  let kwh = null;
  for (let r = 1; r <= maxR; r++) {
    const l = N(strAt(ws, r, 1));
    if (/^(kwh factura|consumo de la factura)/.test(l)) {
      // valor en la propia celda, la de al lado en B o la de debajo
      kwh = numAt(ws, r + 1, 1) ?? null; break;
    }
  }
  let tariff = '';
  if (kind === 'elec') {
    const m = /(\d)\s*\.?\s*(\d)\s*TD/i.exec(strAt(ws, 7, 1)) || /(\d)\s*\.?\s*(\d)\s*TD/i.exec(name);
    tariff = m ? `${m[1]}.${m[2]}TD` : name;
  } else {
    const m = /RL\s*\.?\s*0?(\d)/i.exec(name + ' ' + strAt(ws, 7, 1));
    tariff = m ? `RL${m[1]}` : name;
  }
  return { name, kind, tariff, client, address: strAt(ws, 6, 4), advisor: adv, kwh, cols };
}

function parseWorkbook(wb) {
  const out = [];
  for (const nm of wb.SheetNames) {
    let p = null;
    try { p = parseSheet(nm, wb.Sheets[nm]); } catch (e) { p = null; }
    if (p) out.push(p);
  }
  return out;
}

/* ===== Cálculo del informe ===== */
function typeOf(text) { return /index|omie/i.test(text || '') ? 'idx' : 'fix'; }
function typeLabel(o) {
  if (o.type === 'idx') return 'Indexado';
  const t = (o.typeText || '').trim();
  if (!t || /^fijo$/i.test(t)) return 'Precio fijo';
  if (/fijo/i.test(t)) return 'Precio fijo';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function buildModel(sheet, opts) {
  opts = opts || {};
  const actual = sheet.cols[0];
  let offers = sheet.cols.slice(1).map(o => ({
    ...o,
    type: (opts.types && opts.types[o.letter]) || typeOf(o.typeText),
    saving: actual.total - o.total,
    pct: actual.total ? (actual.total - o.total) / actual.total : 0
  }));
  offers.sort((a, b) => b.saving - a.saving);
offers.forEach((o, i) => { o.rank = i + 1; o.label = o.brand ? o.brand : `Oferta ${i + 1}`; o.sub = typeLabel(o); });
  const bestOf = t => offers.filter(o => o.type === t)[0] || null;
  return { sheet, actual, offers, bestFix: bestOf('fix'), bestIdx: bestOf('idx'), kind: sheet.kind };
}

/* ===== Lectura del Excel de ajuste de potencia ===== */
function parsePowerSheet(name, ws) {
  if (!ws || !ws['!ref']) return null;
  const rg = XLSX.utils.decode_range(ws['!ref']);
  const maxR = rg.e.r + 1, maxC = rg.e.c + 1;
  // ---- cabecera de la tabla (por texto, no por posición fija)
  let hr = 0, cOldKw = 0;
for (let r = 1; r <= Math.min(maxR, 40) && !hr; r++)
  for (let c = 1; c <= maxC; c++)
    if (/^pot\.? ?contratada/.test(N(strAt(ws, r, c)))) { hr = r; cOldKw = c; break; }
  if (!hr) return null;
  let cNewKw = 0, cDays = 0;
  for (let c = 1; c <= maxC; c++) {
    const t = N(strAt(ws, hr, c));
    if (/^pot\.? ?a contratar/.test(t)) cNewKw = c;
    if (t === 'dias') cDays = c;
  }
  const priceAfter = from => { for (let c = from + 1; c <= maxC; c++) if (N(strAt(ws, hr, c)) === 'precio') return c; return 0; };
  const cOldP = priceAfter(cOldKw), cNewP = priceAfter(cNewKw);
  if (!cNewKw || !cOldP || !cNewP) return null;
  const cOldC = cOldP + 1, cNewC = cNewP + 1;   // columnas de coste (a la derecha de cada precio)
  // ---- periodos (P1, P2, …): filas con precio numérico
  const periods = []; let r = hr + 1;
  for (; r <= maxR; r++) {
    const price = numAt(ws, r, cOldP);
    if (price === null) break;
    periods.push({ label: 'P' + (periods.length + 1), kwOld: numAt(ws, r, cOldKw) || 0, kwNew: numAt(ws, r, cNewKw) || 0,
                   price, costOld: numAt(ws, r, cOldC), costNew: numAt(ws, r, cNewC) });
  }
  if (!periods.length || !periods.some(p => p.kwOld > 0 || p.kwNew > 0)) return null;   // plantilla sin rellenar
  const findLbl = re => { for (let rr = r; rr <= maxR; rr++) for (let c = 1; c <= maxC; c++) { const s = strAt(ws, rr, c); if (s && re.test(N(s))) return rr; } return 0; };
  const rTot = findLbl(/^total potencia/), rMas = findLbl(/^mas iva/), rM = findLbl(/^ahorro en potencia mensual/), rA = findLbl(/^ahorro en potencia anual/);
  const totalOld = rTot ? numAt(ws, rTot, cOldC) : null, totalNew = rTot ? numAt(ws, rTot, cNewC) : null;
  const totIvaOld = rMas ? numAt(ws, rMas, cOldC) : null, totIvaNew = rMas ? numAt(ws, rMas, cNewC) : null;
  if (totalOld === null || totIvaOld === null) return { name, kind: 'power', error: 'sin_valores' };
  const rate = (rTot ? numAt(ws, rTot + 1, cOldP) : null) ?? 0.21;
  const days = cDays ? numAt(ws, hr + 1, cDays) : null;
  periods.forEach(p => {
    if (p.costOld === null) p.costOld = (days || 30) * p.kwOld * p.price;
    if (p.costNew === null) p.costNew = (days || 30) * p.kwNew * p.price;
  });
  const tNew = totalNew ?? 0;
  const out = { name, kind: 'power', days, rate, periods, totalOld, totalNew: tNew,
    ivaOld: (rTot ? numAt(ws, rTot + 1, cOldC) : null) ?? totalOld * rate, ivaNew: (rTot ? numAt(ws, rTot + 1, cNewC) : null) ?? tNew * rate,
    totalOldIva: totIvaOld, totalNewIva: totIvaNew ?? tNew * (1 + rate) };
  out.savM = (rM ? numAt(ws, rM, cNewP) : null) ?? (totalOld - tNew);
  out.savMIva = (rM ? numAt(ws, rM, cNewC) : null) ?? (out.totalOldIva - out.totalNewIva);
  out.savA = (rA ? numAt(ws, rA, cNewP) : null) ?? out.savM / 30 * 365;
  out.savAIva = (rA ? numAt(ws, rA, cNewC) : null) ?? out.savMIva / 30 * 365;
  // ---- titular, CUPS, contacto y nota
  let holder = '', cups = '', tRow = 0;
  const after = (r2, c, re) => {
    let v = strAt(ws, r2, c).replace(re, '').trim();
    if (!v) for (let k = c + 1; k <= Math.min(c + 3, maxC); k++) { const t = strAt(ws, r2, k); if (t && !/^(titular|cups)\s*:/i.test(t)) { v = t; break; } }
    return v;
  };
  for (let rr = 1; rr < hr; rr++) for (let c = 1; c <= maxC; c++) {
    const s = strAt(ws, rr, c);
    if (/^titular\s*:/i.test(s)) { holder = after(rr, c, /^titular\s*:/i); tRow = tRow || rr; }
    else if (/^cups\s*:/i.test(s)) cups = after(rr, c, /^cups\s*:/i);
  }
  const contact = [];
  for (let rr = 1; rr < (tRow || hr); rr++) for (let c = 1; c <= maxC; c++) { const s = strAt(ws, rr, c); if (s) contact.push(s.replace(/\s{2,}/g, ' · ')); }
  let note = '';
  for (let rr = r; rr <= maxR && !note; rr++) for (let c = 1; c <= maxC; c++) { const s = strAt(ws, rr, c); if (s.startsWith('*')) { note = s.replace(/^\*\s*/, ''); break; } }
  const m = /(\d)\s*\.?\s*(\d)\s*TD/i.exec(name);
  return Object.assign(out, { tariff: m ? `${m[1]}.${m[2]}TD` : name, holder, cups, contact, note });
}

function parsePowerWorkbook(wb) {
  const out = [];
  for (const nm of wb.SheetNames) {
    let p = null;
    try { p = parsePowerSheet(nm, wb.Sheets[nm]); } catch (e) { p = null; }
    if (p) out.push(p);
  }
  return out;
}
