import { useState, useEffect } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { LayoutDashboard, LogOut, FileText, ExternalLink, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchSheetData, updateSheetStatus } from './sheetsApi';
import './App.css';

const FIXED_COLUMNS = ['Aufnahme', 'Cut', 'Upload'];

// Clean Light Theme Colors
const COLUMN_COLORS = [
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#10b981', // Emerald
];

function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('google_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('google_token'));
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState(FIXED_COLUMNS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Validate stored token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('google_token');
    if (!storedToken) return;

    fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${storedToken}`, {
      headers: { Authorization: `Bearer ${storedToken}`, Accept: 'application/json' },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Token expired');
        return res.json();
      })
      .then((res) => {
        setUser(res);
        localStorage.setItem('google_user', JSON.stringify(res));
      })
      .catch(() => {
        localStorage.removeItem('google_token');
        localStorage.removeItem('google_user');
        setToken(null);
        setUser(null);
      });
  }, []);

  const login = useGoogleLogin({
    onSuccess: (codeResponse) => {
      const accessToken = codeResponse.access_token;
      setToken(accessToken);
      localStorage.setItem('google_token', accessToken);
      fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${accessToken}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
        .then((res) => res.json())
        .then((res) => {
          setUser(res);
          localStorage.setItem('google_user', JSON.stringify(res));
        })
        .catch(console.error);
    },
    onError: (err) => console.log('Login Failed:', err),
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
  });

  const logOut = () => {
    googleLogout();
    localStorage.removeItem('google_token');
    localStorage.removeItem('google_user');
    setUser(null);
    setToken(null);
    setItems([]);
  };

  useEffect(() => {
    if (token) loadData();
  }, [token]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: fetchedItems } = await fetchSheetData(token);
      setItems(fetchedItems);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const onDragEnd = async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const newStatus = destination.droppableId;
    const draggedItem = items.find(i => i.id === draggableId);
    const previousItems = [...items];

    // Optimistic UI update
    setItems(items.map(i => i.id === draggableId ? { ...i, status: newStatus } : i));

    try {
      await updateSheetStatus(token, draggedItem.rowIndex, newStatus);
    } catch (err) {
      console.error(err);
      setItems(previousItems); // Rollback
      alert('Fehler beim Speichern in Google Sheets.');
    }
  };

  const getFormatTagClass = (format) => {
    const f = (format || '').toLowerCase();
    if (f.includes('youtube')) return 'tag-youtube';
    if (f.includes('tiktok')) return 'tag-tiktok';
    return 'tag-default';
  };

  const getItemsByStatus = (status) =>
    items.filter(i => i.status === status || (!i.status && status === FIXED_COLUMNS[0]));

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
                <img src={user.picture} alt="user" />
                <span>{user.given_name}</span>
              </div>
              <button className="refresh-btn" onClick={loadData} title="Aktualisieren">
                <RefreshCw size={15} />
              </button>
              <button className="logout-btn" onClick={logOut} title="Logout">
                <LogOut size={15} />
              </button>
            </>
          ) : (
            <button className="login-btn" onClick={() => login()}>
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="G" style={{ width: 16 }} />
              Anmelden
            </button>
          )}
        </div>
      </header>

      {!token ? (
        <div className="auth-overlay animate-fade-in">
          <h2 className="text-gradient">Willkommen zum Content Manager</h2>
          <p>Verwalte deine Video-Skripte direkt aus Google Sheets in einem interaktiven Kanban Board. Logge dich mit deinem Workspace Account ein.</p>
          <button className="login-btn" onClick={() => login()}>
            Mit Google Workspace starten
          </button>
        </div>
      ) : loading ? (
        <div className="loading-screen">
          <div className="spinner" />
          <span>Lade Daten aus Google Sheets…</span>
        </div>
      ) : error ? (
        <div className="loading-screen" style={{ color: 'var(--accent-red)' }}>
          <p>Fehler: {error}</p>
          <button className="login-btn" onClick={loadData}>Erneut versuchen</button>
        </div>
      ) : (
        <>
          {/* Mobile Swipe Hint */}
          <div className="mobile-swipe-hint">
            <ChevronLeft size={16} /> Spalten wischen <ChevronRight size={16} />
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <div className="board">
              {columns.map((status, i) => {
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
                          {colItems.map((item, index) => (
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
                                    {item.scriptLink ? (
                                      <a
                                        href={item.scriptLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="doc-link"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <FileText size={15} /> Skript öffnen <ExternalLink size={12} style={{ opacity: 0.4 }} />
                                      </a>
                                    ) : (
                                      <span className="doc-link" style={{ opacity: 0.3, cursor: 'default' }}>
                                        <FileText size={15} /> Kein Skript
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        </>
      )}
    </div>
  );
}

export default App;
