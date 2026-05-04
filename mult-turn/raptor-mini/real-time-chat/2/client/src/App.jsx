import { useEffect, useState } from "react";
import AuthForm from "./AuthForm";
import ChatView from "./ChatView";

const TOKEN_KEY = "chat_token";
const USER_KEY = "chat_user";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const userValue = localStorage.getItem(USER_KEY);
    if (savedToken && userValue) {
      try {
        const savedUser = JSON.parse(userValue);
        if (savedUser && savedUser.userId && savedUser.username) {
          setToken(savedToken);
          setCurrentUser(savedUser);
          setIsLoggedIn(true);
          return;
        }
      } catch {
        // ignore parse errors and fall back to login form
      }
    }
    setIsLoggedIn(false);
    setCurrentUser(null);
    setToken("");
  }, []);

  const handleLogin = (newToken, user) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setToken(newToken);
    setCurrentUser(user);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken("");
    setCurrentUser(null);
    setIsLoggedIn(false);
  };

  return (
    <div className="app-container">
      {!isLoggedIn || !currentUser ? (
        <AuthForm onLogin={handleLogin} />
      ) : (
        <ChatView token={token} currentUser={currentUser} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
