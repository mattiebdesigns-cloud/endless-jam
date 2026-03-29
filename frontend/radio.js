// ─── Config ────────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://endless-jam.onrender.com';

// ─── Comet cursor (desktop only) ─────────────────────────────────────────────
if (window.matchMedia('(pointer: fine)').matches) {
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;
  window.addEventListener('resize', () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; });

  const trail = [];
  let mx = -200, my = -200;
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; trail.push({ x: mx, y: my }); if (trail.length > 28) trail.shift(); });
  document.addEventListener('mouseleave', () => { mx = -200; my = -200; trail.length = 0; });

  const STAR_COLORS = ['#FFD700','#FF69B4','#00FFFF','#FFFFFF','#FF4500'];
  function drawStar(x, y, size, alpha, ci) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = STAR_COLORS[ci % STAR_COLORS.length];
    ctx.translate(x, y); ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i%2===0?size:size*0.4; const a=(i*Math.PI)/4; i===0?ctx.moveTo(r*Math.cos(a),r*Math.sin(a)):ctx.lineTo(r*Math.cos(a),r*Math.sin(a)); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i], p = i/trail.length, size = p*7, alpha = p*0.85;
      if (i%2===0) drawStar(t.x, t.y, size, alpha, i);
      ctx.save(); ctx.globalAlpha = alpha*0.4; ctx.fillStyle = i%3===0?'#FF69B4':'#00FFFF';
      ctx.beginPath(); ctx.arc(t.x, t.y, size*0.35, 0, Math.PI*2); ctx.fill(); ctx.restore();
    }
    if (mx > -100) { ctx.save(); ctx.shadowColor='#FFD700'; ctx.shadowBlur=18; ctx.fillStyle='#FFFFFF'; ctx.beginPath(); ctx.arc(mx,my,4.5,0,Math.PI*2); ctx.fill(); ctx.restore(); }
    requestAnimationFrame(render);
  }
  render();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isMobile = () => window.innerWidth <= 700;

function qs(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fetchWithTimeout(url, opts = {}, ms = 45000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, ...opts }).finally(() => clearTimeout(id));
}

function showToast(id) {
  const el = qs(id);
  if (!el) return;
  el.classList.remove('hidden', 'fading');
  setTimeout(() => { el.classList.add('fading'); setTimeout(() => el.classList.add('hidden'), 1000); }, 2200);
}

// ─── State ───────────────────────────────────────────────────────────────────
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAYS = [3000, 5000, 8000, 12000, 20000];
let currentFileId = null;
let isPlaying = false;

// Desktop audio (hidden, JS-controlled) and mobile audio (native controls)
const audioPlayer       = qs('audio-player');
const audioPlayerMobile = qs('audio-player-mobile');

// ─── Desktop UI refs ──────────────────────────────────────────────────────────
const loadingState = qs('loading-state');
const playerState  = qs('player-state');
const errorState   = qs('error-state');
const loadingText  = loadingState ? loadingState.querySelector('.vt-text') : null;
const playBtn      = qs('play-btn');
const nextBtn      = qs('next-btn');
const retryBtn     = qs('retry-btn');
const shareBtn     = qs('share-btn');
const shareToast   = qs('share-toast');
const trackNameEl  = qs('track-name');
const dateHintEl   = qs('date-hint');
const tapHint      = qs('tap-hint');
const commentsList = qs('comments-list');
const commentInput = qs('comment-input');
const commentSubmit= qs('comment-submit');
const gbList       = qs('guestbook-list');
const gbInput      = qs('guestbook-input');
const gbSubmit     = qs('guestbook-submit');

// ─── Mobile UI refs ───────────────────────────────────────────────────────────
const mLoading     = qs('m-loading');
const mPlayer      = qs('m-player');
const mDateEl      = qs('m-date');
const mFilenameEl  = qs('m-filename');
const mTrackEl     = qs('m-track');
const mNextBtn     = qs('m-next');
const mCommentList = qs('m-comments-list');
const mCommentInput= qs('m-comment-input');
const mCommentSub  = qs('m-comment-submit');
const mGbList      = qs('m-guestbook-list');
const mGbInput     = qs('m-guestbook-input');
const mGbSubmit    = qs('m-guestbook-submit');

// ─── Desktop state helpers ────────────────────────────────────────────────────
function showState(name) {
  if (!loadingState) return;
  loadingState.classList.add('hidden');
  playerState.classList.add('hidden');
  errorState.classList.add('hidden');
  if (name === 'loading') loadingState.classList.remove('hidden');
  else if (name === 'player') playerState.classList.remove('hidden');
  else if (name === 'error') errorState.classList.remove('hidden');
}

