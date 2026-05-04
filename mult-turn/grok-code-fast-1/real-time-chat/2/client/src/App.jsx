import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const storedToken = localStorage.getItem('chat_token')
    const storedUser = localStorage.getItem('chat_user')
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser)
        setToken(storedToken)
        setUser(parsedUser)
      } catch (e) {
        // Invalid, clear
        localStorage.removeItem('chat_token')
        localStorage.removeItem('chat_user')
      }
    }
  }, [])

  const handleLogin = (newToken, newUser) => {
    localStorage.setItem('chat_token', newToken)
    localStorage.setItem('chat_user', JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  const handleLogout = () => {
    localStorage.removeItem('chat_token')
    localStorage.removeItem('chat_user')
    setToken(null)
    setUser(null)
    // Disconnect WS will be handled in ChatView
  }

  if (user) {
    return <ChatView user={user} token={token} onLogout={handleLogout} />
  }

  return <AuthForm onLogin={handleLogin} />
}

function ChatView({ user, token, onLogout }) {
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const [wsError, setWsError] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:5000?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setWsError(null)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'history') {
          setMessages(data.messages)
        } else if (data.type === 'message') {
          setMessages(prev => [...prev, data])
        } else if (data.type === 'error') {
          setWsError(data.message)
        }
      } catch (e) {
        setWsError('Invalid message from server')
      }
    }

    ws.onclose = (event) => {
      setConnected(false)
      if (event.code === 4001 || event.code === 4002) {
        onLogout()
      }
    }

    ws.onerror = () => {
      setWsError('WebSocket error')
    }

    return () => {
      ws.close()
    }
  }, [token, onLogout])

  const handleSend = () => {
    const content = inputValue.trim()
    if (content && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content }))
      setInputValue('')
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend()
    }
  }

  const formatTimestamp = (isoString) => {
    const date = new Date(isoString)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  return (
    <div data-testid="chat-container">
      <div data-testid="connection-status" data-connected={connected.toString()}>
        {connected ? 'Online' : 'Offline'}
      </div>
      <div data-testid="current-username">{user.username}</div>
      <button data-testid="btn-logout" onClick={onLogout}>Logout</button>
      {wsError && <div data-testid="connection-error">{wsError}</div>}

      <div data-testid="message-list">
        {messages.length === 0 && <div data-testid="message-empty">No messages yet</div>}
        {messages.map((msg) => (
          <div
            key={msg.id}
            data-testid="message-item"
            data-own={(msg.userId === user.userId).toString()}
            data-message-id={msg.id}
          >
            <div data-testid="message-username">
              {msg.userId === user.userId ? 'You' : msg.username}
            </div>
            <div data-testid="message-content">{msg.content}</div>
            <div data-testid="message-timestamp">{formatTimestamp(msg.timestamp)}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <input
        data-testid="input-message"
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Type a message..."
      />
      <button
        data-testid="btn-send"
        onClick={handleSend}
        disabled={!inputValue.trim()}
      >
        Send
      </button>
    </div>
  )
}

function AuthForm({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleTabChange = (newMode) => {
    setMode(newMode)
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
    const url = `http://localhost:5000${endpoint}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (response.ok) {
        onLogin(data.token, { userId: data.userId, username: data.username })
      } else {
        setError(data.error)
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button data-testid="tab-login" onClick={() => handleTabChange('login')}>
        Login
      </button>
      <button data-testid="tab-register" onClick={() => handleTabChange('register')}>
        Register
      </button>
      <form data-testid="auth-form" data-mode={mode} onSubmit={handleSubmit}>
        <input
          data-testid="input-username"
          type="text"
          placeholder="Username"
          minLength="3"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          data-testid="input-password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button data-testid="btn-submit" type="submit" disabled={loading}>
          {loading ? 'Loading...' : (mode === 'login' ? 'Login' : 'Register')}
        </button>
        {error && <div data-testid="auth-error">{error}</div>}
      </form>
    </div>
  )
}

export default App
