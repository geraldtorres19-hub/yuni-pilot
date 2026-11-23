// Housekeeping & IPC Monitoring - Phase 1 web app (vanilla JS, no framework, no inline script/style)
const $ = (s) => document.querySelector(s);
const app = $('#app');
const S = { user: null, locs: null };

// ---------- tiny DOM helper (text is always set via textContent, never innerHTML) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'style') { for (const d of String(v).split(';')) { const i = d.indexOf(':'); if (i > 0) el.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); } } // CSSOM only: CSP blocks style attributes
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const mount = (...nodes) => { app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false)); app.focus(); window.scrollTo(0, 0); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }

// ---------- time: always shown in hospital local time (Asia/Riyadh); stored as UTC ----------
const fmtDT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const when = (iso) => (iso ? fmtDT.format(new Date(iso)) : '-');
const tx = (obj) => (obj && (obj.en || Object.values(obj)[0])) || '';

// ---------- API (Supabase adapter) ----------
import { api as rawApi, ApiError, sb } from './supa.js';
import { IDLE_MINUTES } from './config.js';
async function api(method, path, body) {
  try { return await rawApi(method, path, body); }
  catch (e) {
    if (e.status === 401 && path !== '/auth/login') { S.user = null; S.locs = null; renderChrome(); location.hash = '#/login'; }
    if (e.status === 403 && e.code === 'pin_change_required') location.hash = '#/change-pin';
    throw e;
  }
}
// Idle sign-out (enforced in the browser; the server also refuses disabled accounts on every call)
let idleT; const bump = () => { clearTimeout(idleT); if (S.user) idleT = setTimeout(() => { logout(); toast('Signed out after a period of inactivity'); }, IDLE_MINUTES * 60000); };
for (const ev of ['click', 'keydown', 'touchstart']) window.addEventListener(ev, bump, { passive: true });
const can = (p) => S.user?.permissions.includes(p);
const hasRole = (r) => S.user?.roles.includes(r);

// ---------- status vocabulary: text + symbol, never colour alone ----------
const STATUS = {
  submitted: ['Submitted - awaiting verification', 'b-info', '⏳'], verified: ['Verified', 'b-ok', '✔'],
  returned: ['Returned for correction', 'b-warn', '↩'], pending_inspection: ['Pending inspection', 'b-warn', '⏳'],
  failed_inspection: ['Failed inspection - correction required', 'b-bad', '✖'], released: ['Released', 'b-ok', '✔'],
  superseded: ['Superseded by correction', 'b-info', '↪'], pending: ['Pending', 'b-warn', '⏳'], completed: ['Completed', 'b-ok', '✔'],
  open: ['Open', 'b-warn', '●'], closed: ['Closed', 'b-ok', '✔'], cancelled: ['Cancelled', 'b-info', '–'], reopened: ['Reopened', 'b-bad', '●'],
};
const badge = (s) => { const [l, c, i] = STATUS[s] || [s, 'b-info', '•']; return h('span', { class: `badge ${c}` }, h('span', { 'aria-hidden': 'true' }, i), l); };
const WF = { DISCHARGE: 'Discharge cleaning', DAILY: 'Daily cleaning' };

const err = (e) => h('div', { class: 'err', role: 'alert' }, e.message || String(e));

// ---------- chrome ----------
function renderChrome() {
  const bar = $('#topbar');
  if (!S.user) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.replaceChildren(
    h('div', { class: 'who' }, h('b', {}, S.user.full_name), `ID ${S.user.employee_no} · ${S.user.roles.join(', ')}`),
    h('button', { onclick: () => (location.hash = '#/') }, 'Home'),
    h('button', { onclick: logout }, 'Sign out'),
  );
}
async function logout() { try { await api('POST', '/auth/logout', {}); } catch { /* ignore */ } S.user = null; S.locs = null; renderChrome(); location.hash = '#/login'; }
window.addEventListener('online', () => setConn());
window.addEventListener('offline', () => setConn());
function setConn() {
  const b = $('#statusbar');
  b.hidden = navigator.onLine;
  b.textContent = navigator.onLine ? '' : 'Offline. Submissions cannot be saved until the connection returns. Offline capture is not available in this version.';
}

