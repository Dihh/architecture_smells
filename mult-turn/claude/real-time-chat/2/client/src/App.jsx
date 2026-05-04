import { useState, useRef } from 'react'
import AuthForm from './AuthForm'
import Chat from './Chat'
import { apiPost } from './api'

function loadSession() {
  const token = localStorage.getItem('chat_token')
  const raw = localStorage.getItem('chat_user')
  if (!token || !raw) return null
  try {
    return { token, user: JSON.parse(raw) }
  } catch {
    return null
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  const wsRef = useRef(null)

  async function handleAuth({ mode, username, password, setError }) {
    try {
      const data = await apiPost(`/auth/${mode}`, { username, password })
      localStorage.setItem('chat_token', data.token)
      localStorage.setItem('chat_user', JSON.stringify({ userId: data.userId, username: data.username }))
      setSession({ token: data.token, user: { userId: data.userId, username: data.username } })
    } catch (err) {
      setError(err.message)
    }
  }

  function handleLogout() {
    localStorage.removeItem('chat_token')
    localStorage.removeItem('chat_user')
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setSession(null)
  }

  if (session) {
    return <Chat session={session} wsRef={wsRef} onLogout={handleLogout} />
  }

  return <AuthForm onAuth={handleAuth} />
}
