/*───────────────────────────────────────────────────────────────
  VocabMaster — Firebase data layer (vm-fbdata.js)

  VM.api(action, payload) lands here when Firebase is switched on
  (VM_FIREBASE in vm-common.js). Every action answers in the SAME shape the
  Apps Script backend returned, so the pages barely changed.

    ACTIONS   answered here, straight from Firestore (fast, no Apps Script)
    GAS_FB    Apps Script, Firebase edition (gas/FirebaseVM.gs): creating
              accounts and resetting passwords need admin rights.

  Collections (see firestore.rules):
    users/{uid}            role 'student'|'teacher', studentId, fullName, classId,
                           teacherUid (students), email, phone, archived
    loginIndex/{sha256}    sha256(lowercased email) → { sid }   (email sign-in)
    classes/{classId}      className, academicYear, semester, teacherUid, status
    assignments/{id}       ONE doc per assignment (id is made in the browser, so a
                           double request can never create two). vocabJson, deadline,
                           session*, extAll + ext{studentId} = time extensions.
    results/{aid}_{uid}    ONE doc per student × assignment: runs[] (appended with
                           arrayUnion — no read before write), attempts, perfectCount.
                           The teacher's grouped table = 1 doc per row, no aggregation.
    rechecks/{aid}_{uid}   teacher "re-checked" marks for in-class penalties
    trSets/{id}            Translate sets;  trProgress/{setId}_{uid} their progress
    readwise/{id}          student self-study articles
    vocabBank/{meta|cN}    word-of-the-day list in chunks of 100 (1–2 reads/day)
───────────────────────────────────────────────────────────────*/
(function () {
'use strict';

const CFG = window.VM_FIREBASE || {};
const STUDENT_DOMAIN = CFG.studentDomain || 'students.vocabmaster.app';
const VOCAB_CHUNK = 100;

let fs = null, auth = null, storage = null, FV = null, _authReady = null;
function init() {
  if (fs) return;
  firebase.initializeApp(window.__FB_CONFIG || CFG.config);
  fs = firebase.firestore();
  auth = firebase.auth();
  storage = firebase.storage();
  FV = firebase.firestore.FieldValue;
  _authReady = new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
}
function authReady() { init(); return _authReady; }

// ── helpers ─────────────────────────────────
// Firebase refuses passwords under 6 characters; older accounts may have one.
// Every place that sets or checks a password pads it the same way (FirebaseVM.gs too).
function authPw(p) { p = String(p == null ? '' : p).trim(); return p.length >= 6 ? p : (p + '______').slice(0, 6); }
function loginEmailFor(studentId) {
  return String(studentId).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_') + '@' + STUDENT_DOMAIN;
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Same ids FirebaseVM.gs creates, so the browser can address a student's docs without a lookup.
async function uidForStudent(sid) { return 's' + (await sha256Hex('sid:' + String(sid).trim())).slice(0, 27); }
function genId(n, prefix) {
  const c = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = '';
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) s += c[r[i] % c.length];
  return (prefix || '') + s;
}
const ok   = data => (data === undefined ? { success: true } : { success: true, data });
const fail = msg => ({ success: false, error: msg });
const str  = v => String(v == null ? '' : v).trim();
const low  = v => str(v).toLowerCase();
const nowIso = () => new Date().toISOString();
const ms = v => { if (!v) return 0; const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; };
const json = (v, fb) => { if (!v) return fb; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return fb; } };
const docs = qs => qs.docs.map(d => Object.assign({ _id: d.id }, d.data()));
const pad2 = n => (n < 10 ? '0' : '') + n;
const localStamp = t => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

// A bare date ("2026-10-05") means "until the end of that day", not 00:00 UTC.
function deadlineMs(v) {
  v = str(v); if (!v) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime();
  return ms(v);
}

// ── short-lived memo (one page visit re-reads the same lists a lot) ──
const _memo = {};
async function memo(key, ttl, fn) {
  const h = _memo[key];
  if (h && Date.now() - h.t < ttl) return h.v;
  const v = await fn();
  _memo[key] = { t: Date.now(), v };
  return v;
}
function forget(prefix) { Object.keys(_memo).forEach(k => { if (!prefix || k.indexOf(prefix) === 0) delete _memo[k]; }); }

// ── current user ────────────────────────────
let _me = null;
async function me() {
  await authReady();
  const u = auth.currentUser;
  if (!u) throw new Error('SESSION_EXPIRED');
  if (_me && _me.uid === u.uid) return _me;
  const d = await fs.doc('users/' + u.uid).get();
  if (!d.exists) throw new Error('SESSION_EXPIRED');
  return (_me = Object.assign({ uid: u.uid }, d.data()));
}
async function teacher() {
  const t = await me();
  if (t.role !== 'teacher') throw Object.assign(new Error('Only teachers can use this feature.'), { code: 'not-teacher' });
  return t;
}

// ════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════
// "Remember me" → LOCAL persistence; otherwise the sign-in ends when the tab closes.
async function signIn(email, password, remember) {
  init();
  try { await auth.setPersistence(remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION); } catch (e) {}
  try { await auth.signInWithEmailAndPassword(email, authPw(password)); return null; }
  catch (e) {
    const c = e.code || '';
    if (/too-many-requests/.test(c)) return 'Too many failed sign-ins. Please wait a few minutes.';
    if (/network/.test(c)) return 'Network error. Check your connection and try again.';
    return 'WRONG';
  }
}
async function finishLogin(requireTeacher) {
  _me = null; forget();
  const u = await me().catch(() => null);
  if (!u || u.archived || (requireTeacher && u.role !== 'teacher')) {
    await signOut();
    return fail(u && u.archived ? 'This account is locked. Contact your teacher.' : 'Wrong account or password.');
  }
  if (u.role === 'teacher') return ok({ name: u.fullName || '', email: u.email || '' });
  return ok({ studentId: u.studentId || '', name: u.fullName || '', class: u.classId || '', email: u.email || '' });
}
async function studentLogin(p) {
  init();
  const id = str(p.studentId || p.login || p.email);
  if (!id || !p.password) return fail('Enter your Student ID or email and your password.');
  let sid = id;
  if (id.indexOf('@') >= 0) {
    const idx = await fs.doc('loginIndex/' + await sha256Hex(low(id))).get();
    if (!idx.exists) {
      const err = await signIn(low(id), p.password, p.remember);   // a teacher using the student form
      if (err) return fail(err === 'WRONG' ? 'Wrong Student ID/email or password.' : err);
      return finishLogin();
    }
    if (idx.data().multi) return fail('This email is linked to several accounts. Sign in with your Student ID.');
    sid = idx.data().sid;
  }
  const err = await signIn(loginEmailFor(sid), p.password, p.remember);
  if (err) return fail(err === 'WRONG' ? 'Wrong Student ID/email or password.' : err);
  return finishLogin();
}
async function teacherLogin(p) {
  const email = low(p.email);
  if (!email || !p.password) return fail('Enter your email and password.');
  const err = await signIn(email, p.password, p.remember);
  if (err) return fail(err === 'WRONG' ? 'Wrong email or password.' : err);
  return finishLogin(true);
}
async function signOut() { init(); _me = null; forget(); try { await auth.signOut(); } catch (e) {} }

async function changePassword(p) {
  if (!p.oldPass || !p.newPass) return fail('Missing password.');
  await authReady();
  const u = auth.currentUser;
  if (!u) throw new Error('SESSION_EXPIRED');
  try {
    await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, authPw(p.oldPass)));
  } catch (e) { return fail('Wrong current password.'); }
  await u.updatePassword(authPw(p.newPass));
  return ok();
}

