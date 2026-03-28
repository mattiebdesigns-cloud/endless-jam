// ─── Config ────────────────────────────────────────────────────────────────
// UPDATE THIS after deploying to Render:
const BACKEND_URL = 'https://endless-jam.onrender.com';

// ─── Comet cursor ────────────────────────────────────────────────────────────
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;
  window.addEventListener('resize', () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  });

  const trail = [];
  let mx = -200, my = -200;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    trail.push({ x: mx, y: my });
    if (trail.length > 28) trail.shift();
  });
  document.addEventListener('mouseleave', () => { mx = -200; my = -200; trail.length = 0; });

  const STAR_COLORS = ['#FFD700', '#FF69B4', '#00FFFF', '#FFFFFF', '#FF4500'];

  function drawStar(x, y, size, alpha, colorIdx) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = STAR_COLORS[colorIdx % STAR_COLORS.length];
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? size : size * 0.4;
      const a = (i * Math.PI) / 4;
      i === 0 ? ctx.moveTo(r * Math.cos(a), r * Math.sin(a))
              : ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      const p = i / trail.length;
      const size = p * 7;
      const alpha = p * 0.85;
      if (i % 2 === 0) drawStar(t.x, t.y, size, alpha, i);
      // faint glow dot between stars
      ctx.save();
      ctx.globalAlpha = alpha * 0.4;
      ctx.fillStyle = i % 3 === 0 ? '#FF69B4' : '#00FFFF';
      ctx.beginPath();
      ctx.arc(t.x, t.y, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Comet head
    if (mx > -100) {
      ctx.save();
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    requestAnimationFrame(render);
  }
  render();
})();

// ─── Elements ────────────────────────────────────────────────────────────────
const audioPlayer    = document.getElementById('audio-player');
const trackName      = document.getElementById('track-name');
const dateHint       = document.getElementById('date-hint');
const tapHint        = document.getElementById('tap-hint');
const loadingState   = document.getElementById('loading-state');
const playerState    = document.getElementById('player-state');
const errorState     = document.getElementById('error-state');
const errorMsg       = document.getElementById('error-message');
const loadingText    = loadingState.querySelector('.vt-text');
const playBtn        = document.getElementById('play-btn');
const nextBtn        = document.getElementById('next-btn');
const retryBtn       = document.getElementById('retry-btn');
const shareBtn       = document.getElementById('share-btn');
const shareToast     = document.getElementById('share-toast');

const photoViewer    = document.getElementById('photo-viewer');
const photoImg       = document.getElementById('photo-img');
const photoPrevBtn   = document.getElementById('photo-prev');
const photoPauseBtn  = document.getElementById('photo-pause');
const photoNextBtn   = document.getElementById('photo-next');

const commentsList   = document.getElementById('comments-list');
const commentsPrompt = document.getElementById('comments-prompt');
const commentInput   = document.getElementById('comment-input');
const commentSubmit  = document.getElementById('comment-submit');

// ─── State ───────────────────────────────────────────────────────────────────
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAYS = [3000, 5000, 8000, 12000, 20000];
let currentFileId = null;
let isPlaying = false;

let photos = [], photoIndex = 0, photoPaused = false, photoTimer = null;
const PHOTO_INTERVAL = 6000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showState(name) {
  loadingState.classList.add('hidden');
  playerState.classList.add('hidden');
  errorState.classList.add('hidden');
  if (name === 'loading') loadingState.classList.remove('hidden');
  else if (name === 'player') playerState.classList.remove('hidden');
  else if (name === 'error') errorState.classList.remove('hidden');
}

function fetchWithTimeout(url, opts = {}, ms = 45000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, ...opts }).finally(() => clearTimeout(id));
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updatePlayBtn() {
  playBtn.innerHTML = isPlaying ? '&#9646;&#9646;' : '&#9654;';
  playBtn.title = isPlaying ? 'Pause' : 'Play';
}

// ─── Comments ─────────────────────────────────────────────────────────────────
async function loadComments(fileId) {
  commentsList.innerHTML = '';
  try {
    const res = await fetch(`${BACKEND_URL}/api/comments/${fileId}`);
    const data = await res.json();
    if (data.length) {
      commentsPrompt.style.display = 'none';
      data.forEach(c => {
        const li = document.createElement('li');
        li.className = 'comment-item';
        li.innerHTML = `<div class="comment-text">${escapeHtml(c.text)}</div>
                        <div class="comment-time">${c.created_at}</div>`;
        commentsList.appendChild(li);
      });
    } else {
      commentsPrompt.style.display = '';
    }
  } catch {
    commentsPrompt.style.display = '';
  }
}

function showGuestbookToast() {
  const toast = document.getElementById('guestbook-toast');
  toast.classList.remove('hidden', 'fading');
  setTimeout(() => {
    toast.classList.add('fading');
    setTimeout(() => toast.classList.add('hidden'), 1000);
  }, 2200);
}

