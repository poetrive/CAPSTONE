/* =====================================================
   NGAMBIS BARENG — script.js
   Vanilla JavaScript, no framework, no external libs.

   Sections:
   1. CONSTANTS & HELPERS
   2. STATE
   3. STORAGE
   4. DATE UTILS
   5. TIMER ENGINE
   6. RENDER — Beranda
   7. RENDER — Tugas
   8. RENDER — Timer
   9. RENDER — Statistik
   10. RENDER — Shared (chips, nav)
   11. EVENTS — Sidebar / Nav
   12. EVENTS — Beranda
   13. EVENTS — Tugas
   14. EVENTS — Timer
   15. EVENTS — Statistik
   16. INIT
   ===================================================== */

'use strict';

/* =====================================================
   1. CONSTANTS & HELPERS
   ===================================================== */

const CIRCUMFERENCE = 2 * Math.PI * 88; // SVG circle r=88

/** Escape user input to prevent XSS */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Generate a simple unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Format seconds → "mm:ss" */
function formatMMSS(secs) {
  const m = Math.floor(Math.abs(secs) / 60).toString().padStart(2, '0');
  const s = (Math.abs(secs) % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Format seconds → human readable (e.g. "1 jam 25 menit") */
function formatDuration(secs) {
  if (!secs || secs < 0) return '0 mnt';
  const totalMin = Math.round(secs / 60);
  if (totalMin < 1) return '0 mnt';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} jam ${m} mnt`;
  if (h > 0) return `${h} jam`;
  return `${m} mnt`;
}

/** Format minutes → human readable */
function formatMinutes(min) {
  return formatDuration(min * 60);
}

/** Get today's date string YYYY-MM-DD in LOCAL timezone */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Convert date string YYYY-MM-DD to Date (local midnight) */
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** How many days from today (negative = past) */
function daysFromToday(dateStr) {
  const today = parseLocalDate(todayStr());
  const target = parseLocalDate(dateStr);
  return Math.round((target - today) / 86400000);
}

/** Format deadline for display */
function formatDeadlineLabel(dateStr) {
  const diff = daysFromToday(dateStr);
  if (diff < 0) return { text: `${Math.abs(diff)} hari lalu`, cls: 'overdue' };
  if (diff === 0) return { text: 'Hari ini', cls: 'soon' };
  if (diff === 1) return { text: 'Besok', cls: 'soon' };
  return { text: `${diff} hari lagi`, cls: 'ok' };
}

/** Show a brief toast notification */
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.remove('show'), 2800);
}

/* =====================================================
   2. STATE
   ===================================================== */

const STATE = {
  currentPage: 'beranda',
  sidebarOpen: false,

  // Tasks (Tugas page)
  tasks: [],       // { id, title, type:'belajar'|'tugas', deadline:YYYY-MM-DD, done:bool, createdAt }

  // Today's plans (Beranda)
  plans: [],       // { id, text, done:bool, date:YYYY-MM-DD }

  // Study sessions history
  sessions: [],    // { id, date:YYYY-MM-DD, startTs, endTs, durationSec, type:'belajar'|'tugas'|'istirahat', label }

  // Timer settings
  timerSettings: {
    belajar: 25,
    tugas: 45,
    istirahat: 5,
  },

  // Timer runtime state
  timer: {
    phase: 'belajar',   // 'belajar' | 'tugas' | 'istirahat'
    running: false,
    startTs: null,      // timestamp when current interval started
    remainSec: 25 * 60, // remaining at time of start/pause
    selectedItem: 'free-belajar',
    sessionCount: 0,    // focus sessions done today
  },

  // Streak
  streak: 0,
  lastStudyDate: null, // YYYY-MM-DD
};

/* =====================================================
   3. STORAGE
   ===================================================== */

const STORAGE_KEY = 'ngambis_v1';

function saveState() {
  try {
    const payload = {
      tasks: STATE.tasks,
      plans: STATE.plans,
      sessions: STATE.sessions,
      timerSettings: STATE.timerSettings,
      timer: STATE.timer,
      streak: STATE.streak,
      lastStudyDate: STATE.lastStudyDate,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.tasks)         STATE.tasks         = data.tasks;
    if (data.plans)         STATE.plans         = data.plans;
    if (data.sessions)      STATE.sessions      = data.sessions;
    if (data.timerSettings) STATE.timerSettings = data.timerSettings;
    if (data.timer)         STATE.timer         = { ...STATE.timer, ...data.timer };
    if (data.streak !== undefined) STATE.streak = data.streak;
    if (data.lastStudyDate) STATE.lastStudyDate = data.lastStudyDate;
    return true;
  } catch (e) {
    console.warn('localStorage load failed:', e);
    return false;
  }
}

/**
 * Seed contoh data awal saat pertama kali dibuka.
 * Hanya mengisi daftar tugas dan rencana hari ini sebagai panduan,
 * TANPA sesi belajar fiktif — waktu belajar & streak mulai dari 0
 * dan hanya bertambah dari aktivitas timer nyata pengguna.
 */
function seedDefaultData() {
  const today = todayStr();
  const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  // Contoh tugas & materi — tidak ada yang ditandai selesai
  STATE.tasks = [
    { id: uid(), title: 'Bab 3 — Kalkulus Integral', type: 'belajar', deadline: addDays(2), done: false, createdAt: Date.now() },
    { id: uid(), title: 'Laporan Praktikum Kimia',   type: 'tugas',   deadline: addDays(1), done: false, createdAt: Date.now() },
    { id: uid(), title: 'Review Materi Pemrograman Web', type: 'belajar', deadline: addDays(5), done: false, createdAt: Date.now() },
    { id: uid(), title: 'Tugas Essay Bahasa Inggris', type: 'tugas',  deadline: addDays(3), done: false, createdAt: Date.now() },
    { id: uid(), title: 'Ringkasan Sejarah Indonesia', type: 'belajar', deadline: addDays(7), done: false, createdAt: Date.now() },
  ];

  // Contoh rencana hari ini — semua belum selesai
  STATE.plans = [
    { id: uid(), text: 'Baca bab 3 kalkulus', done: false, date: today },
    { id: uid(), text: 'Kerjakan latihan soal no. 1-10', done: false, date: today },
    { id: uid(), text: 'Review catatan pemrograman', done: false, date: today },
  ];

  // Tidak ada sesi belajar — waktu belajar hari ini = 0, streak = 0
  STATE.sessions      = [];
  STATE.streak        = 0;
  STATE.lastStudyDate = null;

  saveState();
}

/**
 * Hard-reset semua data ke kondisi awal (seperti buka pertama kali).
 * Dipanggil dari tombol "Reset Data" di sidebar.
 */
function resetAllData() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}

  // Reset STATE ke nilai default
  STATE.tasks         = [];
  STATE.plans         = [];
  STATE.sessions      = [];
  STATE.timerSettings = { belajar: 25, tugas: 45, istirahat: 5 };
  STATE.timer         = {
    phase: 'belajar', running: false, startTs: null,
    remainSec: 25 * 60, selectedItem: 'free-belajar', sessionCount: 0,
  };
  STATE.streak        = 0;
  STATE.lastStudyDate = null;

  // Stop any running timer
  clearInterval(_timerInterval);
  _timerInterval = null;
  updateTabTitle(0);

  // Seed fresh sample tasks/plans (no sessions)
  seedDefaultData();

  // Re-render everything
  renderSharedChips();
  navigateTo(STATE.currentPage);
  showToast('✅ Data berhasil direset ke kondisi awal!');
}

/* =====================================================
   4. DATE UTILS — Day rollover handling
   ===================================================== */

function handleDayRollover() {
  const today = todayStr();

  // Clean completed plans from previous days; carry over incomplete ones
  STATE.plans = STATE.plans.filter(p => {
    if (!p.date || p.date === today) return true; // keep today's
    if (!p.done) { p.date = today; return true; }  // carry forward incomplete
    return false;                                   // remove completed past plans
  });

  // Recalculate streak
  recalcStreak();
  saveState();
}

function recalcStreak() {
  const today = todayStr();
  if (!STATE.lastStudyDate) {
    STATE.streak = 0;
    return;
  }
  const diff = daysFromToday(STATE.lastStudyDate);
  if (diff === 0) {
    // Already studied today — streak maintained (no change needed unless we need to add today)
  } else if (diff === -1) {
    // Last studied yesterday — streak is still valid (will increase if study today)
  } else {
    // Gap > 1 day — reset streak
    STATE.streak = 0;
    STATE.lastStudyDate = null;
  }
}

/** Call when a focus session completes */
function onSessionComplete(session) {
  if (session.type === 'istirahat') return;

  const today = todayStr();
  STATE.sessions.push(session);

  // Update streak
  if (STATE.lastStudyDate !== today) {
    if (!STATE.lastStudyDate) {
      // First ever session
      STATE.streak = 1;
    } else {
      const diff = daysFromToday(STATE.lastStudyDate); // negative means in past
      if (diff === -1) {
        // Studied yesterday → extend streak
        STATE.streak += 1;
      } else {
        // Gap: reset to 1
        STATE.streak = 1;
      }
    }
    STATE.lastStudyDate = today;
  }

  saveState();
  renderSharedChips();
  renderBerandaStreakCard();
  renderStatistik();
  renderTimerSessions();
}

/* =====================================================
   5. TIMER ENGINE
   ===================================================== */

let _timerInterval = null;

/** Get total duration (seconds) for current phase */
function phaseDuration() {
  const s = STATE.timerSettings;
  const phase = STATE.timer.phase;
  if (phase === 'istirahat') return s.istirahat * 60;
  if (phase === 'tugas') return s.tugas * 60;
  return s.belajar * 60;
}

/** Current remaining seconds (live) */
function getRemainingSeconds() {
  if (!STATE.timer.running) return STATE.timer.remainSec;
  const elapsed = Math.floor((Date.now() - STATE.timer.startTs) / 1000);
  return Math.max(0, STATE.timer.remainSec - elapsed);
}

function timerStart() {
  if (STATE.timer.running) return;
  STATE.timer.running = true;
  STATE.timer.startTs = Date.now();
  _timerInterval = setInterval(timerTick, 500);
  renderTimerDisplay();
  saveState();
}

function timerPause() {
  if (!STATE.timer.running) return;
  STATE.timer.remainSec = getRemainingSeconds();
  STATE.timer.running = false;
  clearInterval(_timerInterval);
  renderTimerDisplay();
  saveState();
}

function timerReset() {
  clearInterval(_timerInterval);
  STATE.timer.running = false;
  STATE.timer.startTs = null;
  STATE.timer.remainSec = phaseDuration();
  renderTimerDisplay();
  renderTimerControls();
  saveState();
}

function timerSkip() {
  timerPause();
  advancePhase(false);
}

function advancePhase(completed) {
  const prevPhase = STATE.timer.phase;

  if (completed && prevPhase !== 'istirahat') {
    // Record session
    const label = resolveItemLabel(STATE.timer.selectedItem);
    const dur = phaseDuration();
    const sessionObj = {
      id: uid(),
      date: todayStr(),
      startTs: STATE.timer.startTs || (Date.now() - dur * 1000),
      endTs: Date.now(),
      durationSec: dur,
      type: prevPhase,
      label: label,
    };
    onSessionComplete(sessionObj);
  }

  // Determine next phase
  if (prevPhase === 'istirahat') {
    // Back to belajar or tugas based on selected item
    const sel = STATE.timer.selectedItem;
    STATE.timer.phase = sel.includes('tugas') ? 'tugas' : 'belajar';
  } else {
    STATE.timer.phase = 'istirahat';
  }

  STATE.timer.running = false;
  clearInterval(_timerInterval);
  STATE.timer.remainSec = phaseDuration();
  STATE.timer.startTs = null;
  saveState();
  renderTimerDisplay();
  renderTimerControls();
  renderTimerPhaseLabel();
}

function timerTick() {
  const rem = getRemainingSeconds();
  updateTimerProgressUI(rem);
  updateTabTitle(rem);

  if (rem <= 0) {
    clearInterval(_timerInterval);
    advancePhase(true);
    // Browser notification (if permission granted)
    notifySessionEnd();
  }
}

function notifySessionEnd() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('NGAMBIS BARENG', {
      body: STATE.timer.phase === 'istirahat'
        ? '☕ Waktunya istirahat!'
        : '🎉 Sesi fokus selesai! Lanjut istirahat.',
    });
  }
  showToast(STATE.timer.phase === 'istirahat' ? '☕ Waktunya istirahat!' : '🎯 Sesi fokus selesai!');
}

function resolveItemLabel(val) {
  if (val === 'free-belajar') return 'Belajar Bebas';
  if (val === 'free-tugas') return 'Tugas Bebas';
  // Might be a plan id or task id
  const plan = STATE.plans.find(p => p.id === val);
  if (plan) return plan.text;
  const task = STATE.tasks.find(t => t.id === val);
  if (task) return task.title;
  return 'Belajar Bebas';
}

function updateTimerProgressUI(rem) {
  const total = phaseDuration();
  const fraction = total > 0 ? rem / total : 0;
  const offset = CIRCUMFERENCE * (1 - fraction);
  const progressEl = document.getElementById('timerProgress');
  if (progressEl) progressEl.style.strokeDashoffset = offset;

  const displayEl = document.getElementById('timerDisplay');
  if (displayEl) displayEl.textContent = formatMMSS(rem);

  const statusEl = document.getElementById('timerStatus');
  if (statusEl) {
    statusEl.textContent = STATE.timer.running ? 'Sedang berjalan…' : (rem === phaseDuration() ? 'Siap mulai' : 'Dijeda');
  }
}

function updateTabTitle(rem) {
  if (STATE.timer.running) {
    document.title = `${formatMMSS(rem)} — NGAMBIS BARENG`;
  } else {
    document.title = 'NGAMBIS BARENG';
  }
}

/* =====================================================
   6. RENDER — Beranda
   ===================================================== */

function renderBeranda() {
  renderGreeting();
  renderContinueCard();
  renderPlanList();
  renderBerandaStreakCard();
  renderDeadlineList();
}

function renderGreeting() {
  const hour = new Date().getHours();
  let greeting, msg;
  if (hour < 11) { greeting = 'Selamat Pagi ☀️'; msg = 'Semangat mulai hari yang produktif!'; }
  else if (hour < 15) { greeting = 'Selamat Siang 🌤️'; msg = 'Tetap fokus di tengah hari ya!'; }
  else if (hour < 18) { greeting = 'Selamat Sore 🌅'; msg = 'Jangan lupa istirahat sebentar!'; }
  else { greeting = 'Selamat Malam 🌙'; msg = 'Belajar malam juga keren!'; }

  const greetingText = document.getElementById('greetingText');
  const greetingMsg = document.getElementById('greetingMsg');
  if (greetingText) greetingText.textContent = greeting;
  if (greetingMsg) greetingMsg.textContent = msg;

  // Render mascot
  const mascotEl = document.getElementById('mascotGreeting');
  if (mascotEl) mascotEl.innerHTML = buildMascotSVG(80, hour < 6 || hour >= 22);
}

/** Build the study mascot SVG — a cute round character */
function buildMascotSVG(size = 80, sleeping = false) {
  const s = size;
  const eyeType = sleeping
    ? `<path d="M${s*0.38} ${s*0.42} Q${s*0.41} ${s*0.39} ${s*0.44} ${s*0.42}" stroke="#1F2937" stroke-width="1.5" stroke-linecap="round" fill="none"/>
       <path d="M${s*0.56} ${s*0.42} Q${s*0.59} ${s*0.39} ${s*0.62} ${s*0.42}" stroke="#1F2937" stroke-width="1.5" stroke-linecap="round" fill="none"/>`
    : `<circle class="mascot-eye" cx="${s*0.41}" cy="${s*0.41}" r="${s*0.048}" fill="#1F2937"/>
       <circle class="mascot-eye" cx="${s*0.59}" cy="${s*0.41}" r="${s*0.048}" fill="#1F2937"/>
       <circle cx="${s*0.43}" cy="${s*0.39}" r="${s*0.018}" fill="#fff"/>
       <circle cx="${s*0.61}" cy="${s*0.39}" r="${s*0.018}" fill="#fff"/>`;
  const mouthType = sleeping
    ? `<path d="M${s*0.42} ${s*0.54} Q${s*0.5} ${s*0.52} ${s*0.58} ${s*0.54}" stroke="#F97316" stroke-width="1.5" stroke-linecap="round" fill="none"/>`
    : `<path d="M${s*0.4} ${s*0.53} Q${s*0.5} ${s*0.62} ${s*0.6} ${s*0.53}" stroke="#F97316" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  const zzzs = sleeping
    ? `<text x="${s*0.65}" y="${s*0.28}" font-size="${s*0.13}" fill="#94A3B8" font-weight="bold">z z</text>`
    : '';

  return `<svg class="mascot-float" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" aria-hidden="true">
    <!-- Body -->
    <ellipse cx="${s*0.5}" cy="${s*0.72}" rx="${s*0.28}" ry="${s*0.22}" fill="#5B21B6"/>
    <!-- Head -->
    <circle cx="${s*0.5}" cy="${s*0.43}" r="${s*0.32}" fill="#FDE68A"/>
    <!-- Cheeks -->
    <circle cx="${s*0.29}" cy="${s*0.5}" r="${s*0.065}" fill="#FBBF24" opacity="0.5"/>
    <circle cx="${s*0.71}" cy="${s*0.5}" r="${s*0.065}" fill="#FBBF24" opacity="0.5"/>
    <!-- Eyes -->
    ${eyeType}
    <!-- Mouth -->
    ${mouthType}
    <!-- Hat (graduation cap) -->
    <rect x="${s*0.3}" y="${s*0.12}" width="${s*0.4}" height="${s*0.07}" rx="${s*0.02}" fill="#7C3AED"/>
    <rect x="${s*0.26}" y="${s*0.08}" width="${s*0.48}" height="${s*0.055}" rx="${s*0.015}" fill="#5B21B6"/>
    <!-- Tassel -->
    <line x1="${s*0.74}" y1="${s*0.11}" x2="${s*0.78}" y2="${s*0.19}" stroke="#F97316" stroke-width="${s*0.025}"/>
    <circle cx="${s*0.78}" cy="${s*0.2}" r="${s*0.025}" fill="#F97316"/>
    ${zzzs}
  </svg>`;
}

/**
 * Build fire mascot — chibi/cartoon style.
 * Round body with tiny arms & legs, curly flame tongue on top, anime eyes.
 * active=true  → warm orange-yellow, happy smile, sparkle particles
 * active=false → muted warm grey, sleepy half-closed eyes, zzz bubbles
 *
 * ViewBox: 0 0 120 130  (wider to fit arms, taller to fit legs + flame tip)
 */
function buildFireMascot(size = 72, active = true) {
  // Counter-based prefix avoids SVG gradient ID collisions on re-render
  buildFireMascot._counter = (buildFireMascot._counter || 0) + 1;
  const p = `fm${buildFireMascot._counter}`;

  /* ── palette ── */
  const bodyA  = active ? '#FB923C' : '#94A3B8';   // outer body fill
  const bodyB  = active ? '#FDBA74' : '#CBD5E1';   // body highlight
  const tongA  = active ? '#F97316' : '#64748B';   // flame tongue outer
  const tongB  = active ? '#FCD34D' : '#94A3B8';   // flame tongue inner
  const armCol = active ? '#F97316' : '#94A3B8';
  const legCol = active ? '#EA580C' : '#64748B';
  const cheek  = active ? '#FCA5A5' : '#94A3B8';
  const eyeCol = '#1E293B';

  /* ── gradients / defs ── */
  const defs = `<defs>
    <radialGradient id="${p}bg" cx="45%" cy="40%" r="58%">
      <stop offset="0%"  stop-color="${bodyB}"/>
      <stop offset="100%" stop-color="${bodyA}"/>
    </radialGradient>
    <radialGradient id="${p}tg" cx="50%" cy="80%" r="60%">
      <stop offset="0%"  stop-color="${tongB}"/>
      <stop offset="100%" stop-color="${tongA}"/>
    </radialGradient>
    ${active ? `<filter id="${p}glow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>` : ''}
  </defs>`;

  /* ── flame tongue (curly, on top of body) ── */
  // Main tongue: starts from body top (50,38), spirals up then curves right
  const tongue = `
    <!-- flame tongue -->
    <path d="M44 40 C38 28 42 18 50 14 C58 10 64 16 60 24 C56 30 48 26 50 20
             C52 15 57 14 60 18"
      stroke="${tongA}" stroke-width="5.5" stroke-linecap="round" fill="none"/>
    <path d="M44 40 C38 28 42 18 50 14 C58 10 64 16 60 24 C56 30 48 26 50 20
             C52 15 57 14 60 18"
      stroke="${tongB}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.7"/>
    <!-- small side flicker left -->
    <path d="M42 44 C36 36 34 28 38 22 C40 18 43 20 41 25"
      stroke="${tongA}" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.7"/>
    <!-- small side flicker right -->
    <path d="M58 44 C64 34 66 26 62 20 C60 16 57 18 59 23"
      stroke="${tongA}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.6"/>`;

  /* ── round body ── */
  const body = `
    <!-- shadow/ground -->
    <ellipse cx="60" cy="114" rx="22" ry="5" fill="#00000012"/>
    <!-- body: rounded teardrop, wide at bottom -->
    <ellipse cx="60" cy="78" rx="28" ry="30"
      fill="url(#${p}bg)" ${active ? `filter="url(#${p}glow)"` : ''}/>
    <!-- belly highlight -->
    <ellipse cx="55" cy="70" rx="12" ry="10" fill="${bodyB}" opacity="0.45"/>`;

  /* ── tiny arms ── */
  const arms = `
    <!-- left arm -->
    <path d="M33 72 C24 68 20 76 26 80" stroke="${armCol}" stroke-width="6"
      stroke-linecap="round" fill="none"/>
    <circle cx="24" cy="79" r="5" fill="${armCol}"/>
    <!-- right arm -->
    <path d="M87 72 C96 68 100 76 94 80" stroke="${armCol}" stroke-width="6"
      stroke-linecap="round" fill="none"/>
    <circle cx="96" cy="79" r="5" fill="${armCol}"/>`;

  /* ── tiny legs / feet ── */
  const legs = `
    <!-- left leg -->
    <ellipse cx="49" cy="109" rx="8" ry="5" fill="${legCol}"/>
    <path d="M49 106 L49 96" stroke="${legCol}" stroke-width="7" stroke-linecap="round"/>
    <!-- right leg -->
    <ellipse cx="71" cy="109" rx="8" ry="5" fill="${legCol}"/>
    <path d="M71 106 L71 96" stroke="${legCol}" stroke-width="7" stroke-linecap="round"/>`;

  /* ── cheeks ── */
  const cheeks = `
    <ellipse cx="40" cy="82" rx="7" ry="5" fill="${cheek}" opacity="${active ? '0.5' : '0.3'}"/>
    <ellipse cx="80" cy="82" rx="7" ry="5" fill="${cheek}" opacity="${active ? '0.5' : '0.3'}"/>`;

  /* ── eyes & mouth ── */
  let face;
  if (active) {
    face = `
      <!-- left eye white -->
      <ellipse cx="50" cy="73" rx="8" ry="9" fill="white"/>
      <ellipse cx="70" cy="73" rx="8" ry="9" fill="white"/>
      <!-- pupils -->
      <ellipse cx="51" cy="74" rx="5" ry="6" fill="${eyeCol}"/>
      <ellipse cx="71" cy="74" rx="5" ry="6" fill="${eyeCol}"/>
      <!-- anime shine: big + small dot -->
      <circle cx="48" cy="71" r="2.5" fill="white"/>
      <circle cx="53" cy="76" r="1.2" fill="white"/>
      <circle cx="68" cy="71" r="2.5" fill="white"/>
      <circle cx="73" cy="76" r="1.2" fill="white"/>
      <!-- happy curved eyebrows -->
      <path d="M43 64 Q50 60 57 64" stroke="${eyeCol}" stroke-width="2"
        stroke-linecap="round" fill="none"/>
      <path d="M63 64 Q70 60 77 64" stroke="${eyeCol}" stroke-width="2"
        stroke-linecap="round" fill="none"/>
      <!-- big happy smile with teeth -->
      <path d="M44 87 Q60 98 76 87" stroke="${eyeCol}" stroke-width="2.2"
        stroke-linecap="round" fill="none"/>
      <path d="M44 87 Q60 95 76 87" fill="white"/>
      <path d="M44 87 Q60 95 76 87" stroke="${eyeCol}" stroke-width="1.2"
        stroke-linecap="round" fill="none"/>`;
  } else {
    face = `
      <!-- sleepy: eye whites -->
      <ellipse cx="50" cy="74" rx="8" ry="8" fill="white"/>
      <ellipse cx="70" cy="74" rx="8" ry="8" fill="white"/>
      <!-- half-closed pupils -->
      <ellipse cx="50" cy="75" rx="5" ry="5" fill="${eyeCol}" opacity="0.85"/>
      <ellipse cx="70" cy="75" rx="5" ry="5" fill="${eyeCol}" opacity="0.85"/>
      <!-- droopy eyelids covering top half -->
      <rect x="42" y="66" width="16" height="9" rx="4" fill="${bodyA}"/>
      <rect x="62" y="66" width="16" height="9" rx="4" fill="${bodyA}"/>
      <!-- small shine still visible -->
      <circle cx="48" cy="73" r="1.8" fill="white" opacity="0.6"/>
      <circle cx="68" cy="73" r="1.8" fill="white" opacity="0.6"/>
      <!-- sleepy eyebrows (flat/droopy) -->
      <path d="M43 65 Q50 63 57 65" stroke="${eyeCol}" stroke-width="1.8"
        stroke-linecap="round" fill="none" opacity="0.6"/>
      <path d="M63 65 Q70 63 77 65" stroke="${eyeCol}" stroke-width="1.8"
        stroke-linecap="round" fill="none" opacity="0.6"/>
      <!-- small neutral mouth -->
      <path d="M50 89 Q60 93 70 89" stroke="${eyeCol}" stroke-width="2"
        stroke-linecap="round" fill="none" opacity="0.7"/>`;
  }

  /* ── active extras: sparkle particles ── */
  const sparkles = active ? `
    <!-- star sparkles around body -->
    <g opacity="0.9">
      <!-- top-left star -->
      <path d="M18 38 L19.5 34 L21 38 L25 38 L22 41 L23 45 L19.5 43 L16 45 L17 41 L14 38Z"
        fill="#FCD34D" transform="scale(0.7) translate(8 0)"/>
      <!-- top-right star -->
      <path d="M82 30 L83.5 26 L85 30 L89 30 L86 33 L87 37 L83.5 35 L80 37 L81 33 L78 30Z"
        fill="#FCD34D" transform="scale(0.6) translate(52 0)"/>
      <!-- small sparkle dots -->
      <circle cx="16" cy="60" r="3" fill="#FBBF24"/>
      <circle cx="104" cy="56" r="2.5" fill="#FBBF24"/>
      <circle cx="22" cy="95" r="2" fill="#FB923C"/>
      <circle cx="100" cy="92" r="2" fill="#FB923C"/>
      <!-- tiny 4-point star right -->
      <path d="M106 68 L107.5 65 L109 68 L112 68 L109 70 L110 73 L107.5 71 L105 73 L106 70 L103 68Z"
        fill="#FEF08A" transform="scale(0.5) translate(108 60)"/>
    </g>` : `
    <!-- zzz bubbles -->
    <g fill="#94A3B8" font-family="sans-serif" font-weight="800">
      <text x="85" y="50" font-size="11" opacity="0.75">z</text>
      <text x="93" y="40" font-size="9"  opacity="0.55">z</text>
      <text x="100" y="31" font-size="7" opacity="0.35">z</text>
    </g>`;

  return `<svg width="${size}" height="${Math.round(size*1.08)}"
      viewBox="0 0 120 130" fill="none" aria-hidden="true"
      style="overflow:visible">
    ${defs}
    ${tongue}
    ${body}
    ${arms}
    ${legs}
    ${cheeks}
    ${face}
    ${sparkles}
  </svg>`;
}

function renderContinueCard() {
  const el = document.getElementById('continueCardContent');
  if (!el) return;

  // Find best item: undone plan first, then nearest deadline task
  const today = todayStr();
  const undonePlan = STATE.plans.find(p => !p.done && p.date === today);
  const nearestTask = STATE.tasks
    .filter(t => !t.done)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];

  const item = undonePlan || nearestTask;

  if (!item) {
    el.innerHTML = `<p class="text-sm text-gray-400 text-center py-3">Semua rencana sudah selesai! 🎉</p>`;
    return;
  }

  const isPlan = !!undonePlan;
  const title = isPlan ? escHtml(item.text) : escHtml(item.title);
  const sub = isPlan ? 'Rencana hari ini' : `Tenggat: ${item.deadline}`;
  const type = isPlan ? 'belajar' : item.type;
  const itemId = item.id;

  // Progress: for tasks, based on done ratio in same type; for plans based on done plans today
  let pct = 0;
  if (isPlan) {
    const todayPlans = STATE.plans.filter(p => p.date === today);
    const donePlans  = todayPlans.filter(p => p.done);
    pct = todayPlans.length > 0 ? Math.round(donePlans.length / todayPlans.length * 100) : 0;
  }

  el.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${type==='belajar' ? 'bg-primary-light' : 'bg-accent-light'}">
        <span class="text-lg">${type==='belajar' ? '📚' : '📝'}</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-gray-800 leading-snug mb-0.5 truncate">${title}</p>
        <p class="text-xs text-gray-400 mb-2">${escHtml(sub)}</p>
        ${isPlan ? `
        <div class="progress-bar-track mb-2">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
        <p class="text-xs text-gray-400">${pct}% rencana selesai</p>` : ''}
      </div>
    </div>
    <button class="btn-primary w-full mt-3 text-sm continue-start-btn"
      data-id="${escHtml(itemId)}" data-isplan="${isPlan}">
      ▶ Mulai Sekarang
    </button>`;
}

function renderPlanList() {
  const ul = document.getElementById('planList');
  if (!ul) return;
  const today = todayStr();
  const todayPlans = STATE.plans.filter(p => p.date === today);

  if (todayPlans.length === 0) {
    ul.innerHTML = `<li class="text-xs text-gray-400 text-center py-2">Belum ada rencana. Tambahkan di atas!</li>`;
    return;
  }

  ul.innerHTML = todayPlans.map(p => `
    <li class="plan-item ${p.done ? 'done-plan' : ''}" data-id="${p.id}">
      <input type="checkbox" class="plan-check w-4 h-4 cursor-pointer" style="accent-color:#7C3AED"
        ${p.done ? 'checked' : ''} aria-label="Tandai selesai: ${escHtml(p.text)}"/>
      <span class="plan-text flex-1 text-sm font-medium text-gray-700">${escHtml(p.text)}</span>
      <button class="plan-delete w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors"
        aria-label="Hapus rencana: ${escHtml(p.text)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
        </svg>
      </button>
    </li>`).join('');
}

function renderBerandaStreakCard() {
  // Mascot
  const mascotEl = document.getElementById('weekMascot');
  const today = todayStr();
  const studiedToday = STATE.sessions.some(s => s.date === today && s.type !== 'istirahat');
  if (mascotEl) {
    // Wrap in a div with animation class
    const animClass = studiedToday ? 'mascot-float fire-active' : 'fire-inactive';
    mascotEl.innerHTML = `<div class="${animClass}" style="display:inline-block">${buildFireMascot(72, studiedToday)}</div>`;
  }

  // Badge
  const badge = document.getElementById('streakBadge');
  if (badge) badge.textContent = `${STATE.streak} hari 🔥`;

  // 7 circles
  const dotsEl = document.getElementById('weekDots');
  if (!dotsEl) return;

  const days = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dayName = days[d.getDay()];
    const hasSession = STATE.sessions.some(s => s.date === dateKey && s.type !== 'istirahat');
    const isToday = i === 0;
    let cls = 'empty';
    if (isToday) cls = 'today';
    else if (hasSession) cls = 'done';

    html += `<div class="flex flex-col items-center gap-1">
      <div class="week-dot ${cls}" title="${dateKey}" aria-label="${dayName}: ${hasSession ? 'sudah belajar' : 'belum belajar'}">${dayName}</div>
      ${hasSession ? '<div class="w-1 h-1 rounded-full bg-accent"></div>' : '<div class="w-1 h-1"></div>'}
    </div>`;
  }
  dotsEl.innerHTML = html;
}