// Accounts are created by Apps Script (admin rights). After a successful signup we sign in here.
async function recoverSignupAfterGasError(login, password, isTeacher) {
  // GAS ContentService redirects its response to script.googleusercontent.com.
  // Some browsers/extensions block that redirected response after the server
  // already created the Firebase account. Try Firebase sign-in before reporting failure.
  try {
    const err = await signIn(login, password, false);
    if (!err) return finishLogin(!!isTeacher);
  } catch (e) {}
  return fail('No sign-up response was received from Apps Script. The account may already exist; try signing in before registering again.');
}
async function studentSignup(p) {
  try {
    const r = await gas('fb.register', {
      studentId: p.studentId, fullName: p.name, classId: p.class, email: p.email,
      phone: p.phone, birthdate: p.birthdate, password: p.password
    });
    if (!r || !r.success) return r || fail('Could not register.');
  } catch (e) {
    return recoverSignupAfterGasError(loginEmailFor(p.studentId), p.password, false);
  }
  const err = await signIn(loginEmailFor(p.studentId), p.password, false);
  if (err) return fail(err === 'WRONG' ? 'Account created. Please sign in.' : err);
  return finishLogin();
}
async function teacherSignup(p) {
  try {
    const r = await gas('fb.registerTeacher', { fullName: p.name, email: p.email, phone: p.phone, birthdate: p.birthdate, password: p.password });
    if (!r || !r.success) return r || fail('Could not register.');
  } catch (e) {
    return recoverSignupAfterGasError(low(p.email), p.password, true);
  }
  const err = await signIn(low(p.email), p.password, false);
  if (err) return fail(err === 'WRONG' ? 'Account created. Please sign in.' : err);
  return finishLogin(true);
}

// ════════════════════════════════════════════
// CLASSES / ROSTER
// ════════════════════════════════════════════
async function classList() {
  const t = await teacher();
  return memo('classes|' + t.uid, 20000, async () => {
    const rows = docs(await fs.collection('classes').where('teacherUid', '==', t.uid).get())
      .filter(c => c.status !== 'Archived')
      .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
    return ok(rows.map(c => ({ classId: c.classId, className: c.className, year: c.academicYear || '', semester: c.semester || '', teacherEmail: c.teacherEmail || '' })));
  });
}
async function classCreate(p) {
  const t = await teacher();
  if (!str(p.className)) return fail('Missing class name.');
  let id = '';
  for (let i = 0; i < 6; i++) {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
    const r = crypto.getRandomValues(new Uint8Array(5));
    for (let k = 0; k < 5; k++) s += c[r[k] % c.length];
    id = 'VM-' + s;
    if (!(await fs.doc('classes/' + id).get()).exists) break;
    id = '';
  }
  if (!id) return fail('Could not create a class code. Try again.');
  await fs.doc('classes/' + id).set({
    classId: id, className: str(p.className), academicYear: str(p.year), semester: str(p.semester),
    teacherUid: t.uid, teacherName: t.fullName || '', teacherEmail: t.email || '', status: 'Active', createdAt: nowIso()
  });
  forget('classes|');
  return ok({ classId: id, className: str(p.className), year: p.year, semester: p.semester });
}
async function classArchive(p) {
  await teacher();
  if (!p.classId) return fail('Thiếu classId.');
  await fs.doc('classes/' + p.classId).update({ status: 'Archived' });
  forget('classes|');
  return ok();
}
async function classRoster(p) {
  const t = await teacher();
  if (!p.classId) return fail('Thiếu classId.');
  const rows = docs(await fs.collection('users').where('teacherUid', '==', t.uid).where('classId', '==', str(p.classId).toUpperCase()).get())
    .filter(u => u.role === 'student' && !u.archived)
    .sort((a, b) => str(a.studentId).localeCompare(str(b.studentId)));
  return ok(rows.map(u => ({ studentId: u.studentId, name: u.fullName, class: u.classId, email: u.email || '' })));
}
async function studentArchive(p) {
  await teacher();
  if (!p.studentId) return fail('Thiếu studentId.');
  await fs.doc('users/' + await uidForStudent(p.studentId)).update({ archived: true });
  return ok();
}
async function studentUpdate(p) {
  await teacher();
  if (!p.studentId) return fail('Missing studentId.');
  const patch = {};
  if (p.name)  patch.fullName = str(p.name);
  if (p.class) patch.classId = str(p.class).toUpperCase();
  if (p.email !== undefined) patch.email = low(p.email);
  if (p.phone !== undefined) patch.phone = str(p.phone);
  await fs.doc('users/' + await uidForStudent(p.studentId)).update(patch);
  return ok();
}

// ════════════════════════════════════════════
// ASSIGNMENTS
// ════════════════════════════════════════════
function vocabOf(d) { return json(d.vocabJson, []); }
function activeStr(d) { return d.active === false ? 'FALSE' : 'TRUE'; }

// In-class window end (base, without extensions)
function baseEnd(d) {
  if (d.sessionEnd) return ms(d.sessionEnd);
  const s = ms(d.sessionStart);
  return s ? s + (parseInt(d.sessionDurationMin, 10) || 0) * 60000 : 0;
}
function extFor(d, sid) { return Math.max(ms(d.extAll), ms(d.ext && d.ext[sid])); }

function teacherRow(id, d) {
  return {
    assignmentId: id, mode: d.mode, classId: d.classId, title: d.title,
    reading: d.reading || '', vocab: vocabOf(d),
    deadline: d.deadline || '', requiredGoals: d.requiredGoals,
    sessionStart: d.sessionStart || '', sessionDurationMin: parseInt(d.sessionDurationMin, 10) || 0,
    sessionEnd: d.sessionEnd || '', createdAt: d.createdAt, active: activeStr(d),
    // time extensions (whole class + per student) — shown/edited in the teacher's Extend dialog
    extAll: d.extAll || '', ext: d.ext || {}, deleted: !!d.deleted
  };
}

async function assignCreate(p) {
  const t = await teacher();
  if (!p.classId || !str(p.title)) return fail('Missing classId or title.');
  const cls = await fs.doc('classes/' + p.classId).get();
  if (!cls.exists || cls.data().teacherUid !== t.uid) return fail('The class does not exist or is not yours.');
  const mode = p.mode === 'inclass' ? 'inclass' : 'homework';
  const id = str(p.assignmentId) || genId(10, 'VM-');
  const vocab = p.vocab || [];
  const doc = {
    assignmentId: id, teacherUid: t.uid, classId: p.classId, mode,
    title: window.VM.prefixTitle(p.title, mode),
    reading: p.reading || '', vocabJson: JSON.stringify(vocab), vocabCount: vocab.length,
    deadline: p.deadline || '', requiredGoals: mode === 'homework' ? (parseInt(p.requiredGoals, 10) || 3) : 0,
    sessionStart: p.sessionStart || '', sessionDurationMin: parseInt(p.sessionDurationMin, 10) || 0, sessionEnd: p.sessionEnd || '',
    extAll: '', ext: {}, active: true, deleted: false, createdAt: nowIso()
  };
  // same id twice (double click / retry) → nothing is written a second time
  const ref = fs.doc('assignments/' + id);
  if ((await ref.get()).exists) return ok({ assignmentId: id });
  await ref.set(doc);
  return ok({ assignmentId: id });
}
async function assignUpdate(p) {
  const t = await teacher();
  if (!p.assignmentId) return fail('Thiếu assignmentId.');
  const ref = fs.doc('assignments/' + p.assignmentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().teacherUid !== t.uid) return fail('Assignment not found.');
  const cur = snap.data(), patch = {};
  const mode = p.mode !== undefined ? (p.mode === 'inclass' ? 'inclass' : 'homework') : cur.mode;
  if (p.mode !== undefined) patch.mode = mode;
  if (p.title !== undefined || p.mode !== undefined) patch.title = window.VM.prefixTitle(p.title !== undefined ? p.title : cur.title, mode);
  if (p.reading !== undefined) patch.reading = p.reading;
  if (p.vocab !== undefined) { patch.vocabJson = JSON.stringify(p.vocab); patch.vocabCount = p.vocab.length; }
  if (p.deadline !== undefined) patch.deadline = p.deadline;
  if (p.requiredGoals !== undefined) patch.requiredGoals = mode === 'homework' ? (parseInt(p.requiredGoals, 10) || 3) : 0;
  if (p.sessionStart !== undefined) patch.sessionStart = p.sessionStart;
  if (p.sessionDurationMin !== undefined) patch.sessionDurationMin = parseInt(p.sessionDurationMin, 10) || 0;
  if (p.sessionEnd !== undefined) patch.sessionEnd = p.sessionEnd;
  if (p.active !== undefined) patch.active = !!p.active;
  if (p.classId !== undefined && p.classId !== cur.classId) {
    const cls = await fs.doc('classes/' + p.classId).get();
    if (!cls.exists || cls.data().teacherUid !== t.uid) return fail('Invalid class.');
    patch.classId = p.classId;
  }
  await ref.update(patch);
  return ok();
}
async function assignDelete(p) {
  await teacher();
  if (!p.assignmentId) return fail('Thiếu assignmentId.');
  await fs.doc('assignments/' + p.assignmentId).update({ deleted: true, active: false });
  return ok();
}
async function assignList(p) {
  const t = await teacher();
  const ids = p.classId ? [p.classId] : (p.classIds || null);
  const rows = docs(await fs.collection('assignments').where('teacherUid', '==', t.uid).get())
    .filter(d => (p.includeDeleted || !d.deleted) && (!ids || ids.indexOf(d.classId) > -1))   // includeDeleted: Results dropdown still needs deleted/closed assignments whose results exist
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return ok(rows.map(d => teacherRow(d._id, d)));
}
async function assignGet(p) {
  const u = await me();
  const snap = await fs.doc('assignments/' + p.assignmentId).get();
  if (!snap.exists) return fail('Assignment not found.');
  const d = snap.data();
  return ok(u.role === 'teacher' ? teacherRow(snap.id, d) : studentRow(snap.id, d, u));
}