async function submitComment() {
  const text = commentInput.value.trim();
  if (!text || !currentFileId) return;
  commentSubmit.disabled = true;
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/comments/${currentFileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 10000);
    if (res.ok) {
      commentInput.value = '';
      await loadComments(currentFileId);
      showGuestbookToast();
    }
  } catch { /* silent */ } finally { commentSubmit.disabled = false; }
}

// ─── Photos ───────────────────────────────────────────────────────────────────
async function initPhotos() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/photos`);
    photos = await res.json();
    if (!photos.length) return;
    photoIndex = Math.floor(Math.random() * photos.length);
    photoViewer.classList.remove('hidden');
    showPhoto(photoIndex);
    scheduleNextPhoto();
  } catch { /* no photos */ }
}

function showPhoto(i) {
  const p = photos[i];
  if (p) photoImg.src = `${BACKEND_URL}/api/photo/${p.id}`;
}

function scheduleNextPhoto() {
  clearTimeout(photoTimer);
  if (!photoPaused && photos.length > 0) {
    photoTimer = setTimeout(() => {
      photoIndex = (photoIndex + 1) % photos.length;
      showPhoto(photoIndex);
      scheduleNextPhoto();
    }, PHOTO_INTERVAL);
  }
}

photoPrevBtn.addEventListener('click', () => {
  photoIndex = (photoIndex - 1 + photos.length) % photos.length;
  showPhoto(photoIndex); scheduleNextPhoto();
});
photoNextBtn.addEventListener('click', () => {
  photoIndex = (photoIndex + 1) % photos.length;
  showPhoto(photoIndex); scheduleNextPhoto();
});
photoPauseBtn.addEventListener('click', () => {
  photoPaused = !photoPaused;
  photoPauseBtn.innerHTML = photoPaused ? '&#9658;' : '&#9646;&#9646;';
  photoPaused ? clearTimeout(photoTimer) : scheduleNextPhoto();
});

// ─── Audio ───────────────────────────────────────────────────────────────────
playBtn.addEventListener('click', () => {
  if (isPlaying) { audioPlayer.pause(); }
  else { audioPlayer.play().catch(() => {}); }
});

audioPlayer.addEventListener('play',  () => { isPlaying = true;  updatePlayBtn(); tapHint.classList.add('hidden'); });
audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });
audioPlayer.addEventListener('ended', () => { isPlaying = false; retryCount = 0; loadNextTrack(); });
audioPlayer.addEventListener('error', () => { setTimeout(() => { retryCount = 0; loadNextTrack(); }, 2000); });

// ─── Load track ──────────────────────────────────────────────────────────────
async function loadNextTrack() {
  showState('loading');
  isPlaying = false;
  tapHint.classList.add('hidden');

  if (retryCount === 0)       loadingText.textContent = 'loading...';
  else if (retryCount === 1)  loadingText.textContent = 'waking up server...';
  else                        loadingText.textContent = `still trying... (${retryCount}/${MAX_RETRIES})`;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/now-playing`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    currentFileId = data.file_id;
    trackName.textContent = data.display_name || data.name || 'Unknown';
    dateHint.textContent  = data.date_hint || '';

    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer.src = BACKEND_URL + data.stream_url;
    retryCount = 0;
    showState('player');
    updatePlayBtn();
    loadComments(currentFileId);

    try {
      await audioPlayer.play();
      tapHint.classList.add('hidden');
    } catch {
      tapHint.classList.remove('hidden');
    }

  } catch (err) {
    retryCount++;
    if (retryCount <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount - 1] || 20000;
      loadingText.textContent = `retrying in ${Math.round(delay / 1000)}s...`;
      setTimeout(loadNextTrack, delay);
    } else {
      retryCount = 0;
      errorMsg.textContent = `couldn't connect (${err.message})`;
      showState('error');
    }
  }
}

// ─── Share ───────────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', async () => {
  const url = window.location.href;
  const title = currentFileId
    ? `🎵 ${trackName.textContent || 'Endless Jam'}`
    : '🎵 Endless Jam';

  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch { /* fallback */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    shareToast.classList.remove('hidden');
    setTimeout(() => shareToast.classList.add('hidden'), 2200);
  } catch { /* silent */ }
});

// ─── Comment events ───────────────────────────────────────────────────────────
commentSubmit.addEventListener('click', submitComment);
commentInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); }
});
commentInput.addEventListener('focus', () => { commentsPrompt.style.display = 'none'; });
commentInput.addEventListener('blur',  () => {
  if (!commentInput.value.trim() && !commentsList.children.length) commentsPrompt.style.display = '';
});

nextBtn.addEventListener('click',  () => { retryCount = 0; loadNextTrack(); });
retryBtn.addEventListener('click', () => { retryCount = 0; loadNextTrack(); });

// ─── Init ─────────────────────────────────────────────────────────────────────
initPhotos();
loadNextTrack();
