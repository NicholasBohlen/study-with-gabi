// Study with Gabi, the extras: streak and stats, weak spots, search, exam dates,
// her own cards, pictures, timed practice exams, first-run setup, install and share.
// Loaded before app.js and only called once app.js has booted, so app.js's helpers are all here.
'use strict';

/* ---------- activity log and streak ---------- */
const dayLog = (d = today()) => (state.log[d] ||= { secs: 0, cards: 0, qs: 0, right: 0 });
const studiedOn = d => { const l = state.log[d]; return !!l && (l.cards + l.qs > 0 || l.secs >= 300); };

// Days in a row with some studying. Days off don't break it, and today counts once she starts.
function streak() {
  let d = today(), n = 0;
  if (!studiedOn(d)) d = addDays(d, -1);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    if (studiedOn(d)) n++;
    else if (!state.settings.offDays.includes(parse(d).getDay())) break;
  }
  if (n > (state.bestStreak || 0)) { state.bestStreak = n; save(); }
  return n;
}

// Time studied: 15-second ticks while a study page is open and she's touched it in the last 90 seconds.
const STUDY_VIEWS = ['topic', 'cards', 'quiz', 'deep', 'exam', 'search'];
let lastInput = Date.now();
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true });
setInterval(() => {
  if (!state || document.hidden || Date.now() - lastInput > 90000) return;
  if (!STUDY_VIEWS.includes(document.body.dataset.view)) return;
  dayLog().secs += 15; save();
}, 15000);

function logQuiz(kind, id, pct, n) {
  state.history.push({ d: today(), kind, id, pct, n });
  if (state.history.length > 300) state.history.splice(0, state.history.length - 300);
}

/* ---------- every answer, for weak spots ---------- */
function qkey(topicId, q) {
  let h = 0;
  for (const ch of q.q) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return topicId + '|' + (h >>> 0).toString(36);
}
function recordAnswer(topicId, q, ok) {
  const s = (state.qstats[qkey(topicId, q)] ||= { seen: 0, right: 0, run: 0, miss: 0 });
  s.seen++;
  if (ok) { s.right++; s.run++; } else { s.miss++; s.run = 0; }
  const l = dayLog(); l.qs++; if (ok) l.right++;
}
// Weak: missed at least once and not yet right twice in a row since.
const isWeak = s => !!s && s.miss > 0 && s.run < 2;
function weakQuestions(topics = studying()) {
  const out = [];
  for (const t of topics) for (const q of t.questions || []) {
    const s = state.qstats[qkey(t.id, q)];
    if (isWeak(s)) out.push({ ...q, topic: t.id, acc: s.right / s.seen });
  }
  return out.sort((a, b) => a.acc - b.acc);
}

/* ---------- her own cards ---------- */
const allCards = id => [...(topicById(id)?.cards || []), ...(state.mycards[id] || []).map(c => ({ ...c, mine: true }))];

function myCardsSection(id) {
  const mine = state.mycards[id] || [];
  return `<h2>Your cards <span class="count">${mine.length}</span></h2>
    ${mine.length ? `<div class="card qa-list">${mine.map((c, i) => `<div class="qa mine"><div class="grow"><p class="q">${esc(c.front)}</p><p class="a">${esc(c.back)}</p></div>
      <button class="icon-btn" data-del-card="${i}" aria-label="Delete card">×</button></div>`).join('')}</div>` : ''}
    <details class="card add-card" id="addCard"><summary>+ Write a card</summary>
      <label class="field">Front<textarea id="cFront" rows="2" placeholder="Question or prompt"></textarea></label>
      <label class="field">Back<textarea id="cBack" rows="2" placeholder="Answer"></textarea></label>
      <button class="btn block" id="cSave">Add card</button>
    </details>`;
}
function wireMyCards(id, rerender) {
  document.getElementById('cSave')?.addEventListener('click', () => {
    const front = document.getElementById('cFront').value.trim(), back = document.getElementById('cBack').value.trim();
    if (!front || !back) return alert('Fill in both sides.');
    (state.mycards[id] ||= []).push({ front, back });
    save(); rerender();
    document.getElementById('addCard').open = true;
    document.getElementById('cFront').focus();
  });
  app.querySelectorAll('[data-del-card]').forEach(b => b.onclick = () => {
    if (!confirm('Delete this card?')) return;
    state.mycards[id].splice(Number(b.dataset.delCard), 1); save(); rerender();
  });
}