function updatePlayBtn() {
  if (playBtn) { playBtn.innerHTML = isPlaying ? '&#9646;&#9646;' : '&#9654;'; playBtn.title = isPlaying ? 'Pause' : 'Play'; }
}

// ─── Comments (Song Feels — per track) ───────────────────────────────────────
function renderComments(data, listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!data.length) {
    listEl.innerHTML = '<li class="comment-empty">no feels yet</li>';
    return;
  }
  data.forEach(c => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    li.innerHTML = `<div class="comment-text">${escapeHtml(c.text)}</div><div class="comment-time">${c.created_at}</div>`;
    listEl.appendChild(li);
  });
}

async function loadComments(fileId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/comments/${fileId}`);
    const data = await res.json();
    renderComments(data, commentsList);
    renderComments(data, mCommentList);
  } catch {
    renderComments([], commentsList);
    renderComments([], mCommentList);
  }
}

function appendItem(listEl, text, emptyClass) {
  if (!listEl) return;
  const empty = listEl.querySelector('.' + emptyClass);
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = 'comment-item';
  li.innerHTML = `<div class="comment-text">${escapeHtml(text)}</div><div class="comment-time">just now</div>`;
  listEl.appendChild(li);
  listEl.scrollTop = listEl.scrollHeight;
}

async function submitSongFeels(inputEl, listEl) {
  const text = (inputEl ? inputEl.value : '').trim();
  if (!text || !currentFileId) return;
  inputEl.disabled = true;
  appendItem(commentsList, text, 'comment-empty');
  appendItem(mCommentList, text, 'comment-empty');
  inputEl.value = '';
  showToast('songfeels-toast');
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/comments/${currentFileId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 10000);
    if (res.ok) {
      const data = await (await fetch(`${BACKEND_URL}/api/comments/${currentFileId}`)).json();
      renderComments(data, commentsList);
      renderComments(data, mCommentList);
    }
  } catch { } finally { inputEl.disabled = false; }
}

// ─── Guestbook (site-wide) ────────────────────────────────────────────────────
function renderGuestbook(data, listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!data.length) {
    listEl.innerHTML = '<li class="comment-empty">be the first to sign!</li>';
    return;
  }
  data.forEach(c => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    li.innerHTML = `<div class="comment-text">${escapeHtml(c.text)}</div><div class="comment-time">${c.created_at}</div>`;
    listEl.appendChild(li);
  });
}

async function loadGuestbook() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/guestbook`);
    const data = await res.json();
    renderGuestbook(data, gbList);
    renderGuestbook(data, mGbList);
  } catch { }
}

async function submitGuestbook(inputEl, listEl) {
  const text = (inputEl ? inputEl.value : '').trim();
  if (!text) return;
  inputEl.disabled = true;
  appendItem(gbList, text, 'comment-empty');
  appendItem(mGbList, text, 'comment-empty');
  inputEl.value = '';
  showToast('guestbook-toast');
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/guestbook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 10000);
    if (res.ok) {
      const data = await (await fetch(`${BACKEND_URL}/api/guestbook`)).json();
      renderGuestbook(data, gbList);
      renderGuestbook(data, mGbList);
    }
  } catch { } finally { inputEl.disabled = false; }
}

// ─── Audio events ─────────────────────────────────────────────────────────────
if (playBtn) {
  playBtn.addEventListener('click', () => { isPlaying ? audioPlayer.pause() : audioPlayer.play().catch(()=>{}); });
}
audioPlayer.addEventListener('play',  () => { isPlaying = true;  updatePlayBtn(); if (tapHint) tapHint.classList.add('hidden'); });
audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });
audioPlayer.addEventListener('ended', () => { isPlaying = false; retryCount = 0; loadNextTrack(); });
audioPlayer.addEventListener('error', () => { setTimeout(() => { retryCount = 0; loadNextTrack(); }, 2000); });

// Mobile audio — auto-advance on end/error
if (audioPlayerMobile) {
  audioPlayerMobile.addEventListener('ended', () => { retryCount = 0; loadNextTrack(); });
  audioPlayerMobile.addEventListener('error', () => { setTimeout(() => { retryCount = 0; loadNextTrack(); }, 2000); });
}