// What ONE student sees: deadlines / session end already include any extension for them,
// so student.html's timers and gates work unchanged.
function studentRow(id, d, u) {
  const sid = u.studentId, now = Date.now();
  const o = {
    assignmentId: id, mode: d.mode, title: d.title, reading: d.reading || '', vocab: vocabOf(d),
    deadline: d.deadline || '', requiredGoals: parseInt(d.requiredGoals, 10) || 3,
    sessionStart: d.sessionStart || '', sessionDurationMin: parseInt(d.sessionDurationMin, 10) || 0,
    sessionEnd: d.sessionEnd || '', sessionStatus: null, extended: false
  };
  const ext = extFor(d, sid);
  if (d.mode === 'inclass') {
    let end = baseEnd(d);
    if (ext > end) { end = ext; o.sessionEnd = new Date(ext).toISOString(); o.extended = true; }
    const start = ms(d.sessionStart);
    o.sessionStatus = !start || !end ? 'open' : now < start ? 'upcoming' : now > end ? 'closed' : 'open';
  } else {
    const dl = deadlineMs(d.deadline);
    if (ext && dl && ext > dl) { o.deadline = localStamp(ext); o.extended = true; }
  }
  return o;
}
async function assignForStudent() {
  const u = await me();
  if (!u.classId) return ok([]);
  const rows = docs(await fs.collection('assignments').where('classId', '==', u.classId).where('active', '==', true).get())
    .filter(d => !d.deleted)
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  const now = Date.now();
  return ok(rows.filter(d => {
    if (d.mode === 'inclass') return true;                       // window handled via sessionStatus
    const dl = deadlineMs(d.deadline);
    return !dl || Math.max(dl, extFor(d, u.studentId)) >= now;   // homework: hide only after deadline (+ extension)
  }).map(d => studentRow(d._id, d, u)));
}

/* Gia hạn — p: { assignmentId, scope:'class'|'students', studentIds:[], clear:bool,
                  deltaMin:(phút, cộng thêm)  HOẶC  until:(thời điểm cụ thể),
                  kind:'shift' (chỉ In-class + cả lớp: dời cả giờ bắt đầu lẫn kết thúc) }

   • cộng thêm = (giờ kết thúc/hạn nộp hiện tại của đối tượng, hoặc bây giờ nếu đã qua) + deltaMin
     → SV nào đã được gia hạn riêng thì cộng tiếp từ mốc của chính SV đó.
   • class → extAll;  students → ext.{studentId}.  clear:true gỡ gia hạn.
   • shift → sửa thẳng sessionStart/sessionEnd của bài (đổi lịch kiểm tra), kèm các gia hạn đang có. */