/* ---------- pictures ---------- */
const pic = src => src ? `<img class="pic" src="${esc(src)}" alt="" loading="lazy">` : '';

// Tap a picture (outside a flashcard) to see it full screen.
document.addEventListener('click', e => {
  const img = e.target.closest?.('.pic');
  if (img && !img.closest('.flip')) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${esc(img.getAttribute('src'))}" alt="">`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }
});

// Saves every picture in the classes she's studying for offline use.
function precacheImages() {
  const urls = new Set();
  for (const t of studying()) {
    for (const c of t.cards || []) { if (c.frontImg) urls.add(c.frontImg); if (c.backImg) urls.add(c.backImg); }
    for (const q of t.questions || []) if (q.img) urls.add(q.img);
    for (const n of t.notes || []) if (n.img) urls.add(n.img);
  }
  if (urls.size) navigator.serviceWorker?.ready.then(r => r.active?.postMessage({ type: 'precache', urls: [...urls] })).catch(() => {});
}

/* ---------- search ---------- */
let searchQ = '';
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function viewSearch() {
  app.innerHTML = `<div class="page-head"><h1>Search</h1></div>
    <input id="q" class="search" type="search" placeholder="Cards, notes, questions…" value="${esc(searchQ)}" autocomplete="off" enterkeyhint="search">
    <div id="results"></div>`;
  const input = document.getElementById('q');
  const run = () => { searchQ = input.value; document.getElementById('results').innerHTML = searchResults(searchQ); };
  input.oninput = run;
  run();
  if (!searchQ) input.focus();
}

function searchResults(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return `<p class="hint">Searches every class, studying now or not.</p>`;
  const hit = (...parts) => { const l = parts.join(' ').toLowerCase(); return terms.every(t => l.includes(t)); };
  const re = new RegExp(terms.map(t => escRe(esc(t))).join('|'), 'gi');
  const mark = s => esc(s).replace(re, m => `<mark>${m}</mark>`);
  const snip = s => {
    s = String(s || '');
    const at = Math.max(0, Math.min(...terms.map(t => { const i = s.toLowerCase().indexOf(t); return i < 0 ? Infinity : i; })) - 50);
    return (at > 0 ? '…' : '') + s.slice(at, at + 170) + (s.length > at + 170 ? '…' : '');
  };
  const out = [];
  const add = (t, kind, html, to = 'deep') => out.push(`<a class="result-row" href="#/${to}/${encodeURIComponent(t.id)}">
      <span class="r-head"><span class="chip">${kind}</span><span class="hint">${esc(courseById(t.course)?.title || '')} · ${esc(t.title)}</span></span>
      <span class="r-body">${html}</span></a>`);
  for (const t of content.topics) {
    if (hit(t.title, t.block || '')) add(t, 'Topic', `<b>${mark(t.title)}</b>`, 'topic');
    for (const p of t.points || []) if (hit(p)) add(t, 'Key point', mark(snip(p)));
    for (const n of t.notes || []) if (hit(n.heading || '', n.text || '')) add(t, 'Notes', `${n.heading ? `<b>${mark(n.heading)}</b><br>` : ''}${mark(snip(n.text))}`);
    for (const c of allCards(t.id)) if (hit(c.front, c.back)) add(t, c.mine ? 'Your card' : 'Card', `<b>${mark(c.front)}</b><br>${mark(c.back)}`);
    for (const q of t.questions || []) if (hit(q.q, q.options.join(' '), q.explanation || '')) add(t, 'Question', `${mark(snip(q.q))}<br><span class="good-text">✓ ${mark(q.options[q.answer])}</span>`);
    if (out.length > 80) break;
  }
  return out.length ? `<p class="hint">${out.length > 80 ? 'First 80 matches' : `${out.length} match${out.length === 1 ? '' : 'es'}`}</p>${out.slice(0, 80).join('')}`
    : `<div class="card empty small-empty"><p class="hint">Nothing matches “${esc(query)}”.</p></div>`;
}

