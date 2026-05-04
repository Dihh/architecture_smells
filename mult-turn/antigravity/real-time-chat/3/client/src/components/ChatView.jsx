import React, { useState, useEffect, useRef } from 'react';

const ChatView = ({ session, onLogout }) => {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const socketRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    // Initialize WebSocket connection
    const socket = new WebSocket(`ws://localhost:5000?token=${session.token}`);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setError('');
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'history') {
        setMessages(data.messages);
      } else if (data.type === 'message') {
        setMessages((prev) => [...prev, data]);
      } else if (data.type === 'error') {
        setError(data.message);
      }
    };

    socket.onclose = (event) => {
      setConnected(false);
      if (event.code === 4001 || event.code === 4002) {
        onLogout();
      }
    };

    socket.onerror = () => {
      setError('Connection error occurred');
    };

    return () => {
      socket.close();
    };
  }, [session.token, onLogout]);

  useEffect(() => {
    // Auto-scroll to bottom on message update
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || !socketRef.current) return;

    socketRef.current.send(JSON.stringify({
      type: 'message',
      content: trimmedInput
    }));

    setInput('');
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <div data-testid="chat-container" className="chat-container">
      <header className="chat-header">
        <div className="status-bar">
          <div 
            data-testid="connection-status" 
            data-connected={connected ? "true" : "false"}
            className={`status-indicator ${connected ? 'online' : 'offline'}`}
          >
            {connected ? '● Online' : '○ Offline'}
          </div>
          <span data-testid="current-username" className="username-display">
            {session.user.username}
          </span>
        </div>
        <button 
          data-testid="btn-logout" 
          onClick={onLogout}
          className="logout-btn-small"
        >
          Logout
        </button>
      </header>

      {error && (
        <div data-testid="connection-error" className="connection-error">
          {error}
        </div>
      )}

      <div data-testid="message-list" className="message-list" ref={listRef}>
        {messages.length === 0 ? (
          <div data-testid="message-empty" className="empty-state">
            No cosmic frequencies detected yet...
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.userId === session.user.userId;
            return (
              <div 
                key={msg.id} 
                data-testid="message-item"
                data-own={isOwn ? "true" : "false"}
                data-message-id={msg.id}
                className={`message-item ${isOwn ? 'own' : 'other'}`}
              >
                <div className="message-bubble">
                  <div data-testid="message-username" className="message-username">
                    {isOwn ? 'You' : msg.username}
                  </div>
                  <div data-testid="message-content" className="message-content">
                    {msg.content}
                  </div>
                  <div data-testid="message-timestamp" className="message-timestamp">
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form className="message-input-area" onSubmit={handleSendMessage}>
        <input
          data-testid="input-message"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Transmit your message..."
          autoFocus
        />
        <button
          data-testid="btn-send"
          type="submit"
          disabled={!input.trim()}
          className="send-btn"
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatView;