const MAX_EXT_MIN = 366 * 1440;
function localInput(t) { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
// moves a stored time string by dMs, keeping its format ("2026-10-02T17:30" local, or ISO with Z)
function shiftStr(v, dMs) {
  v = str(v); const t = ms(v);
  if (!v || !t) return v;
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(v) ? new Date(t + dMs).toISOString() : localInput(t + dMs);
}
async function assignExtend(p) {
  const t = await teacher();
  if (!p.assignmentId) return fail('Thiếu assignmentId.');
  const ref = fs.doc('assignments/' + p.assignmentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().teacherUid !== t.uid) return fail('Assignment not found.');
  const d = snap.data(), inclass = d.mode === 'inclass', now = Date.now();
  const FP = firebase.firestore.FieldPath;
  const sids = (p.studentIds || []).map(str).filter(Boolean);
  if (p.scope === 'students' && !sids.length) return fail('Select at least one student.');

  if (p.clear) {
    if (p.scope === 'students') {
      const args = []; sids.forEach(s => args.push(new FP('ext', s), FV.delete()));
      await ref.update(...args);
    } else await ref.update({ extAll: '' });
    return ok();
  }

  const deltaMin = Math.round(Number(p.deltaMin) || 0);
  if (deltaMin < 0 || deltaMin > MAX_EXT_MIN) return fail('Invalid extension time.');
  const abs = ms(p.until);
  if (!deltaMin && !abs) return fail('Enter the extension time.');

  // Dời lịch cả lớp (In-class): giờ bắt đầu và kết thúc cùng lùi
  if (p.kind === 'shift') {
    if (!inclass || p.scope === 'students') return fail('Rescheduling only applies to in-class tests for the whole class.');
    const dMs = deltaMin ? deltaMin * 60000 : abs - ms(d.sessionStart);
    if (!ms(d.sessionStart)) return fail('This session has no start time.');
    if (dMs <= 0) return fail('The new start time must be later than the current start time.');
    const patch = { sessionStart: shiftStr(d.sessionStart, dMs) };
    if (d.sessionEnd) patch.sessionEnd = shiftStr(d.sessionEnd, dMs);
    if (d.extAll) patch.extAll = shiftStr(d.extAll, dMs);
    if (d.ext && Object.keys(d.ext).length) { const e = {}; Object.keys(d.ext).forEach(k => { e[k] = shiftStr(d.ext[k], dMs); }); patch.ext = e; }
    await ref.update(patch);
    return ok({ sessionStart: patch.sessionStart, sessionEnd: patch.sessionEnd || '' });
  }

  const base = inclass ? baseEnd(d) : deadlineMs(d.deadline);
  if (!base) return fail(inclass ? 'This session has no end time.' : 'This item has no deadline, so it cannot be extended.');
  const cur = sid => Math.max(base, ms(d.extAll), sid ? ms(d.ext && d.ext[sid]) : 0);
  const target = sid => abs || (Math.max(cur(sid), now) + deltaMin * 60000);

  if (p.scope === 'students') {
    const args = [], out = {};
    sids.forEach(s => { out[s] = new Date(target(s)).toISOString(); args.push(new FP('ext', s), out[s]); });
    await ref.update(...args);
    return ok({ until: out });
  }
  const until = new Date(target(null)).toISOString();
  await ref.update({ extAll: until });
  return ok({ until });
}

// ════════════════════════════════════════════
// RESULTS   results/{assignmentId}_{uid}
// ════════════════════════════════════════════
function runToRow(r) {
  return {
    timestamp: r.t, score: r.score, isPerfect: !!r.perfect, durationSec: r.dur || 0,
    correct: r.correct || 0, total: r.total || 0, missedWords: r.missed || [],
    timedOut: !!r.timedOut, absent: !!r.absent
  };
}
// arrayUnion: appended without reading the doc first (fast, cheap, no race between two tabs)
async function resultSave(p, forceMode) {
  const u = await me();
  if (!p.assignmentId) return fail('Thiếu assignmentId.');
  const score = Number(p.score) || 0, perfect = score === 100, now = nowIso();
  const run = {
    t: now, score, perfect, dur: Number(p.durationSec) || 0, correct: Number(p.correct) || 0, total: Number(p.total) || 0,
    missed: p.missedWords || [], timedOut: !!p.timedOut, absent: false
  };
  await fs.doc('results/' + p.assignmentId + '_' + u.uid).set({
    uid: u.uid, studentId: u.studentId || '', name: u.fullName || '', classId: u.classId || '', teacherUid: u.teacherUid || '',
    assignmentId: p.assignmentId, title: p.title || '', mode: forceMode || p.mode || '',
    attempts: FV.increment(1), perfectCount: FV.increment(perfect ? 1 : 0), lastAt: now,
    runs: FV.arrayUnion(run)
  }, { merge: true });
  forget('res|');
  return ok();
}
const resultSaveInclass = p => resultSave(p, 'inclass');

async function resultGetForStudent() {
  const u = await me();
  const rows = [];
  docs(await fs.collection('results').where('uid', '==', u.uid).get()).forEach(d => {
    (d.runs || []).forEach(r => rows.push(Object.assign({ assignmentId: d.assignmentId, title: d.title, mode: d.mode }, runToRow(r))));
  });
  return ok(rows);
}

function classResultDocs(t, classId, assignmentId) {
  return memo('res|' + t.uid + '|' + classId + '|' + str(assignmentId), 30000, async () => {
    let q = fs.collection('results').where('teacherUid', '==', t.uid).where('classId', '==', classId);
    if (assignmentId) q = q.where('assignmentId', '==', assignmentId);
    return docs(await q.get());
  });
}
// Every assignment of a class that has at least one result — straight from the results, so the
// Results dropdown can offer assignments that are gone from the assignment list.
async function resultAssignments(p) {
  const t = await teacher();
  if (!p.classId) return fail('classId required');
  const rows = await classResultDocs(t, str(p.classId), '');
  const by = {};
  rows.forEach(d => {
    const a = by[d.assignmentId] || (by[d.assignmentId] = { assignmentId: d.assignmentId, title: d.title || d.assignmentId, mode: d.mode || '', students: 0, last: '' });
    a.students++; if (str(d.lastAt) > a.last) a.last = str(d.lastAt);
  });
  return ok(Object.keys(by).map(k => by[k]).sort((a, b) => b.last.localeCompare(a.last)));
}

async function resultGetForTeacher(p) {
  const t = await teacher();
  if (!p.classId) return fail('classId required');
  const classId = str(p.classId);

  // Flat mode: the runs of one student × assignment (accordion expand) — a single doc read
  if (p.groupBy === 'all') {
    if (!p.studentId || !p.assignmentId) return ok([]);
    const d = await fs.doc('results/' + p.assignmentId + '_' + await uidForStudent(p.studentId)).get();
    if (!d.exists) return ok([]);
    return ok((d.data().runs || []).slice().sort((a, b) => ms(b.t) - ms(a.t)).slice(0, 20).map(runToRow));
  }

  const days = (p.days === 0 || p.days === '0') ? 0 : (parseInt(p.days, 10) || 14);
  const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
  const pageSize = Math.min(parseInt(p.pageSize, 10) || 30, 100);
  const page = Math.max(1, parseInt(p.page, 10) || 1);

  // Whole class is fetched once, then paged/filtered in memory (30 s cache while the teacher pages through)
  const rows = await classResultDocs(t, classId, p.assignmentId);
  const groups = rows.filter(d => (!p.mode || d.mode === p.mode) && (!cutoff || ms(d.lastAt) >= cutoff)).map(d => {
    const runs = d.runs || [];
    let best = 0, last = null;
    runs.forEach(r => { if ((Number(r.score) || 0) > best) best = Number(r.score) || 0; if (!last || r.t > last.t) last = r; });
    return {
      studentId: d.studentId, name: d.name, class: d.classId, assignmentId: d.assignmentId, title: d.title, mode: d.mode,
      bestScore: best, lastScore: last ? Number(last.score) || 0 : 0, lastTimestamp: last ? last.t : '',
      attempts: runs.length, perfectCount: runs.filter(r => r.perfect).length
    };
  }).sort((a, b) => str(b.lastTimestamp).localeCompare(str(a.lastTimestamp)));

  const total = groups.length, totalPages = Math.ceil(total / pageSize) || 1;
  return { success: true, data: groups.slice((page - 1) * pageSize, page * pageSize), meta: { total, page, pageSize, totalPages, days, classId } };
}

async function resultMissedWords(p) {
  const u = await me();
  const sid = u.role === 'teacher' && p.studentId ? await uidForStudent(p.studentId) : u.uid;
  const d = await fs.doc('results/' + p.assignmentId + '_' + sid).get();
  if (!d.exists) return ok({ words: [], timedOut: false, absent: false, score: null });
  const runs = (d.data().runs || []).slice().sort((a, b) => ms(b.t) - ms(a.t));
  const r = runs[0] || {};
  return ok({ words: r.missed || [], timedOut: !!r.timedOut, absent: !!r.absent, score: r.score, timestamp: r.t });
}

// Absent penalty — teacher closes an in-class session: every student without a result is marked
// absent and gets all words missed by anyone in the class. Safe to press twice (skips existing docs).
async function absentPenalty(p) {
  const t = await teacher();
  if (!p.assignmentId || !p.classId) return fail('Missing assignmentId or classId.');
  const aSnap = await fs.doc('assignments/' + p.assignmentId).get();
  if (!aSnap.exists || aSnap.data().teacherUid !== t.uid) return fail('Assignment not found.');
  const A = aSnap.data();
  const res = docs(await fs.collection('results').where('teacherUid', '==', t.uid).where('assignmentId', '==', p.assignmentId).get());
  const missedSet = {}, done = {};
  res.forEach(d => {
    done[d.uid] = true;
    (d.runs || []).forEach(r => { if (!r.absent) (r.missed || []).forEach(w => { missedSet[w] = true; }); });
  });
  const allMissed = Object.keys(missedSet);
  const roster = docs(await fs.collection('users').where('teacherUid', '==', t.uid).where('classId', '==', str(p.classId).toUpperCase()).get())
    .filter(u => u.role === 'student' && !u.archived);
  const absent = roster.filter(u => !done[u._id]);
  const now = nowIso();
  for (let i = 0; i < absent.length; i += 400) {
    const batch = fs.batch();
    absent.slice(i, i + 400).forEach(u => {
      batch.set(fs.doc('results/' + p.assignmentId + '_' + u._id), {
        uid: u._id, studentId: u.studentId, name: u.fullName || '', classId: u.classId, teacherUid: t.uid,
        assignmentId: p.assignmentId, title: A.title || p.title || '', mode: 'inclass',
        attempts: 1, perfectCount: 0, lastAt: now,
        runs: [{ t: now, score: 0, perfect: false, dur: 0, correct: 0, total: p.total || A.vocabCount || 0, missed: allMissed, timedOut: false, absent: true }]
      });
    });
    await batch.commit();
  }
  forget('res|');
  return ok({ absentCount: absent.length, allMissedCount: allMissed.length });
}

async function recheckSave(p) {
  const t = await teacher();
  if (!p.assignmentId || !p.studentId) return fail('Missing required fields.');
  const uid = await uidForStudent(p.studentId);
  await fs.doc('rechecks/' + p.assignmentId + '_' + uid).set({
    teacherUid: t.uid, assignmentId: p.assignmentId, studentId: str(p.studentId), studentName: p.studentName || '',
    classId: p.class || '', missedWords: p.missedWords || '', penaltyType: p.penaltyType || 'wrong',
    checkedBy: t.email || '', checkedAt: nowIso(), note: p.note || ''
  }, { merge: true });
  return ok({ recheckId: p.assignmentId + '_' + uid });
}
// keys are "studentId__assignmentId" — what teacher.html reads
async function recheckList(p) {
  const t = await teacher();
  let q = fs.collection('rechecks').where('teacherUid', '==', t.uid);
  if (p.assignmentId && p.assignmentId !== '__all__') q = q.where('assignmentId', '==', p.assignmentId);
  const map = {};
  docs(await q.get()).forEach(r => {
    map[r.studentId + '__' + r.assignmentId] = { studentId: r.studentId, checkedBy: r.checkedBy, checkedAt: r.checkedAt, penaltyType: r.penaltyType, note: r.note };
  });
  return ok(map);
}

// ════════════════════════════════════════════
// TRANSLATE
// ════════════════════════════════════════════
function trStatus(d) {
  const start = ms(d.sessionStart), dl = deadlineMs(d.deadline), now = Date.now();
  if (!start) return 'open';
  if (now < start) return 'upcoming';
  if (dl && now > dl) return 'closed';
  return 'open';
}
async function translateCreate(p) {
  const t = await teacher();
  if (!p.classId || !str(p.title) || !p.sessionStart) return fail('Missing classId, title, or sessionStart.');
  if (!p.items || p.items.length < 1) return fail('items array required.');
  const cls = await fs.doc('classes/' + p.classId).get();
  if (!cls.exists || cls.data().teacherUid !== t.uid) return fail('The class does not exist or is not yours.');
  const id = str(p.setId || p.assignmentId) || genId(10, 'TR-');
  const tref = fs.doc('trSets/' + id);
  if (!(await tref.get()).exists) {
    await tref.set({
      setId: id, sourceAssignmentId: p.sourceAssignmentId || '', classId: p.classId, teacherUid: t.uid, title: str(p.title),
      itemsJson: JSON.stringify(p.items), itemCount: p.items.length, passScore: parseInt(p.passScore, 10) || 85,
      sessionStart: p.sessionStart, deadline: p.deadline || '', active: true, createdAt: nowIso()
    });
  }
  return ok({ setId: id });
}
async function translateUpdate(p) {
  const t = await teacher();
  if (!p.setId) return fail('Missing setId.');
  const patch = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.passScore !== undefined) patch.passScore = parseInt(p.passScore, 10) || 85;
  if (p.sessionStart !== undefined) patch.sessionStart = p.sessionStart;
  if (p.deadline !== undefined) patch.deadline = p.deadline;
  if (p.active !== undefined) patch.active = !!p.active;
  await fs.doc('trSets/' + p.setId).update(patch);
  return ok();
}
async function translateList(p) {
  const t = await teacher();
  const ids = p.classId ? [p.classId] : (p.classIds || null);
  const rows = docs(await fs.collection('trSets').where('teacherUid', '==', t.uid).get())
    .filter(d => !ids || ids.indexOf(d.classId) > -1)
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return ok(rows.map(d => ({
    setId: d._id, sourceAssignmentId: d.sourceAssignmentId, classId: d.classId, title: d.title, passScore: d.passScore || 85,
    sessionStart: d.sessionStart, deadline: d.deadline, createdAt: d.createdAt, active: d.active === false ? 'FALSE' : 'TRUE', itemCount: d.itemCount || 0
  })));
}
async function translateForStudent() {
  const u = await me();
  if (!u.classId) return ok([]);
  const rows = docs(await fs.collection('trSets').where('classId', '==', u.classId).where('active', '==', true).get());
  return ok(rows.map(d => ({
    setId: d._id, sourceAssignmentId: d.sourceAssignmentId, title: d.title, passScore: d.passScore || 85,
    sessionStart: d.sessionStart, deadline: d.deadline, itemCount: d.itemCount || 30, sessionStatus: trStatus(d)
  })));
}
async function translateGet(p) {
  if (!p.setId) return fail('Missing setId.');
  await me();
  const s = await fs.doc('trSets/' + p.setId).get();
  if (!s.exists) return fail('Set not found.');
  const d = s.data();
  return ok({ setId: s.id, title: d.title, passScore: d.passScore || 85, sessionStart: d.sessionStart, deadline: d.deadline,
             classId: d.classId, items: json(d.itemsJson, []), sessionStatus: trStatus(d) });
}
async function translateSaveResult(p) {
  const u = await me();
  if (!p.setId) return fail('Missing setId.');
  const now = nowIso();
  const doc = {
    uid: u.uid, studentId: u.studentId || '', name: u.fullName || '', classId: u.classId || '', teacherUid: u.teacherUid || '',
    setId: p.setId, title: p.title || '', lastAt: now,
    runs: FV.arrayUnion({ i: Number(p.runIndex) || 1, t: now, score: Number(p.score) || 0, passed: !!p.passed, dur: Number(p.durationSec) || 0 }),
    // only the latest run keeps its heavy detail (keeps the doc small)
    lastItemScores: JSON.stringify(p.itemScores || []), lastChest: JSON.stringify(p.chest || [])
  };
  if ((p.clearedItemIds || []).length) doc.clearedIds = FV.arrayUnion(...p.clearedItemIds);
  await fs.doc('trProgress/' + p.setId + '_' + u.uid).set(doc, { merge: true });
  return ok();
}
async function translateStats(p) {
  const t = await teacher();
  if (!p.setId) return fail('Missing setId.');
  const rows = docs(await fs.collection('trProgress').where('teacherUid', '==', t.uid).where('setId', '==', p.setId).get());
  let runsCount = 0, totalScore = 0;
  const students = rows.map(d => {
    const runs = d.runs || [];
    let best = 0, last = null;
    runs.forEach(r => { runsCount++; totalScore += Number(r.score) || 0; if ((Number(r.score) || 0) > best) best = Number(r.score) || 0; if (!last || r.t > last.t) last = r; });
    return { studentId: d.studentId, name: d.name, runs: runs.length, bestScore: best, lastScore: last ? Number(last.score) || 0 : 0,
             clearedCount: (d.clearedIds || []).length, lastTimestamp: last ? last.t : '' };
  }).sort((a, b) => str(b.lastTimestamp).localeCompare(str(a.lastTimestamp)));
  return ok({
    studentCount: students.length, runsCount, avgScore: runsCount ? Math.round(totalScore / runsCount) : 0,
    avgCleared: students.length ? Math.round(students.reduce((a, s) => a + s.clearedCount, 0) / students.length) : 0, students
  });
}
async function translateMyProgress(p) {
  const u = await me();
  if (!p.setId) return fail('Missing fields.');
  const d = await fs.doc('trProgress/' + p.setId + '_' + u.uid).get();
  if (!d.exists) return ok({ runs: 0, clearedItemIds: [], bestScore: 0, lastScore: 0, nextRunIndex: 1 });
  const x = d.data(), runs = (x.runs || []).slice().sort((a, b) => str(a.t).localeCompare(str(b.t)));
  let best = 0; runs.forEach(r => { if ((Number(r.score) || 0) > best) best = Number(r.score) || 0; });
  return ok({ runs: runs.length, clearedItemIds: x.clearedIds || [], bestScore: best,
             lastScore: runs.length ? Number(runs[runs.length - 1].score) || 0 : 0, nextRunIndex: runs.length + 1 });
}

