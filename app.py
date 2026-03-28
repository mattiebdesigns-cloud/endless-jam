import os
import json
import random
import sqlite3
import threading
import time
import re
from collections import deque
from datetime import datetime

from flask import Flask, jsonify, Response, request, stream_with_context
from flask_cors import CORS
from google.oauth2 import service_account
import google.auth.transport.requests
from googleapiclient.discovery import build
import requests as http_requests

app = Flask(__name__)
app.config['APP_NAME'] = 'Endless Jam'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SERVICE_ACCOUNT_JSON = json.loads(os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '{}'))
DRIVE_FOLDER_ID = os.environ.get('DRIVE_FOLDER_ID', '0B7pTsV_yQbEXVkRVWEVSZkZJQjg')
DRIVE_RESOURCE_KEY = os.environ.get('DRIVE_RESOURCE_KEY', '0-0IKAUcYG-xFxff_GxKY_NQ')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', '*')
INDEX_FILE = os.environ.get('INDEX_FILE', 'file_index.json')
DB_FILE = os.environ.get('DB_FILE', 'comments.db')

AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac', '.opus', '.wma'}
PHOTO_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}

CONTENT_TYPES = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
    '.wma': 'audio/x-ms-wma',
}

MONTH_NAMES = {
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
}

# Resource key header for legacy Drive folder IDs
RESOURCE_KEY_HEADER = f'{DRIVE_FOLDER_ID}/{DRIVE_RESOURCE_KEY}'

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
file_index = {'audio': [], 'photos': [], 'indexed_at': None}
play_history = deque(maxlen=50)
_index_initialized = False
_index_lock = threading.Lock()

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS(app, origins=CORS_ORIGIN)


@app.after_request
def add_cors_headers(response):
    origin = CORS_ORIGIN if CORS_ORIGIN != '*' else '*'
    response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    return response


# ---------------------------------------------------------------------------
# Google Drive helpers
# ---------------------------------------------------------------------------
def get_credentials():
    creds = service_account.Credentials.from_service_account_info(
        SERVICE_ACCOUNT_JSON,
        scopes=['https://www.googleapis.com/auth/drive.readonly'],
    )
    return creds


def get_drive_service():
    return build('drive', 'v3', credentials=get_credentials(), cache_discovery=False)


def list_folder_recursive(service, folder_id, folder_path=''):
    """Recursively list all audio and photo files under folder_id."""
    results = []
    page_token = None
    extra_headers = {'X-Goog-Drive-Resource-Keys': RESOURCE_KEY_HEADER}

    while True:
        response = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields='nextPageToken, files(id, name, mimeType)',
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute(num_retries=3)
        )

        for f in response.get('files', []):
            if f['mimeType'] == 'application/vnd.google-apps.folder':
                child_path = f"{folder_path}/{f['name']}" if folder_path else f['name']
                results.extend(list_folder_recursive(service, f['id'], child_path))
            else:
                ext = os.path.splitext(f['name'])[1].lower()
                if ext in AUDIO_EXTENSIONS or ext in PHOTO_EXTENSIONS:
                    results.append({
                        'id': f['id'],
                        'name': f['name'],
                        'mimeType': f['mimeType'],
                        'folder_path': folder_path,
                        'ext': ext,
                    })

        page_token = response.get('nextPageToken')
        if not page_token:
            break

    return results


def build_index():
    service = get_drive_service()
    all_files = list_folder_recursive(service, DRIVE_FOLDER_ID)
    return {
        'audio': [f for f in all_files if f['ext'] in AUDIO_EXTENSIONS],
        'photos': [f for f in all_files if f['ext'] in PHOTO_EXTENSIONS],
        'indexed_at': time.time(),
    }


def save_index(index):
    with open(INDEX_FILE, 'w') as fh:
        json.dump(index, fh)


def refresh_index_background():
    """Re-scan Drive after a short delay and update the cache file."""
    time.sleep(10)  # Let the first track start before scanning
    try:
        new_index = build_index()
        with _index_lock:
            global file_index
            file_index = new_index
        save_index(new_index)
        app.logger.info(
            f'Index refreshed: {len(new_index["audio"])} audio, '
            f'{len(new_index["photos"])} photos'
        )
    except Exception as exc:
        app.logger.error(f'Background index refresh failed: {exc}')


def load_or_build_index():
    global file_index, _index_initialized
    with _index_lock:
        if _index_initialized:
            return
        _index_initialized = True

    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE) as fh:
                file_index = json.load(fh)
            app.logger.info(
                f'Loaded index from cache: {len(file_index["audio"])} audio files'
            )
            threading.Thread(target=refresh_index_background, daemon=True).start()
            return
        except Exception as exc:
            app.logger.warning(f'Cache load failed ({exc}), rebuilding from Drive')

    app.logger.info('Building Drive index for the first time...')
    try:
        file_index = build_index()
        save_index(file_index)
        app.logger.info(
            f'Index built: {len(file_index["audio"])} audio, '
            f'{len(file_index["photos"])} photos'
        )
    except Exception as exc:
        app.logger.error(f'Failed to build Drive index: {exc}')


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------
def parse_date_hint(folder_path: str, filename: str):
    year = None
    month = None

    for part in folder_path.split('/'):
        part_clean = part.strip()
        if part_clean.isdigit() and 1990 <= int(part_clean) <= 2030:
            year = part_clean
        elif part_clean.lower() in MONTH_NAMES:
            month = part_clean.capitalize()

    if year and month:
        return f'{month} {year}'
    if year:
        return year

    match = re.search(r'(\d{4})[-_](\d{2})[-_](\d{2})', filename)
    if match:
        try:
            d = datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            return d.strftime('%B %Y')
        except ValueError:
            pass

    return None