// ---------- router ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
async function render() {
  setConn();
  const hash = location.hash.replace(/^#/, '') || '/';
  if (!S.user && hash !== '/login') {
    try { const me = await api('GET', '/auth/me'); S.user = me.user; renderChrome(); bump(); } catch { return loginPage(); }
  }
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { try { return await fn(...m.slice(1).map(decodeURIComponent)); } catch (e) { return mount(err(e), h('button', { onclick: () => render() }, 'Try again')); } }
  }
  mount(h('h1', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Home'));
}
window.addEventListener('hashchange', render);

// ---------- login / PIN ----------
route(/^\/login$/, () => loginPage());
function loginPage() {
  renderChrome();
  const msg = h('div');
  const no = h('input', { id: 'emp', autocomplete: 'username', inputmode: 'text', required: true, maxlength: '30' });
  const pin = h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true, maxlength: '8' });
  const go = h('button', { type: 'submit' }, 'Sign in');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); go.disabled = true; msg.replaceChildren();
    try {
      const r = await api('POST', '/auth/login', { employee_no: no.value.trim(), pin: pin.value });
      S.user = r.user; renderChrome(); bump();
      location.hash = r.user.must_change_pin ? '#/change-pin' : '#/';
      if (!r.user.must_change_pin) render();
    } catch (x) { msg.replaceChildren(err(x)); pin.value = ''; } finally { go.disabled = false; }
  } },
  h('label', { for: 'emp' }, 'Employee ID ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), no,
  h('label', { for: 'pin' }, 'PIN ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), pin,
  msg, h('p', {}, go));
  mount(h('h1', {}, 'Housekeeping & IPC Monitoring'),
    h('p', { class: 'muted' }, 'Sign in with your own employee ID and PIN. Never share your PIN.'), h('div', { class: 'card' }, form),
    h('p', { class: 'small muted' }, 'Language: English (Arabic, Indonesian and Urdu arrive in a later phase).'));
  no.focus();
}
route(/^\/change-pin$/, () => {
  const msg = h('div');
  const cur = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '8' });
  const n1 = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  const n2 = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  mount(h('h1', {}, S.user?.must_change_pin ? 'Set your own PIN' : 'Change PIN'),
    S.user?.must_change_pin && h('p', {}, 'You are using a temporary PIN. Choose your own 6 to 8 digit PIN to continue.'),
    h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if (n1.value !== n2.value) return msg.replaceChildren(err({ message: 'The two new PINs do not match' }));
      try { await api('POST', '/auth/change-pin', { current_pin: cur.value, new_pin: n1.value }); S.user.must_change_pin = false; toast('PIN changed'); location.hash = '#/'; }
      catch (x) { msg.replaceChildren(err(x)); }
    } }, h('label', {}, 'Current (temporary) PIN'), cur, h('label', {}, 'New PIN (6-8 digits, not a sequence)'), n1, h('label', {}, 'Repeat new PIN'), n2, msg, h('p', {}, h('button', { type: 'submit' }, 'Save PIN'))));
});