function renderDeadlineList() {
  const ul = document.getElementById('deadlineList');
  if (!ul) return;
  const upcoming = STATE.tasks
    .filter(t => !t.done)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 3);

  if (upcoming.length === 0) {
    ul.innerHTML = `<li class="text-xs text-gray-400 text-center py-2">Tidak ada deadline 🎉</li>`;
    return;
  }

  ul.innerHTML = upcoming.map(t => {
    const dl = formatDeadlineLabel(t.deadline);
    const icon = t.type === 'belajar' ? '📚' : '📝';
    return `<li class="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
      <span class="text-base">${icon}</span>
      <span class="flex-1 text-xs font-medium text-gray-700 truncate">${escHtml(t.title)}</span>
      <span class="deadline-badge ${dl.cls}">${dl.text}</span>
    </li>`;
  }).join('');
}

/* =====================================================
   7. RENDER — Tugas
   ===================================================== */

function renderTugas() {
  const belajarItems = STATE.tasks.filter(t => t.type === 'belajar' && !t.done)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const tugasItems = STATE.tasks.filter(t => t.type === 'tugas' && !t.done)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const belajarDone = STATE.tasks.filter(t => t.type === 'belajar' && t.done);
  const tugasDone = STATE.tasks.filter(t => t.type === 'tugas' && t.done);

  const bCount = document.getElementById('belajarCount');
  const tCount = document.getElementById('tugasCount');
  const bDoneCount = document.getElementById('belajarDoneCount');
  const tDoneCount = document.getElementById('tugasDoneCount');

  if (bCount) bCount.textContent = belajarItems.length;
  if (tCount) tCount.textContent = tugasItems.length;
  if (bDoneCount) bDoneCount.textContent = belajarDone.length;
  if (tDoneCount) tDoneCount.textContent = tugasDone.length;

  const bList = document.getElementById('belajarList');
  const tList = document.getElementById('tugasList');
  const bDoneList = document.getElementById('belajarDoneList');
  const tDoneList = document.getElementById('tugasDoneList');

  if (bList) bList.innerHTML = belajarItems.map(t => renderTaskItem(t)).join('') || `<li class="text-xs text-gray-400 text-center py-3">Tidak ada item belajar</li>`;
  if (tList) tList.innerHTML = tugasItems.map(t => renderTaskItem(t)).join('') || `<li class="text-xs text-gray-400 text-center py-3">Tidak ada item tugas</li>`;
  if (bDoneList) bDoneList.innerHTML = belajarDone.map(t => renderTaskItem(t, true)).join('');
  if (tDoneList) tDoneList.innerHTML = tugasDone.map(t => renderTaskItem(t, true)).join('');
}

