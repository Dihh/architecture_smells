import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)

  useEffect(() => {
    const storedToken = localStorage.getItem('chat_token')
    const storedUser = localStorage.getItem('chat_user')
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser)
        setUser(parsedUser)
        setToken(storedToken)
      } catch (error) {
        // invalid, clear
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
    // disconnect WS if any
  }

  return (
    <>
      {!user ? <AuthForm onLogin={handleLogin} /> : <Chat user={user} token={token} onLogout={handleLogout} />}
    </>
  )
}

function AuthForm({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleTabChange = (newMode) => {
    setMode(newMode)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const formData = new FormData(e.target)
    const username = formData.get('username')
    const password = formData.get('password')

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
        setError(data.error || 'An error occurred')
      }
    } catch (error) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form data-testid="auth-form" data-mode={mode} onSubmit={handleSubmit}>
      <button data-testid="tab-login" type="button" onClick={() => handleTabChange('login')}>Login</button>
      <button data-testid="tab-register" type="button" onClick={() => handleTabChange('register')}>Register</button>
      <input data-testid="input-username" name="username" minLength="3" required />
      <input data-testid="input-password" name="password" type="password" required />
      <button data-testid="btn-submit" type="submit" disabled={loading}>{loading ? 'Loading...' : (mode === 'login' ? 'Login' : 'Register')}</button>
      {error && <div data-testid="auth-error">{error}</div>}
    </form>
  )
}

function Chat({ user, token, onLogout }) {
  const [messages, setMessages] = useState([])
  const [connected, setConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')
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
      setConnectionError('')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'history') {
          setMessages(data.messages)
        } else if (data.type === 'message') {
          setMessages(prev => [...prev, data])
        } else if (data.type === 'error') {
          setConnectionError(data.message)
        }
      } catch (error) {
        console.error('Invalid WS message', error)
      }
    }

    ws.onclose = (event) => {
      setConnected(false)
      if (event.code === 4001 || event.code === 4002) {
        localStorage.removeItem('chat_token')
        localStorage.removeItem('chat_user')
        onLogout()
      }
    }

    ws.onerror = () => {
      setConnected(false)
    }

    return () => {
      ws.close()
    }
  }, [token, onLogout])

  const handleSend = () => {
    const input = document.querySelector('[data-testid="input-message"]')
    const content = input.value.trim()
    if (content && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content }))
      input.value = ''
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend()
    }
  }

  const handleLogoutClick = () => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    onLogout()
  }

  return (
    <div data-testid="chat-container">
      <div data-testid="connection-status" data-connected={connected.toString()}>
        {connected ? 'Online' : 'Offline'}
      </div>
      <div data-testid="current-username">{user.username}</div>
      <button data-testid="btn-logout" onClick={handleLogoutClick}>Logout</button>
      {connectionError && <div data-testid="connection-error">{connectionError}</div>}
      <div data-testid="message-list">
        {messages.length === 0 && <div data-testid="message-empty">No messages yet</div>}
        {messages.map(msg => (
          <Message key={msg.id} message={msg} currentUserId={user.userId} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <input
        data-testid="input-message"
        onKeyPress={handleKeyPress}
        onChange={(e) => {
          const btn = document.querySelector('[data-testid="btn-send"]')
          if (btn) btn.disabled = !e.target.value.trim()
        }}
      />
      <button data-testid="btn-send" onClick={handleSend} disabled>Send</button>
    </div>
  )
}

function Message({ message, currentUserId }) {
  const isOwn = message.userId === currentUserId
  const timestamp = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div data-testid="message-item" data-own={isOwn.toString()} data-message-id={message.id}>
      <div data-testid="message-username">{isOwn ? 'You' : message.username}</div>
      <div data-testid="message-content">{message.content}</div>
      <div data-testid="message-timestamp">{timestamp}</div>
    </div>
  )
}

export default App