// ---------- home ----------
const tile = (ico, label, href, sub) => h('a', { class: 'tile', href }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label, sub && h('small', {}, sub));
const tileOff = (ico, label, sub) => h('div', { class: 'tile', 'aria-disabled': 'true', role: 'link' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label, h('small', {}, sub));

route(/^\/$/, async () => {
  const tiles = [];
  if (can('cleaning.submit')) {
    tiles.push(tile('🛏', 'Discharge cleaning', '#/pick/DISCHARGE'), tile('🧹', 'Daily room cleaning', '#/pick/DAILY'));
    tiles.push(tileOff('🌙', 'Night shift report', 'Phase 2'), tileOff('🗑', 'Garbage collection', 'Phase 2'), tileOff('🌡', 'SEPCO readings', 'Phase 2'));
  }
  if (can('task.read.own')) tiles.push(tile('📋', 'My tasks', '#/tasks'));
  if (can('cleaning.submit')) tiles.push(tile('🗂', 'My submissions', '#/records?mine=1'));
  if (can('cleaning.read.team') || can('cleaning.read.area') || can('cleaning.read.all')) {
    tiles.push(tile('✅', 'Review queue', '#/review'), tile('🚪', 'Room board', '#/rooms'), tile('📁', 'All records', '#/records'));
  }
  if (can('dashboard.read')) tiles.push(tile('📊', 'Operations board', '#/board'));
  if (can('task.assign')) tiles.push(tile('➕', 'Assign task', '#/assign'));
  if (can('corrective.read')) tiles.push(tile('🛠', 'Corrective actions', '#/corrective'));
  if (can('checklist.draft') || can('checklist.approve')) tiles.push(tile('☑', 'Checklists', '#/checklists'));
  if (can('location.manage')) tiles.push(tile('🏥', 'Locations', '#/locations'));
  if (can('user.manage')) tiles.push(tile('👥', 'Users & access', '#/users'), tile('🔒', 'Audit & security', '#/audit'));
  tiles.push(tile('🔑', 'Change PIN', '#/change-pin'));
  mount(h('h1', {}, `Welcome, ${S.user.full_name}`), h('p', { class: 'muted small' }, `Hospital local time (Asia/Riyadh): ${when(new Date().toISOString())}`),
    h('div', { class: 'grid' }, tiles),
    can('cleaning.submit') && h('p', { class: 'small muted' }, 'Greyed buttons are planned for later phases and cannot be used yet.'),
    h('p', { class: 'small muted' }, 'Chat is not for emergencies. Report urgent safety issues through the hospital’s approved escalation channels.'));
});

// ---------- location picker ----------
async function locations() { if (!S.locs) S.locs = await api('GET', '/locations'); return S.locs; }
route(/^\/pick\/(DISCHARGE|DAILY)$/, async (wf) => {
  const locs = await locations();
  const search = h('input', { type: 'search', placeholder: 'Search room or area', 'aria-label': 'Search room or area' });
  const box = h('div', { class: 'tree' });
  const draw = () => {
    const term = search.value.trim().toLowerCase();
    const byId = new Map(locs.map((l) => [l.id, l]));
    const kids = [];
    for (const l of locs) {
      const name = tx(l.name);
      if (term && !(name.toLowerCase().includes(term) || l.code.toLowerCase().includes(term))) continue;
      const depth = (l.path.match(/\//g) || []).length - 2;
      if (l.selectable) kids.push(h('button', { class: `locbtn lvl${Math.min(depth, 3)}`, onclick: () => (location.hash = `#/run/${wf}/${l.id}`) }, `${name}  `, h('span', { class: 'muted small' }, l.code)));
      else if (!term) kids.push(h('div', { class: `locgroup lvl${Math.min(depth, 3)}` }, name));
    }
    box.replaceChildren(...(kids.length ? kids : [h('p', { class: 'muted' }, 'No matching location in your assigned areas.')]));
    void byId;
  };
  search.addEventListener('input', draw); draw();
  mount(h('h1', {}, `${WF[wf]}: choose location`), h('p', { class: 'muted small' }, 'Only rooms and areas you are authorised for are selectable.'), search, box);
});

// ---------- checklist runner ----------
route(/^\/run\/(DISCHARGE|DAILY)\/([0-9a-f-]{36})$/, async (wf, locId) => {
  const locs = await locations();
  const loc = locs.find((l) => l.id === locId);
  if (!loc) throw new Error('Location not available');
  const cl = await api('GET', `/checklists/applicable?workflow=${wf}&location_id=${locId}`);
  const tasks = can('task.read.own') ? await api('GET', '/tasks/mine') : [];
  runChecklist(wf, loc, cl, tasks.find((t) => t.location_id === locId && t.workflow === wf), null);
});

function runChecklist(wf, loc, cl, task, parentId) {
  const clientUuid = crypto.randomUUID(); // reused on retry, so a repeated tap can never create a duplicate record
  const startedAt = new Date().toISOString();
  const answers = new Map(); // item_id -> {result, remarks}
  const msg = h('div');
  const isolation = h('input', { maxlength: '32', placeholder: 'Approved IPC code, e.g. CONTACT', autocomplete: 'off' });
  const overall = h('textarea', { maxlength: '1000', 'aria-label': 'Overall remarks' });
  const prog = h('div', { class: 'progress' }, h('div'));
  const progTxt = h('span', { class: 'small muted' });
  const submitBtn = h('button', { class: 'ok' }, 'Submit');
  const update = () => {
    const done = cl.items.filter((i) => answers.has(i.id)).length;
    prog.firstChild.style.width = `${Math.round((done / cl.items.length) * 100)}%`;
    progTxt.textContent = `${done} of ${cl.items.length} answered`;
  };
  const itemEls = cl.items.map((it) => {
    const rem = h('textarea', { maxlength: '500', placeholder: 'Reason / remarks (required if not completed)', 'aria-label': `Remarks for ${tx(it.text)}` });
    const remWrap = h('div', { hidden: true }, h('label', {}, 'Reason', ' ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')), rem);
    const btns = [['completed', 'c', '✔ Done'], ['not_completed', 'n', '✖ Not done'], ...(it.na_allowed ? [['not_applicable', 'a', 'N/A']] : [])].map(([val, cls, lab]) => {
      const b = h('button', { type: 'button', class: cls, 'aria-pressed': 'false', onclick: () => {
        answers.set(it.id, { result: val, remarksEl: rem });
        btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        remWrap.hidden = val === 'completed'; update();
      } }, lab);
      return b;
    });
    const seg = h('div', { class: 'seg' }, btns);
    if (!it.na_allowed) seg.style.gridTemplateColumns = 'repeat(2,1fr)';
    return h('div', { class: `item${it.critical ? ' crit' : ''}` },
      h('div', {}, h('b', {}, `${it.seq}. `), tx(it.text), ' ', it.required ? h('span', { class: 'req', title: 'Required' }, '*') : h('span', { class: 'muted small' }, '(optional)'), it.critical && h('span', { class: 'badge b-bad' }, 'Critical')),
      seg, remWrap);
  });
  submitBtn.addEventListener('click', async () => {
    msg.replaceChildren();
    const items = [];
    for (const it of cl.items) {
      const a = answers.get(it.id);
      if (!a) { if (it.required) return msg.replaceChildren(err({ message: `Please answer: ${tx(it.text)}` })); continue; }
      const remarks = a.remarksEl.value.trim();
      if (a.result === 'not_completed' && !remarks) return msg.replaceChildren(err({ message: `Give a reason for: ${tx(it.text)}` }));
      items.push({ item_id: it.id, result: a.result, remarks: remarks || undefined });
    }
    if (!confirm('Submit this record? You will not be able to edit it afterwards.')) return;
    submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
    try {
      const r = await api('POST', '/cleaning-records', {
        client_uuid: clientUuid, workflow: wf, location_id: loc.id, checklist_version_id: cl.id, task_id: task?.id,
        parent_record_id: parentId || undefined, started_at_device: startedAt, completed_at_device: new Date().toISOString(),
        isolation_code: wf === 'DISCHARGE' && isolation.value.trim() ? isolation.value.trim() : undefined,
        remarks: overall.value.trim() || undefined, items,
      });
      const final = r.status === 'pending_inspection'
        ? 'Saved on the server. This room is NOT released: it is waiting for an independent inspection.'
        : 'Saved on the server. It is now waiting for supervisor verification.';
      mount(h('h1', {}, 'Submitted'), h('div', { class: 'okmsg' }, final), r.duplicate && h('p', { class: 'muted' }, 'This was already received earlier; no duplicate was created.'),
        r.critical_failures > 0 && h('div', { class: 'warnmsg' }, `${r.critical_failures} critical item(s) were marked not done. Tell your team leader or supervisor now.`),
        h('p', {}, 'Server receipt time: ', when(r.received_at)), h('p', {}, badge(r.status)),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/' }, 'Home'), h('a', { class: 'btn secondary', href: `#/record/${r.id}` }, 'View record')));
    } catch (x) {
      submitBtn.disabled = false; submitBtn.textContent = 'Submit';
      msg.replaceChildren(err(x), x.status === 0 && h('p', { class: 'small' }, 'Your answers are still on this screen. Tap Submit again when the connection is back; it is safe to retry.'));
    }
  });
  update();
  mount(h('h1', {}, `${WF[wf]}: ${tx(loc.name)}`),
    h('p', { class: 'small muted' }, `Checklist v${cl.version_no} · ${cl.procedure_ref || ''}`), parentId && h('div', { class: 'warnmsg' }, 'This is a correction of a returned/failed record. Complete every item again.'),
    h('div', { class: 'card' }, prog, progTxt),
    wf === 'DISCHARGE' && h('div', {}, h('label', {}, 'Previous isolation precaution code (if required by IPC)'), isolation, h('p', { class: 'small muted' }, 'Enter an approved code only. Never type patient names, MRNs or diagnoses.')),
    itemEls, h('label', {}, 'Overall remarks (optional)'), overall, msg, h('p', {}, submitBtn));
}

// ---------- records ----------
function recRow(r) {
  return h('li', { class: 'click', onclick: () => (location.hash = `#/record/${r.id}`) },
    h('div', { class: 'row' }, h('b', { class: 'grow' }, `${tx(r.location_name)} (${r.location_code})`), badge(r.status)),
    h('div', { class: 'small muted' }, `${WF[r.workflow]} · ${r.cleaner_name} · ${when(r.submitted_at)}`),
    r.not_completed_count > 0 && h('div', { class: 'small' }, `⚠ ${r.not_completed_count} item(s) not completed`));
}
route(/^\/records(?:\?(.*))?$/, async (qs) => {
  const p = new URLSearchParams(qs || '');
  const status = h('select', { 'aria-label': 'Status' }, h('option', { value: '' }, 'All statuses'), ...Object.keys(STATUS).filter((k) => ['submitted', 'verified', 'returned', 'pending_inspection', 'failed_inspection', 'released', 'superseded'].includes(k)).map((k) => h('option', { value: k }, STATUS[k][0])));
  const wfSel = h('select', { 'aria-label': 'Workflow' }, h('option', { value: '' }, 'All types'), h('option', { value: 'DISCHARGE' }, WF.DISCHARGE), h('option', { value: 'DAILY' }, WF.DAILY));
  const list = h('ul', { class: 'list' });
  const load = async () => {
    const qq = new URLSearchParams(); if (p.get('mine')) qq.set('mine', '1'); if (status.value) qq.set('status', status.value); if (wfSel.value) qq.set('workflow', wfSel.value);
    list.replaceChildren(h('li', { class: 'muted' }, 'Loading…'));
    try { const rows = await api('GET', '/cleaning-records?' + qq); list.replaceChildren(...(rows.length ? rows.map(recRow) : [h('li', { class: 'muted' }, 'No records found.')])); } catch (e) { list.replaceChildren(err(e)); }
  };
  status.addEventListener('change', load); wfSel.addEventListener('change', load);
  mount(h('h1', {}, p.get('mine') ? 'My submissions' : 'Cleaning records'), h('div', { class: 'row' }, h('div', { class: 'grow' }, status), h('div', { class: 'grow' }, wfSel)), list);
  load();
});
route(/^\/review$/, async () => {
  const [a, b, c] = await Promise.all([api('GET', '/cleaning-records?status=pending_inspection'), api('GET', '/cleaning-records?status=submitted'), api('GET', '/cleaning-records?status=failed_inspection')]);
  const sec = (t, rows, empty) => [h('h2', {}, `${t} (${rows.length})`), h('ul', { class: 'list' }, rows.length ? rows.map(recRow) : h('li', { class: 'muted' }, empty))];
  mount(h('h1', {}, 'Review queue'), sec('Awaiting inspection', a, 'Nothing waiting for inspection.'), sec('Awaiting verification', b, 'Nothing waiting for verification.'), sec('Failed - awaiting correction', c, 'No failed rooms.'));
});

route(/^\/record\/([0-9a-f-]{36})$/, async (id) => {
  const r = await api('GET', `/cleaning-records/${id}`);
  const msg = h('div');
  const act = async (path, body, okmsg) => { msg.replaceChildren(); try { await api('POST', `/cleaning-records/${id}/${path}`, body); toast(okmsg); render(); } catch (e) { msg.replaceChildren(err(e)); } };
  const mine = r.cleaner_id === S.user.id;
  const actions = h('div');
  if (!mine && can('cleaning.verify') && r.workflow === 'DAILY' && r.status === 'submitted') actions.append(h('button', { class: 'ok', onclick: () => act('verify', {}, 'Verified') }, 'Verify'));
  if (!mine && can('cleaning.verify') && ['submitted', 'pending_inspection'].includes(r.status)) {
    const reason = h('textarea', { maxlength: '500', placeholder: 'Reason for returning', 'aria-label': 'Reason for returning' });
    actions.append(h('h3', {}, 'Return for correction'), reason, h('p', {}, h('button', { class: 'secondary', onclick: () => (reason.value.trim() ? act('return', { reason: reason.value.trim() }, 'Returned') : msg.replaceChildren(err({ message: 'Give a reason' }))) }, 'Return to cleaner')));
  }
  if (!mine && can('inspection.perform') && S.user.inspector_designated && r.workflow === 'DISCHARGE' && r.status === 'pending_inspection') {
    const remarks = h('textarea', { maxlength: '1000', placeholder: 'Inspection remarks (required if failed)', 'aria-label': 'Inspection remarks' });
    const checks = r.items.map((i) => h('label', { class: 'row' }, h('input', { type: 'checkbox', value: i.item_id, style: 'width:28px;min-height:28px' }), tx(i.text)));
    actions.append(h('h2', {}, 'Independent inspection'), h('p', { class: 'small muted' }, 'Tick the items that FAILED inspection (only if failing the room).'), ...checks, remarks,
      h('div', { class: 'row' },
        h('button', { class: 'ok', onclick: () => confirm('Pass and RELEASE this room for the next patient?') && act('inspect', { result: 'pass', remarks: remarks.value.trim() || undefined }, 'Room released') }, 'Pass & release room'),
        h('button', { class: 'danger', onclick: () => { const failed = checks.map((c) => c.querySelector('input')).filter((c) => c.checked).map((c) => c.value); act('inspect', { result: 'fail', failed_item_ids: failed, remarks: remarks.value.trim() }, 'Inspection failed - room held'); } }, 'Fail inspection')));
  }
  if (mine && ['failed_inspection', 'returned'].includes(r.status)) actions.append(h('div', { class: 'warnmsg' }, r.returned_reason || ''), h('button', { onclick: async () => {
    const locs = await locations(); const loc = locs.find((l) => l.id === r.location_id) || { id: r.location_id, name: r.location_name };
    const cl = await api('GET', `/checklists/applicable?workflow=${r.workflow}&location_id=${r.location_id}`); runChecklist(r.workflow, loc, cl, null, r.id);
  } }, 'Correct and resubmit'));
  mount(h('button', { class: 'link', onclick: () => history.back() }, '← Back'),
    h('h1', {}, `${tx(r.location_name)} (${r.location_code})`),
    h('div', { class: 'card' }, h('p', {}, badge(r.status)), h('p', { class: 'small' }, `${WF[r.workflow]} · by ${r.cleaner_name} (ID ${r.cleaner_no})`),
      h('p', { class: 'small' }, 'Started (device): ', when(r.started_at_device), ' · Completed (device): ', when(r.completed_at_device), h('br'), 'Server received: ', when(r.received_at), r.time_suspect && h('span', { class: 'badge b-warn' }, '⚠ device clock differs from server time')),
      r.isolation_code && h('p', { class: 'small' }, 'Isolation code: ', r.isolation_code), r.remarks && h('p', {}, r.remarks), r.returned_reason && h('p', { class: 'warnmsg' }, `Reason: ${r.returned_reason}`),
      r.release && h('p', { class: 'okmsg' }, `Released ${when(r.release.released_at)} (server time)`)),
    h('h2', {}, 'Checklist'), h('table', {}, h('tbody', {}, r.items.map((i) => h('tr', {}, h('td', {}, i.seq), h('td', {}, tx(i.text), i.critical && ' (critical)'), h('td', {}, i.result === 'completed' ? '✔ Done' : i.result === 'not_completed' ? '✖ NOT done' : i.result === 'not_applicable' ? 'N/A' : '-'), h('td', {}, i.remarks || ''))))),
    r.inspections.length > 0 && [h('h2', {}, 'Inspections'), h('ul', { class: 'list' }, r.inspections.map((n) => h('li', {}, `Round ${n.round_no}: ${n.result.toUpperCase()} by ${n.inspector_name} · ${when(n.inspected_at)}`, n.remarks && h('div', { class: 'small' }, n.remarks))))],
    msg, actions,
    r.history && [h('h2', {}, 'Change history'), h('table', {}, h('tbody', {}, r.history.map((e) => h('tr', {}, h('td', {}, when(e.at)), h('td', {}, e.actor_label || '-'), h('td', {}, e.action)))))]);
});

route(/^\/rooms$/, async () => {
  const rows = await api('GET', '/cleaning-records/board/rooms');
  mount(h('h1', {}, 'Room board'), h('p', { class: 'small muted' }, 'Latest discharge cleaning per room. A room is only “Released” after an independent inspection passes.'),
    h('ul', { class: 'list' }, rows.length ? rows.map((r) => h('li', { class: 'click', onclick: () => (location.hash = `#/record/${r.record_id}`) }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${tx(r.location_name)} (${r.location_code})`), badge(r.status)), h('div', { class: 'small muted' }, `${r.cleaner_name} · ${when(r.submitted_at)}`))) : h('li', { class: 'muted' }, 'No discharge cleaning records yet.')));
});

// ---------- tasks ----------
route(/^\/tasks$/, async () => {
  const rows = await api('GET', '/tasks/mine');
  mount(h('h1', {}, 'My tasks'), h('ul', { class: 'list' }, rows.length ? rows.map((t) => h('li', {}, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${tx(t.location_name)} (${t.location_code})`), badge(t.status), t.overdue && h('span', { class: 'badge b-bad' }, '⚠ Overdue')),
    h('div', { class: 'small muted' }, `${WF[t.workflow]}${t.due_at ? ' · due ' + when(t.due_at) : ''}`), t.status === 'pending' && h('p', {}, h('a', { class: 'btn', href: `#/run/${t.workflow}/${t.location_id}` }, 'Start')))) : h('li', { class: 'muted' }, 'No open tasks.')));
});
route(/^\/assign$/, async () => {
  const [staff, locs, existing] = await Promise.all([api('GET', '/tasks/assignable-staff'), locations(), api('GET', '/tasks')]);
  const msg = h('div');
  const wf = h('select', {}, h('option', { value: 'DAILY' }, WF.DAILY), h('option', { value: 'DISCHARGE' }, WF.DISCHARGE));
  const loc = h('select', {}, ...locs.filter((l) => l.selectable).map((l) => h('option', { value: l.id }, `${tx(l.name)} (${l.code})`)));
  const who = h('select', {}, ...staff.map((s) => h('option', { value: s.id }, `${s.full_name} (${s.employee_no})`)));
  const due = h('input', { type: 'datetime-local' });
  mount(h('h1', {}, 'Assign task'), h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    try { await api('POST', '/tasks', { workflow: wf.value, location_id: loc.value, assigned_to: who.value, due_at: due.value ? new Date(due.value).toISOString() : undefined }); toast('Task assigned'); render(); } catch (x) { msg.replaceChildren(err(x)); }
  } }, h('label', {}, 'Type'), wf, h('label', {}, 'Room / area'), loc, h('label', {}, 'Cleaner'), who, h('label', {}, 'Due (optional, your local time)'), due, msg, h('p', {}, h('button', { type: 'submit' }, 'Assign'))),
  h('h2', {}, 'Recent tasks'), h('ul', { class: 'list' }, existing.slice(0, 30).map((t) => h('li', {}, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${tx(t.location_name)} → ${t.assignee_name}`), badge(t.status), t.overdue && h('span', { class: 'badge b-bad' }, '⚠ Overdue')), h('div', { class: 'small muted' }, `${WF[t.workflow]}${t.due_at ? ' · due ' + when(t.due_at) : ''}`)))));
});

// ---------- corrective actions / board ----------
route(/^\/corrective$/, async () => {
  const rows = await api('GET', '/corrective-actions');
  const msg = h('div');
  mount(h('h1', {}, 'Corrective actions'), msg, h('ul', { class: 'list' }, rows.length ? rows.map((c) => {
    const note = h('input', { placeholder: 'Closure note', maxlength: '500', 'aria-label': 'Closure note' });
    return h('li', {}, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${tx(c.location_name)} · ${c.severity.toUpperCase()}`), badge(c.status), c.overdue && h('span', { class: 'badge b-bad' }, '⚠ Overdue')),
      h('p', { class: 'small' }, c.description), h('div', { class: 'small muted' }, `Opened ${when(c.opened_at)} · due ${when(c.due_at)}`), c.closure_note && h('p', { class: 'small' }, `Closed: ${c.closure_note}`),
      c.status !== 'closed' && can('corrective.close') && h('div', { class: 'row' }, h('div', { class: 'grow' }, note), h('button', { onclick: async () => { try { await api('POST', `/corrective-actions/${c.id}/close`, { note: note.value }); toast('Closed'); render(); } catch (x) { msg.replaceChildren(err(x)); } } }, 'Close')));
  }) : h('li', { class: 'muted' }, 'No corrective actions.')));
});
route(/^\/board$/, async () => {
  const b = await api('GET', '/board');
  const stat = (label, v) => h('div', { class: 'card' }, h('div', { class: 'small muted' }, label), h('div', { style: 'font-size:1.8rem;font-weight:700' }, String(v)));
  const rs = b.records_by_status;
  mount(h('h1', {}, 'Operations board'), h('p', { class: 'small muted' }, `Saved records, ${b.window}. ${b.note}`),
    h('div', { class: 'grid' }, stat('Awaiting inspection', rs.pending_inspection || 0), stat('Awaiting verification', rs.submitted || 0), stat('Failed inspection', rs.failed_inspection || 0), stat('Released rooms', rs.released || 0), stat('Verified daily', rs.verified || 0),
      stat('Pending tasks', b.tasks.pending), stat('Overdue tasks', b.tasks.overdue), stat('Open corrective actions', b.corrective_actions.open), stat('Overdue corrective actions', b.corrective_actions.overdue)),
    h('p', { class: 'small muted' }, 'Full KPI dashboards, targets and reports arrive in Phase 3.'));
});

