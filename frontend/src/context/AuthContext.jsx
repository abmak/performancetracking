import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const response = await fetch(url, config);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return response.json();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, check for stored token
  useEffect(() => {
    const stored = localStorage.getItem('vas_token');
    const storedUser = localStorage.getItem('vas_user');
    if (stored && storedUser) {
      setToken(stored);
      try {
        setUser(JSON.parse(storedUser));
      } catch {}
      // Verify token is still valid
      verifyToken(stored);
    } else {
      setLoading(false);
    }
  }, []);

  async function verifyToken(t) {
    try {
      const data = await request('/auth/me', {
        headers: { Authorization: `Bearer ${t}` },
      });
      setUser(data.user);
      localStorage.setItem('vas_user', JSON.stringify(data.user));
    } catch {
      // Token invalid — clear
      setToken(null);
      setUser(null);
      localStorage.removeItem('vas_token');
      localStorage.removeItem('vas_user');
    }
    setLoading(false);
  }

  async function login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('vas_token', data.token);
    localStorage.setItem('vas_user', JSON.stringify(data.user));
    return data;
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem('vas_token');
    localStorage.removeItem('vas_user');
  }

  function updateUser(updates) {
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem('vas_user', JSON.stringify(updated));
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await request('/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { current_password: currentPassword, new_password: newPassword },
    });
    return data;
  }

  async function uploadAvatar(base64Data) {
    const data = await request('/auth/upload-avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { avatar_data: base64Data },
    });
    updateUser({ avatar_url: data.avatar_url });
    return data;
  }

  async function removeAvatar() {
    await request('/auth/remove-avatar', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    updateUser({ avatar_url: null });
  }

  function hasPermission(permissionName) {
    if (!user || !user.permissions) return false;
    return user.permissions.some(p => p.name === permissionName);
  }

  function hasAnyPermission(...names) {
    return names.some(n => hasPermission(n));
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser, changePassword, uploadAvatar, removeAvatar, hasPermission, hasAnyPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { request };