// ════════════════════════════════════════════
// READWISE (student self-study)
// ════════════════════════════════════════════
async function readwiseSave(p) {
  const u = await me();
  if (!str(p.title) || !p.passage) return fail('Missing required fields.');
  const id = genId(12, 'rw_');
  await fs.doc('readwise/' + id).set({
    articleId: id, uid: u.uid, studentId: u.studentId || '', studentName: u.fullName || '', classId: u.classId || '',
    title: str(p.title), passage: p.passage, wordCount: String(p.passage).split(/\s+/).filter(Boolean).length,
    vocabJson: JSON.stringify(p.vocab || []), collocJson: JSON.stringify(p.collocations || []), savedAt: nowIso()
  });
  return ok({ articleId: id });
}
async function readwiseList() {
  const u = await me();
  const rows = docs(await fs.collection('readwise').where('uid', '==', u.uid).get()).sort((a, b) => str(b.savedAt).localeCompare(str(a.savedAt)));
  return ok(rows.map(d => ({ articleId: d._id, title: d.title, wordCount: d.wordCount || 0, readMin: Math.ceil((d.wordCount || 0) / 200), savedAt: d.savedAt, studentName: d.studentName })));
}
async function readwiseGet(p) {
  await me();
  if (!p.articleId) return fail('Missing articleId.');
  const s = await fs.doc('readwise/' + p.articleId).get();
  if (!s.exists) return fail('Article not found.');
  const d = s.data();
  return ok({ articleId: s.id, title: d.title, passage: d.passage, vocab: json(d.vocabJson, []), collocations: json(d.collocJson, []), savedAt: d.savedAt });
}
async function readwiseDelete(p) {
  await me();
  if (!p.articleId) return fail('Missing fields.');
  await fs.doc('readwise/' + p.articleId).delete();
  return ok();
}