// ---------- checklists (management / IPC) ----------
route(/^\/checklists$/, async () => {
  const rows = await api('GET', '/checklists');
  mount(h('h1', {}, 'Checklists'), can('checklist.draft') && h('p', {}, h('a', { class: 'btn', href: '#/checklist-new' }, 'New checklist')),
    h('ul', { class: 'list' }, rows.map((r) => h('li', { class: 'click', onclick: () => (location.hash = `#/checklist/${r.version_id}`) }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${r.name} v${r.version_no}`), badge(r.status === 'draft' ? 'pending' : r.status === 'approved' ? 'completed' : 'cancelled'), h('span', { class: 'small' }, r.status)),
      h('div', { class: 'small muted' }, `${WF[r.workflow]} · ${r.location_type || 'any location type'} · ${r.item_count} items · ref: ${r.procedure_ref || 'none'}`)))));
});
route(/^\/checklist\/([0-9a-f-]{36})$/, async (id) => {
  const v = await api('GET', `/checklists/versions/${id}`);
  const msg = h('div');
  mount(h('a', { href: '#/checklists', class: 'link' }, '← Checklists'), h('h1', {}, `${v.name} v${v.version_no}`), h('p', {}, v.status.toUpperCase(), ` · ${v.procedure_ref || 'no procedure reference'}`),
    v.status === 'approved' && h('p', { class: 'small muted' }, `Approved ${when(v.approved_at)}. Approved content cannot be edited; create a new version instead.`),
    h('table', {}, h('tbody', {}, v.items.map((i) => h('tr', {}, h('td', {}, i.seq), h('td', {}, tx(i.text)), h('td', {}, [i.required ? 'required' : 'optional', i.critical && 'CRITICAL', i.na_allowed && 'N/A ok'].filter(Boolean).join(', ')))))),
    msg, v.status === 'draft' && can('checklist.approve') && h('p', {}, h('button', { class: 'ok', onclick: async () => { if (!confirm('Approve this checklist for use by staff? Its content becomes locked.')) return; try { await api('POST', `/checklists/versions/${id}/approve`, {}); toast('Approved'); render(); } catch (e) { msg.replaceChildren(err(e)); } } }, 'Approve for use')),
    v.status === 'draft' && h('p', { class: 'small muted' }, 'The author of a draft cannot approve it; a different IPC reviewer must.'));
});
route(/^\/checklist-new$/, () => {
  const msg = h('div');
  const name = h('input', { maxlength: '120' });
  const wf = h('select', {}, h('option', { value: 'DAILY' }, WF.DAILY), h('option', { value: 'DISCHARGE' }, WF.DISCHARGE));
  const lt = h('select', {}, h('option', { value: '' }, 'Any location type'), ...['room', 'isolation', 'toilet', 'corridor', 'lobby', 'office', 'public', 'staff', 'other'].map((x) => h('option', { value: x }, x)));
  const ref = h('input', { maxlength: '200', placeholder: 'Approved procedure / policy reference' });
  const items = h('textarea', { style: 'min-height:220px', placeholder: 'One item per line. Add tags at the end: [critical] [optional] [na]' });
  mount(h('h1', {}, 'New checklist (draft)'), h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    const list = items.value.split('\n').map((s) => s.trim()).filter(Boolean).map((line, i) => ({ code: `ITEM-${i + 1}`, text: { en: line.replace(/\s*\[(critical|optional|na)\]/gi, '').trim() }, critical: /\[critical\]/i.test(line), required: !/\[optional\]/i.test(line), na_allowed: /\[na\]/i.test(line) }));
    try { const r = await api('POST', '/checklists', { name: name.value, workflow: wf.value, location_type: lt.value || undefined, procedure_ref: ref.value || undefined, items: list }); location.hash = `#/checklist/${r.version_id}`; } catch (x) { msg.replaceChildren(err(x)); }
  } }, h('label', {}, 'Name'), name, h('label', {}, 'Workflow'), wf, h('label', {}, 'Location type'), lt, h('label', {}, 'Procedure reference (needed before approval)'), ref, h('label', {}, 'Items'), items, msg, h('p', {}, h('button', { type: 'submit' }, 'Save draft'))));
});

