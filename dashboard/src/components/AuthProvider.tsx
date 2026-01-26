"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getStoredPassword, setStoredPassword, clearStoredPassword } from "@/lib/auth";

interface AuthContextType {
  isAuthenticated: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if already authenticated on mount
  useEffect(() => {
    const stored = getStoredPassword();
    if (stored) {
      // Verify the stored password is still valid
      fetch("/api/auth/verify", {
        headers: { "X-Dashboard-Auth": stored },
      })
        .then((res) => {
          if (res.ok) {
            setIsAuthenticated(true);
          } else {
            clearStoredPassword();
          }
        })
        .catch(() => {
          clearStoredPassword();
        })
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  const login = async (pwd: string): Promise<boolean> => {
    const res = await fetch("/api/auth/verify", {
      headers: { "X-Dashboard-Auth": pwd },
    });
    if (res.ok) {
      setStoredPassword(pwd);
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    clearStoredPassword();
    setIsAuthenticated(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const success = await login(password);
    if (!success) {
      setError("Wrong password, pal");
    }
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8">
            <h1 className="text-2xl font-bold text-white text-center mb-2">
              Vito Dashboard
            </h1>
            <p className="text-zinc-500 text-center text-sm mb-6">
              Enter the password to continue
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoFocus
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full py-3 bg-white text-zinc-900 font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Checking..." : "Enter"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
