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
// The courses she's studying now (Settings), and their topics. Progress on other courses is kept.
const isStudying = t => state.settings.courses.includes(t.course);
const studying = () => content.topics.filter(isStudying);
const courseById = id => content.courses.find(c => c.id === id);
const tp = id => (state.topics[id] ||= { done: false, attempts: 0, lastScore: null, bestScore: null, completedOn: null, nextReview: null });
const save = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { alert('Could not save progress: ' + e.message); } };

/* ---------- state ---------- */
function defaultSettings() {
  const s = content.defaults || {};
  return {
    start: s.start || today(),
    end: s.end || addDays(today(), 20),
    offDays: s.offDays || [],          // 0=Sun … 6=Sat
    finalReview: s.finalReview !== false,
    courses: defaultCourses()
  };
}

// Courses marked "current" in content.json, else the newest semester's (the last listed), else all.
function defaultCourses() {
  const cs = content.courses;
  const cur = cs.filter(c => c.current);
  if (cur.length) return cur.map(c => c.id);
  const last = cs[cs.length - 1];
  return (last?.term ? cs.filter(c => c.term === last.term) : cs).map(c => c.id);
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
  state.settings.courses = (state.settings.courses || []).filter(courseById);
  if (!state.settings.courses.length) state.settings.courses = defaultCourses();
  // Make sure the plan holds exactly the topics she's studying (handles topics added mid-break).
  const planned = new Set(Object.values(state.plan).flat());
  const now = studying();
  // A course file that didn't load (offline) leaves the plan alone.
  if (!content.missing.length && (now.some(t => !planned.has(t.id)) || planned.size !== now.length)) rebuildPlan();
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
  const done = studying().filter(t => tp(t.id).done);
  const todo = studying().filter(t => !tp(t.id).done);
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
  const reviews = studying()
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
const reviewsOn = d => studying().filter(t => tp(t.id).done && tp(t.id).nextReview === d).map(t => t.id);

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
  const total = studying().length;
  const doneCount = studying().filter(t => tp(t.id).done).length;
  const pct = total ? Math.round(doneCount / total * 100) : 0;
  const days = studyDays();
  const idx = days.indexOf(today());
  const fd = finalDay();
  const status = idx >= 0 ? `Study day ${idx + 1} of ${days.length}`
    : preview ? `Break starts ${pretty(days[0] || state.settings.start)}`
    : today() > state.settings.end ? 'Break is over. Nice work.' : 'Day off. Rest up.';

  let h = `<section class="hero">
      <div class="grow"><p class="eyebrow">${longDay(today())}</p><h1>${greeting()}</h1><p class="hero-sub">${status}</p>
        <p class="hero-courses">${state.settings.courses.map(id => esc(courseById(id)?.title)).join(' · ')}</p></div>
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

  const done = studying().filter(x => tp(x.id).done).length;
  let h = `<div class="page-head"><h1>Calendar</h1><p class="hint">${shortDay(state.settings.start)} to ${shortDay(state.settings.end)} · ${studying().length} topics over ${studyDays().length} study days · ${done} done</p></div>
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

/* ---------- topics (by semester and course) ---------- */
function viewTopics(which) {
  const all = which === 'all';
  const courses = content.courses.filter(c => all || state.settings.courses.includes(c.id));
  let h = `<div class="page-head"><h1>Topics</h1>
    <div class="seg"><a href="#/topics" class="${all ? '' : 'on'}">Studying now</a><a href="#/topics/all" class="${all ? 'on' : ''}">All courses</a></div></div>`;
  let term = null;
  for (const c of courses) {
    const ids = content.topics.filter(t => t.course === c.id).map(t => t.id);
    if (!ids.length) continue;
    if (c.term && c.term !== term && (all || new Set(courses.map(x => x.term)).size > 1)) { term = c.term; h += `<h2 class="term">${esc(c.term)}</h2>`; }
    const done = ids.filter(id => tp(id).done).length;
    h += `<div class="course-head"><b class="grow">${esc(c.title)}</b><span class="hint">${done}/${ids.length} done</span></div>
      <div class="mini-progress"><div style="width:${Math.round(done / ids.length * 100)}%"></div></div>`;
    h += ids.map(id => {
      const d = plannedDate(id);
      const p = tp(id);
      const when = p.done ? (p.nextReview && isStudying(topicById(id)) ? `Review ${p.nextReview <= today() ? 'due' : shortDay(p.nextReview)}` : '') : d ? `Planned ${shortDay(d)}` : '';
      return topicRow(id, { tag: when ? `<span>${when}</span> · ` : '' });
    }).join('');
  }
  if (!courses.length) h += `<div class="card empty"><p class="hint">No courses picked. Choose what you're studying in Settings.</p><a class="btn secondary" href="#/settings">Settings</a></div>`;
  if (content.missing.length) h += `<p class="hint">Couldn't load ${content.missing.map(esc).join(', ')}. Open the app once with internet.</p>`;
  if (!all && courses.length) h += `<a class="btn block secondary" href="#/quiz/__mixed">Quick mixed quiz</a>`;
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
    ${p.done && (p.lastScore ?? 100) < 80 ? `<a class="card deep-cta warn" href="#/deep/${encodeURIComponent(id)}"><span class="grow"><b>You scored ${p.lastScore}% last time</b><span class="hint">Go over it in depth: what you missed, full notes, worked questions</span></span><span class="chev">›</span></a>` : ''}
    <div class="steps">
      ${!p.done ? `<a class="step" href="#/deep/${encodeURIComponent(id)}"><span class="step-n alt">?</span><span class="grow"><b>Don't know this yet?</b><span class="hint">Start with the in-depth review</span></span><span class="chev">›</span></a>` : ''}
      ${t.cards?.length ? `<a class="step" href="#/cards/${encodeURIComponent(id)}"><span class="step-n">1</span><span class="grow"><b>Flashcards</b><span class="hint">${t.cards.length} cards</span></span><span class="chev">›</span></a>` : ''}
      ${t.questions?.length ? `<a class="step" href="#/quiz/${encodeURIComponent(id)}"><span class="step-n">${t.cards?.length ? 2 : 1}</span><span class="grow"><b>Quiz</b><span class="hint">${t.questions.length} questions · sets the next review</span></span><span class="chev">›</span></a>` : ''}
      ${p.done ? `<a class="step" href="#/deep/${encodeURIComponent(id)}"><span class="step-n alt">≡</span><span class="grow"><b>In depth</b><span class="hint">Notes, every card and worked questions</span></span><span class="chev">›</span></a>` : ''}
    </div>
    ${!t.questions?.length && !p.done ? `<button class="btn block ghost" id="markdone">Mark done</button>` : ''}`;
  wireBack();
  document.getElementById('markdone')?.addEventListener('click', () => {
    Object.assign(p, { done: true, completedOn: p.completedOn || today() }); scheduleReview(id, 80); save(); location.hash = '#/today';
  });
}

/* ---------- in depth ---------- */
// Plain text to HTML: blank lines split paragraphs, lines starting "- " are bullets.
function richText(text) {
  return String(text || '').split(/\n\s*\n/).map(par => {
    const lines = par.split('\n');
    if (lines.every(l => /^\s*[-•]\s/.test(l))) return `<ul class="points">${lines.map(l => `<li>${esc(l.replace(/^\s*[-•]\s/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
}

function viewDeep(id) {
  const t = topicById(id);
  if (!t) return notFound();
  const p = tp(id);
  const qs = t.questions || [];
  const missed = (p.missed || []).map(q => qs.find(x => x.q === q)).filter(Boolean);
  const answer = q => q.options[q.answer];
  const sections = [];
  if (missed.length) sections.push(['missed', `What you missed (${missed.length})`, missed.map(q => `<div class="card worked miss">
      <p class="wq">${esc(q.q)}</p><p class="wa">✓ ${esc(answer(q))}</p>${q.explanation ? `<p class="hint">${esc(q.explanation)}</p>` : ''}</div>`).join('')]);
  if (t.notes?.length) sections.push(['notes', 'Notes', t.notes.map(n => `<div class="card notes">${n.heading ? `<h3 class="card-title">${esc(n.heading)}</h3>` : ''}${richText(n.text)}</div>`).join('')]);
  if (t.points?.length) sections.push(['points', 'Key points', `<div class="card"><ul class="points">${t.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`]);
  if (t.cards?.length) sections.push(['cards', `All cards (${t.cards.length})`, `<div class="card qa-list">${t.cards.map(c => `<div class="qa"><p class="q">${esc(c.front)}</p><p class="a">${esc(c.back)}</p></div>`).join('')}</div>`]);
  const practice = qs.filter(q => !missed.includes(q));
  if (practice.length) sections.push(['practice', `Worked questions (${practice.length})`, `<p class="hint">Answer in your head, then tap to check.</p>` + practice.map(q => `<details class="card worked">
      <summary>${esc(q.q)}</summary>
      <ol class="wopts">${q.options.map((o, i) => `<li class="${i === q.answer ? 'right' : ''}">${esc(o)}</li>`).join('')}</ol>
      ${q.explanation ? `<p class="hint">${esc(q.explanation)}</p>` : ''}</details>`).join('')]);

  app.innerHTML = `${backLink('#/topic/' + encodeURIComponent(id), t.title)}
    <div class="topic-head" style="--c:${blockColor(t.block)}">
      <p class="eyebrow">In depth${t.block ? ` · ${esc(t.block)}` : ''}</p><h1>${esc(t.title)}</h1>
      <p class="hint">Take your time. Read it through, then test yourself.</p>
    </div>
    ${sections.length > 1 ? `<div class="jump">${sections.map(([k, title]) => `<button data-jump="${k}">${esc(title.replace(/ \(\d+\)$/, ''))}</button>`).join('')}</div>` : ''}
    ${sections.map(([k, title, body]) => `<h2 id="s-${k}">${esc(title)}</h2>${body}`).join('') || '<div class="card empty"><p class="hint">Nothing more on this topic yet.</p></div>'}
    <h2>Now test yourself</h2>
    <div class="two">
      ${t.cards?.length ? `<a class="btn secondary" href="#/cards/${encodeURIComponent(id)}">Flashcards</a>` : ''}
      ${qs.length ? `<a class="btn" href="#/quiz/${encodeURIComponent(id)}">Take the quiz</a>` : ''}
    </div>`;
  wireBack();
  app.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => document.getElementById('s-' + b.dataset.jump).scrollIntoView({ behavior: 'smooth' }));
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
      ${s.again ? `<a class="btn block secondary" href="#/deep/${encodeURIComponent(id)}">Go over it in depth first</a>` : ''}
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
    for (const t of studying()) for (const q of t.questions || []) {
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
    session = { kind: 'quiz', id, qs, i: 0, picked: null, right: 0, byTopic: {}, missed: {} };
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
    if (!ok) (s.missed[q.topic] ||= []).push(q.q);
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
        if (s.missed[tid]) p.missed = [...new Set([...s.missed[tid], ...(p.missed || [])])].slice(0, 20);
      }
    } else {
      const p = tp(id);
      p.attempts++; p.lastScore = pct; p.bestScore = Math.max(p.bestScore ?? 0, pct);
      if (!p.done) { p.done = true; p.completedOn = today(); }
      scheduleReview(id, pct);
      p.missed = s.missed[id] || [];
    }
    save();
  }
  const next = id.startsWith('__') ? null : tp(id).nextReview;
  const msg = pct >= 80 ? 'Strong work.' : pct >= 60 ? 'Getting there.' : 'This one needs another pass.';
  app.innerHTML = `<div class="card result ${scoreClass(pct)}"><p class="eyebrow">${esc(title)}</p>
      <div class="score">${pct}%</div><p><b>${msg}</b></p><p class="hint">${s.right} of ${s.qs.length} correct</p>
      ${next ? `<p class="hint">Comes back for review ${next === addDays(today(), 1) ? 'tomorrow' : 'on ' + pretty(next)}.</p>` : ''}</div>
    ${!id.startsWith('__') && pct < 80 ? `<a class="btn block ${pct < 60 ? '' : 'secondary'}" href="#/deep/${encodeURIComponent(id)}">Review it in depth</a>` : ''}
    ${id.startsWith('__') && Object.keys(s.missed).length ? `<h2>Missed topics</h2>${Object.keys(s.missed).map(tid => topicRow(tid, { tag: `<span class="chip bad">${s.missed[tid].length} missed</span>` })).join('')}` : ''}
    <a class="btn block ${!id.startsWith('__') && pct < 60 ? 'ghost' : ''}" href="#/today">Back to today</a>
    <button class="btn block ghost" id="retry">Retake quiz</button>`;
  document.getElementById('retry').onclick = () => { session = null; viewQuiz(id); };
}

/* ---------- settings ---------- */
function viewSettings() {
  const st = state.settings;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const terms = [...new Set(content.courses.map(c => c.term || ''))];
  const courseBox = c => {
    const ids = content.topics.filter(t => t.course === c.id);
    const done = ids.filter(t => tp(t.id).done).length;
    return `<label class="course-pick"><input type="checkbox" value="${esc(c.id)}" ${st.courses.includes(c.id) ? 'checked' : ''}>
      <span class="grow"><b>${esc(c.title)}</b><span class="hint">${c.missing ? "Couldn't load (offline?)" : `${ids.length} topics${done ? ` · ${done} done` : ''}`}</span></span></label>`;
  };
  app.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
    <h2>Studying now</h2>
    <div class="card">
      <p class="hint">Pick the classes for this break. Today, the calendar and quizzes use only these. Progress on the others is kept.</p>
      ${terms.map(term => `<div class="term-group">${term ? `<div class="term-row"><b class="grow">${esc(term)}</b>${terms.length > 1 ? `<button class="linkish" data-term="${esc(term)}">Only this semester</button>` : ''}</div>` : ''}
        ${content.courses.filter(c => (c.term || '') === term).map(courseBox).join('')}</div>`).join('')}
    </div>
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
    <p class="hint center">${esc(content.title)} · ${content.courses.length} course${content.courses.length === 1 ? '' : 's'} · ${content.topics.length} topics</p>`;
  app.querySelectorAll('[data-term]').forEach(b => b.onclick = () => {
    app.querySelectorAll('.course-pick input').forEach(x => { x.checked = (courseById(x.value).term || '') === b.dataset.term; });
  });

  document.getElementById('saveSettings').onclick = () => {
    const start = document.getElementById('start').value, end = document.getElementById('end').value;
    if (!start || !end || end < start) return alert('End date needs to be on or after the start date.');
    const offDays = [...app.querySelectorAll('.days input:checked')].map(x => Number(x.value));
    if (offDays.length === 7) return alert('Leave at least one study day.');
    const courses = [...app.querySelectorAll('.course-pick input:checked')].map(x => x.value);
    if (!courses.length) return alert('Pick at least one class to study.');
    Object.assign(st, { start, end, offDays, courses, finalReview: document.getElementById('final').checked });
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
    today: viewToday, calendar: () => viewCalendar(id), plan: () => viewCalendar(), topics: () => viewTopics(id), settings: viewSettings,
    topic: () => viewTopic(id), deep: () => viewDeep(id), cards: () => viewCards(id), quiz: () => viewQuiz(id)
  }[view || 'today'] || viewToday)();
  window.scrollTo(0, 0);
}

/* ---------- boot ---------- */
const getJSON = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); };

// content.json lists courses (each with a term), whose topics sit inline or in their own file.
// An older content.json with just "topics" is one course. Topic ids become "<course>:<topic>".
async function loadContent() {
  const lib = await getJSON('content.json');
  const list = lib.courses || [{ id: lib.id || 'main', title: lib.title || 'Topics', topics: lib.topics }];
  const missing = [];
  const loaded = await Promise.all(list.map(async c => {
    if (c.topics || !c.file) return c.topics || [];
    try { return (await getJSON(c.file)).topics || []; } catch (e) { missing.push(c.title); return null; }
  }));
  const courses = list.map(({ topics, ...c }, i) => ({ ...c, missing: !loaded[i] }));
  const topics = list.flatMap((c, i) => (loaded[i] || []).map(t => ({ ...t, id: `${c.id}:${t.id}`, course: c.id })));
  return { id: lib.id || 'main', title: lib.title || '', defaults: lib.defaults, courses, topics, missing };
}

async function boot() {
  try {
    content = await loadContent();
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
if ('serviceWorker' in navigator) {
  // A new version taking over reloads the page once, so old and new files never run together.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
boot();
