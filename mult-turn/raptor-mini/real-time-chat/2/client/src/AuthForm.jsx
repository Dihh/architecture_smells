import { useState } from "react";

const BASE_URL = "http://localhost:5000";

function AuthForm({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }

    setIsSubmitting(true);
    const url = `${BASE_URL}/auth/${mode}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || "Authentication failed");
        setIsSubmitting(false);
        return;
      }

      if (!data.token || !data.userId || !data.username) {
        setError("Invalid response from server");
        setIsSubmitting(false);
        return;
      }

      localStorage.setItem("chat_token", data.token);
      localStorage.setItem("chat_user", JSON.stringify({ userId: data.userId, username: data.username }));
      onLogin(data.token, { userId: data.userId, username: data.username });
    } catch (fetchError) {
      setError("Unable to connect to server");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-tabs">
        <button
          type="button"
          data-testid="tab-login"
          className={mode === "login" ? "active" : ""}
          onClick={() => handleModeChange("login")}
        >
          Login
        </button>
        <button
          type="button"
          data-testid="tab-register"
          className={mode === "register" ? "active" : ""}
          onClick={() => handleModeChange("register")}
        >
          Register
        </button>
      </div>

      <form data-testid="auth-form" data-mode={mode} onSubmit={handleSubmit}>
        <label>
          Username
          <input
            data-testid="input-username"
            name="username"
            type="text"
            value={username}
            minLength="3"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          Password
          <input
            data-testid="input-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <div data-testid="auth-error" className="auth-error">
            {error}
          </div>
        ) : null}

        <button
          data-testid="btn-submit"
          type="submit"
          className="submit-button"
          disabled={isSubmitting}
        >
          {mode === "login" ? "Login" : "Register"}
        </button>
      </form>
    </div>
  );
}

export default AuthForm;
