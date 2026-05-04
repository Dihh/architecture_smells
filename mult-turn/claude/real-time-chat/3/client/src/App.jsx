import { useState, useRef } from 'react';
import AuthForm from './AuthForm';
import Chat from './Chat';
import { loadSession, clearSession } from './session.js';

export default function App() {
  const [session, setSession] = useState(() => loadSession());
  const wsRef = useRef(null);

  function handleLogin(newSession) {
    setSession(newSession);
  }

  function handleLogout() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    clearSession();
    setSession(null);
  }

  if (session) {
    return <Chat session={session} wsRef={wsRef} onLogout={handleLogout} />;
  }

  return <AuthForm onLogin={handleLogin} />;
}
