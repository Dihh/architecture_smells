import { useEffect, useMemo, useRef, useState } from "react";

function formatTime(timestamp) {
  try {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return "--:--";
  }
}

function ChatView({ token, currentUser, onLogout }) {
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const wsRef = useRef(null);
  const listRef = useRef(null);

  const wsUrl = useMemo(() => `ws://localhost:5000?token=${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnectionError("");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "history" && Array.isArray(payload.messages)) {
          setMessages(payload.messages);
          return;
        }
        if (payload?.type === "message") {
          setMessages((current) => [...current, payload]);
          return;
        }
        if (payload?.type === "error") {
          setConnectionError(payload.message || "WebSocket error");
          return;
        }
      } catch (error) {
        setConnectionError("Invalid message received");
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (event.code === 4001 || event.code === 4002) {
        localStorage.removeItem("chat_token");
        localStorage.removeItem("chat_user");
        onLogout();
      }
    };

    ws.onerror = () => {
      setConnectionError("WebSocket connection error");
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, onLogout]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "message", content }));
    setDraft("");
  };

  return (
    <div data-testid="chat-container" className="chat-shell">
      <div className="chat-header">
        <div>
          <div data-testid="current-username" className="current-user">
            {currentUser.username}
          </div>
          <div
            data-testid="connection-status"
            data-connected={connected ? "true" : "false"}
            className={`connection-status ${connected ? "online" : "offline"}`}
          >
            {connected ? "Online" : "Offline"}
          </div>
        </div>
        <button data-testid="btn-logout" className="logout-button" onClick={onLogout}>
          Logout
        </button>
      </div>

      {connectionError ? (
        <div data-testid="connection-error" className="connection-error">
          {connectionError}
        </div>
      ) : null}

      <div ref={listRef} data-testid="message-list" className="message-list">
        {messages.length === 0 ? (
          <div data-testid="message-empty" className="message-empty">
            No messages yet.
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.userId === currentUser.userId;
            return (
              <div
                key={message.id}
                data-testid="message-item"
                data-own={isOwn ? "true" : "false"}
                data-message-id={message.id}
                className={`message-item ${isOwn ? "own" : "other"}`}
              >
                <div data-testid="message-username" className="message-username">
                  {isOwn ? "You" : message.username}
                </div>
                <div data-testid="message-content" className="message-content">
                  {message.content}
                </div>
                <div data-testid="message-timestamp" className="message-timestamp">
                  {formatTime(message.timestamp)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form className="message-form" onSubmit={handleSend}>
        <input
          data-testid="input-message"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message..."
        />
        <button
          data-testid="btn-send"
          type="submit"
          disabled={draft.trim().length === 0}
          className="send-button"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatView;
