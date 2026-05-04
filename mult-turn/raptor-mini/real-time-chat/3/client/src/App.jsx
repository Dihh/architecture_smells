import { useRef, useState } from 'react';
import { AuthForm } from './AuthForm.jsx';
import { Chat } from './Chat.jsx';

function restoreSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  const token = localStorage.getItem('chat_token');
  const rawUser = localStorage.getItem('chat_user');

  if (!token || !rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser);
    if (user && typeof user.userId === 'number' && typeof user.username === 'string') {
      return { token, user };
    }
  } catch {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
  }

  return null;
}

export default function App() {
  const [session, setSession] = useState(restoreSession);
  const wsRef = useRef(null);

  const saveSession = ({ token, user }) => {
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_user', JSON.stringify(user));
    setSession({ token, user });
  };

  const clearSession = () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
    setSession(null);
  };

  const handleAuthSubmit = async ({ mode, username, password }) => {
    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
    const response = await fetch(`http://localhost:5000${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Authentication failed');
    }

    if (!data.token || !data.userId || !data.username) {
      throw new Error('Authentication failed');
    }

    saveSession({ token: data.token, user: { userId: data.userId, username: data.username } });
  };

  const handleLogout = () => {
    clearSession();

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  };

  return (
    <main className="app-shell">
      {!session ? (
        <AuthForm onSubmit={handleAuthSubmit} />
      ) : (
        <Chat
          user={session.user}
          token={session.token}
          wsRef={wsRef}
          onLogout={handleLogout}
        />
      )}
    </main>
  );
}
