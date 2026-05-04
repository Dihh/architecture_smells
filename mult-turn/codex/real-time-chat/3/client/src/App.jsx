import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://localhost:5000";
const WS_URL = "ws://localhost:5000";
const TOKEN_STORAGE_KEY = "chat_token";
const USER_STORAGE_KEY = "chat_user";

function getStoredSession() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const storedUser = localStorage.getItem(USER_STORAGE_KEY);

  if (!token || !storedUser) {
    return null;
  }

  try {
    const user = JSON.parse(storedUser);

    if (!Number.isInteger(user.userId) || typeof user.username !== "string") {
      throw new Error("Invalid stored user");
    }

    return { token, user };
  } catch {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

function AuthForm({ onAuthSuccess }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const username = formData.get("username");
    const password = formData.get("password");
    const endpoint = mode === "login" ? "/auth/login" : "/auth/register";

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Authentication failed");
        return;
      }

      const user = {
        userId: data.userId,
        username: data.username,
      };

      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      onAuthSuccess({ token: data.token, user });
    } catch {
      setError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      className="auth-form"
      data-testid="auth-form"
      data-mode={mode}
      onSubmit={handleSubmit}
    >
      <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
        <button
          aria-selected={mode === "login"}
          className={mode === "login" ? "active" : ""}
          data-testid="tab-login"
          onClick={() => switchMode("login")}
          role="tab"
          type="button"
        >
          Login
        </button>
        <button
          aria-selected={mode === "register"}
          className={mode === "register" ? "active" : ""}
          data-testid="tab-register"
          onClick={() => switchMode("register")}
          role="tab"
          type="button"
        >
          Register
        </button>
      </div>

      <label>
        Username
        <input
          autoComplete="username"
          data-testid="input-username"
          minLength="3"
          name="username"
          required
          type="text"
        />
      </label>

      <label>
        Password
        <input
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          data-testid="input-password"
          name="password"
          required
          type="password"
        />
      </label>

      {error ? (
        <p className="auth-error" data-testid="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        className="submit-button"
        data-testid="btn-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting
          ? "Please wait"
          : mode === "login"
            ? "Login"
            : "Create account"}
      </button>
    </form>
  );
}

function formatMessageTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function MessageList({ messages, currentUser }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="message-list" data-testid="message-list" ref={listRef}>
      {messages.length === 0 ? (
        <div className="message-empty" data-testid="message-empty">
          No messages yet.
        </div>
      ) : (
        messages.map((message) => {
          const isOwn = message.userId === currentUser.userId;

          return (
            <article
              className={`message-item ${isOwn ? "own" : ""}`}
              data-message-id={message.id}
              data-own={isOwn ? "true" : "false"}
              data-testid="message-item"
              key={message.id}
            >
              <div className="message-meta">
                <span data-testid="message-username">
                  {isOwn ? "You" : message.username}
                </span>
                <time dateTime={message.timestamp} data-testid="message-timestamp">
                  {formatMessageTime(message.timestamp)}
                </time>
              </div>
              <p data-testid="message-content">{message.content}</p>
            </article>
          );
        })
      )}
    </div>
  );
}

function MessageInput({ onSend }) {
  const [content, setContent] = useState("");
  const trimmedContent = content.trim();

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!trimmedContent) {
      return;
    }

    onSend(trimmedContent);
    setContent("");
  };

  return (
    <form className="message-input-form" onSubmit={handleSubmit}>
      <input
        data-testid="input-message"
        onChange={(event) => setContent(event.target.value)}
        placeholder="Type a message"
        type="text"
        value={content}
      />
      <button
        data-testid="btn-send"
        disabled={!content}
        type="submit"
      >
        Send
      </button>
    </form>
  );
}

function ChatView({ onLogout, session, socketRef }) {
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(session.token)}`);
    socketRef.current = ws;

    ws.addEventListener("open", () => {
      if (socketRef.current !== ws) {
        return;
      }

      setIsConnected(true);
    });

    ws.addEventListener("message", (event) => {
      if (socketRef.current !== ws) {
        return;
      }

      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "history") {
          setMessages(payload.messages);
          return;
        }

        if (payload.type === "message") {
          setMessages((currentMessages) => [...currentMessages, payload]);
          return;
        }

        if (payload.type === "error") {
          setConnectionError(payload.message);
        }
      } catch {
        setConnectionError("Received an invalid server message");
      }
    });

    ws.addEventListener("close", (event) => {
      if (socketRef.current !== ws) {
        return;
      }

      setIsConnected(false);
      socketRef.current = null;

      if (event.code === 4001 || event.code === 4002) {
        onLogout();
      }
    });

    ws.addEventListener("error", () => {
      if (socketRef.current !== ws) {
        return;
      }

      setConnectionError("WebSocket connection error");
    });

    return () => {
      ws.close();

      if (socketRef.current === ws) {
        socketRef.current = null;
      }
    };
  }, [onLogout, session.token, socketRef]);

  const handleSendMessage = (content) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setConnectionError("WebSocket is not connected");
      return;
    }

    socketRef.current.send(JSON.stringify({ type: "message", content }));
  };

  return (
    <div className="chat-container" data-testid="chat-container">
      <header className="chat-header">
        <div>
          <span
            className={`connection-status ${isConnected ? "online" : ""}`}
            data-connected={isConnected ? "true" : "false"}
            data-testid="connection-status"
          >
            {isConnected ? "Online" : "Offline"}
          </span>
          <strong data-testid="current-username">{session.user.username}</strong>
        </div>
        <button data-testid="btn-logout" onClick={onLogout} type="button">
          Logout
        </button>
      </header>

      {connectionError ? (
        <div
          className="connection-error"
          data-testid="connection-error"
          role="alert"
        >
          {connectionError}
        </div>
      ) : null}

      <MessageList currentUser={session.user} messages={messages} />
      <MessageInput onSend={handleSendMessage} />
    </div>
  );
}

function App() {
  const socketRef = useRef(null);
  const [session, setSession] = useState(getStoredSession);

  const handleAuthSuccess = (nextSession) => {
    setSession(nextSession);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setSession(null);
  };

  return (
    <main className="app-shell">
      <section className="auth-panel">
        <div className="brand">
          <span>Real-time Chat</span>
          <h1>Sign in to continue</h1>
        </div>

        {session ? (
          <ChatView
            onLogout={handleLogout}
            session={session}
            socketRef={socketRef}
          />
        ) : (
          <AuthForm onAuthSuccess={handleAuthSuccess} />
        )}
      </section>
    </main>
  );
}

export default App;