// ─── Load track ──────────────────────────────────────────────────────────────
async function loadNextTrack() {
  isPlaying = false;
  showState('loading');
  if (mLoading) mLoading.style.display = '';
  if (mPlayer)  mPlayer.style.display  = 'none';
  if (tapHint)  tapHint.classList.add('hidden');

  const msg = retryCount === 0 ? 'loading...' : retryCount === 1 ? 'waking up server...' : `still trying... (${retryCount}/${MAX_RETRIES})`;
  if (loadingText) loadingText.textContent = msg;
  if (mLoading) mLoading.textContent = msg;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/now-playing`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    currentFileId = data.file_id;
    const displayName = data.display_name || data.name || 'Unknown';
    const dateStr     = data.date_hint || '';
    const filename    = data.name || '';

    // Desktop UI
    if (trackNameEl) trackNameEl.textContent = displayName;
    if (dateHintEl)  dateHintEl.textContent  = dateStr ? `${dateStr}  ·  ${filename}` : filename;

    // Mobile UI
    if (mTrackEl)    mTrackEl.textContent    = displayName;
    if (mDateEl)     mDateEl.textContent     = dateStr;
    if (mFilenameEl) mFilenameEl.textContent = filename;
    if (mLoading)    mLoading.style.display  = 'none';
    if (mPlayer)     mPlayer.style.display   = '';

    const streamSrc = BACKEND_URL + data.stream_url;
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.src = streamSrc;
    if (audioPlayerMobile) {
      audioPlayerMobile.src = '';
      audioPlayerMobile.src = streamSrc;
      audioPlayerMobile.load();
    }

    retryCount = 0;
    showState('player');
    updatePlayBtn();
    loadComments(currentFileId);

    try {
      await audioPlayer.play();
      if (tapHint) tapHint.classList.add('hidden');
    } catch {
      if (tapHint) tapHint.classList.remove('hidden');
    }

  } catch (err) {
    retryCount++;
    if (retryCount <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount-1] || 20000;
      const retryMsg = `retrying in ${Math.round(delay/1000)}s...`;
      if (loadingText) loadingText.textContent = retryMsg;
      if (mLoading) mLoading.textContent = retryMsg;
      setTimeout(loadNextTrack, delay);
    } else {
      retryCount = 0;
      const errMsg = `couldn't connect (${err.message})`;
      if (qs('error-message')) qs('error-message').textContent = errMsg;
      showState('error');
    }
  }
}

// ─── Share ────────────────────────────────────────────────────────────────────
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const url = window.location.href;
    const title = `🎵 ${trackNameEl ? trackNameEl.textContent : 'Endless Jam'}`;
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { } }
    try { await navigator.clipboard.writeText(url); shareToast.classList.remove('hidden'); setTimeout(() => shareToast.classList.add('hidden'), 2200); } catch { }
  });
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

// Desktop — Song Feels
if (commentSubmit) commentSubmit.addEventListener('click', () => submitSongFeels(commentInput, commentsList));
if (commentInput)  commentInput.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitSongFeels(commentInput,commentsList);} });

// Desktop — Guestbook
if (gbSubmit) gbSubmit.addEventListener('click', () => submitGuestbook(gbInput, gbList));
if (gbInput)  gbInput.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitGuestbook(gbInput,gbList);} });

// Desktop — Next / Retry
if (nextBtn)  nextBtn.addEventListener('click',  () => { retryCount = 0; loadNextTrack(); });
if (retryBtn) retryBtn.addEventListener('click', () => { retryCount = 0; loadNextTrack(); });

// Mobile — Song Feels
if (mCommentSub) mCommentSub.addEventListener('click', () => submitSongFeels(mCommentInput, mCommentList));
if (mCommentInput) mCommentInput.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitSongFeels(mCommentInput,mCommentList);} });

// Mobile — Guestbook
if (mGbSubmit) mGbSubmit.addEventListener('click', () => submitGuestbook(mGbInput, mGbList));
if (mGbInput)  mGbInput.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitGuestbook(mGbInput,mGbList);} });

// Mobile — Next
if (mNextBtn) mNextBtn.addEventListener('click', () => { retryCount = 0; loadNextTrack(); });

// ─── Volume slider ────────────────────────────────────────────────────────────
const volSlider = qs('volume-slider');
if (volSlider) {
  volSlider.addEventListener('input', () => { audioPlayer.volume = parseFloat(volSlider.value); });
}

// ─── Autoplay unlock — first user interaction starts audio if blocked ─────────
let autoplayUnlocked = false;
function unlockAutoplay() {
  if (autoplayUnlocked || isPlaying) return;
  autoplayUnlocked = true;
  audioPlayer.play().catch(() => {});
  if (tapHint) tapHint.classList.add('hidden');
}
document.addEventListener('click', unlockAutoplay, { once: true });
document.addEventListener('keydown', unlockAutoplay, { once: true });

// ─── Init ─────────────────────────────────────────────────────────────────────
loadGuestbook();
loadNextTrack();
