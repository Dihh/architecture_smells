import { useState } from 'react';

const AUTH_MODES = {
  login: {
    label: 'Login',
    submitLabel: 'Log in'
  },
  register: {
    label: 'Register',
    submitLabel: 'Create account'
  }
};

const API_BASE_URL = 'http://localhost:5000';

export default function AuthForm({ onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode(nextMode) {
    setMode(nextMode);
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      onAuthSuccess({
        token: data.token,
        user: {
          userId: data.userId,
          username: data.username
        }
      });
    } catch (requestError) {
      setError('Unable to reach the server');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="auth-form"
      data-testid="auth-form"
      data-mode={mode}
      onSubmit={handleSubmit}
    >
      <div className="brand-block">
        <p className="eyebrow">Real-Time Chat</p>
        <h1>{AUTH_MODES[mode].label}</h1>
      </div>

      <div className="tabs" role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          className={mode === 'login' ? 'tab active' : 'tab'}
          data-testid="tab-login"
          aria-selected={mode === 'login'}
          role="tab"
          onClick={() => switchMode('login')}
        >
          Login
        </button>
        <button
          type="button"
          className={mode === 'register' ? 'tab active' : 'tab'}
          data-testid="tab-register"
          aria-selected={mode === 'register'}
          role="tab"
          onClick={() => switchMode('register')}
        >
          Register
        </button>
      </div>

      <label className="field">
        <span>Username</span>
        <input
          data-testid="input-username"
          minLength="3"
          name="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          data-testid="input-password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {error ? (
        <p className="auth-error" data-testid="auth-error">
          {error}
        </p>
      ) : null}

      <button className="submit-button" data-testid="btn-submit" type="submit">
        {isSubmitting ? 'Please wait' : AUTH_MODES[mode].submitLabel}
      </button>
    </form>
  );
}
