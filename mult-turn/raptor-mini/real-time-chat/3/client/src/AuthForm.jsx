import { useEffect, useState } from 'react';

export function AuthForm({ onSubmit }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [mode]);

  const switchMode = (nextMode) => {
    if (nextMode !== mode) {
      setMode(nextMode);
      setError('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      await onSubmit({ mode, username: username.trim(), password });
    } catch (err) {
      setError(err.message || 'Authentication failed');
    }
  };

  return (
    <form
      data-testid="auth-form"
      data-mode={mode}
      onSubmit={handleSubmit}
      className="auth-form"
    >
      <div className="tab-list">
        <button
          type="button"
          data-testid="tab-login"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => switchMode('login')}
        >
          Login
        </button>
        <button
          type="button"
          data-testid="tab-register"
          className={mode === 'register' ? 'active' : ''}
          onClick={() => switchMode('register')}
        >
          Register
        </button>
      </div>

      <label>
        Username
        <input
          data-testid="input-username"
          minLength="3"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
        />
      </label>

      <label>
        Password
        <input
          data-testid="input-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </label>

      {error ? (
        <div data-testid="auth-error" className="auth-error">
          {error}
        </div>
      ) : null}

      <button data-testid="btn-submit" type="submit" className="submit-button">
        {mode === 'login' ? 'Log In' : 'Register'}
      </button>
    </form>
  );
}