// ════════════════════════════════════════════
// WORD OF THE DAY   vocabBank/meta {count} + vocabBank/c0..cN {words:[…100]}
// ════════════════════════════════════════════
async function vocabToday(p) {
  await me();
  const meta = await memo('vocabmeta', 3600000, async () => { const d = await fs.doc('vocabBank/meta').get(); return d.exists ? d.data() : { count: 0 }; });
  const n = meta.count || 0;
  if (!n) return fail('No vocab.');
  const idx = (Math.floor(Date.now() / 86400000) + (typeof p.index === 'number' ? p.index : 0)) % n;
  const prev = (idx - 1 + n) % n;
  const chunk = async i => memo('vocabc' + i, 3600000, async () => { const d = await fs.doc('vocabBank/c' + i).get(); return d.exists ? (d.data().words || []) : []; });
  const [a, b] = await Promise.all([chunk(Math.floor(idx / VOCAB_CHUNK)), chunk(Math.floor(prev / VOCAB_CHUNK))]);
  const w = (list, i) => list[i % VOCAB_CHUNK] || {};
  const cur = w(a, idx), pr = w(b, prev);
  return ok({ current: cur, previous: pr });
}

// ════════════════════════════════════════════
// IELTS READING / LISTENING LIBRARY + ATTEMPTS
// ════════════════════════════════════════════
function cleanIeltsContent(p) {
  const skill = p.skill === 'listening' ? 'listening' : 'reading';
  const sections = Array.isArray(p.sections) ? p.sections.slice(0, 4) : [];
  const types = ['short-answer','sentence-completion','summary-completion','diagram-completion','multiple-choice','matching-features','matching-headings','true-false-not-given','yes-no-not-given','matching','plan-map-diagram-labelling','form-note-table-flow-chart-summary-completion'];
  if (!str(p.title) || !sections.length) throw new Error('Enter a title and at least one passage/part.');
  sections.forEach(s => {
    if (!str(s.text) && !str(s.script) && !(Array.isArray(s.questions) && s.questions.length)) throw new Error('Each passage/part needs text, a script or questions.');
    s.script = str(s.script).slice(0, 50000);
    s.questionsText = str(s.questionsText).slice(0, 60000);
    if (!Array.isArray(s.questions)) s.questions = [];
    s.questions.forEach(q => {
      if (!str(q.prompt) || !types.includes(q.type)) throw new Error('A question is missing its text or has an invalid task type.');
      if (!Array.isArray(q.answers)) q.answers = q.answer ? [q.answer] : [];
      q.answers = q.answers.map(str).filter(Boolean);
      q.options = Array.isArray(q.options) ? q.options.map(str).filter(Boolean) : [];
      q.instruction = str(q.instruction).slice(0, 4000);
      q.number = Number(q.number) || 0;
    });
  });
  return { title: str(p.title), skill, book: str(p.book), test: str(p.test), part: str(p.part), sourceUrl: str(p.sourceUrl), sourceTitle: str(p.sourceTitle), attribution: str(p.attribution), sourceTestNumber: str(p.sourceTestNumber), taskTypes: Array.from(new Set(sections.flatMap(s => s.questions.map(q => q.type)))), sections };
}
function publicIelts(d) {
  const copy = JSON.parse(JSON.stringify(d));
  (copy.sections || []).forEach(s => { delete s.script; (s.questions || []).forEach(q => { delete q.answers; delete q.answer; }); });
  return copy;
}
// Library item = ONE part (Passage / Part) of one book + test. Everyone signed in can read published items.
function ieltsCanEdit(u, d) { return d.ownerUid === u.uid || (u.role === 'teacher' && d.teacherUid === u.uid); }
function ieltsLibraryId(skill, book, test, part) { return ('L_' + skill + '_' + book + '_T' + test + '_P' + part).replace(/[^A-Za-z0-9_]/g, ''); }
async function ieltsContentSave(p) {
  const u = await me(), data = cleanIeltsContent(p);
  if (!data.book || !data.test || !data.part) return fail('Select Book, Test and Part.');
  if (!data.sections.some(s => s.questions.length)) return fail('Add at least one question.');
  if (data.sections.some(s => s.questions.some(q => !q.answers.length))) return fail('Every question needs an answer before you can finish.');
  const id = str(p.id) || ieltsLibraryId(data.skill, data.book, data.test, data.part);
  const ref = fs.doc('ieltsContent/' + id), prior = await ref.get();
  if (prior.exists && !ieltsCanEdit(u, prior.data())) return fail('This part is already in the Library: ' + (prior.data().title || id) + '. Only its creator or the creator’s teacher can edit it.');
  if (prior.exists && prior.data().archived && !p.id) return fail('This part was in the Library before and is archived. Contact your teacher.');
  const ownerUid = prior.exists ? prior.data().ownerUid : u.uid;
  const teacherUid = prior.exists ? (prior.data().teacherUid || '') : (u.role === 'teacher' ? u.uid : (u.teacherUid || ''));
  const version = prior.exists ? (prior.data().version || 1) + 1 : 1;
  const keySections = data.sections.map(s => ({ script: s.script || '', answers: (s.questions || []).map(q => q.answers || []) }));
  data.sections.forEach(s => { delete s.script; (s.questions || []).forEach(q => { delete q.answers; delete q.answer; }); });
  const batch = fs.batch();
  batch.set(ref, Object.assign({}, data, {
    ownerUid, ownerName: prior.exists ? (prior.data().ownerName || '') : (u.fullName || ''), ownerRole: prior.exists ? (prior.data().ownerRole || '') : u.role,
    teacherUid, classId: '', allowedClassIds: [], visibility: 'library', status: 'published', archived: false, version,
    createdAt: prior.exists ? prior.data().createdAt : nowIso(), updatedAt: nowIso()
  }));
  batch.set(fs.doc('ieltsAnswerKeys/' + id), { ownerUid, teacherUid, visibility: 'library', sections: keySections, version, updatedAt: nowIso() });
  await batch.commit();
  return ok({ id, version });
}
async function ieltsContentList(p) {
  const u = await me();
  const [pub, own] = await Promise.all([
    fs.collection('ieltsContent').where('status', '==', 'published').where('archived', '==', false).get(),
    fs.collection('ieltsContent').where('ownerUid', '==', u.uid).get()
  ]);
  const map = {};
  docs(pub).concat(docs(own)).forEach(d => { map[d._id] = d; });
  const rows = Object.keys(map).map(k => map[k]).filter(d => !d.archived && d.status === 'published' && (p.skill ? d.skill === p.skill : true));
  return ok(rows.map(d => ({
    id: d._id, title: d.title, skill: d.skill, book: d.book || '', test: d.test || '', part: d.part || '', taskTypes: d.taskTypes || [],
    questionCount: (d.sections || []).reduce((n, s) => n + (s.questions || []).length, 0), hasAudio: !!(d.sections || []).some(s => s.audio && s.audio.path),
    ownerName: d.ownerName || '', ownerRole: d.ownerRole || '', version: d.version || 1, updatedAt: d.updatedAt || '', canEdit: ieltsCanEdit(u, d)
  })));
}
async function ieltsContentGet(p) {
  const u = await me(), s = await fs.doc('ieltsContent/' + str(p.id)).get();
  if (!s.exists) return fail('Test not found.');
  const d = Object.assign({ id: s.id }, s.data()), canEdit = ieltsCanEdit(u, d);
  if (!canEdit && !(d.status === 'published' && !d.archived)) return fail('You do not have access to this test.');
  if (canEdit) {
    const key = await fs.doc('ieltsAnswerKeys/' + s.id).get();
    if (key.exists) (d.sections || []).forEach((section, si) => { const ks = (key.data().sections || [])[si] || {}; if (ks.script) section.script = ks.script; (section.questions || []).forEach((q, qi) => { q.answers = (ks.answers || [])[qi] || []; }); });
  }
  d.canEdit = canEdit;
  return ok(canEdit ? d : publicIelts(d));
}
async function ieltsContentArchive(p) {
  const u = await me(), ref = fs.doc('ieltsContent/' + str(p.id)), s = await ref.get();
  if (!s.exists || !ieltsCanEdit(u, s.data())) return fail('You cannot remove this item.');
  await ref.update({ archived: true, status: 'archived', updatedAt: nowIso() }); return ok();
}

