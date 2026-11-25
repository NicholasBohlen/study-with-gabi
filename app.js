// Study with Gabi: daily plan + flashcards + quizzes, all from content.json.
// Progress is stored on the device (localStorage). No accounts, no server.
'use strict';

const STATE_KEY = 'study-with-gabi:state';
const app = document.getElementById('app');
let content = null;   // loaded content.json
let state = null;     // saved progress
let session = null;   // in-progress flashcard or quiz run (memory only)

/* ---------- dates (local time, YYYY-MM-DD) ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const pretty = s => parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const topicById = id => content.topics.find(t => t.id === id);
const tp = id => (state.topics[id] ||= { done: false, attempts: 0, lastScore: null, bestScore: null, completedOn: null, nextReview: null });
const save = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { alert('Could not save progress: ' + e.message); } };

/* ---------- state ---------- */
function defaultSettings() {
  const s = content.defaults || {};
  return {
    start: s.start || today(),
    end: s.end || addDays(today(), 20),
    offDays: s.offDays || [],          // 0=Sun … 6=Sat
    finalReview: s.finalReview !== false
  };
}

function loadState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { /* ignore */ }
  if (saved && saved.contentId === content.id) {
    state = saved;
  } else {
    // New content set (new semester) or first launch: start fresh.
    state = { contentId: content.id, settings: defaultSettings(), plan: {}, topics: {} };
  }
  // Make sure every topic in content.json is on the plan (handles new topics added mid-break).
  const planned = new Set(Object.values(state.plan).flat());
  if (content.topics.some(t => !planned.has(t.id))) rebuildPlan();
  save();
}

function studyDays() {
  const { start, end, offDays } = state.settings;
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (!offDays.includes(parse(d).getDay())) days.push(d);
  return days;
}

function finalDay() {
  const days = studyDays();
  return state.settings.finalReview && days.length >= 5 ? days[days.length - 1] : null;
}

// Keeps finished topics where they were, spreads unfinished ones over the remaining days.
function rebuildPlan() {
  const plan = {};
  const done = content.topics.filter(t => tp(t.id).done);
  const todo = content.topics.filter(t => !tp(t.id).done);
  for (const t of done) (plan[tp(t.id).completedOn || state.settings.start] ||= []).push(t.id);

  const fd = finalDay();
  const from = today() > state.settings.start ? today() : state.settings.start;
  let days = studyDays().filter(d => d >= from && d !== fd);
  if (!days.length) days = [from];
  todo.forEach((t, i) => {
    const d = days[Math.floor(i * days.length / todo.length)];
    (plan[d] ||= []).push(t.id);
  });
  state.plan = plan;
}

function plannedDate(id) {
  for (const [d, ids] of Object.entries(state.plan)) if (ids.includes(id)) return d;
  return null;
}

/* ---------- what's due today ---------- */
function dueToday() {
  const t = today();
  const firstDay = studyDays()[0] || state.settings.start;
  const horizon = t < firstDay ? firstDay : t;   // before break starts: show day 1 as a head start
  const fresh = [];
  for (const [d, ids] of Object.entries(state.plan).sort()) {
    if (d > horizon) continue;
    for (const id of ids) if (!tp(id).done && topicById(id)) fresh.push({ id, carried: d < t && t >= firstDay });
  }
  const reviews = content.topics
    .filter(x => tp(x.id).done && tp(x.id).nextReview && tp(x.id).nextReview <= t)
    .sort((a, b) => (tp(a.id).lastScore ?? 0) - (tp(b.id).lastScore ?? 0))
    .slice(0, 3)
    .map(x => x.id);
  return { fresh, reviews, preview: t < firstDay };
}

// Score-based spacing: weak topics come back sooner.
function scheduleReview(id, pct) {
  const gap = pct < 60 ? 1 : pct < 80 ? 3 : 7;
  tp(id).nextReview = addDays(today(), gap);
}