// ---------- locations (admin / manager) ----------
route(/^\/locations$/, async () => {
  const all = await api('GET', '/locations?include_inactive=1');
  const msg = h('div');
  const code = h('input', { maxlength: '40' }); const name = h('input', { maxlength: '120' });
  const type = h('select', {}, ...['building', 'floor', 'department', 'room', 'isolation', 'corridor', 'lobby', 'office', 'public', 'staff', 'toilet', 'other'].map((x) => h('option', { value: x }, x)));
  const parent = h('select', {}, h('option', { value: '' }, '(top level: buildings only)'), ...all.filter((l) => l.active).map((l) => h('option', { value: l.id }, `${tx(l.name)} [${l.location_type}]`)));
  mount(h('h1', {}, 'Locations'), h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    try { await api('POST', '/locations', { code: code.value.trim(), name: { en: name.value.trim() }, location_type: type.value, parent_id: parent.value || undefined }); S.locs = null; toast('Location added'); render(); } catch (x) { msg.replaceChildren(err(x)); }
  } }, h('h3', {}, 'Add location'), h('label', {}, 'Code (unique)'), code, h('label', {}, 'Name'), name, h('label', {}, 'Type'), type, h('label', {}, 'Parent'), parent, msg, h('p', {}, h('button', { type: 'submit' }, 'Add'))),
  h('ul', { class: 'list' }, all.map((l) => { const depth = (l.path.match(/\//g) || []).length - 2; return h('li', {}, h('div', { class: 'row' }, h('span', { class: 'grow', style: `padding-inline-start:${depth * 14}px` }, `${tx(l.name)} `, h('span', { class: 'small muted' }, `${l.code} · ${l.location_type}`)), !l.active && h('span', { class: 'badge b-warn' }, 'Inactive'),
    h('button', { class: 'secondary', onclick: async () => { try { await api('PATCH', `/locations/${l.id}`, { active: !l.active }); S.locs = null; render(); } catch (x) { msg.replaceChildren(err(x)); } } }, l.active ? 'Deactivate' : 'Reactivate'))); })));
});