function renderTaskItem(task, compact = false) {
  const dl = formatDeadlineLabel(task.deadline);
  const isOverdue = daysFromToday(task.deadline) < 0 && !task.done;
  const deadlineText = isOverdue
    ? `<span class="text-red-500 font-semibold">${Math.abs(daysFromToday(task.deadline))} hari terlambat</span>`
    : `<span class="deadline-badge ${dl.cls}">${dl.text}</span>`;

  return `<li class="task-item ${task.type} ${task.done ? 'done' : ''}" data-id="${task.id}">
    <div class="flex items-start gap-2">
      <input type="checkbox" class="task-check mt-0.5 w-4 h-4 cursor-pointer"
        style="accent-color:${task.type==='belajar'?'#7C3AED':'#F97316'}"
        ${task.done ? 'checked' : ''}
        aria-label="Tandai selesai: ${escHtml(task.title)}"/>
      <div class="flex-1 min-w-0">
        <div class="task-item-title" id="title-${task.id}">${escHtml(task.title)}</div>
        <div class="flex items-center gap-2 mt-1.5">
          ${deadlineText}
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${!task.done ? `
        <button class="task-edit w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary hover:bg-primary-light transition-colors"
          aria-label="Edit: ${escHtml(task.title)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5" aria-hidden="true">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>` : ''}
        <button class="task-delete w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors"
          aria-label="Hapus: ${escHtml(task.title)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>
    </div>
  </li>`;
}

