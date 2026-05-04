import { useState } from 'react';

const AuthForm = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleTabChange = (newMode) => {
    setMode(newMode);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

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
        setError(data.error || 'Authentication failed');
        return;
      }

      // Success
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify({
        userId: data.userId,
        username: data.username,
      }));

      onAuthSuccess({
        userId: data.userId,
        username: data.username,
        token: data.token,
      });
    } catch (err) {
      setError('Connection error. Is the backend running?');
    }
  };

  return (
    <div className="auth-container">
      <div className="tabs">
        <button
          data-testid="tab-login"
          className={`tab-btn ${mode === 'login' ? 'active' : ''}`}
          onClick={() => handleTabChange('login')}
        >
          Login
        </button>
        <button
          data-testid="tab-register"
          className={`tab-btn ${mode === 'register' ? 'active' : ''}`}
          onClick={() => handleTabChange('register')}
        >
          Register
        </button>
      </div>

      <form
        data-testid="auth-form"
        data-mode={mode}
        onSubmit={handleSubmit}
      >
        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            data-testid="input-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength="3"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            data-testid="input-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div data-testid="auth-error" className="error">
            {error}
          </div>
        )}

        <button data-testid="btn-submit" type="submit">
          {mode === 'login' ? 'Login' : 'Register'}
        </button>
      </form>
    </div>
  );
};

export default AuthForm;
