import { useState, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { LayoutDashboard, LogOut, Upload, FileText, ExternalLink, ChevronLeft, ChevronRight, Eye, ThumbsUp, MessageCircle } from 'lucide-react';
import { fetchSheetData } from './sheetsApi';
import { auth, googleProvider } from './firebase';
import { subscribeVideos, updateVideoStatus, importVideos } from './videosDb';
import './App.css';

const FIXED_COLUMNS = ['Aufnahme', 'Cut', 'Upload'];

// Clean Light Theme Colors
const COLUMN_COLORS = [
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#10b981', // Emerald
];
const YOUTUBE_COLOR = '#ef4444'; // Red
const ALLOWED_SCRIPT_LINK_HOSTS = new Set(['docs.google.com', 'drive.google.com']);
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

// Als Homescreen-App (PWA) kommen Popups nicht zurueck in die App, dort per Redirect anmelden
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const REDIRECT_FALLBACK_ERRORS = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']);
const IGNORED_LOGIN_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

const getSafeScriptLink = (link) => {
  if (!link) return null;

  try {
    const url = new URL(link);
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_SCRIPT_LINK_HOSTS.has(url.hostname)) return null;

    return url.href;
  } catch {
    return null;
  }
};

// Video-ID aus einem YouTube-Link; null, wenn der Link nicht eindeutig auf YouTube zeigt
const getYoutubeId = (link) => {
  if (!link) return null;

  try {
    const url = new URL(link);
    if (url.protocol !== 'https:') return null;
    if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

    const id = url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : url.searchParams.get('v') || url.pathname.split('/shorts/')[1];
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch {
    return null;
  }
};

const formatCount = (n) => new Intl.NumberFormat('de-CH').format(Number(n) || 0);

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );

  // Fehler aus einer Redirect-Anmeldung kommen erst nach dem Neuladen an
  useEffect(() => {
    getRedirectResult(auth).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeVideos(
      (data) => {
        setItems(data);
        setLoaded(true);
      },
      (err) => {
        setError(err.message);
        setLoaded(true);
      },
    );
  }, [user]);

  const login = async () => {
    setError(null);
    try {
      if (isStandalone) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (REDIRECT_FALLBACK_ERRORS.has(err.code)) {
        await signInWithRedirect(auth, googleProvider).catch((e) => setError(e.message));
      } else if (!IGNORED_LOGIN_ERRORS.has(err.code)) {
        setError(err.message);
      }
    }
  };
  const logOut = () => signOut(auth);

  // Einmaliger Import aus dem alten Google Sheet
  const importFromSheet = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    onSuccess: async (res) => {
      try {
        const { items: rows } = await fetchSheetData(res.access_token);
        await importVideos(rows);
        alert(`${rows.length} Videos aus dem Sheet importiert.`);
      } catch (err) {
        alert(`Import fehlgeschlagen: ${err.message}`);
      }
    },
    onError: (err) => console.log('Import-Login fehlgeschlagen:', err),
  });

  const onDragEnd = async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId;
    const previousItems = [...items];

    // Optimistic UI update (Firestore-Listener liefert danach den echten Stand)
    setItems(items.map(i => i.id === draggableId ? { ...i, status: newStatus } : i));

    try {
      await updateVideoStatus(draggableId, newStatus);
    } catch (err) {
      console.error(err);
      setItems(previousItems); // Rollback
      alert('Fehler beim Speichern in Firestore.');
    }
  };

  const getFormatTagClass = (format) => {
    const f = (format || '').toLowerCase();
    if (f.includes('youtube')) return 'tag-youtube';
    if (f.includes('tiktok')) return 'tag-tiktok';
    return 'tag-default';
  };

  // Videos mit YouTube-Link stehen nur in der YouTube-Spalte
  const isOnYoutube = (item) => Boolean(getYoutubeId(item.youtubeUrl));

  const getItemsByStatus = (status) =>
    items.filter(i => !isOnYoutube(i) && (i.status === status || (!i.status && status === FIXED_COLUMNS[0])));

  const youtubeItems = items
    .filter(isOnYoutube)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || (b.order ?? 0) - (a.order ?? 0));

  return (
    <div className="app-container">
      <header>
        <div className="header-left">
          <LayoutDashboard className="logo-icon" />
          <h1>Content Kanban</h1>
        </div>
        <div className="user-controls">
          {user ? (
            <>
              <div className="user-info">
                <img src={user.photoURL} alt="user" />
                <span>{(user.displayName || '').split(' ')[0]}</span>
              </div>
              <button className="refresh-btn" onClick={() => importFromSheet()} title="Einmalig aus Google Sheet importieren">
                <Upload size={15} />
              </button>
              <button className="logout-btn" onClick={logOut} title="Logout">
                <LogOut size={15} />
              </button>
            </>
          ) : (
            <button className="login-btn" onClick={login}>
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="G" style={{ width: 16 }} />
              Anmelden
            </button>
          )}
        </div>
      </header>

      {!authReady ? (
        <div className="loading-screen"><div className="spinner" /></div>
      ) : !user ? (
        <div className="auth-overlay animate-fade-in">
          <h2 className="text-gradient">Willkommen zum Content Manager</h2>
          <p>Verwalte deine Video-Skripte direkt aus Google Sheets in einem interaktiven Kanban Board. Logge dich mit deinem Workspace Account ein.</p>
          <button className="login-btn" onClick={login}>
            Mit Google Workspace starten
          </button>
          {error && <p style={{ color: 'var(--accent-red)' }}>Anmeldung fehlgeschlagen: {error}</p>}
        </div>
      ) : !loaded ? (
        <div className="loading-screen">
          <div className="spinner" />
          <span>Lade Daten…</span>
        </div>
      ) : error ? (
        <div className="loading-screen" style={{ color: 'var(--accent-red)' }}>
          <p>Fehler: {error}</p>
          <button className="login-btn" onClick={() => window.location.reload()}>Erneut versuchen</button>
        </div>
      ) : (
        <>
          {/* Mobile Swipe Hint */}
          <div className="mobile-swipe-hint">
            <ChevronLeft size={16} /> Spalten wischen <ChevronRight size={16} />
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <div className="board">
              {FIXED_COLUMNS.map((status, i) => {
                const colColor = COLUMN_COLORS[i % COLUMN_COLORS.length];
                const colItems = getItemsByStatus(status);

                return (
                  <div key={status} className="column glass-panel">
                    <div className="column-header">
                      <div className="column-header-inner">
                        <span className="column-dot" style={{ background: colColor }} />
                        <h3>{status}</h3>
                      </div>
                      <span className="item-count">{colItems.length}</span>
                    </div>

                    <Droppable droppableId={status}>
                      {(provided, snapshot) => (
                        <div
                          className={`column-content ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                        >
                          {colItems.length === 0 && (
                            <p className="empty-col">Keine Einträge</p>
                          )}
                          {colItems.map((item, index) => {
                            const safeScriptLink = getSafeScriptLink(item.scriptLink);

                            return (
                              <Draggable key={item.id} draggableId={item.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    className={`card glass-card ${snapshot.isDragging ? 'is-dragging' : ''}`}
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    style={{
                                      borderLeft: `3px solid ${colColor}`,
                                      ...provided.draggableProps.style,
                                    }}
                                  >
                                    <div className="card-top">
                                      <span className={`card-tag ${getFormatTagClass(item.format)}`}>
                                        {item.format || '—'}
                                      </span>
                                      <span className="card-id">#{item.videoId || '?'}</span>
                                    </div>
                                    <h4 className="card-title">{item.title || 'Ohne Titel'}</h4>
                                    <div className="card-footer">
                                      {safeScriptLink ? (
                                        <a
                                          href={safeScriptLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="doc-link"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <FileText size={15} /> Skript öffnen <ExternalLink size={12} style={{ opacity: 0.4 }} />
                                        </a>
                                      ) : (
                                        <span className="doc-link" style={{ opacity: 0.3, cursor: 'default' }}>
                                          <FileText size={15} /> {item.scriptLink ? 'Ungültiger Link' : 'Kein Skript'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}

              {/* YouTube: nur Anzeige, Daten kommen vom Apps-Script-Sync */}
              <div className="column glass-panel">
                <div className="column-header">
                  <div className="column-header-inner">
                    <span className="column-dot" style={{ background: YOUTUBE_COLOR }} />
                    <h3>YouTube</h3>
                  </div>
                  <span className="item-count">{youtubeItems.length}</span>
                </div>

                <div className="column-content">
                  {youtubeItems.length === 0 && (
                    <p className="empty-col">Keine Videos</p>
                  )}
                  {youtubeItems.map((item) => {
                    const ytId = getYoutubeId(item.youtubeUrl);

                    return (
                      <a
                        key={item.id}
                        className="card glass-card yt-card"
                        href={`https://www.youtube.com/watch?v=${ytId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ borderLeft: `3px solid ${YOUTUBE_COLOR}` }}
                      >
                        <img
                          className="yt-thumb"
                          src={`https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`}
                          alt=""
                          loading="lazy"
                        />
                        <div className="card-top">
                          <span className="card-tag tag-youtube">{item.format || 'Youtube'}</span>
                          {item.publishedAt && (
                            <span className="card-id">{new Date(item.publishedAt).toLocaleDateString('de-CH')}</span>
                          )}
                        </div>
                        <h4 className="card-title">{item.title || 'Ohne Titel'}</h4>
                        <div className="card-footer yt-stats">
                          <span title="Views"><Eye size={14} /> {formatCount(item.views)}</span>
                          <span title="Likes"><ThumbsUp size={14} /> {formatCount(item.likes)}</span>
                          <span title="Kommentare"><MessageCircle size={14} /> {formatCount(item.comments)}</span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </DragDropContext>
        </>
      )}
    </div>
  );
}

export default App;