/* =====================================================
   8. RENDER — Timer
   ===================================================== */

function renderTimer() {
  renderTimerDisplay();
  renderTimerControls();
  renderTimerPhaseLabel();
  renderTimerItemSelect();
  renderTimerSettings();
  renderTimerSessions();
}

function renderTimerDisplay() {
  const rem = getRemainingSeconds();
  updateTimerProgressUI(rem);
  // Phase color
  const section = document.getElementById('page-timer');
  if (section) {
    section.classList.toggle('timer-break', STATE.timer.phase === 'istirahat');
  }
}

function renderTimerControls() {
  const btnStart = document.getElementById('btnTimerStart');
  const btnPause = document.getElementById('btnTimerPause');
  if (!btnStart || !btnPause) return;
  if (STATE.timer.running) {
    btnStart.classList.add('hidden');
    btnPause.classList.remove('hidden');
  } else {
    btnStart.classList.remove('hidden');
    btnPause.classList.add('hidden');
  }
}

function renderTimerPhaseLabel() {
  const el = document.getElementById('timerPhaseLabel');
  if (!el) return;
  const labels = { belajar: '📚 Fokus Belajar', tugas: '📝 Fokus Tugas', istirahat: '☕ Istirahat' };
  el.textContent = labels[STATE.timer.phase] || 'Fokus';
  const progEl = document.getElementById('timerProgress');
  if (progEl) {
    progEl.style.stroke = STATE.timer.phase === 'istirahat' ? '#14B8A6' : '#7C3AED';
  }
}