/* ---------- views ---------- */
function viewToday() {
  const { fresh, reviews, preview } = dueToday();
  const total = content.topics.length;
  const doneCount = content.topics.filter(t => tp(t.id).done).length;
  const days = studyDays();
  const idx = days.indexOf(today());
  const fd = finalDay();
  let h = `<h1>${pretty(today())}</h1>
    <p class="muted">${idx >= 0 ? `Study day ${idx + 1} of ${days.length}` : preview ? `Break starts ${pretty(days[0] || state.settings.start)}` : today() > state.settings.end ? 'Break is over. Nice work.' : 'Day off'}</p>
    <div class="progress"><div style="width:${total ? Math.round(doneCount / total * 100) : 0}%"></div></div>
    <p class="small muted">${doneCount} of ${total} topics done</p>`;

  if (preview && fresh.length) h += `<div class="card"><b>Head start.</b> <span class="muted">Here's day 1 if you want to get going early.</span></div>`;

  if (fresh.length) {
    h += `<h2>Today's topics</h2>`;
    h += fresh.map(({ id, carried }) => topicRow(id, carried ? '<span class="tag warn">Carried over</span>' : '')).join('');
  }
  if (reviews.length) {
    h += `<h2>Review</h2><p class="small muted">Topics due for another look, weakest first.</p>`;
    h += reviews.map(id => topicRow(id, `<span class="tag ${tp(id).lastScore < 60 ? 'bad' : 'warn'}">Last: ${tp(id).lastScore}%</span>`, true)).join('');
  }
  if (fd === today() || (today() > (fd || '9999') && doneCount === total)) {
    h += `<h2>Final review</h2><div class="card"><p>Mixed quiz across everything, weighted toward topics you scored lowest on.</p>
      <a class="btn block" href="#/quiz/__final">Start final review</a></div>`;
  }
  if (!fresh.length && !reviews.length && fd !== today()) {
    h += `<div class="card center"><p class="big">✓</p><p>Nothing due today.</p>
      <a class="btn secondary" href="#/quiz/__mixed">Quick mixed quiz</a></div>`;
  }
  app.innerHTML = h;
}

function topicRow(id, extra = '', review = false) {
  const t = topicById(id);
  return `<a class="card row" href="#/topic/${encodeURIComponent(id)}${review ? '?review=1' : ''}">
    <div class="grow"><div><b>${esc(t.title)}</b></div>
      <div class="small muted">${t.block ? `<span class="tag">${esc(t.block)}</span>` : ''}${extra}
      ${t.cards?.length || 0} cards · ${t.questions?.length || 0} questions</div></div>
    <span class="muted">›</span></a>`;
}

