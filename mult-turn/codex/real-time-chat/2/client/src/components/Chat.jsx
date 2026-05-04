import { useEffect, useState } from 'react';
import MessageInput from './MessageInput.jsx';
import MessageList from './MessageList.jsx';

const WS_BASE_URL = 'ws://localhost:5000';

export default function Chat({ token, user, webSocketRef, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(token)}`);
    webSocketRef.current = ws;

    ws.addEventListener('open', () => {
      setIsConnected(true);
      setConnectionError('');
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'history') {
          setMessages(payload.messages || []);
          return;
        }

        if (payload.type === 'message') {
          setMessages((currentMessages) => [...currentMessages, payload]);
          return;
        }

        if (payload.type === 'error') {
          setConnectionError(payload.message || 'WebSocket error');
        }
      } catch (error) {
        setConnectionError('Received an unreadable message');
      }
    });

    ws.addEventListener('close', (event) => {
      setIsConnected(false);

      if (webSocketRef.current === ws) {
        webSocketRef.current = null;
      }

      if (event.code === 4001 || event.code === 4002) {
        onLogout();
      }
    });

    ws.addEventListener('error', () => {
      setConnectionError('Connection error');
    });

    return () => {
      if (webSocketRef.current === ws) {
        webSocketRef.current = null;
      }

      ws.close();
    };
  }, [onLogout, token, webSocketRef]);

  function handleSendMessage(content) {
    const trimmedContent = content.trim();

    if (!trimmedContent || webSocketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    webSocketRef.current.send(
      JSON.stringify({
        type: 'message',
        content: trimmedContent
      })
    );
  }

  return (
    <div className="chat-container" data-testid="chat-container">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1 data-testid="current-username">{user.username}</h1>
        </div>

        <div className="chat-actions">
          <span
            className={isConnected ? 'status online' : 'status offline'}
            data-testid="connection-status"
            data-connected={isConnected ? 'true' : 'false'}
          >
            {isConnected ? 'Online' : 'Offline'}
          </span>
          <button className="logout-button" data-testid="btn-logout" type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      {connectionError ? (
        <p className="connection-error" data-testid="connection-error">
          {connectionError}
        </p>
      ) : null}

      <MessageList messages={messages} currentUserId={user.userId} />
      <MessageInput onSendMessage={handleSendMessage} />
    </div>
  );
}
