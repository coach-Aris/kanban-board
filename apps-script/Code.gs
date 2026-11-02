/**
 * CONTENT MANAGER - FIRESTORE SYNC
 *
 * Haelt die Firestore-Sammlung "videos" aktuell:
 *  1. Neue Google Docs im Skript-Ordner  -> neues Video (Status "Aufnahme")
 *  2. Skript aus dem Ordner entfernt     -> Video wird geloescht
 *  3. Neue YouTube-Uploads               -> neues Video (Status "Upload")
 *  4. YouTube-Statistiken                -> Views/Likes/Kommentare, Veroeffentlichungsdatum + Tagesverlauf
 *
 * Einrichtung (einmalig):
 *  - Projekteinstellungen > Google-Cloud-Projekt: Projektnummer 372707937763
 *  - Projekteinstellungen > "appsscript.json im Editor anzeigen" und Inhalt aus appsscript.json uebernehmen
 *  - Dienste > YouTube Data API v3 hinzufuegen
 *  - Funktion setup() einmal ausfuehren (Berechtigungen bestaetigen, legt den Trigger an)
 */

const CONFIG = {
  projectId: 'content-app-e4022',
  scriptFolderId: '1vRC6AEuwVP4elYlLsh95vjU84dXfsUKm',
  channelId: 'UC4KZuocTMvcBEBrcOjKyRgA',
  timeZone: 'Europe/Zurich',
  maxYoutubeImport: 15,
  syncEveryMinutes: 30,
};

const STATUS = { RECORDING: 'Aufnahme', UPLOADED: 'Upload' };
const FIRESTORE_URL =
  'https://firestore.googleapis.com/v1/projects/' + CONFIG.projectId + '/databases/(default)/documents';

// ---------- Einstieg ----------

/** Einmalig ausfuehren: erstellt den Zeit-Trigger und startet den ersten Lauf. */
function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('mainSync').timeBased().everyMinutes(CONFIG.syncEveryMinutes).create();
  mainSync();
}

function mainSync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log('Anderer Lauf aktiv, ueberspringe.');
    return;
  }
  try {
    const videos = listVideos();
    syncDriveFiles(videos);
    importYoutubeUploads(videos);
    updateYoutubeStats(videos);
    console.log('Sync beendet (' + videos.length + ' Videos).');
  } finally {
    lock.releaseLock();
  }
}

// ---------- 1 + 2: Drive-Ordner ----------

function syncDriveFiles(videos) {
  try {
    const files = DriveApp.getFolderById(CONFIG.scriptFolderId).getFilesByType(MimeType.GOOGLE_DOCS);
    const drive = [];
    while (files.hasNext()) {
      const file = files.next();
      drive.push({ url: file.getUrl().trim(), name: file.getName() });
    }
    const driveUrls = drive.map((f) => f.url);

    // Entfernte Skripte loeschen. Leere Ordnerliste gilt als Fehler und loescht nichts.
    if (driveUrls.length > 0) {
      videos
        .filter((v) => v.scriptLink && !driveUrls.includes(v.scriptLink))
        .forEach((v) => {
          console.log('Loesche "' + v.title + '" (Skript nicht mehr im Ordner)');
          deleteDocument('videos/' + v.id);
          videos.splice(videos.indexOf(v), 1);
        });
    }

    drive
      .filter((f) => !videos.some((v) => v.scriptLink === f.url))
      .forEach((f) => {
        console.log('Neu im Ordner: ' + f.name);
        addVideo(videos, 'doc-' + driveFileId(f.url), {
          title: f.name,
          status: STATUS.RECORDING,
          scriptLink: f.url,
          notes: 'Auto-Import',
        });
      });
  } catch (e) {
    console.error('Drive-Sync fehlgeschlagen: ' + e.message);
  }
}

// ---------- 3: YouTube-Uploads ----------

function importYoutubeUploads(videos) {
  try {
    const channel = YouTube.Channels.list('contentDetails', { id: CONFIG.channelId });
    if (!channel.items || channel.items.length === 0) return;
    const uploadsId = channel.items[0].contentDetails.relatedPlaylists.uploads;
    const uploads = YouTube.PlaylistItems.list('snippet', {
      playlistId: uploadsId,
      maxResults: CONFIG.maxYoutubeImport,
    });

    (uploads.items || []).forEach((item) => {
      const ytId = item.snippet.resourceId.videoId;
      if (videos.some((v) => youtubeId(v.youtubeUrl) === ytId)) return;
      console.log('Neuer Upload: ' + item.snippet.title);
      addVideo(videos, 'yt-' + ytId, {
        title: item.snippet.title,
        status: STATUS.UPLOADED,
        youtubeUrl: 'https://www.youtube.com/watch?v=' + ytId,
        notes: 'Auto-Import YT',
      });
    });
  } catch (e) {
    console.error('YouTube-Import fehlgeschlagen: ' + e.message);
  }
}

