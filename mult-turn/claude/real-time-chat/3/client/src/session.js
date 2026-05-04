const API = 'http://localhost:5000';

export function loadSession() {
  const token = localStorage.getItem('chat_token');
  const raw = localStorage.getItem('chat_user');
  if (!token || !raw) return null;
  try {
    return { token, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function saveSession({ token, userId, username }) {
  localStorage.setItem('chat_token', token);
  localStorage.setItem('chat_user', JSON.stringify({ userId, username }));
}

export function clearSession() {
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
}

export async function apiAuth(mode, username, password) {
  const res = await fetch(`${API}/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data; // { token, userId, username }
}