function renderTimerItemSelect() {
  const sel = document.getElementById('timerItemSelect');
  if (!sel) return;
  const today = todayStr();
  const todayPlans = STATE.plans.filter(p => p.date === today && !p.done);
  const tasks = STATE.tasks.filter(t => !t.done);

  let opts = `<option value="free-belajar">🆓 Belajar Bebas</option>
              <option value="free-tugas">🆓 Tugas Bebas</option>`;

  if (todayPlans.length > 0) {
    opts += `<optgroup label="Rencana Hari Ini">`;
    todayPlans.forEach(p => {
      opts += `<option value="${p.id}">${escHtml(p.text)}</option>`;
    });
    opts += `</optgroup>`;
  }

  if (tasks.length > 0) {
    opts += `<optgroup label="Daftar Tugas">`;
    tasks.forEach(t => {
      const icon = t.type === 'belajar' ? '📚' : '📝';
      opts += `<option value="${t.id}">${icon} ${escHtml(t.title)}</option>`;
    });
    opts += `</optgroup>`;
  }

  sel.innerHTML = opts;
  // Restore selection
  if (STATE.timer.selectedItem) sel.value = STATE.timer.selectedItem;
}

function renderTimerSettings() {
  const durB = document.getElementById('durBelajar');
  const durT = document.getElementById('durTugas');
  const durI = document.getElementById('durIstirahat');
  if (durB) durB.value = STATE.timerSettings.belajar;
  if (durT) durT.value = STATE.timerSettings.tugas;
  if (durI) durI.value = STATE.timerSettings.istirahat;
}