// ---------- 4: Statistiken ----------

function updateYoutubeStats(videos) {
  try {
    const docsByYtId = {};
    videos.forEach((v) => {
      const ytId = youtubeId(v.youtubeUrl);
      if (ytId) (docsByYtId[ytId] = docsByYtId[ytId] || []).push(v.id);
    });
    const ytIds = Object.keys(docsByYtId);
    const today = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');

    for (let i = 0; i < ytIds.length; i += 50) {
      const res = YouTube.Videos.list('snippet,statistics', { id: ytIds.slice(i, i + 50).join(',') });
      (res.items || []).forEach((item) => {
        const stats = {
          views: Number(item.statistics.viewCount || 0),
          likes: Number(item.statistics.likeCount || 0),
          comments: Number(item.statistics.commentCount || 0),
        };
        docsByYtId[item.id].forEach((docId) => {
          patchDocument('videos/' + docId, Object.assign({ publishedAt: item.snippet.publishedAt }, stats));
          patchDocument('videos/' + docId + '/stats/' + today, Object.assign({ date: today }, stats));
        });
      });
    }
  } catch (e) {
    console.error('Statistik-Update fehlgeschlagen: ' + e.message);
  }
}

// ---------- Videos ----------

/** Legt ein Video an und haengt es an die lokale Liste. */
function addVideo(videos, docId, fields) {
  const order = videos.reduce((max, v) => Math.max(max, v.order), 0) + 1;
  const data = Object.assign(
    {
      order: order,
      videoId: '',
      format: 'Youtube',
      title: '',
      status: STATUS.RECORDING,
      scriptLink: '',
      youtubeUrl: '',
      notes: '',
      views: 0,
      likes: 0,
      comments: 0,
    },
    fields
  );
  createDocument('videos', docId, data);
  videos.push({
    id: docId,
    order: order,
    title: data.title,
    scriptLink: data.scriptLink,
    youtubeUrl: data.youtubeUrl,
  });
}

function listVideos() {
  const videos = [];
  let pageToken = '';
  do {
    const res = firestore('get', 'videos?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : ''));
    (res.documents || []).forEach((doc) => {
      const f = doc.fields || {};
      videos.push({
        id: doc.name.split('/').pop(),
        order: Number(fieldValue(f.order)) || 0,
        title: String(fieldValue(f.title)),
        scriptLink: String(fieldValue(f.scriptLink)).trim(),
        youtubeUrl: String(fieldValue(f.youtubeUrl)).trim(),
      });
    });
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return videos;
}

// ---------- URL-Helfer ----------

function driveFileId(url) {
  const match = url.match(/\/d\/([^/?]+)/);
  return match ? match[1] : Utilities.base64EncodeWebSafe(url).slice(0, 40);
}

function youtubeId(url) {
  url = String(url || '');
  if (url.includes('v=')) return url.split('v=')[1].split('&')[0];
  if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split('?')[0];
  if (url.includes('shorts/')) return url.split('shorts/')[1].split('?')[0];
  return '';
}

// ---------- Firestore (REST) ----------

function firestore(method, path, body) {
  const res = UrlFetchApp.fetch(FIRESTORE_URL + '/' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('Firestore ' + method.toUpperCase() + ' ' + path + ' -> ' + code + ': ' + res.getContentText());
  }
  return JSON.parse(res.getContentText() || '{}');
}

function createDocument(collection, docId, data) {
  firestore('post', collection + '?documentId=' + encodeURIComponent(docId), { fields: toFields(data) });
}

/** Aendert nur die uebergebenen Felder; alle anderen (z.B. Status) bleiben unberuehrt. */
function patchDocument(path, data) {
  const mask = Object.keys(data)
    .map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k))
    .join('&');
  firestore('patch', path + '?' + mask, { fields: toFields(data) });
}

function deleteDocument(path) {
  firestore('delete', path);
}

function toFields(data) {
  const fields = {};
  Object.keys(data).forEach((key) => {
    const v = data[key];
    fields[key] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v == null ? '' : v) };
  });
  return fields;
}

function fieldValue(value) {
  if (!value) return '';
  if ('integerValue' in value) return Number(value.integerValue);
  if ('stringValue' in value) return value.stringValue;
  return '';
}
