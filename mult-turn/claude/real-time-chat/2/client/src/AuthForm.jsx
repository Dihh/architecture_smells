import { useState } from 'react'

export default function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [error, setError] = useState('')

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    const { username, password } = e.target.elements
    onAuth({ mode, username: username.value, password: password.value, setError })
  }

  return (
    <form data-testid="auth-form" data-mode={mode} onSubmit={handleSubmit}>
      <div>
        <button
          type="button"
          data-testid="tab-login"
          onClick={() => switchMode('login')}
        >
          Login
        </button>
        <button
          type="button"
          data-testid="tab-register"
          onClick={() => switchMode('register')}
        >
          Register
        </button>
      </div>

      <input
        data-testid="input-username"
        name="username"
        type="text"
        placeholder="Username"
        minLength="3"
        required
      />
      <input
        data-testid="input-password"
        name="password"
        type="password"
        placeholder="Password"
        required
      />

      {error && <p data-testid="auth-error">{error}</p>}

      <button data-testid="btn-submit" type="submit">
        {mode === 'login' ? 'Login' : 'Register'}
      </button>
    </form>
  )
}
