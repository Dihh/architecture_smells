import React, { useState, useEffect } from 'react';
import AuthForm from './components/AuthForm';
import ChatView from './components/ChatView';

function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    // Check for existing session on load
    const token = localStorage.getItem('chat_token');
    const userJson = localStorage.getItem('chat_user');

    if (token && userJson) {
      try {
        const user = JSON.parse(userJson);
        setSession({ token, user });
      } catch (e) {
        // Clear corrupt data
        localStorage.removeItem('chat_token');
        localStorage.removeItem('chat_user');
      }
    }
  }, []);

  const handleAuthSuccess = (token, user) => {
    localStorage.setItem('chat_token', token);
    localStorage.setItem('chat_user', JSON.stringify(user));
    setSession({ token, user });
  };

  const handleLogout = () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
    setSession(null);
  };

  return (
    <main className={session ? 'in-chat' : 'in-auth'}>
      {!session ? (
        <>
          <h1>Nebula Chat</h1>
          <p className="subtitle">Connect across the stars in real-time.</p>
          <AuthForm onAuthSuccess={handleAuthSuccess} />
        </>
      ) : (
        <ChatView session={session} onLogout={handleLogout} />
      )}
    </main>
  );
}

export default App;