// ---------- users (admin) ----------
function showPin(title, pin) {
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('div', {}, h('h2', {}, title), h('p', {}, 'Give this temporary PIN to the user in person. It is shown only once and must be changed at first sign-in.'), h('div', { class: 'pin' }, pin), h('button', { onclick: () => m.remove() }, 'I have noted it')));
  document.body.append(m);
}
route(/^\/users$/, async () => {
  const [users, locs] = await Promise.all([api('GET', '/users'), api('GET', '/locations?include_inactive=1')]);
  const msg = h('div');
  const emp = h('input', { maxlength: '30' }); const nm = h('input', { maxlength: '120' }); const pos = h('input', { maxlength: '80' });
  const role = h('select', {}, ...['CLEANER', 'TEAM_LEADER', 'SUPERVISOR', 'HK_MANAGER', 'IPC', 'SYS_ADMIN'].map((r) => h('option', { value: r }, r)));
  const scope = h('select', { multiple: true, size: '5', 'aria-label': 'Assigned areas' }, ...locs.filter((l) => l.active && ['building', 'floor', 'department'].includes(l.location_type)).map((l) => h('option', { value: l.id }, `${tx(l.name)} [${l.location_type}]`)));
  const tl = h('select', {}, h('option', { value: '' }, '(none)'), ...users.filter((u) => u.roles.includes('TEAM_LEADER') && u.status === 'active').map((u) => h('option', { value: u.id }, u.full_name)));
  const patch = async (u, body) => { try { await api('PATCH', `/users/${u.id}`, body); render(); } catch (x) { msg.replaceChildren(err(x)); } };
  mount(h('h1', {}, 'Users & access'), h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren();
    try { const r = await api('POST', '/users', { employee_no: emp.value.trim(), full_name: nm.value.trim(), position: pos.value.trim(), roles: [role.value], team_leader_id: tl.value || undefined, scope_location_ids: [...scope.selectedOptions].map((o) => o.value) }); showPin(`Temporary PIN for ${r.user.full_name}`, r.temporary_pin); render(); } catch (x) { msg.replaceChildren(err(x)); }
  } }, h('h3', {}, 'Register staff member'), h('label', {}, 'Employee ID'), emp, h('label', {}, 'Full name'), nm, h('label', {}, 'Position'), pos, h('label', {}, 'Role'), role, h('label', {}, 'Team leader (cleaners)'), tl, h('label', {}, 'Assigned areas (hold Ctrl/Cmd for several)'), scope, msg, h('p', {}, h('button', { type: 'submit' }, 'Register'))),
  h('ul', { class: 'list' }, users.map((u) => h('li', {}, h('div', { class: 'row' }, h('b', { class: 'grow' }, `${u.full_name} (${u.employee_no})`), h('span', { class: `badge ${u.status === 'active' ? 'b-ok' : 'b-bad'}` }, u.status)), h('div', { class: 'small muted' }, `${u.position} · ${u.roles.join(', ')}${u.inspector_designated ? ' · inspector' : ''}${u.must_change_pin ? ' · PIN change pending' : ''}`),
    h('div', { class: 'row' },
      h('button', { class: 'secondary', onclick: async () => { if (confirm(`Reset PIN for ${u.full_name}? Their sessions will end.`)) { try { const r = await api('POST', `/users/${u.id}/reset-pin`, {}); showPin(`New temporary PIN for ${u.full_name}`, r.temporary_pin); } catch (x) { msg.replaceChildren(err(x)); } } } }, 'Reset PIN'),
      h('button', { class: 'secondary', onclick: () => patch(u, { status: u.status === 'active' ? 'disabled' : 'active' }) }, u.status === 'active' ? 'Disable' : 'Enable'),
      (u.roles.includes('SUPERVISOR') || u.roles.includes('HK_MANAGER') || u.roles.includes('TEAM_LEADER')) && h('button', { class: 'secondary', onclick: () => patch(u, { inspector_designated: !u.inspector_designated }) }, u.inspector_designated ? 'Remove inspector designation' : 'Designate as inspector'))))));
});

route(/^\/audit$/, async () => {
  const [rows, ver] = await Promise.all([api('GET', '/audit?limit=100'), api('GET', '/audit/verify')]);
  mount(h('h1', {}, 'Audit & security'), h('div', { class: ver.ok ? 'okmsg' : 'err' }, ver.ok ? `Audit chain verified: ${ver.checked} events, no tampering detected.` : `AUDIT CHAIN BROKEN at event ${ver.bad_seq}. Escalate to hospital security.`),
    h('table', {}, h('thead', {}, h('tr', {}, ['Time', 'Actor', 'Action', 'Entity'].map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((e) => h('tr', {}, h('td', {}, when(e.at)), h('td', {}, e.actor_label || '-'), h('td', {}, e.action), h('td', { class: 'small' }, `${e.entity_type || ''} ${(e.entity_id || '').slice(0, 8)}`))))));
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
