import { useState, useEffect, useRef } from 'react'
import AuthForm from './AuthForm'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const ws = useRef(null)
  const messagesEndRef = useRef(null)

  // Session persistence
  useEffect(() => {
    const token = localStorage.getItem('chat_token')
    const userJson = localStorage.getItem('chat_user')

    if (token && userJson) {
      try {
        const userData = JSON.parse(userJson)
        setUser({ ...userData, token })
      } catch (err) {
        localStorage.removeItem('chat_token')
        localStorage.removeItem('chat_user')
      }
    }
  }, [])

  // WebSocket Connection
  useEffect(() => {
    if (!user) {
      if (ws.current) {
        ws.current.close()
      }
      return
    }

    const wsUrl = `ws://localhost:5000?token=${user.token}`
    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setConnected(true)
      setError('')
    }

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'history') {
        setMessages(data.messages)
      } else if (data.type === 'message') {
        setMessages((prev) => [...prev, data])
      } else if (data.type === 'error') {
        setError(data.error)
      }
    }

    ws.current.onclose = (event) => {
      setConnected(false)
      if (event.code === 4001 || event.code === 4002) {
        handleLogout()
      }
    }

    ws.current.onerror = () => {
      setConnected(false)
    }

    return () => {
      if (ws.current) ws.current.close()
    }
  }, [user])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleLogout = () => {
    if (ws.current) ws.current.close()
    localStorage.removeItem('chat_token')
    localStorage.removeItem('chat_user')
    setUser(null)
    setMessages([])
  }

  const sendMessage = (e) => {
    e?.preventDefault()
    if (!inputValue.trim() || !connected) return

    ws.current.send(JSON.stringify({
      type: 'message',
      content: inputValue
    }))
    setInputValue('')
  }

  const formatTime = (isoString) => {
    const date = new Date(isoString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  return (
    <div className="App" data-connected={connected.toString()}>
      {!user ? (
        <AuthForm onAuthSuccess={setUser} />
      ) : (
        <div data-testid="chat-container" className="chat-container">
          <header className="chat-header">
            <div className="header-info">
              <h2>Chat Sphere</h2>
              <span className={`status-indicator ${connected ? 'online' : 'offline'}`}>
                {connected ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="user-profile">
              <span className="username">@{user.username}</span>
              <button data-testid="btn-logout" className="logout-btn" onClick={handleLogout}>Logout</button>
            </div>
          </header>

          <main className="chat-main">
            <div className="message-list" data-testid="message-list">
              {messages.length === 0 ? (
                <div data-testid="message-empty" className="empty-state">
                  No messages yet. Be the first to say hi!
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-item ${msg.user_id === user.userId ? 'own' : ''}`}
                    data-testid="message-item"
                    data-own={msg.user_id === user.userId}
                    data-message-id={msg.id}
                  >
                    <div className="message-bubble">
                      <div className="message-header">
                        <span data-testid="message-username" className="sender">
                          {msg.user_id === user.userId ? 'You' : msg.username}
                        </span>
                        <span data-testid="message-timestamp" className="time">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div className="message-content">{msg.content}</div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {error && <div className="chat-error">{error}</div>}

            <form className="message-input-area" onSubmit={sendMessage}>
              <input
                data-testid="input-message"
                type="text"
                placeholder="Type a message..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    sendMessage(e)
                  }
                }}
              />
              <button
                data-testid="btn-send"
                type="submit"
                disabled={!inputValue.trim() || !connected}
              >
                Send
              </button>
            </form>
          </main>
        </div>
      )}
    </div>
  )
}

export default App
