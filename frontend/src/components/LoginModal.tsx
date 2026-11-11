import React, { useState } from 'react';
import { loginUser } from '../binanceService';

interface LoginModalProps {
  onLoginSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Bitte Benutzername und Passwort eingeben.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await loginUser(username.trim(), password.trim());
      if (res.success) {
        onLoginSuccess();
      } else {
        setError(res.error || 'Ungültige Anmeldedaten. Zugriff verweigert.');
      }
    } catch (err: any) {
      setError(err.message || 'Verbindungsfehler zum Server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-backdrop">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">🔐</div>
          <h2>CryptoAnalyzer Terminal</h2>
          <p className="login-subtitle">
            24/7 Autonomes Trading Dashboard • Zugriff nur fuer autorisierte Administratoren
          </p>
        </div>

        {error && (
          <div className="login-error-banner">
            <span>⚠️ {error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="auth-username">Benutzername</label>
            <input
              id="auth-username"
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="z.B. admin"
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Passwort</label>
            <div className="password-wrapper">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Passwort eingeben"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="toggle-pwd-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
              >
                {showPassword ? '👁️' : '🔒'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            disabled={loading}
          >
            {loading ? 'Authentifiziere...' : 'Terminal Entsperren 🚀'}
          </button>
        </form>

        <div className="login-footer">
          <span>Standard-Zugang: <code>admin</code> / <code>admin123</code></span>
          <span className="login-subtext">Passwort kann in der <code>backend/.env</code> Datei frei gewählt werden.</span>
        </div>
      </div>
    </div>
  );
};