/* ---------- exam dates ---------- */
const examsAhead = () => (state.settings.exams || []).filter(e => e.date >= today()).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const daysUntil = d => Math.round((parse(d) - parse(today())) / 864e5);
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
// The last day to have a topic learned: the day before its class's next exam.
function examDeadline(t) { const e = examsAhead().find(x => x.course === t.course); return e ? addDays(e.date, -1) : null; }
const examLabel = e => `${esc(courseById(e.course)?.title || 'Exam')}${e.title ? `: ${esc(e.title)}` : ''}`;

function examsCard() {
  const list = (state.settings.exams || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const courses = [...content.courses].sort((a, b) => state.settings.courses.includes(b.id) - state.settings.courses.includes(a.id));
  return `<h2>Exams</h2>
    <div class="card">
      <p class="hint">Topics for a class with an exam coming get planned before it, and Today counts down and switches to exam prep three days out.</p>
      ${list.map(e => `<div class="exam-row ${e.date < today() ? 'past' : ''}"><span class="grow"><b>${examLabel(e)}</b><span class="hint">${pretty(e.date)}${e.date >= today() ? ` · ${inDays(daysUntil(e.date))}` : ' · done'}</span></span>
        <button class="icon-btn" data-del-exam="${esc(e.id)}" aria-label="Remove exam">×</button></div>`).join('')}
      <details class="add-exam"><summary>+ Add an exam</summary>
        <label class="field">Class<select id="exCourse">${courses.map(c => `<option value="${esc(c.id)}">${esc(c.title)}${c.term ? ` (${esc(c.term)})` : ''}</option>`).join('')}</select></label>
        <div class="two"><label class="field">Name<input id="exTitle" placeholder="Block 1"></label><label class="field">Date<input type="date" id="exDate" min="${today()}"></label></div>
        <button class="btn block secondary" id="exAdd">Add exam</button>
      </details>
    </div>`;
}
function wireExams() {
  document.getElementById('exAdd').onclick = () => {
    const date = document.getElementById('exDate').value;
    if (!date) return alert('Pick the exam date.');
    state.settings.exams.push({ id: Date.now().toString(36), course: document.getElementById('exCourse').value, title: document.getElementById('exTitle').value.trim(), date });
    rebuildPlan(); save(); viewSettings();
    document.querySelector('.add-exam')?.scrollIntoView({ block: 'center' });
  };
  app.querySelectorAll('[data-del-exam]').forEach(b => b.onclick = () => {
    state.settings.exams = state.settings.exams.filter(e => e.id !== b.dataset.delExam);
    rebuildPlan(); save(); viewSettings();
  });
}

/* ---------- Today's extra cards ---------- */
function todayExtras() {
  let h = '';
  if (exam && !exam.done) h += `<a class="card feature row" href="#/exam"><span class="grow"><b>Practice exam in progress</b><span class="hint">Question ${exam.i + 1} of ${exam.qs.length}${exam.ends ? ` · ${fmtTime(exam.ends - Date.now())} left` : ''}</span></span><span class="chev">›</span></a>`;
  const next = examsAhead().find(e => daysUntil(e.date) <= 21);
  if (next) {
    const n = daysUntil(next.date);
    h += `<div class="countdown ${n <= 3 ? 'soon' : ''}"><div class="cd-num"><b>${n}</b><span>${n === 1 ? 'day' : 'days'}</span></div>
      <div class="grow"><b>${examLabel(next)}</b><span class="hint">${n === 0 ? 'Today. Good luck!' : pretty(next.date)}</span></div></div>`;
    if (n <= 3) {
      const ts = content.topics.filter(t => t.course === next.course)
        .sort((a, b) => (tp(a.id).done ? tp(a.id).lastScore ?? 100 : -1) - (tp(b.id).done ? tp(b.id).lastScore ?? 100 : -1)).slice(0, 4);
      const weak = weakQuestions(content.topics.filter(t => t.course === next.course)).length;
      h += `<h2>Exam prep</h2><p class="hint">The ${ts.length} weakest topics in this class.</p>${ts.map(t => topicRow(t.id)).join('')}
        <div class="two"><a class="btn" href="#/practice/${encodeURIComponent(next.course)}">Timed practice</a>${weak ? `<a class="btn secondary" href="#/quiz/__weak">Weak spots (${weak})</a>` : ''}</div>`;
      return h;
    }
  }
  const weak = weakQuestions().length;
  if (weak) h += `<a class="card weak-card row" href="#/quiz/__weak"><span class="weak-num">${weak}</span><span class="grow"><b>Weak spots</b><span class="hint">Questions you've missed. Get each right twice to clear it.</span></span><span class="chev">›</span></a>`;
  return h;
}

/* ---------- stats ---------- */
const fmtMins = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
function quizName(h) {
  if (h.kind === 'exam') return 'Practice exam';
  return { __final: 'Final review', __mixed: 'Mixed quiz', __weak: 'Weak spots' }[h.id] || topicById(h.id)?.title || 'Quiz';
}

function viewStats() {
  const st = streak();
  const days = [...Array(7)].map((_, i) => addDays(today(), i - 6));
  const mins = days.map(d => Math.round((state.log[d]?.secs || 0) / 60));
  const top = Math.max(20, ...mins);
  const bars = days.map((d, i) => {
    const hgt = Math.max(mins[i] ? 4 : 0, mins[i] / top * 86);
    const x = i * 40 + 6;
    return `<rect x="${x}" y="${100 - hgt}" width="28" height="${hgt}" rx="5" class="${d === today() ? 'bar-today' : 'bar'}"/>
      ${mins[i] ? `<text x="${x + 14}" y="${94 - hgt}" class="bar-val">${mins[i]}</text>` : ''}
      <text x="${x + 14}" y="118" class="bar-lab">${parse(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</text>`;
  }).join('');
  const tot = Object.values(state.log).reduce((a, l) => ({ secs: a.secs + l.secs, cards: a.cards + l.cards, qs: a.qs + l.qs, right: a.right + l.right }), { secs: 0, cards: 0, qs: 0, right: 0 });
  const recent = state.history.slice(-20);
  const line = recent.length > 1 ? recent.map((h, i) => `${(i / (recent.length - 1) * 280).toFixed(1)},${(76 - h.pct * 0.72).toFixed(1)}`).join(' ') : '';
  const weak = weakQuestions().length;
  const classes = state.settings.courses.map(courseById).filter(Boolean).map(c => {
    const ts = content.topics.filter(t => t.course === c.id);
    const scored = ts.filter(t => tp(t.id).lastScore != null);
    const avg = scored.length ? Math.round(scored.reduce((a, t) => a + tp(t.id).lastScore, 0) / scored.length) : null;
    return `<div class="class-stat"><div class="row"><b class="grow">${esc(c.title)}</b>${avg != null ? `<span class="chip ${scoreClass(avg)}">${avg}% avg</span>` : '<span class="hint">No quizzes yet</span>'}</div>
      <div class="mini-progress"><div style="width:${ts.length ? Math.round(ts.filter(t => tp(t.id).done).length / ts.length * 100) : 0}%"></div></div>
      <span class="hint">${ts.filter(t => tp(t.id).done).length} of ${ts.length} topics done</span></div>`;
  }).join('');

  app.innerHTML = `<div class="page-head"><h1>Stats</h1></div>
    <div class="stat-hero">
      <div class="streak"><span class="flame">🔥</span><b>${st}</b><span>day streak</span></div>
      <div class="grow stat-grid">
        <div><b>${state.bestStreak || st}</b><span>best streak</span></div>
        <div><b>${fmtMins(tot.secs)}</b><span>studied</span></div>
        <div><b>${tot.cards}</b><span>cards</span></div>
        <div><b>${tot.qs ? Math.round(tot.right / tot.qs * 100) + '%' : '–'}</b><span>of ${tot.qs} right</span></div>
      </div>
    </div>
    <h2>Last 7 days <span class="hint">minutes</span></h2>
    <div class="card">${mins.some(Boolean) ? `<svg class="bars" viewBox="0 0 286 124" role="img" aria-label="Minutes studied each of the last 7 days">${bars}</svg>`
      : '<p class="hint center">Time spent on cards, quizzes and notes shows up here.</p>'}</div>
    ${line ? `<h2>Quiz scores <span class="hint">last ${recent.length}</span></h2>
      <div class="card"><svg class="trend" viewBox="-4 -4 288 88" preserveAspectRatio="none"><line x1="0" x2="280" y1="18.4" y2="18.4" class="goal"/><polyline points="${line}"/></svg>
      <p class="hint">Dashed line is 80%.</p></div>` : ''}
    ${weak ? `<a class="card weak-card row" href="#/quiz/__weak"><span class="weak-num">${weak}</span><span class="grow"><b>Weak spots</b><span class="hint">Missed questions waiting to be cleared</span></span><span class="chev">›</span></a>` : ''}
    ${classes ? `<h2>By class</h2><div class="card">${classes}</div>` : ''}
    ${state.history.length ? `<h2>Recent</h2>${state.history.slice(-6).reverse().map(h => `<div class="recent-row"><span class="grow"><b>${esc(quizName(h))}</b><span class="hint">${pretty(h.d)} · ${h.n} questions</span></span><span class="chip ${scoreClass(h.pct)}">${h.pct}%</span></div>`).join('')}` : ''}
    <a class="btn block secondary" href="#/practice">Timed practice exam</a>`;
}

/* ---------- timed practice exam ---------- */
let exam = null;
let examTimer = null;
const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let practicePick = null;

function viewPractice(courseId) {
  const withQs = content.courses.filter(c => content.topics.some(t => t.course === c.id && t.questions?.length));
  if (!practicePick || courseId) practicePick = { courses: courseId ? [courseId] : state.settings.courses.filter(id => withQs.some(c => c.id === id)), n: 20, per: 90 };
  const pk = practicePick;
  const pool = () => content.topics.filter(t => pk.courses.includes(t.course)).reduce((a, t) => a + (t.questions?.length || 0), 0);
  const seg = (name, opts, val) => `<div class="seg wide" data-seg="${name}">${opts.map(([v, l]) => `<button class="${v === val ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  app.innerHTML = `${backLink('#/today')}
    <div class="page-head"><h1>Practice exam</h1><p class="hint">Exam conditions: a clock, no answers until the end, flag questions to come back to.</p></div>
    ${exam && !exam.done ? `<a class="card feature row" href="#/exam"><span class="grow"><b>Resume the one in progress</b><span class="hint">Question ${exam.i + 1} of ${exam.qs.length}</span></span><span class="chev">›</span></a>` : ''}
    <h2>Classes</h2>
    <div class="card">${withQs.map(c => `<label class="course-pick"><input type="checkbox" value="${esc(c.id)}" ${pk.courses.includes(c.id) ? 'checked' : ''}>
      <span class="grow"><b>${esc(c.title)}</b><span class="hint">${c.term ? esc(c.term) + ' · ' : ''}${content.topics.filter(t => t.course === c.id).reduce((a, t) => a + (t.questions?.length || 0), 0)} questions</span></span></label>`).join('') || '<p class="hint">No questions yet.</p>'}</div>
    <h2>Questions</h2>${seg('n', [[10, '10'], [20, '20'], [40, '40'], [0, 'All']], pk.n)}
    <h2>Time per question</h2>${seg('per', [[60, '60 s'], [90, '90 s'], [0, 'Untimed']], pk.per)}
    <p class="hint" id="pinfo"></p>
    <button class="btn block" id="pstart">Start</button>`;
  wireBack();
  const info = () => {
    const n = Math.min(pk.n || Infinity, pool());
    document.getElementById('pinfo').textContent = n ? `${n} questions${pk.per ? ` · ${fmtTime(n * pk.per * 1000)} on the clock` : ''}` : 'Pick at least one class.';
  };
  info();
  app.querySelectorAll('.course-pick input').forEach(x => x.onchange = () => { pk.courses = [...app.querySelectorAll('.course-pick input:checked')].map(i => i.value); info(); });
  app.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => {
    pk[b.parentElement.dataset.seg] = Number(b.dataset.v);
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); info();
  });
  document.getElementById('pstart').onclick = () => {
    if (!pool()) return alert('Pick a class with questions.');
    if (exam && !exam.done && !confirm('Throw away the exam in progress?')) return;
    const qs = shuffle(content.topics.filter(t => pk.courses.includes(t.course)).flatMap(t => (t.questions || []).map(q => ({ ...q, topic: t.id }))))
      .slice(0, pk.n || undefined)
      .map(q => { const o = shuffle(q.options.map((_, i) => i)); return { ...q, options: o.map(i => q.options[i]), answer: o.indexOf(q.answer) }; });
    exam = { qs, ans: qs.map(() => null), flag: qs.map(() => false), i: 0, started: Date.now(), ends: pk.per ? Date.now() + qs.length * pk.per * 1000 : null, done: false, grid: false };
    location.hash = '#/exam';
  };
}

function viewExam() {
  if (!exam) { location.replace('#/practice'); return; }
  if (exam.done) return viewExamResult();
  const e = exam, q = e.qs[e.i];
  const answered = e.ans.filter(a => a != null).length;
  app.innerHTML = `<div class="exam-bar"><span class="timer ${e.ends && e.ends - Date.now() < 60000 ? 'low' : ''}" id="timer">${e.ends ? fmtTime(e.ends - Date.now()) : fmtTime(Date.now() - e.started)}</span>
      <button class="exam-count" id="grid">${e.i + 1} / ${e.qs.length} ▾</button>
      <button class="flag-btn ${e.flag[e.i] ? 'on' : ''}" id="flag">⚑ ${e.flag[e.i] ? 'Flagged' : 'Flag'}</button></div>
    ${e.grid ? `<div class="card qgrid">${e.qs.map((_, i) => `<button data-go="${i}" class="${[i === e.i && 'cur', e.ans[i] != null && 'ans', e.flag[i] && 'flg'].filter(Boolean).join(' ')}">${i + 1}</button>`).join('')}
      <p class="hint">${answered} answered · ${e.flag.filter(Boolean).length} flagged</p></div>` : ''}
    <div class="card question">${esc(q.q)}${pic(q.img)}</div>
    ${q.options.map((o, i) => `<button class="opt ${e.ans[e.i] === i ? 'picked' : ''}" data-i="${i}"><span class="letter">${'ABCDEFGH'[i]}</span><span>${esc(o)}</span></button>`).join('')}
    <div class="two exam-nav"><button class="btn ghost" id="prev" ${e.i === 0 ? 'disabled' : ''}>‹ Back</button>
      ${e.i + 1 < e.qs.length ? `<button class="btn" id="next">Next ›</button>` : `<button class="btn" id="finish">Finish</button>`}</div>
    ${e.i + 1 < e.qs.length ? `<button class="btn block ghost" id="finish">Finish exam</button>` : ''}`;
  const go = i => { e.i = i; viewExam(); window.scrollTo(0, 0); };
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => { e.ans[e.i] = Number(b.dataset.i); viewExam(); });
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { e.grid = false; go(Number(b.dataset.go)); });
  document.getElementById('grid').onclick = () => { e.grid = !e.grid; viewExam(); };
  document.getElementById('flag').onclick = () => { e.flag[e.i] = !e.flag[e.i]; viewExam(); };
  document.getElementById('prev').onclick = () => go(e.i - 1);
  document.getElementById('next')?.addEventListener('click', () => go(e.i + 1));
  document.getElementById('finish').onclick = () => {
    const left = e.qs.length - e.ans.filter(a => a != null).length;
    if (left && !confirm(`${left} question${left === 1 ? ' is' : 's are'} unanswered. Finish anyway?`)) return;
    finishExam();
  };
  if (!examTimer) examTimer = setInterval(() => {
    if (!exam || exam.done) { clearInterval(examTimer); examTimer = null; return; }
    if (exam.ends && Date.now() >= exam.ends) return finishExam();
    const el = document.getElementById('timer');
    if (el) { el.textContent = exam.ends ? fmtTime(exam.ends - Date.now()) : fmtTime(Date.now() - exam.started); el.classList.toggle('low', !!exam.ends && exam.ends - Date.now() < 60000); }
  }, 1000);
}

function finishExam() {
  const e = exam;
  clearInterval(examTimer); examTimer = null;
  e.done = true; e.took = Math.min(Date.now(), e.ends || Infinity) - e.started;
  e.right = 0; e.byTopic = {};
  e.qs.forEach((q, i) => {
    const ok = e.ans[i] === q.answer;
    if (ok) e.right++;
    recordAnswer(q.topic, q, ok);
    const bt = (e.byTopic[q.topic] ||= { r: 0, n: 0, missed: [] }); bt.n++;
    if (ok) bt.r++; else bt.missed.push(q.q);
  });
  for (const [tid, bt] of Object.entries(e.byTopic)) {
    const p = tp(tid);
    if (p.done && bt.r / bt.n < 0.6) p.nextReview = today();
    if (bt.missed.length) p.missed = [...new Set([...bt.missed, ...(p.missed || [])])].slice(0, 20);
  }
  e.pct = Math.round(e.right / e.qs.length * 100);
  logQuiz('exam', '__exam', e.pct, e.qs.length);
  save();
  if (document.body.dataset.view === 'exam') viewExamResult();
}

function viewExamResult() {
  const e = exam;
  const topics = Object.entries(e.byTopic).sort((a, b) => a[1].r / a[1].n - b[1].r / b[1].n);
  const wrong = e.qs.map((q, i) => ({ q, a: e.ans[i] })).filter(x => x.a !== x.q.answer);
  app.innerHTML = `<div class="card result ${scoreClass(e.pct)}"><p class="eyebrow">Practice exam</p><div class="score">${e.pct}%</div>
      <p><b>${e.right} of ${e.qs.length} correct</b></p><p class="hint">Took ${fmtTime(e.took)}${e.ends && e.took >= e.ends - e.started ? ' (time ran out)' : ''} · ${fmtTime(e.took / e.qs.length)} per question</p></div>
    <h2>By topic</h2>
    ${topics.map(([tid, bt]) => topicRow(tid, { tag: `<span class="chip ${scoreClass(bt.r / bt.n * 100)}">${bt.r}/${bt.n}</span>` })).join('')}
    ${wrong.length ? `<h2>What you missed <span class="count">${wrong.length}</span></h2>` + wrong.map(({ q, a }) => `<details class="card worked miss">
      <summary>${esc(q.q)}</summary>
      <p class="wa">✓ ${esc(q.options[q.answer])}</p>
      <p class="hint">${a == null ? 'You left this blank.' : `You picked: ${esc(q.options[a])}`}</p>
      ${q.explanation ? `<p class="hint">${esc(q.explanation)}</p>` : ''}</details>`).join('') : ''}
    <a class="btn block" href="#/practice" id="newExam">New practice exam</a>
    <a class="btn block ghost" href="#/today">Back to today</a>`;
  document.getElementById('newExam').onclick = () => { exam = null; };
}

/* ---------- install, share, first run ---------- */
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; document.querySelectorAll('.install-btn').forEach(b => { b.hidden = false; }); });
addEventListener('appinstalled', () => { installPrompt = null; document.querySelectorAll('.install-btn').forEach(b => { b.hidden = true; }); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isSamsung = /SamsungBrowser/.test(navigator.userAgent);

function installCard() {
  if (standalone()) return '';
  const how = isIOS ? 'In Safari, tap Share, then <b>Add to Home Screen</b>.'
    : isSamsung ? 'Tap the menu (☰), then <b>Add page to</b> › <b>Home screen</b>.'
    : 'In Chrome, tap ⋮, then <b>Install app</b> (or <b>Add to Home screen</b>).';
  return `<div class="card install"><b>Put it on your home screen</b><p class="hint">It opens like an app and works with no signal. ${how}</p>
    <button class="btn block install-btn" ${installPrompt ? '' : 'hidden'}>Install app</button></div>`;
}
function wireInstall() {
  app.querySelectorAll('.install-btn').forEach(b => b.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null; b.hidden = true;
  });
}

function shareCard() {
  return `<h2>Share</h2><div class="card"><p class="hint">Send the app to a friend. Their progress stays on their own phone.</p>
    <button class="btn block secondary" id="share">Share with a friend</button></div>`;
}
function wireShare() {
  document.getElementById('share').onclick = async () => {
    const url = location.origin + location.pathname;
    const data = { title: 'Study with Gabi', text: 'The study app I use: a daily plan, flashcards and quizzes for our classes.', url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); alert('Link copied.'); }
    } catch (err) { if (err.name !== 'AbortError') prompt('Copy this link:', url); }
  };
}

// First launch: pick classes, dates and days off before anything else.
function viewWelcome() {
  const st = state.settings;
  const terms = [...new Set(content.courses.map(c => c.term || ''))];
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  app.innerHTML = `<div class="welcome-hero"><img src="icon-192.png" alt="" width="64" height="64"><h1>Welcome</h1>
      <p>A daily plan, flashcards and quizzes, worked out for you. Set it up in a minute.</p></div>
    <h2>Your name <span class="hint">optional</span></h2>
    <div class="card"><input id="wName" class="text-in" placeholder="For the greeting" value="${esc(st.name || '')}" autocomplete="given-name"></div>
    ${content.courses.length > 1 ? `<h2>Your classes</h2><div class="card">
      ${terms.map(term => `<div class="term-group">${term ? `<div class="term-row"><b class="grow">${esc(term)}</b></div>` : ''}
        ${content.courses.filter(c => (c.term || '') === term).map(c => `<label class="course-pick"><input type="checkbox" value="${esc(c.id)}" ${st.courses.includes(c.id) ? 'checked' : ''}>
          <span class="grow"><b>${esc(c.title)}</b><span class="hint">${content.topics.filter(t => t.course === c.id).length} topics</span></span></label>`).join('')}</div>`).join('')}</div>` : ''}
    <h2>Study dates</h2>
    <div class="card"><div class="two"><label class="field">Starts<input type="date" id="wStart" value="${st.start}"></label><label class="field">Ends<input type="date" id="wEnd" value="${st.end}"></label></div>
      <div class="field">Days off<div class="days">${names.map((n, i) => `<label><input type="checkbox" value="${i}" ${st.offDays.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div></div>
    ${installCard()}
    <button class="btn block big-btn" id="wGo">Build my plan</button>
    <p class="hint center">You can change all of this later in Settings.</p>`;
  wireInstall();
  document.getElementById('wGo').onclick = () => {
    const start = document.getElementById('wStart').value, end = document.getElementById('wEnd').value;
    if (!start || !end || end < start) return alert('The end date needs to be on or after the start date.');
    const offDays = [...app.querySelectorAll('.days input:checked')].map(x => Number(x.value));
    if (offDays.length === 7) return alert('Leave at least one study day.');
    const picks = [...app.querySelectorAll('.course-pick input:checked')].map(x => x.value);
    if (content.courses.length > 1 && !picks.length) return alert('Pick at least one class.');
    Object.assign(st, { name: document.getElementById('wName').value.trim(), start, end, offDays, courses: content.courses.length > 1 ? picks : st.courses });
    state.onboarded = true;
    rebuildPlan(); save(); precacheImages();
    location.hash = '#/today';
  };
}
