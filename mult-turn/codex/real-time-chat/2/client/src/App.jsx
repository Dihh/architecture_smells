import { useRef, useState } from 'react';
import AuthForm from './components/AuthForm.jsx';
import Chat from './components/Chat.jsx';

const TOKEN_STORAGE_KEY = 'chat_token';
const USER_STORAGE_KEY = 'chat_user';

function getStoredSession() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const userJson = localStorage.getItem(USER_STORAGE_KEY);

  if (!token || !userJson) {
    return null;
  }

  try {
    return {
      token,
      user: JSON.parse(userJson)
    };
  } catch (error) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

export default function App() {
  const webSocketRef = useRef(null);
  const [session, setSession] = useState(() => getStoredSession());

  function handleAuthSuccess(nextSession) {
    localStorage.setItem(TOKEN_STORAGE_KEY, nextSession.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextSession.user));
    setSession(nextSession);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);

    if (webSocketRef.current) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }

    setSession(null);
  }

  return (
    <main className="app-shell">
      <section className="auth-panel" aria-label="Authentication">
        {session ? (
          <Chat
            token={session.token}
            user={session.user}
            webSocketRef={webSocketRef}
            onLogout={handleLogout}
          />
        ) : (
          <AuthForm onAuthSuccess={handleAuthSuccess} />
        )}
      </section>
    </main>
  );
}
