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

/* ---------- shared bits for the views ---------- */
const PALETTE = ['#3b7dd8', '#d9485f', '#1f9d74', '#d98a1c', '#7a5bd6', '#1a9bb5', '#c94f9a', '#6b9a2a'];
function blockColor(block) {
  const blocks = [...new Set(content.topics.map(t => t.block || 'Other'))];
  return PALETTE[Math.max(0, blocks.indexOf(block || 'Other')) % PALETTE.length];
}
const scoreClass = s => s == null ? 'good' : s < 60 ? 'bad' : s < 80 ? 'warn' : 'good';
const shortDay = s => parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDay = s => parse(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const reviewsOn = d => content.topics.filter(t => tp(t.id).done && tp(t.id).nextReview === d).map(t => t.id);

// Back link: goes back if we came from inside the app, otherwise to the fallback page.
let navDepth = 0;
const backLink = (fallback, label = 'Back') => `<a class="back" href="${fallback}" data-back>‹ ${esc(label)}</a>`;
function wireBack() {
  app.querySelector('[data-back]')?.addEventListener('click', e => { if (navDepth > 1) { e.preventDefault(); history.back(); } });
}

function ring(pct, label) {
  const r = 30, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="${r}" class="ring-bg"/>
      <circle cx="36" cy="36" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
    </svg><div class="ring-text"><b>${pct}%</b><span>${label}</span></div></div>`;
}

function topicRow(id, { tag = '', review = false } = {}) {
  const t = topicById(id);
  const p = tp(id);
  const right = p.done && p.lastScore != null && !review
    ? `<span class="chip ${scoreClass(p.lastScore)}">${p.lastScore}%</span>`
    : p.done && !review ? `<span class="chip good">✓</span>` : `<span class="chev">›</span>`;
  return `<a class="topic-row" style="--c:${blockColor(t.block)}" href="#/topic/${encodeURIComponent(id)}${review ? '?review=1' : ''}">
    <span class="bar"></span>
    <span class="grow">
      <span class="t-title">${esc(t.title)}</span>
      <span class="t-meta">${t.block ? `<span class="block-name">${esc(t.block)}</span>` : ''}${tag}
        <span>${t.cards?.length || 0} cards · ${t.questions?.length || 0} questions</span></span>
    </span>${right}</a>`;
}

// Status of one calendar day, shared by the week strip and the month grid.
function dayInfo(d) {
  const st = state.settings;
  const inBreak = d >= st.start && d <= st.end;
  const off = st.offDays.includes(parse(d).getDay());
  const ids = (state.plan[d] || []).filter(topicById);
  const t = today();
  const dots = ids.map(id => {
    const p = tp(id);
    return { color: blockColor(topicById(id).block), cls: p.done ? 'done' : d < t ? 'missed' : 'todo' };
  });
  return { inBreak, off, ids, dots, final: d === finalDay(), reviews: d >= t ? reviewsOn(d) : [] };
}

function dotsHtml(info, max = 4) {
  const dots = info.dots.slice(0, max).map(x => `<i class="dot ${x.cls}" style="--c:${x.color}"></i>`).join('');
  const more = info.dots.length > max ? `<i class="more">+${info.dots.length - max}</i>` : '';
  const extra = (info.final ? '<i class="dot star">★</i>' : '') + (info.reviews.length && !info.dots.length ? '<i class="dot review"></i>' : '');
  return `<span class="dots">${dots}${more}${extra}</span>`;
}

/* ---------- today ---------- */
function weekStrip() {
  const t = today();
  const start = addDays(t, -parse(t).getDay());
  let h = '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const info = dayInfo(d);
    h += `<a href="#/calendar/${d}" class="wd ${d === t ? 'is-today' : ''} ${!info.inBreak || info.off ? 'is-off' : ''}">
      <span class="wd-name">${parse(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
      <span class="wd-num">${parse(d).getDate()}</span>${dotsHtml(info, 3)}</a>`;
  }
  return h + '</div>';
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function viewToday() {
  const { fresh, reviews, preview } = dueToday();
  const total = content.topics.length;
  const doneCount = content.topics.filter(t => tp(t.id).done).length;
  const pct = total ? Math.round(doneCount / total * 100) : 0;
  const days = studyDays();
  const idx = days.indexOf(today());
  const fd = finalDay();
  const status = idx >= 0 ? `Study day ${idx + 1} of ${days.length}`
    : preview ? `Break starts ${pretty(days[0] || state.settings.start)}`
    : today() > state.settings.end ? 'Break is over. Nice work.' : 'Day off. Rest up.';

  let h = `<section class="hero">
      <div class="grow"><p class="eyebrow">${longDay(today())}</p><h1>${greeting()}</h1><p class="hero-sub">${status}</p></div>
      ${ring(pct, `${doneCount}/${total}`)}
    </section>
    ${weekStrip()}`;

  if (preview && fresh.length) h += `<div class="note">Head start: here's day 1 if you want to get going early.</div>`;

  if (fresh.length) {
    h += `<h2>Today's topics <span class="count">${fresh.length}</span></h2>`;
    h += fresh.map(({ id, carried }) => topicRow(id, { tag: carried ? '<span class="chip warn">Carried over</span>' : '' })).join('');
  }
  if (reviews.length) {
    h += `<h2>Review <span class="count">${reviews.length}</span></h2><p class="hint">Due for another look, weakest first.</p>`;
    h += reviews.map(id => topicRow(id, { review: true, tag: `<span class="chip ${scoreClass(tp(id).lastScore)}">Last ${tp(id).lastScore}%</span>` })).join('');
  }
  if (fd === today() || (today() > (fd || '9999') && doneCount === total)) {
    h += `<h2>Final review</h2><div class="card feature"><p>A mixed quiz across everything, weighted toward the topics you scored lowest on.</p>
      <a class="btn block" href="#/quiz/__final">Start final review</a></div>`;
  }
  if (!fresh.length && !reviews.length && fd !== today()) {
    h += `<div class="card empty"><div class="empty-icon">✓</div><p><b>Nothing due today.</b></p>
      <p class="hint">Want to keep it fresh?</p><a class="btn secondary" href="#/quiz/__mixed">Quick mixed quiz</a></div>`;
  }
  app.innerHTML = h;
}

/* ---------- calendar ---------- */
function viewCalendar(sel) {
  const t = today();
  if (!sel || !/^\d{4}-\d{2}-\d{2}$/.test(sel)) sel = t < state.settings.start ? state.settings.start : t;
  const sd = parse(sel);
  const first = new Date(sd.getFullYear(), sd.getMonth(), 1);
  const prev = iso(new Date(sd.getFullYear(), sd.getMonth() - 1, 1));
  const next = iso(new Date(sd.getFullYear(), sd.getMonth() + 1, 1));
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const names = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2026, 1, i + 1).toLocaleDateString(undefined, { weekday: 'narrow' })); // Feb 1 2026 is a Sunday

  let grid = names.map(n => `<span class="cal-head">${n}</span>`).join('');
  for (let i = 0; i < first.getDay(); i++) grid += '<span></span>';
  for (let d = iso(first); parse(d).getMonth() === first.getMonth(); d = addDays(d, 1)) {
    const info = dayInfo(d);
    const cls = ['cal-day', d === t && 'is-today', d === sel && 'is-sel', (!info.inBreak || info.off) && 'is-off'].filter(Boolean).join(' ');
    grid += `<a href="#/calendar/${d}" class="${cls}"><span class="num">${parse(d).getDate()}</span>${dotsHtml(info, 3)}</a>`;
  }

  const done = content.topics.filter(x => tp(x.id).done).length;
  let h = `<div class="page-head"><h1>Calendar</h1><p class="hint">${shortDay(state.settings.start)} to ${shortDay(state.settings.end)} · ${content.topics.length} topics over ${studyDays().length} study days · ${done} done</p></div>
    <div class="card cal">
      <div class="cal-nav"><a href="#/calendar/${prev}" aria-label="Previous month">‹</a><b>${monthName}</b><a href="#/calendar/${next}" aria-label="Next month">›</a></div>
      <div class="cal-grid">${grid}</div>
      <div class="legend"><span><i class="dot todo" style="--c:var(--muted)"></i>Planned</span><span><i class="dot done" style="--c:var(--muted)"></i>Done</span><span><i class="dot missed" style="--c:var(--muted)"></i>Behind</span><span><i class="dot review"></i>Review</span><span><i class="dot star">★</i>Final</span></div>
    </div>`;

  // The picked day's agenda
  const info = dayInfo(sel);
  const days = studyDays();
  const n = days.indexOf(sel);
  const label = !info.inBreak ? 'Outside the break' : info.off ? 'Day off' : `Study day ${n + 1} of ${days.length}`;
  h += `<h2 class="agenda-head">${sel === t ? 'Today · ' : ''}${longDay(sel)}</h2><p class="hint">${label}</p>`;
  if (info.ids.length) h += info.ids.map(id => topicRow(id, { tag: !tp(id).done && sel < t ? '<span class="chip warn">Behind</span>' : '' })).join('');
  if (info.reviews.length) h += `<h3>Reviews due</h3>` + info.reviews.map(id => topicRow(id, { review: true, tag: `<span class="chip ${scoreClass(tp(id).lastScore)}">Last ${tp(id).lastScore}%</span>` })).join('');
  if (info.final) h += `<a class="card feature row" href="#/quiz/__final"><span class="grow"><b>★ Final mixed review</b><br><span class="hint">Everything, weighted toward weak spots</span></span><span class="chev">›</span></a>`;
  if (!info.ids.length && !info.reviews.length && !info.final) h += `<div class="card empty small-empty"><p class="hint">Nothing planned.</p></div>`;
  app.innerHTML = h;
}

/* ---------- topics (all, by block) ---------- */
function viewTopics() {
  const groups = {};
  for (const t of content.topics) (groups[t.block || 'Other'] ||= []).push(t.id);
  let h = `<div class="page-head"><h1>Topics</h1><p class="hint">Everything in this set, grouped by block.</p></div>`;
  for (const [block, ids] of Object.entries(groups)) {
    const done = ids.filter(id => tp(id).done).length;
    h += `<div class="block-head" style="--c:${blockColor(block)}"><span class="swatch"></span><b class="grow">${esc(block)}</b>
      <span class="hint">${done}/${ids.length}</span></div>
      <div class="mini-progress" style="--c:${blockColor(block)}"><div style="width:${Math.round(done / ids.length * 100)}%"></div></div>`;
    h += ids.map(id => {
      const d = plannedDate(id);
      const p = tp(id);
      const when = p.done ? (p.nextReview ? `Review ${p.nextReview <= today() ? 'due' : shortDay(p.nextReview)}` : '') : d ? `Planned ${shortDay(d)}` : '';
      return topicRow(id, { tag: when ? `<span>${when}</span> · ` : '' });
    }).join('');
  }
  h += `<a class="btn block secondary" href="#/quiz/__mixed">Quick mixed quiz</a>`;
  app.innerHTML = h;
}

/* ---------- one topic ---------- */
function viewTopic(id) {
  const t = topicById(id);
  if (!t) return notFound();
  const p = tp(id);
  const color = blockColor(t.block);
  app.innerHTML = `${backLink('#/today')}
    <div class="topic-head" style="--c:${color}">
      <p class="eyebrow">${t.block ? esc(t.block) : ''}${t.source ? ` · ${esc(t.source)}` : ''}</p>
      <h1>${esc(t.title)}</h1>
      ${p.done ? `<p><span class="chip good">Done</span> <span class="hint">Best ${p.bestScore ?? '–'}% · last ${p.lastScore ?? '–'}%${p.nextReview ? ` · review ${p.nextReview <= today() ? 'due now' : shortDay(p.nextReview)}` : ''}</span></p>` : ''}
    </div>
    ${t.points?.length ? `<div class="card"><h3 class="card-title">Key points</h3><ul class="points">${t.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="steps">
      ${t.cards?.length ? `<a class="step" href="#/cards/${encodeURIComponent(id)}"><span class="step-n">1</span><span class="grow"><b>Flashcards</b><span class="hint">${t.cards.length} cards</span></span><span class="chev">›</span></a>` : ''}
      ${t.questions?.length ? `<a class="step" href="#/quiz/${encodeURIComponent(id)}"><span class="step-n">${t.cards?.length ? 2 : 1}</span><span class="grow"><b>Quiz</b><span class="hint">${t.questions.length} questions · sets the next review</span></span><span class="chev">›</span></a>` : ''}
    </div>
    ${!t.questions?.length && !p.done ? `<button class="btn block ghost" id="markdone">Mark done</button>` : ''}`;
  wireBack();
  document.getElementById('markdone')?.addEventListener('click', () => {
    Object.assign(p, { done: true, completedOn: p.completedOn || today() }); scheduleReview(id, 80); save(); location.hash = '#/today';
  });
}

/* ---------- flashcards ---------- */
function viewCards(id) {
  const t = topicById(id);
  if (!t) return notFound();
  if (!session || session.kind !== 'cards' || session.id !== id) {
    session = { kind: 'cards', id, queue: shuffle(t.cards), total: t.cards.length, cleared: 0, again: 0 };
  }
  const s = session;
  if (!s.queue.length) {
    app.innerHTML = `<div class="card empty"><div class="empty-icon">✓</div><h1>Cards done</h1>
      <p class="hint">${s.again ? `You missed ${s.again} along the way and went back over them.` : 'Clean run.'}</p></div>
      <a class="btn block" href="#/quiz/${encodeURIComponent(id)}">Take the quiz</a>
      <button class="btn block ghost" id="again">Run cards again</button>`;
    document.getElementById('again').onclick = () => { session = null; viewCards(id); };
    return;
  }
  const c = s.queue[0];
  app.innerHTML = `${backLink('#/topic/' + encodeURIComponent(id), t.title)}
    <div class="run-head"><span class="hint">${s.cleared} of ${s.total} cleared</span><span class="hint">${s.queue.length} left</span></div>
    <div class="mini-progress"><div style="width:${Math.round(s.cleared / s.total * 100)}%"></div></div>
    <div class="flip-wrap" id="flip" role="button" tabindex="0" aria-label="Flip card">
      <div class="flip">
        <div class="face front"><span class="side">Question</span><div>${esc(c.front)}</div><span class="tap">Tap to flip</span></div>
        <div class="face back"><span class="side">Answer</span><div>${esc(c.back)}</div></div>
      </div>
    </div>
    <div id="pre"><button class="btn block secondary" id="show">Show answer</button></div>
    <div class="two" id="post" hidden><button class="btn bad" id="no">Again</button><button class="btn good" id="yes">Got it</button></div>`;
  wireBack();
  const card = document.getElementById('flip');
  const flip = () => {
    const on = card.classList.toggle('flipped');
    document.getElementById('pre').hidden = on;
    document.getElementById('post').hidden = !on;
  };
  card.onclick = flip;
  card.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } };
  document.getElementById('show').onclick = flip;
  document.getElementById('yes').onclick = () => { s.queue.shift(); s.cleared++; viewCards(id); };
  document.getElementById('no').onclick = () => {
    const card = s.queue.shift(); s.again++;
    s.queue.splice(Math.min(3, s.queue.length), 0, card);   // comes back a few cards later
    viewCards(id);
  };
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
  if (!s.qs.length) { app.innerHTML = `${backLink('#/today')}<div class="card empty"><p>No questions yet.</p></div>`; wireBack(); return; }
  if (s.i >= s.qs.length) return quizResult(id, title);

  const q = s.qs[s.i];
  const answered = s.picked !== null;
  app.innerHTML = `${backLink(special ? '#/today' : '#/topic/' + encodeURIComponent(id), title)}
    <div class="run-head"><span class="hint">Question ${s.i + 1} of ${s.qs.length}</span>${special ? `<span class="hint">${esc(topicById(q.topic).title)}</span>` : ''}</div>
    <div class="mini-progress"><div style="width:${Math.round(s.i / s.qs.length * 100)}%"></div></div>
    <div class="card question">${esc(q.q)}</div>
    ${q.options.map((o, i) => {
      let cls = 'opt';
      if (answered && i === q.answer) cls += ' correct';
      else if (answered && i === s.picked) cls += ' wrong';
      return `<button class="${cls}" data-i="${i}" ${answered ? 'disabled' : ''}><span class="letter">${'ABCDEFGH'[i]}</span><span>${esc(o)}</span></button>`;
    }).join('')}
    ${answered ? `<div class="card explain ${s.picked === q.answer ? 'ok' : 'no'}"><b>${s.picked === q.answer ? 'Correct.' : 'Not quite.'}</b> ${esc(q.explanation || '')}</div>
      <button class="btn block" id="next">${s.i + 1 < s.qs.length ? 'Next question' : 'See score'}</button>` : ''}`;
  wireBack();
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    s.picked = Number(b.dataset.i);
    const ok = s.picked === q.answer;
    if (ok) s.right++;
    const bt = (s.byTopic[q.topic] ||= { r: 0, n: 0 }); bt.n++; if (ok) bt.r++;
    viewQuiz(id);
    document.getElementById('next')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  const msg = pct >= 80 ? 'Strong work.' : pct >= 60 ? 'Getting there.' : 'This one needs another pass.';
  app.innerHTML = `<div class="card result ${scoreClass(pct)}"><p class="eyebrow">${esc(title)}</p>
      <div class="score">${pct}%</div><p><b>${msg}</b></p><p class="hint">${s.right} of ${s.qs.length} correct</p>
      ${next ? `<p class="hint">Comes back for review ${next === addDays(today(), 1) ? 'tomorrow' : 'on ' + pretty(next)}.</p>` : ''}</div>
    <a class="btn block" href="#/today">Back to today</a>
    <button class="btn block ghost" id="retry">Retake quiz</button>`;
  document.getElementById('retry').onclick = () => { session = null; viewQuiz(id); };
}

/* ---------- settings ---------- */
function viewSettings() {
  const st = state.settings;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  app.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
    <h2>Break</h2>
    <div class="card">
      <div class="two">
        <label class="field">Starts<input type="date" id="start" value="${st.start}"></label>
        <label class="field">Ends<input type="date" id="end" value="${st.end}"></label>
      </div>
      <div class="field">Days off
        <div class="days">${names.map((n, i) => `<label><input type="checkbox" value="${i}" ${st.offDays.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      </div>
      <label class="switch"><input type="checkbox" id="final" ${st.finalReview ? 'checked' : ''}><span>Save the last study day for a mixed final review</span></label>
      <button class="btn block" id="saveSettings">Save and rebuild plan</button>
      <p class="hint">Rebuilding keeps finished topics and spreads the rest over the days left.</p>
    </div>
    <h2>Backup</h2>
    <div class="card">
      <p class="hint">Progress lives on this device only. Export a backup to move it to another phone or keep it safe.</p>
      <button class="btn block secondary" id="export">Export progress</button>
      <label class="btn block ghost">Import progress<input type="file" id="import" accept="application/json" hidden></label>
      <button class="btn block ghost danger" id="reset">Reset all progress</button>
    </div>
    <p class="hint center">${esc(content.title)} · ${content.topics.length} topics</p>`;

  document.getElementById('saveSettings').onclick = () => {
    const start = document.getElementById('start').value, end = document.getElementById('end').value;
    if (!start || !end || end < start) return alert('End date needs to be on or after the start date.');
    const offDays = [...app.querySelectorAll('.days input:checked')].map(x => Number(x.value));
    if (offDays.length === 7) return alert('Leave at least one study day.');
    Object.assign(st, { start, end, offDays, finalReview: document.getElementById('final').checked });
    rebuildPlan(); save(); location.hash = '#/calendar';
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

function notFound() { app.innerHTML = `<div class="card empty"><p>That page doesn't exist.</p><a class="btn" href="#/today">Go to today</a></div>`; }

/* ---------- router ---------- */
const TAB_OF = { today: 'today', calendar: 'calendar', plan: 'calendar', topics: 'topics', settings: 'settings' };
function route() {
  navDepth++;
  const [path] = location.hash.slice(2).split('?');
  const [view, raw] = path.split('/');
  const id = raw ? decodeURIComponent(raw) : null;
  if (!['cards', 'quiz'].includes(view)) session = null;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === (TAB_OF[view || 'today'] || '')));
  document.body.dataset.view = view || 'today';
  ({
    today: viewToday, calendar: () => viewCalendar(id), plan: () => viewCalendar(), topics: viewTopics, settings: viewSettings,
    topic: () => viewTopic(id), cards: () => viewCards(id), quiz: () => viewQuiz(id)
  }[view || 'today'] || viewToday)();
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