def make_display_name(filename: str) -> str:
    name = os.path.splitext(filename)[0]
    name = re.sub(r'^\d{4}[-_]\d{2}[-_]\d{2}[-_\s]*', '', name)
    name = name.replace('_', ' ').replace('-', ' ').strip()
    return name if name else os.path.splitext(filename)[0]


# ---------------------------------------------------------------------------
# SQLite — comments
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        conn.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/status')
def status():
    return jsonify({
        'audio_count': len(file_index.get('audio', [])),
        'photo_count': len(file_index.get('photos', [])),
        'indexed_at': file_index.get('indexed_at'),
        'recent_plays': len(play_history),
    })


@app.route('/api/now-playing')
def now_playing():
    audio = file_index.get('audio', [])
    if not audio:
        return jsonify({'error': 'No audio files indexed yet. Try again in a moment.'}), 503

    recent = set(play_history)
    available = [f for f in audio if f['id'] not in recent]
    if not available:
        available = audio  # All played — start fresh

    track = random.choice(available)
    play_history.append(track['id'])

    date_hint = parse_date_hint(track.get('folder_path', ''), track['name'])
    display_name = make_display_name(track['name'])

    return jsonify({
        'file_id': track['id'],
        'name': track['name'],
        'display_name': display_name,
        'date_hint': date_hint,
        'folder_path': track.get('folder_path', ''),
        'stream_url': f'/api/stream/{track["id"]}',
    })


@app.route('/api/stream/<file_id>')
def stream_audio(file_id):
    try:
        service = get_drive_service()
        file_meta = (
            service.files()
            .get(fileId=file_id, fields='name,mimeType', supportsAllDrives=True)
            .execute()
        )
    except Exception as exc:
        return jsonify({'error': str(exc)}), 502

    # Refresh credentials for direct HTTP request
    creds = get_credentials()
    auth_req = google.auth.transport.requests.Request()
    creds.refresh(auth_req)

    drive_url = (
        f'https://www.googleapis.com/drive/v3/files/{file_id}'
        f'?alt=media&supportsAllDrives=true'
    )

    req_headers = {
        'Authorization': f'Bearer {creds.token}',
        'X-Goog-Drive-Resource-Keys': RESOURCE_KEY_HEADER,
    }
    if 'Range' in request.headers:
        req_headers['Range'] = request.headers['Range']

    drive_resp = http_requests.get(drive_url, headers=req_headers, stream=True)

    ext = os.path.splitext(file_meta.get('name', ''))[1].lower()
    content_type = CONTENT_TYPES.get(
        ext,
        drive_resp.headers.get('Content-Type', 'audio/mpeg'),
    )

    resp_headers = {
        'Content-Type': content_type,
        'Accept-Ranges': 'bytes',
    }
    for h in ('Content-Range', 'Content-Length'):
        if h in drive_resp.headers:
            resp_headers[h] = drive_resp.headers[h]

    return Response(
        stream_with_context(drive_resp.iter_content(chunk_size=8192)),
        status=drive_resp.status_code,
        headers=resp_headers,
    )


# ---------------------------------------------------------------------------
# Comments routes
# ---------------------------------------------------------------------------
@app.route('/api/comments/<file_id>', methods=['GET'])
def get_comments(file_id):
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, text, created_at FROM comments WHERE file_id = ? ORDER BY created_at',
            (file_id,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/comments/<file_id>', methods=['POST'])
def add_comment(file_id):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment text is required'}), 400
    if len(text) > 500:
        return jsonify({'error': 'Comment must be 500 characters or fewer'}), 400

    with get_db() as conn:
        conn.execute(
            'INSERT INTO comments (file_id, text, created_at) VALUES (?, ?, ?)',
            (file_id, text, datetime.utcnow().strftime('%Y-%m-%d %H:%M')),
        )
        conn.commit()
    return jsonify({'ok': True}), 201


# ---------------------------------------------------------------------------
# Photos route
# ---------------------------------------------------------------------------
@app.route('/api/photos')
def get_photos():
    photos = file_index.get('photos', [])
    folder = request.args.get('folder', '')
    if folder:
        photos = [p for p in photos if p.get('folder_path', '').startswith(folder)]
    return jsonify(photos)


@app.route('/api/photo/<file_id>')
def stream_photo(file_id):
    creds = get_credentials()
    auth_req = google.auth.transport.requests.Request()
    creds.refresh(auth_req)

    drive_url = (
        f'https://www.googleapis.com/drive/v3/files/{file_id}'
        f'?alt=media&supportsAllDrives=true'
    )
    req_headers = {
        'Authorization': f'Bearer {creds.token}',
        'X-Goog-Drive-Resource-Keys': RESOURCE_KEY_HEADER,
    }

    drive_resp = http_requests.get(drive_url, headers=req_headers, stream=True)
    content_type = drive_resp.headers.get('Content-Type', 'image/jpeg')

    return Response(
        stream_with_context(drive_resp.iter_content(chunk_size=8192)),
        status=drive_resp.status_code,
        headers={'Content-Type': content_type},
    )


# ---------------------------------------------------------------------------
# Startup — runs for both direct execution and gunicorn
# ---------------------------------------------------------------------------
init_db()
load_or_build_index()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