function renderTimerSessions() {
  const ul = document.getElementById('sessionList');
  const empty = document.getElementById('sessionEmpty');
  if (!ul) return;

  const today = todayStr();
  const todaySessions = STATE.sessions.filter(s => s.date === today && s.type !== 'istirahat')
    .sort((a, b) => b.startTs - a.startTs);

  if (todaySessions.length === 0) {
    ul.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  ul.innerHTML = todaySessions.map(s => {
    const icon = s.type === 'belajar' ? '📚' : '📝';
    const time = new Date(s.startTs).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `<li class="session-item">
      <span class="text-base shrink-0">${icon}</span>
      <span class="flex-1 text-gray-700 font-medium truncate">${escHtml(s.label)}</span>
      <span class="text-gray-400 shrink-0 ml-1">${formatDuration(s.durationSec)}</span>
      <span class="text-gray-300 text-xs shrink-0 ml-1">${time}</span>
    </li>`;
  }).join('');
}

/* =====================================================
   9. RENDER — Statistik
   ===================================================== */

function renderStatistik() {
  const today = todayStr();
  const todaySec = STATE.sessions
    .filter(s => s.date === today && s.type !== 'istirahat')
    .reduce((acc, s) => acc + s.durationSec, 0);

  // Last 7 days
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const sec = STATE.sessions.filter(s => s.date === dateKey && s.type !== 'istirahat')
      .reduce((acc, s) => acc + s.durationSec, 0);
    last7.push({ date: dateKey, sec, label: ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()] });
  }

  const total7Sec = last7.reduce((a, b) => a + b.sec, 0);

  // Update stat cards
  const statToday = document.getElementById('statToday');
  const stat7days = document.getElementById('stat7days');
  const statStreak = document.getElementById('statStreak');
  if (statToday) statToday.textContent = formatDuration(todaySec);
  if (stat7days) stat7days.textContent = formatDuration(total7Sec);
  if (statStreak) statStreak.textContent = `${STATE.streak} 🔥`;

  renderBarChart(last7);
  renderDonutChart();
}

function renderBarChart(data) {
  const svg = document.getElementById('barChart');
  if (!svg) return;

  const W = 320, H = 200;
  const padL = 36, padR = 10, padT = 16, padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxSec = Math.max(...data.map(d => d.sec), 1);
  const barW = chartW / data.length - 6;

  let svgContent = '';
  // Y-axis grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padT + chartH - (i / 4) * chartH;
    const val = Math.round(maxSec * (i / 4) / 60);
    svgContent += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#F3F4F6" stroke-width="1"/>`;
    svgContent += `<text x="${padL-4}" y="${y+4}" text-anchor="end" font-size="9" fill="#9CA3AF">${val}</text>`;
  }

  data.forEach((d, i) => {
    const barH = d.sec > 0 ? Math.max(4, (d.sec / maxSec) * chartH) : 0;
    const x = padL + i * (chartW / data.length) + (chartW / data.length - barW) / 2;
    const y = padT + chartH - barH;
    const isToday = i === data.length - 1;
    const fill = isToday ? '#7C3AED' : '#C4B5FD';
    const label = formatDuration(d.sec);
    const dayLabel = d.label;

    svgContent += `
      <rect class="chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}"
        rx="4" fill="${fill}" tabindex="0"
        role="img" aria-label="${dayLabel}: ${label}"
        data-tooltip="${dayLabel}: ${label}"
        data-bx="${x + barW/2}" data-by="${y}"/>
      <text x="${x + barW/2}" y="${padT + chartH + 14}" text-anchor="middle" font-size="9" fill="${isToday ? '#7C3AED' : '#6B7280'}" font-weight="${isToday ? '700' : '400'}">${dayLabel}</text>`;
  });

  svg.innerHTML = svgContent;

  // Tooltip events
  svg.querySelectorAll('.chart-bar').forEach(bar => {
    const tooltip = document.getElementById('barTooltip');
    const showTip = () => {
      if (!tooltip) return;
      const bx = parseFloat(bar.getAttribute('data-bx'));
      const by = parseFloat(bar.getAttribute('data-by'));
      tooltip.textContent = bar.getAttribute('data-tooltip');
      // Scale to container
      const svgRect = svg.getBoundingClientRect();
      const container = document.getElementById('barChartContainer');
      const cRect = container ? container.getBoundingClientRect() : svgRect;
      const scaleX = svgRect.width / W;
      const scaleY = svgRect.height / H;
      tooltip.style.left = `${bx * scaleX}px`;
      tooltip.style.top  = `${by * scaleY}px`;
      tooltip.classList.remove('hidden');
    };
    const hideTip = () => tooltip && tooltip.classList.add('hidden');
    bar.addEventListener('mouseenter', showTip);
    bar.addEventListener('mouseleave', hideTip);
    bar.addEventListener('focus', showTip);
    bar.addEventListener('blur', hideTip);
    bar.addEventListener('touchstart', showTip, { passive: true });
    bar.addEventListener('touchend', hideTip, { passive: true });
  });
}

