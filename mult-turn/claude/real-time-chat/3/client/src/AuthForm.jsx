import { useState } from 'react';
import { apiAuth, saveSession } from './session.js';

export default function AuthForm({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await apiAuth(mode, username, password);
      saveSession(session);
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form data-testid="auth-form" data-mode={mode} onSubmit={handleSubmit}>
      <div>
        <button type="button" data-testid="tab-login" onClick={() => switchMode('login')}>
          Login
        </button>
        <button type="button" data-testid="tab-register" onClick={() => switchMode('register')}>
          Register
        </button>
      </div>

      <input
        data-testid="input-username"
        name="username"
        type="text"
        placeholder="Username"
        minLength="3"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />

      <input
        data-testid="input-password"
        name="password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      <button type="submit" data-testid="btn-submit" disabled={loading}>
        {mode === 'login' ? 'Login' : 'Register'}
      </button>

      {error && <p data-testid="auth-error">{error}</p>}
    </form>
  );
}
