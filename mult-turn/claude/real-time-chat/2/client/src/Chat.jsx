import { useState, useEffect, useRef, useCallback } from 'react'

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function MessageList({ messages, userId }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div data-testid="message-list">
      {messages.length === 0 && (
        <div data-testid="message-empty">No messages yet</div>
      )}
      {messages.map((msg) => {
        const own = msg.userId === userId
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
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

function MessageInput({ onSend }) {
  const [text, setText] = useState('')

  function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') send()
  }

  return (
    <div>
      <input
        data-testid="input-message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message…"
      />
      <button
        data-testid="btn-send"
        onClick={send}
        disabled={text.length === 0}
      >
        Send
      </button>
    </div>
  )
}

export default function Chat({ session, wsRef, onLogout }) {
  const { token, user } = session
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState([])
  const [connError, setConnError] = useState('')

  const handleLogout = useCallback(() => {
    onLogout()
  }, [onLogout])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:5000?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'history') {
        setMessages(msg.messages)
      } else if (msg.type === 'message') {
        setMessages((prev) => [...prev, msg])
      } else if (msg.type === 'error') {
        setConnError(msg.message)
      }
    }

    ws.onclose = (e) => {
      setConnected(false)
      wsRef.current = null
      if (e.code === 4001 || e.code === 4002) {
        localStorage.removeItem('chat_token')
        localStorage.removeItem('chat_user')
        onLogout()
      }
    }

    ws.onerror = () => setConnError('Connection error')

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [token, wsRef, onLogout])

  function sendMessage(content) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content }))
    }
  }

  return (
    <div data-testid="chat-container">
      <div>
        <span
          data-testid="connection-status"
          data-connected={String(connected)}
        >
          {connected ? 'Online' : 'Offline'}
        </span>
        <span data-testid="current-username">{user.username}</span>
        <button data-testid="btn-logout" onClick={handleLogout}>Logout</button>
      </div>

      {connError && <div data-testid="connection-error">{connError}</div>}

      <MessageList messages={messages} userId={user.userId} />
      <MessageInput onSend={sendMessage} />
    </div>
  )
}
