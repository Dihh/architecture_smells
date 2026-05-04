import { useEffect, useRef, useState, useCallback } from 'react';
import { clearSession } from './session.js';

const WS_URL = 'ws://localhost:5000';

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function MessageList({ messages, userId }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div data-testid="message-list">
      {messages.length === 0 && (
        <div data-testid="message-empty">No messages yet. Say hello!</div>
      )}
      {messages.map((msg) => {
        const own = msg.userId === userId;
        return (
          <div
            key={msg.id}
            data-testid="message-item"
            data-own={String(own)}
            data-message-id={msg.id}
          >
            <span data-testid="message-username">{own ? 'You' : msg.username}</span>
            <span data-testid="message-content">{msg.content}</span>
            <span data-testid="message-timestamp">{formatTime(msg.timestamp)}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageInput({ onSend }) {
  const [text, setText] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') submit();
  }

  return (
    <div>
      <input
        data-testid="input-message"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message…"
      />
      <button
        data-testid="btn-send"
        type="button"
        onClick={submit}
        disabled={!text.trim()}
      >
        Send
      </button>
    </div>
  );
}

export default function Chat({ session, wsRef, onLogout }) {
  const { token, userId, username } = session;
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState('');

  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setConnected(true);
      setConnError('');
    });

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'history') {
        setMessages(msg.messages);
      } else if (msg.type === 'message') {
        setMessages((prev) => [...prev, msg]);
      } else if (msg.type === 'error') {
        setConnError(msg.message);
      }
    });

    ws.addEventListener('close', (e) => {
      setConnected(false);
      wsRef.current = null;
      if (e.code === 4001 || e.code === 4002) {
        clearSession();
        onLogoutRef.current();
      }
    });

    ws.addEventListener('error', () => {
      setConnError('WebSocket connection error');
    });

    return () => {
      ws.close();
    };
  }, [token]);

  const handleSend = useCallback((content) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content }));
    }
  }, []);

  return (
    <div data-testid="chat-container">
      <div>
        <span
          data-testid="connection-status"
          data-connected={String(connected)}
        >
          {connected ? 'Online' : 'Offline'}
        </span>
        <span data-testid="current-username">{username}</span>
        <button type="button" data-testid="btn-logout" onClick={onLogout}>
          Logout
        </button>
      </div>

      {connError && <div data-testid="connection-error">{connError}</div>}

      <MessageList messages={messages} userId={userId} />
      <MessageInput onSend={handleSend} />
    </div>
  );
}
