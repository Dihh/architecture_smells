import React, { useState } from 'react';

const AuthForm = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState('login'); // 'login' or 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTabSwitch = (newMode) => {
    setMode(newMode);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = `http://localhost:5000/auth/${mode}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      // Success
      const { token, userId, username: registeredName } = data;
      onAuthSuccess(token, { userId, username: registeredName });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="tabs">
        <button
          data-testid="tab-login"
          className={`tab-btn ${mode === 'login' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('login')}
          type="button"
        >
          Login
        </button>
        <button
          data-testid="tab-register"
          className={`tab-btn ${mode === 'register' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('register')}
          type="button"
        >
          Register
        </button>
      </div>

      <form
        data-testid="auth-form"
        data-mode={mode}
        onSubmit={handleSubmit}
      >
        {error && (
          <div data-testid="auth-error" className="error-message">
            {error}
          </div>
        )}

        <div className="input-group">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            data-testid="input-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength="3"
            placeholder="Enter your username"
            required
            disabled={loading}
          />
        </div>

        <div className="input-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            data-testid="input-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            disabled={loading}
          />
        </div>

        <button
          data-testid="btn-submit"
          type="submit"
          disabled={loading}
        >
          {loading ? 'Processing...' : (mode === 'login' ? 'Sign In' : 'Create Account')}
        </button>
      </form>
    </div>
  );
};

export default AuthForm;
