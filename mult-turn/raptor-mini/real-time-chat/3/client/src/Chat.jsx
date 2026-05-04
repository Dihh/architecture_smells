import { useEffect, useMemo, useRef, useState } from 'react';

function formatLocalTime(timestamp) {
  try {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '';
  }
}

export function Chat({ user, token, wsRef, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const listRef = useRef(null);

  const url = useMemo(() => `ws://localhost:5000?token=${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setIsConnected(true);
      setConnectionError('');
    });

    ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        setConnectionError('Received invalid data from server');
        return;
      }

      if (payload.type === 'history' && Array.isArray(payload.messages)) {
        setMessages(payload.messages);
        return;
      }

      if (payload.type === 'message') {
        setMessages((current) => [...current, payload]);
        return;
      }

      if (payload.type === 'error' && typeof payload.message === 'string') {
        setConnectionError(payload.message);
        return;
      }
    });

    ws.addEventListener('close', (event) => {
      setIsConnected(false);
      if (event.code === 4001 || event.code === 4002) {
        onLogout();
      }
    });

    ws.addEventListener('error', () => {
      setConnectionError('WebSocket connection failed');
    });

    return () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      ws.close();
    };
  }, [url, onLogout, wsRef]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (content) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setConnectionError('Unable to send message while disconnected');
      return;
    }

    wsRef.current.send(JSON.stringify({ type: 'message', content: content.trim() }));
    setMessageInput('');
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!messageInput) {
      return;
    }
    sendMessage(messageInput);
  };

  return (
    <div data-testid="chat-container" className="chat-container">
      <div className="chat-header">
        <div>
          <div data-testid="current-username" className="current-user">
            {user.username}
          </div>
          <div
            data-testid="connection-status"
            data-connected={isConnected ? 'true' : 'false'}
            className={`connection-status ${isConnected ? 'online' : 'offline'}`}
          >
            {isConnected ? 'Online' : 'Offline'}
          </div>
        </div>
        <button data-testid="btn-logout" type="button" onClick={onLogout}>
          Logout
        </button>
      </div>

      {connectionError ? (
        <div data-testid="connection-error" className="connection-error">
          {connectionError}
        </div>
      ) : null}

      <div data-testid="message-list" ref={listRef} className="message-list">
        {messages.length === 0 ? (
          <div data-testid="message-empty" className="message-empty">
            No messages yet.
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.userId === user.userId;
            return (
              <div
                key={message.id}
                data-testid="message-item"
                data-own={isOwn ? 'true' : 'false'}
                data-message-id={message.id}
                className={`message-item ${isOwn ? 'own' : 'other'}`}
              >
                <div data-testid="message-username" className="message-username">
                  {isOwn ? 'You' : message.username}
                </div>
                <div data-testid="message-content" className="message-content">
                  {message.content}
                </div>
                <div data-testid="message-timestamp" className="message-timestamp">
                  {formatLocalTime(message.timestamp)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form className="message-input-form" onSubmit={handleSubmit}>
        <input
          data-testid="input-message"
          type="text"
          value={messageInput}
          onChange={(event) => setMessageInput(event.target.value)}
          placeholder="Type a message..."
        />
        <button data-testid="btn-send" type="submit" disabled={!messageInput}>
          Send
        </button>
      </form>
    </div>
  );
}