function viewTopic(id) {
  const t = topicById(id);
  if (!t) return notFound();
  const p = tp(id);
  app.innerHTML = `<a href="#/today" class="small">‹ Today</a>
    <h1>${esc(t.title)}</h1>
    <p class="small muted">${t.block ? `<span class="tag">${esc(t.block)}</span>` : ''}${t.source ? esc(t.source) : ''}</p>
    ${p.done ? `<p><span class="tag good">Done</span> <span class="small muted">Best ${p.bestScore}% · last ${p.lastScore}%</span></p>` : ''}
    ${t.points?.length ? `<div class="card"><b>Key points</b><ul class="points">${t.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <p class="small muted">Read the key points, run the flashcards, then take the quiz. The quiz score decides when this topic comes back for review.</p>
    <a class="btn block" href="#/cards/${encodeURIComponent(id)}" ${t.cards?.length ? '' : 'hidden'}>1. Flashcards (${t.cards?.length || 0})</a>
    <a class="btn block secondary" href="#/quiz/${encodeURIComponent(id)}" ${t.questions?.length ? '' : 'hidden'}>2. Quiz (${t.questions?.length || 0})</a>
    ${!t.questions?.length && !p.done ? `<button class="btn block ghost" id="markdone">Mark done</button>` : ''}`;
  document.getElementById('markdone')?.addEventListener('click', () => {
    Object.assign(p, { done: true, completedOn: p.completedOn || today() }); scheduleReview(id, 80); save(); location.hash = '#/today';
  });
}

/* ---------- flashcards ---------- */
function viewCards(id) {
  const t = topicById(id);
  if (!t) return notFound();
  if (!session || session.kind !== 'cards' || session.id !== id) {
    session = { kind: 'cards', id, queue: shuffle(t.cards), flipped: false, seen: 0, again: 0 };
  }
  const s = session;
  if (!s.queue.length) {
    app.innerHTML = `<h1>Cards done</h1>
      <p class="muted">${s.again ? `You missed ${s.again} along the way and went back over them.` : 'Clean run.'}</p>
      <a class="btn block" href="#/quiz/${encodeURIComponent(id)}">Take the quiz</a>
      <button class="btn block ghost" id="again">Run cards again</button>`;
    document.getElementById('again').onclick = () => { session = null; viewCards(id); };
    return;
  }
  const c = s.queue[0];
  app.innerHTML = `<a href="#/topic/${encodeURIComponent(id)}" class="small">‹ ${esc(t.title)}</a>
    <p class="small muted">${s.queue.length} left</p>
    <div class="card flash ${s.flipped ? 'back' : ''}" id="flip">
      <div class="side">${s.flipped ? 'Answer' : 'Tap to flip'}</div>
      <div>${esc(s.flipped ? c.back : c.front)}</div>
    </div>
    ${s.flipped
      ? `<div class="two"><button class="btn bad" id="no">Again</button><button class="btn good" id="yes">Got it</button></div>`
      : `<button class="btn block secondary" id="show">Show answer</button>`}`;
  const flip = () => { s.flipped = !s.flipped; viewCards(id); };
  document.getElementById('flip').onclick = flip;
  document.getElementById('show')?.addEventListener('click', flip);
  document.getElementById('yes')?.addEventListener('click', () => { s.queue.shift(); s.flipped = false; viewCards(id); });
  document.getElementById('no')?.addEventListener('click', () => {
    const card = s.queue.shift(); s.again++;
    s.queue.splice(Math.min(3, s.queue.length), 0, card);   // comes back a few cards later
    s.flipped = false; viewCards(id);
  });
}

/* ---------- quizzes ---------- */
function buildQuestions(id) {
  if (id === '__final' || id === '__mixed') {
    const n = id === '__final' ? 25 : 10;
    // Weight toward weak topics: each question appears once, plus extra copies for low scorers.
    const pool = [];
    for (const t of content.topics) for (const q of t.questions || []) {
      const sc = tp(t.id).lastScore;
      const w = sc == null ? 2 : sc < 60 ? 3 : sc < 80 ? 2 : 1;
      for (let i = 0; i < w; i++) pool.push({ ...q, topic: t.id });
    }
    const seen = new Set(); const out = [];
    for (const q of shuffle(pool)) { if (!seen.has(q.q)) { seen.add(q.q); out.push(q); } if (out.length >= n) break; }
    return out;
  }
  return shuffle(topicById(id).questions.map(q => ({ ...q, topic: id })));
}

function viewQuiz(id) {
  const special = id === '__final' || id === '__mixed';
  if (!special && !topicById(id)) return notFound();
  if (!session || session.kind !== 'quiz' || session.id !== id) {
    const qs = buildQuestions(id).map(q => {
      const order = shuffle(q.options.map((_, i) => i));
      return { ...q, options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
    });
    session = { kind: 'quiz', id, qs, i: 0, picked: null, right: 0, byTopic: {} };
  }
  const s = session;
  const title = id === '__final' ? 'Final review' : id === '__mixed' ? 'Mixed quiz' : topicById(id).title;
  if (!s.qs.length) { app.innerHTML = `<p>No questions yet.</p>`; return; }
  if (s.i >= s.qs.length) return quizResult(id, title);

  const q = s.qs[s.i];
  const answered = s.picked !== null;
  app.innerHTML = `<a href="${special ? '#/today' : '#/topic/' + encodeURIComponent(id)}" class="small">‹ ${esc(title)}</a>
    <p class="small muted">Question ${s.i + 1} of ${s.qs.length}${special ? ` · ${esc(topicById(q.topic).title)}` : ''}</p>
    <div class="card"><b>${esc(q.q)}</b></div>
    ${q.options.map((o, i) => {
      let cls = 'opt';
      if (answered && i === q.answer) cls += ' correct';
      else if (answered && i === s.picked) cls += ' wrong';
      return `<button class="${cls}" data-i="${i}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('')}
    ${answered ? `<div class="card explain"><b>${s.picked === q.answer ? 'Correct.' : 'Not quite.'}</b> ${esc(q.explanation || '')}</div>
      <button class="btn block" id="next">${s.i + 1 < s.qs.length ? 'Next' : 'See score'}</button>` : ''}`;
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    s.picked = Number(b.dataset.i);
    const ok = s.picked === q.answer;
    if (ok) s.right++;
    const bt = (s.byTopic[q.topic] ||= { r: 0, n: 0 }); bt.n++; if (ok) bt.r++;
    viewQuiz(id);
  });
  document.getElementById('next')?.addEventListener('click', () => { s.i++; s.picked = null; viewQuiz(id); window.scrollTo(0, 0); });
}

function quizResult(id, title) {
  const s = session;
  const pct = Math.round(s.right / s.qs.length * 100);
  if (!s.recorded) {
    s.recorded = true;
    if (id === '__final' || id === '__mixed') {
      // Mixed quizzes nudge each topic's review timing based on how that topic went.
      for (const [tid, { r, n }] of Object.entries(s.byTopic)) {
        const p = tp(tid); const tpct = Math.round(r / n * 100);
        if (p.done && tpct < 60) p.nextReview = today();
      }
    } else {
      const p = tp(id);
      p.attempts++; p.lastScore = pct; p.bestScore = Math.max(p.bestScore ?? 0, pct);
      if (!p.done) { p.done = true; p.completedOn = today(); }
      scheduleReview(id, pct);
    }
    save();
  }
  const next = id.startsWith('__') ? null : tp(id).nextReview;
  app.innerHTML = `<h1>${esc(title)}</h1>
    <div class="card center"><div class="big">${pct}%</div><p class="muted">${s.right} of ${s.qs.length} correct</p>
    ${next ? `<p class="small">This topic comes back for review ${next === addDays(today(), 1) ? 'tomorrow' : 'on ' + pretty(next)}.</p>` : ''}</div>
    <a class="btn block" href="#/today">Back to today</a>
    <button class="btn block ghost" id="retry">Retake quiz</button>`;
  document.getElementById('retry').onclick = () => { session = null; viewQuiz(id); };
}

/* ---------- plan ---------- */
function viewPlan() {
  const fd = finalDay();
  const days = studyDays();
  const t = today();
  let h = `<h1>Break plan</h1><p class="muted small">${pretty(state.settings.start)} to ${pretty(state.settings.end)} · ${content.topics.length} topics over ${days.length} study days</p>`;
  for (const d of days) {
    const ids = (state.plan[d] || []).filter(topicById);
    if (!ids.length && d !== fd) continue;
    h += `<div class="card day ${d === t ? 'today' : ''}"><div class="row"><b class="grow">${pretty(d)}</b>${d === t ? '<span class="tag">Today</span>' : ''}</div>`;
    for (const id of ids) {
      const p = tp(id);
      h += `<a class="topic" href="#/topic/${encodeURIComponent(id)}"><span>${esc(topicById(id).title)}</span>
        <span>${p.done ? `<span class="tag ${p.lastScore < 60 ? 'bad' : 'good'}">${p.lastScore ?? '✓'}${p.lastScore != null ? '%' : ''}</span>` : d < t ? '<span class="tag warn">Behind</span>' : ''}</span></a>`;
    }
    if (d === fd) h += `<a class="topic" href="#/quiz/__final"><span><b>Final mixed review</b></span><span></span></a>`;
    h += `</div>`;
  }
  // Topics finished on a day off or outside the window still show.
  const shown = new Set(days.flatMap(d => state.plan[d] || []));
  const extra = Object.entries(state.plan).filter(([d]) => !days.includes(d)).flatMap(([, ids]) => ids).filter(id => !shown.has(id) && topicById(id));
  if (extra.length) h += `<h2>Also done</h2>` + extra.map(id => topicRow(id)).join('');
  h += `<a class="btn block secondary" href="#/quiz/__mixed">Quick mixed quiz</a>`;
  app.innerHTML = h;
}

/* ---------- settings ---------- */
function viewSettings() {
  const st = state.settings;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  app.innerHTML = `<h1>Settings</h1>
    <div class="card">
      <label class="field">Break starts<input type="date" id="start" value="${st.start}"></label>
      <label class="field">Break ends<input type="date" id="end" value="${st.end}"></label>
      <div class="field" style="font-weight:600">Days off
        <div class="days">${names.map((n, i) => `<label><input type="checkbox" value="${i}" ${st.offDays.includes(i) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      </div>
      <label class="field" style="font-weight:500"><input type="checkbox" id="final" ${st.finalReview ? 'checked' : ''}> Save the last study day for a mixed final review</label>
      <button class="btn block" id="saveSettings">Save and rebuild plan</button>
      <p class="small muted">Rebuilding keeps finished topics and spreads the rest over the days left.</p>
    </div>
    <h2>Backup</h2>
    <div class="card">
      <p class="small muted">Progress lives on this device only. Export a backup to move it to another phone or keep it safe.</p>
      <button class="btn block secondary" id="export">Export progress</button>
      <label class="btn block ghost">Import progress<input type="file" id="import" accept="application/json" hidden></label>
      <button class="btn block ghost" id="reset" style="color:var(--bad)">Reset all progress</button>
    </div>
    <p class="small muted center">${esc(content.title)} · ${content.topics.length} topics</p>`;

  document.getElementById('saveSettings').onclick = () => {
    const start = document.getElementById('start').value, end = document.getElementById('end').value;
    if (!start || !end || end < start) return alert('End date needs to be on or after the start date.');
    st.start = start; st.end = end;
    st.offDays = [...app.querySelectorAll('.days input:checked')].map(x => Number(x.value));
    if (st.offDays.length === 7) return alert('Leave at least one study day.');
    st.finalReview = document.getElementById('final').checked;
    rebuildPlan(); save(); location.hash = '#/plan';
  };
  document.getElementById('export').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `study-with-gabi-progress-${today()}.json`; a.click();
  };
  document.getElementById('import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.settings || !data.topics) throw new Error('Not a progress file');
      if (data.contentId !== content.id && !confirm('This backup is from a different content set. Import anyway?')) return;
      state = { ...data, contentId: content.id }; rebuildPlan(); save(); location.hash = '#/today';
    } catch (err) { alert('Could not import: ' + err.message); }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('Erase all progress on this device? This cannot be undone.')) return;
    localStorage.removeItem(STATE_KEY); session = null; loadState(); location.hash = '#/today';
  };
}

function notFound() { app.innerHTML = `<p>That page doesn't exist.</p><a class="btn" href="#/today">Go to today</a>`; }

/* ---------- router ---------- */
function route() {
  const [path] = location.hash.slice(2).split('?');
  const [view, raw] = path.split('/');
  const id = raw ? decodeURIComponent(raw) : null;
  if (!['cards', 'quiz'].includes(view)) session = null;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === (view || 'today')));
  ({ today: viewToday, plan: viewPlan, settings: viewSettings, topic: () => viewTopic(id), cards: () => viewCards(id), quiz: () => viewQuiz(id) }[view || 'today'] || viewToday)();
  window.scrollTo(0, 0);
}

/* ---------- boot ---------- */
async function boot() {
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    content = await res.json();
  } catch (e) {
    app.innerHTML = `<p>Couldn't load study content. Open the app once with internet so it can save a copy for offline use.</p>`;
    return;
  }
  loadState();
  window.addEventListener('hashchange', route);
  route();
}

const setOffline = () => { document.getElementById('offline').hidden = navigator.onLine; };
window.addEventListener('online', setOffline); window.addEventListener('offline', setOffline); setOffline();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
