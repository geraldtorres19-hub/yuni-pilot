// Adapter: translates the app's api(method, path, body) calls into Supabase RPC / Edge Function calls.
// All authorisation happens in the database functions; nothing here is trusted for security.
import { createClient } from './supabase-lib.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'yuni-pilot-auth' } });

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || 'Request failed'); this.status = status; this.code = body?.code; }
}
const STATUS = { YU400: 400, YU401: 401, YU403: 403, YU404: 404, YU409: 409, YU422: 422 };
const NET = { error: 'No connection to the server. Nothing was saved. Check your connection and try again.', code: 'network' };
function fromDb(error) {
  const st = STATUS[error.code];
  if (st) return new ApiError(st, { error: error.message, code: error.details || 'error' });
  if (!error.code && /fetch|network|load failed/i.test(error.message || '')) return new ApiError(0, NET);
  return new ApiError(500, { error: 'The server could not complete the request. Nothing was saved.', code: 'server' });
}
async function rpc(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args); } catch { throw new ApiError(0, NET); }
  if (r.error) throw fromDb(r.error);
  return r.data;
}
async function fn(action, payload) {
  let r;
  try { r = await sb.functions.invoke('staff-admin', { body: { action, ...payload } }); } catch { throw new ApiError(0, NET); }
  if (r.error) {
    let body = null;
    try { body = await r.error.context?.json(); } catch { /* not json */ }
    if (!body) throw new ApiError(r.error.context ? 500 : 0, r.error.context ? { error: 'Request failed', code: 'server' } : NET);
    throw new ApiError(r.error.context?.status || 500, body);
  }
  return r.data;
}
const email = (no) => `${String(no).trim().toLowerCase()}@staff.yuni.invalid`;
const shapeUser = (m) => ({ ...m, permissions: m.perms });