function renderDonutChart() {
  const svg = document.getElementById('donutChart');
  const legend = document.getElementById('donutLegend');
  if (!svg || !legend) return;

  const CX = 80, CY = 80, R = 60, SW = 24;
  const circumf = 2 * Math.PI * R;

  const bSec = STATE.sessions.filter(s => s.type === 'belajar').reduce((a, s) => a + s.durationSec, 0);
  const tSec = STATE.sessions.filter(s => s.type === 'tugas').reduce((a, s) => a + s.durationSec, 0);
  const total = bSec + tSec;

  if (total === 0) {
    svg.innerHTML = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#F3F4F6" stroke-width="${SW}"/>
      <text x="${CX}" y="${CY+4}" text-anchor="middle" font-size="11" fill="#9CA3AF">Belum ada data</text>`;
    legend.innerHTML = '';
    return;
  }

  const bFrac = bSec / total;
  const tFrac = tSec / total;
  const bDash = circumf * bFrac;
  const tDash = circumf * tFrac;

  // Donut: stroke-dashoffset shifts the arc start clockwise.
  // belajar: offset=0 → starts at 12-o'clock
  // tugas:   offset = circumf - bDash → starts right after belajar ends
  const bOffset = 0;
  const tOffset = circumf - bDash;

  svg.innerHTML = `
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#F3F4F6" stroke-width="${SW}"/>
    <circle class="donut-slice" cx="${CX}" cy="${CY}" r="${R}" fill="none"
      stroke="#7C3AED" stroke-width="${SW}"
      stroke-dasharray="${bDash} ${circumf}"
      stroke-dashoffset="${bOffset}"
      transform="rotate(-90 ${CX} ${CY})"
      tabindex="0" role="img"
      aria-label="Belajar: ${formatDuration(bSec)}"
      data-tooltip="📚 Belajar: ${formatDuration(bSec)}"/>
    <circle class="donut-slice" cx="${CX}" cy="${CY}" r="${R}" fill="none"
      stroke="#F97316" stroke-width="${SW}"
      stroke-dasharray="${tDash} ${circumf}"
      stroke-dashoffset="${tOffset}"
      transform="rotate(-90 ${CX} ${CY})"
      tabindex="0" role="img"
      aria-label="Tugas: ${formatDuration(tSec)}"
      data-tooltip="📝 Tugas: ${formatDuration(tSec)}"/>
    <text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#1F2328">${Math.round(bFrac*100)}%</text>
    <text x="${CX}" y="${CY + 8}" text-anchor="middle" font-size="10" fill="#6B7280">Belajar</text>`;

  legend.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full inline-block" style="background:#7C3AED"></span>
      <span class="text-gray-600 text-sm">📚 Belajar</span>
      <span class="font-bold text-sm ml-1" style="color:#7C3AED">${formatDuration(bSec)}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-3 h-3 rounded-full inline-block" style="background:#F97316"></span>
      <span class="text-gray-600 text-sm">📝 Tugas</span>
      <span class="font-bold text-sm ml-1" style="color:#F97316">${formatDuration(tSec)}</span>
    </div>`;

  // Tooltip events
  const tooltip = document.getElementById('donutTooltip');
  svg.querySelectorAll('.donut-slice').forEach(slice => {
    const showTip = (e) => {
      if (!tooltip) return;
      tooltip.textContent = slice.getAttribute('data-tooltip');
      const rect = svg.getBoundingClientRect();
      tooltip.style.left = `${CX}px`;
      tooltip.style.top  = `${CY - R - 10}px`;
      tooltip.classList.remove('hidden');
    };
    const hideTip = () => tooltip && tooltip.classList.add('hidden');
    slice.addEventListener('mouseenter', showTip);
    slice.addEventListener('mouseleave', hideTip);
    slice.addEventListener('focus', showTip);
    slice.addEventListener('blur', hideTip);
    slice.addEventListener('touchstart', showTip, { passive: true });
    slice.addEventListener('touchend', hideTip, { passive: true });
  });
}

/* =====================================================
   10. RENDER — Shared (Chips, Nav)
   ===================================================== */

function renderSharedChips() {
  const today = todayStr();
  const todaySec = STATE.sessions
    .filter(s => s.date === today && s.type !== 'istirahat')
    .reduce((acc, s) => acc + s.durationSec, 0);

  const streakCountEl = document.getElementById('streakCount');
  const todayTimeEl   = document.getElementById('todayTimeText');
  if (streakCountEl) streakCountEl.textContent = STATE.streak;
  if (todayTimeEl)   todayTimeEl.textContent = formatDuration(todaySec);
}

function renderNavActive(page) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const isActive = btn.dataset.page === page;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

function renderPageTitle(page) {
  const titles = {
    beranda: 'Beranda',
    tugas: 'Daftar Tugas',
    timer: 'Timer Belajar',
    statistik: 'Statistik',
  };
  const el = document.getElementById('pageTitle');
  if (el) el.textContent = titles[page] || page;
}

/* =====================================================
   11. EVENTS — Sidebar / Navigation
   ===================================================== */

function setupNavEvents() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar    = document.getElementById('sidebar');
  const overlay    = document.getElementById('sidebarOverlay');

  /** Is this a desktop viewport? */
  function isDesktop() {
    return window.innerWidth >= 1024;
  }

  function openSidebar() {
    STATE.sidebarOpen = true;
    document.body.classList.add('menu-open'); // hamburger → X animation
    if (isDesktop()) {
      // Desktop: expand width (push layout)
      sidebar.classList.remove('sidebar-desktop-closed');
      sidebar.classList.add('sidebar-desktop-open');
    } else {
      // Mobile: slide-in overlay
      sidebar.classList.add('sidebar-open');
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden'; // prevent scroll behind
    }
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Tutup menu navigasi');
  }

  function closeSidebar() {
    STATE.sidebarOpen = false;
    document.body.classList.remove('menu-open'); // X → hamburger animation
    if (isDesktop()) {
      // Desktop: collapse width
      sidebar.classList.remove('sidebar-desktop-open');
      sidebar.classList.add('sidebar-desktop-closed');
    } else {
      // Mobile: slide out
      sidebar.classList.remove('sidebar-open');
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Buka menu navigasi');
  }

  function toggleSidebar() {
    STATE.sidebarOpen ? closeSidebar() : openSidebar();
  }

  // On resize: sync sidebar state with new breakpoint
  window.addEventListener('resize', () => {
    if (isDesktop()) {
      // Always clean up mobile classes
      sidebar.classList.remove('sidebar-open');
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
      // Apply correct desktop class based on current state
      if (STATE.sidebarOpen) {
        sidebar.classList.remove('sidebar-desktop-closed');
        sidebar.classList.add('sidebar-desktop-open');
      } else {
        sidebar.classList.remove('sidebar-desktop-open');
        sidebar.classList.add('sidebar-desktop-closed');
      }
    } else {
      // Always clean up desktop classes on mobile
      sidebar.classList.remove('sidebar-desktop-open', 'sidebar-desktop-closed');
    }
  });

  if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
  if (overlay)    overlay.addEventListener('click', closeSidebar);

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && STATE.sidebarOpen) closeSidebar();
  });

  // Nav button clicks
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
      // Always close sidebar on mobile; on desktop leave open
      if (!isDesktop()) closeSidebar();
    });
  });
}

function navigateTo(page) {
  if (!page) return;
  STATE.currentPage = page;

  // Hide all pages, show target
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  renderNavActive(page);
  renderPageTitle(page);

  // Render page-specific content
  switch (page) {
    case 'beranda':   renderBeranda();   break;
    case 'tugas':     renderTugas();     break;
    case 'timer':     renderTimer();     break;
    case 'statistik': renderStatistik(); break;
  }
}

/* =====================================================
   12. EVENTS — Beranda
   ===================================================== */

function setupBerandaEvents() {
  // "Lanjut Belajar" button
  const btnLanjut = document.getElementById('btnLanjutBelajar');
  if (btnLanjut) {
    btnLanjut.addEventListener('click', () => navigateTo('timer'));
  }

  // Plan form submit
  const planForm = document.getElementById('planForm');
  if (planForm) {
    planForm.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('planInput');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      STATE.plans.push({ id: uid(), text, done: false, date: todayStr() });
      input.value = '';
      saveState();
      renderPlanList();
      renderContinueCard();
      showToast('Rencana ditambahkan!');
    });
  }

  // Plan list — delegation
  const planList = document.getElementById('planList');
  if (planList) {
    planList.addEventListener('change', e => {
      if (!e.target.classList.contains('plan-check')) return;
      const li = e.target.closest('[data-id]');
      if (!li) return;
      const plan = STATE.plans.find(p => p.id === li.dataset.id);
      if (plan) {
        plan.done = e.target.checked;
        saveState();
        renderPlanList();
        renderContinueCard();
        renderSharedChips();
      }
    });

    planList.addEventListener('click', e => {
      const delBtn = e.target.closest('.plan-delete');
      if (!delBtn) return;
      const li = delBtn.closest('[data-id]');
      if (!li) return;
      STATE.plans = STATE.plans.filter(p => p.id !== li.dataset.id);
      saveState();
      renderPlanList();
      renderContinueCard();
      showToast('Rencana dihapus');
    });
  }

  // Continue card "Mulai Sekarang" — use delegation on the card container
  const continueCardEl = document.getElementById('continueCard');
  if (continueCardEl) {
    continueCardEl.addEventListener('click', e => {
      const btn = e.target.closest('.continue-start-btn');
      if (!btn) return;
      const itemId = btn.dataset.id;
      navigateTo('timer');
      // Set timer item selection
      setTimeout(() => {
        const sel = document.getElementById('timerItemSelect');
        if (sel && itemId) {
          sel.value = itemId;
          STATE.timer.selectedItem = itemId;
          // Determine phase based on item
          const plan = STATE.plans.find(p => p.id === itemId);
          const task = STATE.tasks.find(t => t.id === itemId);
          if (plan) STATE.timer.phase = 'belajar';
          if (task) STATE.timer.phase = task.type;
          timerReset();
        }
      }, 50);
    });
  }
}

/* =====================================================
   13. EVENTS — Tugas
   ===================================================== */

