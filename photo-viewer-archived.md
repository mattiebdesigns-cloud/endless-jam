# Photo Viewer — Archived Code

Removed temporarily — talk to the crew before making photos public.
Re-integrate when ready.

---

## index.html — add inside `.notebook-wrapper` (before closing `</div>`)

```html
<!-- Photo viewer -->
<div id="photo-viewer" class="photo-viewer hidden">
  <img id="photo-img" src="" alt=""/>
  <div class="photo-controls">
    <button id="photo-prev" class="photo-btn">&#9668;</button>
    <button id="photo-pause" class="photo-btn">&#9646;&#9646;</button>
    <button id="photo-next" class="photo-btn">&#9658;</button>
  </div>
</div>
```

---

## style.css — photo viewer rules

```css
/* ─── Photo viewer ──────────────────────────────────────── */
.photo-viewer {
  max-width: 1000px;
  margin: 16px auto 0;
  background: #000;
  border: 4px solid #ff00ff;
  box-shadow: 0 0 20px #ff00ff;
  position: relative;
  aspect-ratio: 4/3;
}
.photo-viewer.hidden { display: none; }

#photo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.photo-controls {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
}

.photo-btn {
  background: rgba(0,0,0,0.7);
  color: #00ffff;
  border: 1px solid #00ffff;
  padding: 5px 14px;
  font-family: inherit;
  cursor: pointer;
}
.photo-btn:hover { background: rgba(0,255,255,0.2); }
```

---

## radio.js — add these back

### Near the top (after `const audioPlayer` line):
```javascript
// Photos
let photos = [], photoIndex = 0, photoPaused = false, photoTimer = null;
const PHOTO_INTERVAL = 6000;
```

### Photo functions (add before audio events section):
```javascript
// ─── Photos ───────────────────────────────────────────────────────────────────
async function initPhotos() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/photos`);
    photos = await res.json();
    if (!photos.length) return;
    photoIndex = Math.floor(Math.random() * photos.length);
    qs('photo-viewer').classList.remove('hidden');
    showPhoto(photoIndex); scheduleNextPhoto();
  } catch { }
}

function showPhoto(i) {
  const p = photos[i]; if (p) qs('photo-img').src = `${BACKEND_URL}/api/photo/${p.id}`;
}
function scheduleNextPhoto() {
  clearTimeout(photoTimer);
  if (!photoPaused && photos.length > 0) {
    photoTimer = setTimeout(() => { photoIndex = (photoIndex+1)%photos.length; showPhoto(photoIndex); scheduleNextPhoto(); }, PHOTO_INTERVAL);
  }
}

qs('photo-prev').addEventListener('click', () => { photoIndex=(photoIndex-1+photos.length)%photos.length; showPhoto(photoIndex); scheduleNextPhoto(); });
qs('photo-next').addEventListener('click', () => { photoIndex=(photoIndex+1)%photos.length; showPhoto(photoIndex); scheduleNextPhoto(); });
qs('photo-pause').addEventListener('click', () => {
  photoPaused = !photoPaused;
  qs('photo-pause').innerHTML = photoPaused ? '&#9658;' : '&#9646;&#9646;';
  photoPaused ? clearTimeout(photoTimer) : scheduleNextPhoto();
});
```

### In the Init section — add `initPhotos();` before `loadNextTrack();`
