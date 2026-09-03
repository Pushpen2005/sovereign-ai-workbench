import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loginApi, registerApi, getMeApi } from "../api/auth.api.js";

const AuthContext = createContext(null);
const TOKEN_KEY = "sovereign_auth_token";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Validate existing token on mount
  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        if (isMounted) {
          setIsLoading(false);
          setUser(null);
        }
        return;
      }

      try {
        const userData = await getMeApi();
        if (isMounted) {
          setUser(userData);
        }
      } catch (err) {
        console.warn("[Auth] Stored session invalid or expired:", err.message);
        localStorage.removeItem(TOKEN_KEY);
        if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const { user: authUser, token: authToken } = await loginApi({ email, password });
      localStorage.setItem(TOKEN_KEY, authToken);
      setToken(authToken);
      setUser(authUser);
      return authUser;
    } catch (err) {
      const msg = err.message || "Failed to authenticate";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async ({ name, email, password, organizationName }) => {
    setIsLoading(true);
    setError(null);
    try {
      const { user: authUser, token: authToken } = await registerApi({
        name,
        email,
        password,
        organizationName,
      });
      localStorage.setItem(TOKEN_KEY, authToken);
      setToken(authToken);
      setUser(authUser);
      return authUser;
    } catch (err) {
      const msg = err.message || "Registration failed";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Non-blocking
    }
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = {
    user,
    token,
    isAuthenticated: Boolean(user && token),
    isLoading,
    error,
    login,
    register,
    logout,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