const ROUTES = [
  ['GET', /^\/auth\/me$/, async () => { const { data } = await sb.auth.getSession(); if (!data.session) throw new ApiError(401, { error: 'Not signed in', code: 'unauthenticated' }); return { user: shapeUser(await rpc('me')) }; }],
  ['POST', /^\/auth\/login$/, async (_m, _q, b) => {
    let r;
    try { r = await sb.auth.signInWithPassword({ email: email(b.employee_no), password: String(b.pin) }); } catch { throw new ApiError(0, NET); }
    if (r.error) throw new ApiError(/fetch|network/i.test(r.error.message) ? 0 : 401, /fetch|network/i.test(r.error.message) ? NET : { error: 'Employee ID or PIN is incorrect, or the account is locked', code: 'bad_credentials' });
    let me;
    try { me = await rpc('me'); } catch (e) { await sb.auth.signOut(); throw new ApiError(401, { error: 'Employee ID or PIN is incorrect, or the account is locked', code: 'bad_credentials' }); }
    await sb.rpc('session_started');
    return { user: shapeUser(me) };
  }],
  ['POST', /^\/auth\/logout$/, async () => { await sb.auth.signOut(); return { ok: true }; }],
  ['POST', /^\/auth\/change-pin$/, async (_m, _q, b) => {
    const { data } = await sb.auth.getUser();
    const mail = data?.user?.email;
    if (!mail) throw new ApiError(401, { error: 'Not signed in', code: 'unauthenticated' });
    const chk = await sb.auth.signInWithPassword({ email: mail, password: String(b.current_pin) });
    if (chk.error) throw new ApiError(400, { error: 'Current PIN is incorrect', code: 'bad_credentials' });
    return fn('change_pin', { new_pin: b.new_pin });
  }],

  ['GET', /^\/locations$/, (_m, q) => rpc('list_locations', { p_include_inactive: q.get('include_inactive') === '1' })],
  ['POST', /^\/locations$/, (_m, _q, b) => rpc('location_create', { p: b })],
  ['PATCH', /^\/locations\/([^/]+)$/, (m, _q, b) => rpc('location_update', { p_id: m[1], p: b })],

  ['GET', /^\/checklists\/applicable$/, (_m, q) => rpc('checklist_applicable', { p_workflow: q.get('workflow'), p_location_id: q.get('location_id') })],
  ['GET', /^\/checklists$/, () => rpc('checklists_list')],
  ['GET', /^\/checklists\/versions\/([^/]+)$/, (m) => rpc('checklist_version_get', { p_id: m[1] })],
  ['POST', /^\/checklists$/, (_m, _q, b) => rpc('checklist_create', { p: b })],
  ['POST', /^\/checklists\/templates\/([^/]+)\/versions$/, (m, _q, b) => rpc('checklist_new_version', { p_template: m[1], p: b })],
  ['PUT', /^\/checklists\/versions\/([^/]+)$/, (m, _q, b) => rpc('checklist_update_draft', { p_id: m[1], p: b })],
  ['POST', /^\/checklists\/versions\/([^/]+)\/approve$/, (m) => rpc('checklist_approve', { p_id: m[1] })],

  ['GET', /^\/tasks\/mine$/, () => rpc('tasks_mine')],
  ['GET', /^\/tasks\/assignable-staff$/, () => rpc('assignable_staff')],
  ['GET', /^\/tasks$/, () => rpc('tasks_list')],
  ['POST', /^\/tasks$/, (_m, _q, b) => rpc('task_create', { p: b })],
  ['POST', /^\/tasks\/([^/]+)\/cancel$/, (m, _q, b) => rpc('task_cancel', { p_id: m[1], p_reason: b.reason })],

  ['POST', /^\/cleaning-records$/, (_m, _q, b) => rpc('record_submit', { p: b })],
  ['GET', /^\/cleaning-records\/board\/rooms$/, () => rpc('rooms_board')],
  ['GET', /^\/cleaning-records$/, (_m, q) => rpc('records_list', { p: Object.fromEntries(q.entries()) })],
  ['GET', /^\/cleaning-records\/([^/]+)$/, (m) => rpc('record_get', { p_id: m[1] })],
  ['POST', /^\/cleaning-records\/([^/]+)\/verify$/, (m) => rpc('record_verify', { p_id: m[1] })],
  ['POST', /^\/cleaning-records\/([^/]+)\/return$/, (m, _q, b) => rpc('record_return', { p_id: m[1], p_reason: b.reason })],
  ['POST', /^\/cleaning-records\/([^/]+)\/inspect$/, (m, _q, b) => rpc('record_inspect', { p_id: m[1], p: b })],

  ['GET', /^\/corrective-actions$/, (_m, q) => rpc('corrective_list', { p_status: q.get('status') })],
  ['POST', /^\/corrective-actions\/([^/]+)\/close$/, (m, _q, b) => rpc('corrective_close', { p_id: m[1], p_note: b.note })],
  ['GET', /^\/board$/, () => rpc('board_summary')],
  ['GET', /^\/audit\/verify$/, () => rpc('audit_verify')],
  ['GET', /^\/audit$/, (_m, q) => rpc('audit_list', { p: Object.fromEntries(q.entries()) })],

  ['GET', /^\/users$/, () => rpc('users_list')],
  ['POST', /^\/users$/, (_m, _q, b) => fn('create_user', { user: b })],
  ['PATCH', /^\/users\/([^/]+)$/, async (m, _q, b) => (await fn('update_user', { user_id: m[1], changes: b })).user],
  ['POST', /^\/users\/([^/]+)\/reset-pin$/, (m) => fn('reset_pin', { user_id: m[1] })],
];

export async function api(method, path, body) {
  const [pathname, qs = ''] = path.split('?');
  const q = new URLSearchParams(qs);
  for (const [m, re, h] of ROUTES) {
    const mm = pathname.match(re);
    if (m === method && mm) return h(mm.map((x, i) => (i ? decodeURIComponent(x) : x)), q, body || {});
  }
  throw new ApiError(404, { error: 'Unknown request', code: 'not_found' });
}