function setupTugasEvents() {
  // Add task form
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', e => {
      e.preventDefault();
      const titleEl    = document.getElementById('taskTitle');
      const typeEl     = document.getElementById('taskType');
      const deadlineEl = document.getElementById('taskDeadline');
      const titleErrEl = document.getElementById('taskTitleErr');
      const deadErrEl  = document.getElementById('taskDeadlineErr');

      const title    = titleEl ? titleEl.value.trim() : '';
      const type     = typeEl ? typeEl.value : 'belajar';
      const deadline = deadlineEl ? deadlineEl.value : '';

      let valid = true;
      if (!title) {
        valid = false;
        titleEl && titleEl.classList.add('input-error');
        titleErrEl && titleErrEl.classList.remove('hidden');
      } else {
        titleEl && titleEl.classList.remove('input-error');
        titleErrEl && titleErrEl.classList.add('hidden');
      }
      if (!deadline) {
        valid = false;
        deadlineEl && deadlineEl.classList.add('input-error');
        deadErrEl && deadErrEl.classList.remove('hidden');
      } else {
        deadlineEl && deadlineEl.classList.remove('input-error');
        deadErrEl && deadErrEl.classList.add('hidden');
      }
      if (!valid) return;

      STATE.tasks.push({ id: uid(), title, type, deadline, done: false, createdAt: Date.now() });
      if (titleEl) titleEl.value = '';
      if (deadlineEl) deadlineEl.value = '';
      saveState();
      renderTugas();
      renderTimerItemSelect();
      renderDeadlineList();
      showToast('Item ditambahkan!');
    });

    // Clear errors on input
    taskForm.addEventListener('input', e => {
      if (e.target.id === 'taskTitle') {
        e.target.classList.remove('input-error');
        document.getElementById('taskTitleErr')?.classList.add('hidden');
      }
      if (e.target.id === 'taskDeadline') {
        e.target.classList.remove('input-error');
        document.getElementById('taskDeadlineErr')?.classList.add('hidden');
      }
    });
  }

  // Task list interaction (delegation on document since lists are re-rendered)
  document.addEventListener('change', e => {
    if (!e.target.classList.contains('task-check')) return;
    const li = e.target.closest('[data-id]');
    if (!li) return;
    const task = STATE.tasks.find(t => t.id === li.dataset.id);
    if (!task) return;
    task.done = e.target.checked;
    saveState();
    renderTugas();
    renderDeadlineList();
    renderContinueCard();
  });

  document.addEventListener('click', e => {
    // Delete task
    const delBtn = e.target.closest('.task-delete');
    if (delBtn) {
      const li = delBtn.closest('[data-id]');
      if (!li) return;
      STATE.tasks = STATE.tasks.filter(t => t.id !== li.dataset.id);
      saveState();
      renderTugas();
      renderDeadlineList();
      renderContinueCard();
      renderTimerItemSelect();
      showToast('Item dihapus');
      return;
    }

    // Edit task (inline)
    const editBtn = e.target.closest('.task-edit');
    if (editBtn) {
      const li = editBtn.closest('[data-id]');
      if (!li) return;
      const task = STATE.tasks.find(t => t.id === li.dataset.id);
      if (!task) return;

      const titleEl = document.getElementById(`title-${task.id}`);
      if (!titleEl || titleEl.querySelector('input')) return; // already editing

      const currentText = task.title;
      titleEl.innerHTML = `<input type="text" class="task-edit-input" value="${escHtml(currentText)}" maxlength="100"
        aria-label="Edit judul: ${escHtml(currentText)}"/>`;
      const inp = titleEl.querySelector('input');
      if (inp) {
        inp.focus();
        inp.select();
        const save = () => {
          const newVal = inp.value.trim();
          if (newVal) { task.title = newVal; }
          saveState();
          renderTugas();
          renderDeadlineList();
        };
        inp.addEventListener('blur', save);
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { inp.blur(); }
          if (ev.key === 'Escape') { renderTugas(); }
        });
      }
    }
  });
}

/* =====================================================
   14. EVENTS — Timer
   ===================================================== */

function setupTimerEvents() {
  const btnStart  = document.getElementById('btnTimerStart');
  const btnPause  = document.getElementById('btnTimerPause');
  const btnReset  = document.getElementById('btnTimerReset');
  const btnSkip   = document.getElementById('btnTimerSkip');
  const itemSel   = document.getElementById('timerItemSelect');
  const durB      = document.getElementById('durBelajar');
  const durT      = document.getElementById('durTugas');
  const durI      = document.getElementById('durIstirahat');

  if (btnStart) btnStart.addEventListener('click', () => {
    timerStart();
    renderTimerControls();
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  });

  if (btnPause) btnPause.addEventListener('click', () => {
    timerPause();
    renderTimerControls();
  });

  if (btnReset) btnReset.addEventListener('click', timerReset);
  if (btnSkip)  btnSkip.addEventListener('click', timerSkip);

  if (itemSel) {
    itemSel.addEventListener('change', () => {
      STATE.timer.selectedItem = itemSel.value;
      // Switch phase based on item type
      const task = STATE.tasks.find(t => t.id === itemSel.value);
      if (task) STATE.timer.phase = task.type;
      else if (itemSel.value === 'free-tugas') STATE.timer.phase = 'tugas';
      else STATE.timer.phase = 'belajar';
      timerReset();
      renderTimerPhaseLabel();
    });
  }

  // Duration settings
  function setupDurInput(el, key) {
    if (!el) return;
    el.addEventListener('change', () => {
      const val = Math.min(180, Math.max(1, parseInt(el.value) || 1));
      el.value = val;
      STATE.timerSettings[key] = val;
      saveState();
      // If this matches current phase, reset timer
      if (STATE.timer.phase === key && !STATE.timer.running) {
        STATE.timer.remainSec = phaseDuration();
        renderTimerDisplay();
      }
    });
  }
  setupDurInput(durB, 'belajar');
  setupDurInput(durT, 'tugas');
  setupDurInput(durI, 'istirahat');
}

/* =====================================================
   15. EVENTS — Statistik
   ===================================================== */

function setupStatistikEvents() {
  // Charts are re-rendered on page nav; tooltip events set up in render functions
}

/* =====================================================
   Sidebar utility events (reset data button)
   ===================================================== */

function setupSidebarUtilEvents() {
  const btnReset = document.getElementById('btnResetData');
  if (!btnReset) return;

  btnReset.addEventListener('click', () => {
    // Ask for confirmation to prevent accidental reset
    const confirmed = window.confirm(
      'Reset semua data?\n\nSemua sesi belajar, streak, dan rencana hari ini akan dihapus.\nDaftar tugas akan dikembalikan ke contoh awal.\n\nLanjutkan?'
    );
    if (confirmed) resetAllData();
  });
}

/* =====================================================
   16. INIT
   ===================================================== */

function init() {
  const hasData = loadState();
  if (!hasData) {
    seedDefaultData();
  } else {
    handleDayRollover();
  }

  // Restore running timer if page was closed
  if (STATE.timer.running && STATE.timer.startTs) {
    const rem = getRemainingSeconds();
    if (rem > 0) {
      // Resume interval
      _timerInterval = setInterval(timerTick, 500);
    } else {
      // Timer expired while away
      STATE.timer.running = false;
      STATE.timer.remainSec = 0;
      saveState();
    }
  }

  // Set up events
  setupNavEvents();
  setupBerandaEvents();
  setupTugasEvents();
  setupTimerEvents();
  setupStatistikEvents();
  setupSidebarUtilEvents();

  // Set initial sidebar state based on viewport
  // Desktop: start open (push layout). Mobile: start closed (hidden).
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) {
    if (window.innerWidth >= 1024) {
      // Desktop default: open — add push class and mark menu-open on body
      sidebarEl.classList.add('sidebar-desktop-open');
      document.body.classList.add('menu-open');
      STATE.sidebarOpen = true;
    } else {
      // Mobile default: closed (CSS default transform: translateX(-100%) handles hiding)
      STATE.sidebarOpen = false;
    }
  }

  // Render initial page
  renderSharedChips();
  navigateTo('beranda');

  // Set today's min date on task form
  const deadlineInput = document.getElementById('taskDeadline');
  if (deadlineInput) deadlineInput.min = todayStr();

  // Periodic clock refresh for greeting (every minute)
  setInterval(() => {
    if (STATE.currentPage === 'beranda') renderGreeting();
    renderSharedChips();
  }, 60000);

  // Periodic day rollover check (every 5 min)
  setInterval(() => {
    handleDayRollover();
    if (STATE.currentPage === 'beranda') renderBeranda();
  }, 5 * 60 * 1000);
}

// Run on DOM ready
document.addEventListener('DOMContentLoaded', init);