// ── IELTS In-class sessions (assignments with kind:'ielts'; time windows + extensions reuse assign.extend) ──
function ieltsSessionEnd(d, sid) {
  const base = d.sessionEnd ? ms(d.sessionEnd) : (ms(d.sessionStart) ? ms(d.sessionStart) + (parseInt(d.sessionDurationMin, 10) || 0) * 60000 : 0);
  return Math.max(base, ms(d.extAll), sid ? ms(d.ext && d.ext[sid]) : 0);
}
function ieltsSessionStatus(d, sid) {
  const now = Date.now(), start = ms(d.sessionStart), end = ieltsSessionEnd(d, sid);
  return !start || !end ? 'open' : now < start ? 'upcoming' : now > end ? 'closed' : 'open';
}
async function ieltsInclassCreate(p) {
  const t = await teacher();
  const cls = await fs.doc('classes/' + str(p.classId)).get();
  if (!cls.exists || cls.data().teacherUid !== t.uid || cls.data().status === 'Archived') return fail('The class does not exist or is not yours.');
  const ids = (Array.isArray(p.contentIds) ? p.contentIds : []).map(str).filter(Boolean).slice(0, 4);
  if (!ids.length) return fail('Select a test from the Library.');
  const meta = [];
  for (const cid of ids) {
    const c = await fs.doc('ieltsContent/' + cid).get();
    if (!c.exists || c.data().archived || c.data().status !== 'published') return fail('One of the tests is no longer in the Library.');
    meta.push({ id: cid, title: c.data().title, skill: c.data().skill, book: c.data().book || '', test: c.data().test || '', part: c.data().part || '' });
  }
  if (meta.some(m => m.skill !== meta[0].skill)) return fail('A session can only contain one skill.');
  if (!p.sessionStart || !ms(p.sessionStart)) return fail('Enter a start time.');
  const dur = parseInt(p.sessionDurationMin, 10) || 0;
  if (dur < 5 || dur > 240) return fail('Duration must be between 5 and 240 minutes.');
  const id = str(p.assignmentId) || genId(10, 'IC-');
  const ref = fs.doc('assignments/' + id);
  if ((await ref.get()).exists) return ok({ assignmentId: id });
  const title = str(p.title) || (meta.length === 1 ? meta[0].title : (meta[0].book + ' · Test ' + meta[0].test + ' · Full ' + meta[0].skill));
  await ref.set({
    assignmentId: id, kind: 'ielts', teacherUid: t.uid, classId: str(p.classId), mode: 'inclass', title, skill: meta[0].skill,
    contentIds: ids, contentMeta: meta, sessionStart: str(p.sessionStart), sessionDurationMin: dur, sessionEnd: '',
    extAll: '', ext: {}, active: true, deleted: false, createdAt: nowIso()
  });
  return ok({ assignmentId: id });
}
async function ieltsInclassList(p) {
  const t = await teacher();
  const rows = docs(await fs.collection('assignments').where('teacherUid', '==', t.uid).get())
    .filter(d => d.kind === 'ielts' && !d.deleted && (!p.classId || d.classId === p.classId))
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return ok(rows.map(d => ({
    assignmentId: d._id, classId: d.classId, title: d.title, skill: d.skill, contentIds: d.contentIds || [], contentMeta: d.contentMeta || [],
    sessionStart: d.sessionStart, sessionDurationMin: d.sessionDurationMin, extAll: d.extAll || '', ext: d.ext || {},
    endsAt: new Date(ieltsSessionEnd(d, null) || 0).toISOString(), status: ieltsSessionStatus(d, null), createdAt: d.createdAt
  })));
}
async function ieltsInclassForStudent() {
  const u = await me();
  if (!u.classId) return ok([]);
  const rows = docs(await fs.collection('assignments').where('classId', '==', u.classId).where('active', '==', true).get())
    .filter(d => d.kind === 'ielts' && !d.deleted)
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return ok(rows.map(d => ({
    assignmentId: d._id, title: d.title, skill: d.skill, contentIds: d.contentIds || [], contentMeta: d.contentMeta || [],
    sessionStart: d.sessionStart, sessionDurationMin: d.sessionDurationMin,
    endsAt: new Date(ieltsSessionEnd(d, u.studentId) || 0).toISOString(), status: ieltsSessionStatus(d, u.studentId)
  })));
}
async function ieltsInclassDelete(p) {
  const t = await teacher(), ref = fs.doc('assignments/' + str(p.assignmentId)), s = await ref.get();
  if (!s.exists || s.data().teacherUid !== t.uid || s.data().kind !== 'ielts') return fail('In-class session not found.');
  await ref.update({ deleted: true, active: false }); return ok();
}
async function ieltsAttemptSave(p) {
  const u = await me();
  if (u.role !== 'student') return fail('Only students can submit practice attempts.');
  await authReady();
  const current = auth.currentUser;
  if (!current) return fail('SESSION_EXPIRED');
  const idToken = await current.getIdToken();
  return gas('ielts.gradeAttempt', { idToken, apiKey:CFG.config.apiKey, contentIds:Array.isArray(p.contentIds)?p.contentIds:[p.contentId], assignmentId:str(p.assignmentId), answers:Array.isArray(p.answers)?p.answers:[], startedAt:str(p.startedAt) });
}
async function ieltsAttemptList(p) {
  const u = await me(); let q;
  if (u.role === 'teacher') {
    if (!p.classId) return fail('Select a class to see results.');
    q = fs.collection('ieltsAttempts').where('teacherUid','==',u.uid);
    q = q.where('classId','==',str(p.classId));
    if (p.studentId) q = q.where('studentId','==',str(p.studentId));
  } else q = fs.collection('ieltsAttempts').where('uid','==',u.uid);
  const rows = docs(await q.get()).filter(d => (!p.skill || d.skill === p.skill) && (!p.since || d.completedAt >= p.since)).sort((a,b) => str(a.completedAt).localeCompare(str(b.completedAt)));
  return ok(rows);
}
async function ieltsReportCreate(p) {
  const u = await me();
  if (u.role !== 'student' || !str(p.contentId) || !str(p.message)) return fail('Describe the problem before sending.');
  if (p.privateContent) return fail('Private practice items cannot be reported to a teacher.');
  const id = genId(20, 'IR_');
  await fs.doc('ieltsReports/' + id).set({ uid:u.uid, studentId:u.studentId||'', studentName:u.fullName||'', teacherUid:u.teacherUid||'', classId:u.classId||'', contentId:str(p.contentId), contentTitle:str(p.contentTitle), questionNumber:Number(p.questionNumber)||0, message:str(p.message).slice(0,2000), createdAt:nowIso(), status:'open' });
  return ok({id});
}
async function ieltsReportList(p) {
  const t = await teacher();
  let q = fs.collection('ieltsReports').where('teacherUid','==',t.uid);
  if (p.classId) q = q.where('classId','==',str(p.classId));
  const rows = docs(await q.get()).sort((a,b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return ok(rows);
}
async function ieltsReportUpdate(p) {
  const t = await teacher(), ref = fs.doc('ieltsReports/' + str(p.id)), s = await ref.get();
  if (!s.exists || s.data().teacherUid !== t.uid) return fail('You cannot update this report.');
  const status = ['open','reviewing','resolved'].includes(p.status) ? p.status : 'reviewing';
  await ref.update({status, teacherNote:str(p.teacherNote).slice(0,2000), updatedAt:nowIso()}); return ok();
}
async function ieltsAudioUpload(p) {
  const u = await me(), id = str(p.contentId), file = p.file;
  if (!file || !id) return fail('Choose an audio file for a saved item.');
  if (!/^audio\/(mpeg|mp4|wav|x-wav|webm|ogg|aac|flac)$/i.test(str(file.type)) || file.size > 25 * 1024 * 1024) return fail('Only MP3, MP4, WAV, WebM, OGG, AAC or FLAC audio up to 25 MB is accepted.');
  const snap = await fs.doc('ieltsContent/' + id).get();
  if (!snap.exists) return fail('Save the item before uploading audio.');
  const item = snap.data();
  const authorized = ieltsCanEdit(u, item);
  if (!authorized) return fail('Only the creator can upload audio.');
  const ext = str(file.name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8) || 'audio';
  const path = 'ieltsAudio/' + u.uid + '/' + id + '/' + genId(18, '') + '.' + ext;
  await storage.ref(path).put(file, {contentType:file.type,customMetadata:{ownerUid:u.uid,contentId:id}});
  return ok({path, fileName:str(file.name), contentType:str(file.type), size:file.size});
}
async function ieltsAudioAttach(p) {
  const u = await me(), ref = fs.doc('ieltsContent/' + str(p.contentId)), snap = await ref.get();
  if (!snap.exists) return fail('Item not found.');
  const item = snap.data();
  if (!ieltsCanEdit(u, item) || !String(p.audioPath||'').startsWith('ieltsAudio/' + u.uid + '/' + str(p.contentId) + '/')) return fail('You cannot attach this audio.');
  const sections = item.sections || [];
  if (!sections.length) return fail('The item needs a section before audio can be attached.');
  sections[0].audio = {path:str(p.audioPath), fileName:str(p.fileName), contentType:str(p.contentType), size:Number(p.size)||0};
  await ref.update({sections,updatedAt:nowIso()});
  return ok();
}
async function ieltsAudioUrl(p) {
  const u = await me(), path = str(p.path);
  if (!path.startsWith('ieltsAudio/')) return fail('Invalid audio path.');
  return ok(await storage.ref(path).getDownloadURL());
}
async function ieltsImportUrl(p) {
  const t = await teacher(), current = auth.currentUser;
  if (!current) return fail('SESSION_EXPIRED');
  return gas('ielts.importUrl', { url:str(p.url), idToken:await current.getIdToken() });
}

// ════════════════════════════════════════════
// APPS SCRIPT (admin): accounts + passwords
// ════════════════════════════════════════════
async function gas(action, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(window.VM.GAS, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }), redirect: 'follow', signal: ctrl.signal
    });
    if (!r.ok) throw new Error('Network error ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const ACTIONS = {
  'auth.studentLogin': studentLogin, 'auth.teacherLogin': teacherLogin,
  'auth.studentSignup': studentSignup, 'auth.teacherSignup': teacherSignup,
  // Mật khẩu Firebase được mã hoá, không đọc lại được → Apps Script đặt mật khẩu MỚI và gửi qua email
  'auth.forgotPassword': p => gas('fb.forgotPassword', p),
  'auth.changePassword': changePassword, 'auth.changePasswordTeacher': changePassword,
  'class.create': classCreate, 'class.list': classList, 'class.roster': classRoster, 'class.archive': classArchive,
  'student.archive': studentArchive, 'student.update': studentUpdate,
  'assign.create': assignCreate, 'assign.update': assignUpdate, 'assign.delete': assignDelete,
  'assign.list': assignList, 'assign.get': assignGet, 'assign.forStudent': assignForStudent, 'assign.extend': assignExtend,
  'result.save': p => resultSave(p), 'result.saveInclass': resultSaveInclass,
  'result.getForTeacher': resultGetForTeacher, 'result.assignments': resultAssignments, 'result.getForStudent': resultGetForStudent,
  'result.missedWords': resultMissedWords, 'result.absentPenalty': absentPenalty,
  'result.recheckSave': recheckSave, 'result.recheckList': recheckList,
  'translate.create': translateCreate, 'translate.update': translateUpdate, 'translate.list': translateList,
  'translate.forStudent': translateForStudent, 'translate.get': translateGet, 'translate.saveResult': translateSaveResult,
  'translate.stats': translateStats, 'translate.myProgress': translateMyProgress,
  'readwise.save': readwiseSave, 'readwise.list': readwiseList, 'readwise.get': readwiseGet, 'readwise.delete': readwiseDelete,
  'ielts.inclass.create': ieltsInclassCreate, 'ielts.inclass.list': ieltsInclassList, 'ielts.inclass.forStudent': ieltsInclassForStudent, 'ielts.inclass.delete': ieltsInclassDelete,
  'ielts.content.save': ieltsContentSave, 'ielts.content.list': ieltsContentList, 'ielts.content.get': ieltsContentGet, 'ielts.content.archive': ieltsContentArchive,
  'ielts.attempt.save': ieltsAttemptSave, 'ielts.attempt.list': ieltsAttemptList,
  'ielts.report.create': ieltsReportCreate, 'ielts.report.list': ieltsReportList, 'ielts.report.update': ieltsReportUpdate,
  'ielts.audio.upload': ieltsAudioUpload, 'ielts.audio.attach': ieltsAudioAttach, 'ielts.audio.url': ieltsAudioUrl,
  'ielts.importUrl': ieltsImportUrl,
  'vocab.today': vocabToday,
  'ping': async () => ok('pong')
};

async function call(action, payload) {
  init();
  payload = payload || {};
  try {
    if (ACTIONS[action]) return await ACTIONS[action](payload);
    return fail('This action is not available in the Firebase version: ' + action);
  } catch (e) {
    const code = (e && e.code) || '';
    if (e && (e.message === 'SESSION_EXPIRED' || /unauthenticated/i.test(code))) return fail('SESSION_EXPIRED');
    if (/permission[-_]denied/i.test(code)) return fail(auth && auth.currentUser ? 'You do not have permission to access this data.' : 'SESSION_EXPIRED');
    if (/unavailable|deadline-exceeded/i.test(code)) return fail('Cannot reach the server. Check your connection and try again.');
    console.error('[vm-fbdata] ' + action, e);
    return fail((e && e.message) || String(e));
  }
}

window.FB = { call, authReady, signOut, _helpers: { authPw, loginEmailFor, sha256Hex, uidForStudent, cleanIeltsContent, publicIelts } };
})();
