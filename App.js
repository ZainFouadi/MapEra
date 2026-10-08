// UI + data loading. Logic lives in calc.js, constants in config.js.
const $ = (s) => document.querySelector(s);
const S = { regions: {}, countries: {}, country: null, planned: new Set(), sel: null, ethics: [], gov: null, up: {}, view: null };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getAuth = () => JSON.parse(localStorage.getItem('wm_auth') || '{"type":"none"}');

async function api(proc, input) {
  const a = getAuth(), headers = { Accept: 'application/json' };
  if (a.type === 'jwt') headers.Authorization = 'Bearer ' + a.value;
  if (a.type === 'token') headers.token = a.value;
  let url = `${CFG.API}/${proc}`;
  if (input !== undefined) url += '?input=' + encodeURIComponent(JSON.stringify(input));
  const r = await fetch(url, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${proc}: ${j.error?.message || j.error?.json?.message || 'HTTP ' + r.status}`);
  let d = j.result?.data;
  if (d && d.json !== undefined && Object.keys(d).length <= 2) d = d.json;
  return d;
}
const arr = (d) => (Array.isArray(d) ? d : d?.items ? d.items : d ? Object.values(d) : []);
const hue = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 65% 50%)`; };
const cColor = (id) => S.countries[id]?.color || hue(id);
const cName = (id) => S.countries[id]?.name || String(id || '?').slice(-6);
const mine = () => S.country._id;
const owned = () => new Set(Object.values(S.regions).filter((r) => r.country === mine()).map((r) => r._id));
const setMsg = (t, err) => { const m = $('#status'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); };

// ---------- Login ----------
async function initLogin() {
  const a = getAuth(); $('#auth-type').value = a.type; $('#auth-value').value = a.value || '';
  try {
    arr(await api(CFG.EP.countries)).forEach((c) => (S.countries[c._id] = c));
    $('#country').innerHTML = Object.values(S.countries).sort((x, y) => String(x.name).localeCompare(y.name)).map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    const saved = localStorage.getItem('wm_country'); if (saved) $('#country').value = saved;
  } catch (e) { $('#login-msg').textContent = 'Could not load countries: ' + e.message; $('#login-msg').className = 'msg err'; }
}
$('#go').onclick = async () => {
  const type = $('#auth-type').value, value = $('#auth-value').value.trim();
  if (type !== 'none' && !value) { $('#login-msg').textContent = 'Paste a token or choose "No login".'; return; }
  localStorage.setItem('wm_auth', JSON.stringify({ type, value }));
  localStorage.setItem('wm_country', $('#country').value);
  S.country = S.countries[$('#country').value];
  $('#login').hidden = true; $('#app').hidden = false;
  await loadAll();
};
$('#logout').onclick = () => { localStorage.removeItem('wm_auth'); location.reload(); };

// ---------- Data ----------
async function loadAll() {
  $('#title').textContent = S.country.name;
  try {
    setMsg('Loading regions...');
    S.regions = await api(CFG.EP.regions);
    const res = [...new Set(Object.values(S.regions).map((r) => Calc.norm(r.strategicResource)).filter(Boolean))];
    $('#f-res').innerHTML = '<option value="">All resources</option>' + res.map((k) => `<option value="${k}">${k}</option>`).join('');
    drawMap(); renderBonus(); setMsg('');
    loadEthics();
  } catch (e) { setMsg('Failed to load: ' + e.message + ' (use Diagnose)', true); }
}

// Country -> president -> party -> ethics. Field names are guesses; Diagnose shows the real shape.
async function loadEthics() {
  try {
    const g = await api(CFG.EP.gov, { countryId: mine() }); S.gov = g;
    const pid = g.president || g.presidentId || g.leader || g.head;
    const u = pid && await api(CFG.EP.user, { userId: pid?._id || pid });
    const partyId = u && (u.party || u.partyId);
    const p = partyId && await api(CFG.EP.party, { partyId: partyId?._id || partyId });
    S.party = p; S.president = u;
    const e = p?.ethics ?? p?.ethic ?? [];
    S.ethics = (Array.isArray(e) ? e : Object.keys(e)).map((x) => (typeof x === 'string' ? x : x.name || x.code || x.id));
  } catch (e) { S.ethicErr = e.message; }
  renderBonus(); renderSide();
}

async function loadUp(id) {
  if (S.up[id]) return;
  S.up[id] = {};
  await Promise.all(CFG.BUILDINGS.map(async ([k]) => {
    try { S.up[id][k] = await api(CFG.EP.upgrade, { regionId: id, upgradeType: k }); } catch (e) { S.up[id][k] = null; }
  }));
}

// ---------- Map (points + neighbor links; polygons need map.getMapData shape) ----------
function drawMap() {
  const rs = Object.values(S.regions).filter((r) => r.position);
  const xs = rs.map((r) => r.position[0]), ys = rs.map((r) => r.position[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 1000, k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180), sc = W / ((x1 - x0) * k), H = (y1 - y0) * sc;
  S.view = S.view || { x: 0, y: 0, w: W, h: H, W, H };
  S.proj = (p) => [(p[0] - x0) * k * sc, H - (p[1] - y0) * sc];
  $('#map').setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);
  paint();
}

function paint() {
  const own = owned(), q = $('#search').value.toLowerCase(), fr = $('#f-res').value, fc = $('#f-claim').checked;
  let links = '', dots = '';
  Object.values(S.regions).forEach((r) => {
    if (!r.position) return;
    const [x, y] = S.proj(r.position), isMine = own.has(r._id), plan = S.planned.has(r._id);
    const can = !isMine && !plan && Calc.claimable(r, own, S.planned);
    let hide = (q && !String(r.name).toLowerCase().includes(q)) || (fr && Calc.norm(r.strategicResource) !== fr) || (fc && !can);
    const fill = isMine || plan ? cColor(mine()) : cColor(r.country);
    const op = hide ? 0.12 : isMine || plan ? 1 : 0.55;
    const res = Calc.norm(r.strategicResource);
    (r.neighbors || []).forEach((n) => { const o = S.regions[n]; if (o?.position && n > r._id && (isMine || plan || own.has(n) || S.planned.has(n))) { const [x2, y2] = S.proj(o.position); links += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#cbd2db"/>`; } });
    dots += `<g data-id="${r._id}" opacity="${op}" style="cursor:pointer">
      <circle cx="${x}" cy="${y}" r="${plan ? 7 : 5}" fill="${fill}" ${plan ? 'stroke="#111" stroke-dasharray="3 2"' : S.sel === r._id ? 'stroke="#111" stroke-width="2"' : ''}/>
      ${res ? `<circle cx="${x + 6}" cy="${y - 6}" r="3" fill="${CFG.RESOURCES[res] || '#999'}" stroke="#fff"/>` : ''}
      ${can ? `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${cColor(mine())}" stroke-opacity=".5"/>` : ''}</g>`;
  });
  $('#map').innerHTML = links + dots;
  $('#map').querySelectorAll('g').forEach((g) => (g.onclick = () => clickRegion(g.dataset.id)));
}

// pan + zoom
(() => {
  const m = $('#map'); let drag = null;
  m.onwheel = (e) => { e.preventDefault(); const v = S.view, f = e.deltaY > 0 ? 1.15 : 0.87, r = m.getBoundingClientRect(), px = v.x + ((e.clientX - r.left) / r.width) * v.w, py = v.y + ((e.clientY - r.top) / r.height) * v.h; v.w *= f; v.h *= f; v.x = px - ((e.clientX - r.left) / r.width) * v.w; v.y = py - ((e.clientY - r.top) / r.height) * v.h; m.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); };
  m.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; };
  m.onpointermove = (e) => { if (!drag) return; const v = S.view, r = m.getBoundingClientRect(), dx = ((e.clientX - drag.x) / r.width) * v.w, dy = ((e.clientY - drag.y) / r.height) * v.h; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true; if (!drag.moved) return; v.x -= dx; v.y -= dy; drag.x = e.clientX; drag.y = e.clientY; m.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); };
  m.onpointerup = () => setTimeout(() => (drag = null), 0);
  m.addEventListener('click', (e) => { if (drag?.moved) e.stopImmediatePropagation(); }, true);
})();

async function clickRegion(id) {
  const r = S.regions[id], own = owned();
  S.sel = id;
  if (!own.has(id)) {
    if (S.planned.has(id)) {
      S.planned.delete(id); S.planned = Calc.prune(S.planned, own, S.regions);
    } else if (Calc.claimable(r, own, S.planned)) S.planned.add(id);
    else setMsg(`${r.name} is not adjacent to your territory or planned regions.`, true);
    if (S.planned.has(id)) setMsg('');
  }
  paint(); renderBonus(); renderSide();
  await loadUp(id); renderSide();
}

// ---------- Panels ----------
function renderBonus() {
  if (!S.country) return;
  const own = [...owned()].map((i) => S.regions[i]), plan = [...S.planned].map((i) => S.regions[i]);
  const before = Calc.srBonus(own), after = Calc.srBonus([...own, ...plan]);
  const eff = Calc.ethicEffects(S.ethics);
  const keys = [...new Set([...Object.keys(before.per), ...Object.keys(after.per)])];
  const rows = keys.map((k) => `<div class="row"><span><span class="tag" style="background:${CFG.RESOURCES[k] || '#ddd'}22">${k}</span> x${after.per[k]?.count || 0}</span><span>${before.per[k]?.pct ?? 0}% &rarr; <b>${after.per[k]?.pct ?? 0}%</b></span></div>`).join('');
  $('#bonus').innerHTML = `
    <div class="dim">Strategic resource bonus</div>
    <div class="big">${before.total}% &rarr; ${after.total}%</div>${rows}
    <hr><div class="row"><span>Ethic bonus <span class="dim">(from party ethic)</span></span><b>+${eff.srBonus}%</b></div>
    <div class="row"><span>Total with ethic</span><b>${after.total + eff.srBonus}%</b></div>
    <div class="dim">${S.president ? 'President: ' + esc(S.president.username || S.president.name || '?') : ''} ${S.party ? '| Party: ' + esc(S.party.name || '?') : ''}<br>Ethics: ${S.ethics.length ? esc(S.ethics.join(', ')) : 'none loaded'}${eff.used.length ? ' (counted: ' + esc(eff.used.join(', ')) + ')' : ''}${S.ethicErr ? '<br>Ethic error: ' + esc(S.ethicErr) : ''}</div>
    <div class="dim">Planned regions: ${S.planned.size}. Bonus applies only with a Specialization set by law.</div>`;
}

function renderSide() {
  const r = S.regions[S.sel]; if (!r) return;
  const eff = Calc.ethicEffects(S.ethics), up = S.up[r._id];
  const b = CFG.BUILDINGS.map(([k, label]) => {
    const u = up?.[k];
    if (!up) return `<div class="row"><span>${label}</span><span class="dim">loading...</span></div>`;
    if (!u) return `<div class="row"><span>${label}</span><span class="dim">not built</span></div>`;
    const dev = u.lastUpgradeAt ? new Date(new Date(u.lastUpgradeAt).getTime() + eff.devCooldownH * 36e5).toISOString() : null;
    return `<div class="row"><span>${label}</span><span class="up">Lv ${u.level ?? 0}</span></div>
      <div class="row dim"><span>Operating</span><span>${u.status === 'active' ? '<span style="color:var(--ok)">active</span>' : esc(u.status) + ' <span data-end="' + (u.willBeActiveAt || '') + '"></span>'}</span></div>
      <div class="row dim"><span>Dev cooldown (${eff.devCooldownH}h)</span><span data-end="${dev || ''}"></span></div>`;
  }).join('');
  $('#side').innerHTML = `<b>${esc(r.name)}</b> <span class="dim">${esc(r.mainCity || '')}</span>
    <div class="row"><span>Owner</span><span>${esc(cName(r.country))}</span></div>
    <div class="row"><span>Resource</span><span>${esc(r.strategicResource || '-')}</span></div>
    <div class="row"><span>Biome / climate</span><span>${esc(r.biome || '')} / ${esc(r.climate || '')}</span></div>
    <div class="row"><span>Development</span><span>${Number(r.development || 0).toFixed(1)}</span></div>
    <div class="row"><span>Resistance</span><span>${Math.round(r.resistance || 0)}/${r.resistanceMax || 0}</span></div>
    <hr>${b}`;
  tick();
}
function tick() { document.querySelectorAll('[data-end]').forEach((e) => (e.textContent = e.dataset.end ? Calc.fmt(Calc.msLeft(e.dataset.end)) : '-')); }
setInterval(tick, 1000);

// ---------- Controls ----------
['#search', '#f-res', '#f-claim'].forEach((s) => ($(s).oninput = paint));
$('#reset').onclick = () => { S.planned.clear(); S.sel = null; $('#search').value = ''; $('#f-res').value = ''; $('#f-claim').checked = false; $('#side').textContent = 'Click a region.'; paint(); renderBonus(); setMsg(''); };

// ---------- Diagnose ----------
$('#diag').onclick = async () => {
  const a = getAuth(), lines = [`Time: ${new Date().toISOString()}`, `Auth: ${a.type}${a.value ? ' (token set)' : ''}`, `Country: ${S.country?.name} ${S.country?._id}`, `UA: ${navigator.userAgent}`, ''];
  const shape = (d) => (Array.isArray(d) ? `array(${d.length}) first keys: ${Object.keys(d[0] || {}).join(',')}` : d && typeof d === 'object' ? `object keys: ${Object.keys(d).slice(0, 25).join(',')}` : typeof d);
  const first = (o) => { const v = o && !Array.isArray(o) ? Object.values(o)[0] : null; return v && typeof v === 'object' ? ` | first value keys: ${Object.keys(v).join(',')}` : ''; };
  const tests = [
    [CFG.EP.countries], [CFG.EP.regions], [CFG.EP.map],
    [CFG.EP.gov, { countryId: mine() }],
    [CFG.EP.upgrade, { regionId: S.sel || Object.keys(S.regions)[0], upgradeType: 'bunker' }],
  ];
  if (S.gov) { const pid = S.gov.president || S.gov.presidentId; if (pid) tests.push([CFG.EP.user, { userId: pid?._id || pid }]); }
  if (S.president?.party) tests.push([CFG.EP.party, { partyId: S.president.party?._id || S.president.party }]);
  for (const [p, i] of tests) {
    const t0 = performance.now();
    try { const d = await api(p, i); lines.push(`OK   ${p} ${(performance.now() - t0) | 0}ms  ${shape(d)}${first(d)}`); if (p === CFG.EP.map) lines.push('     sample: ' + JSON.stringify(d).slice(0, 400)); if (p === CFG.EP.gov) lines.push('     sample: ' + JSON.stringify(d).slice(0, 500)); }
    catch (e) { lines.push(`FAIL ${p}  ${e.message}  (CORS/auth/network?)`); }
  }
  lines.push('', `Party sample: ${JSON.stringify(S.party || null).slice(0, 600)}`, `Ethics parsed: ${JSON.stringify(S.ethics)}`);
  $('#report').value = lines.join('\n'); $('#dlg').showModal();
};
$('#copy').onclick = () => { $('#report').select(); document.execCommand('copy'); };
$('#close').onclick = () => $('#dlg').close();

initLogin();