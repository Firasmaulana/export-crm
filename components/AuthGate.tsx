"use client";

import React, { useState, useEffect } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Eye, EyeOff, ArrowRight } from "lucide-react";

export interface AuthenticatedUser {
  email: string;
  name: string;
  mode: "supabase" | "local";
}

interface AuthGateProps {
  children: (user: AuthenticatedUser, onSignOut: () => void) => React.ReactNode;
}

const LOCAL_AUTH_STORAGE_KEY = "b2b_export_crm_auth_user_v1";

export default function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      if (isSupabaseConfigured && supabase) {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
        }
        const { data } = await supabase.auth.getSession();
        if (mounted && data.session?.user) {
          const u = data.session.user;
          setUser({
            email: u.email || "user@internal.team",
            name:
              (u.user_metadata?.full_name as string) ||
              u.email?.split("@")[0] ||
              "Internal Team",
            mode: "supabase",
          });
        }
        if (mounted) setInitializing(false);
        return;
      }

      if (typeof window !== "undefined") {
        const saved = window.localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as AuthenticatedUser;
            if (parsed && parsed.email) {
              if (mounted) setUser(parsed);
            }
          } catch {
            // ignore
          }
        }
      }

      if (mounted) setInitializing(false);
    }

    checkSession();

    if (isSupabaseConfigured && supabase) {
      const { data: listener } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (session?.user) {
            setUser({
              email: session.user.email || "user@internal.team",
              name:
                (session.user.user_metadata?.full_name as string) ||
                session.user.email?.split("@")[0] ||
                "Internal Team",
              mode: "supabase",
            });
          } else {
            setUser(null);
          }
        }
      );
      return () => {
        mounted = false;
        listener.subscription.unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
    }
    setUser(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg("Masukkan alamat email Anda.");
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        if (authTab === "signin") {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (error) throw error;
          if (data.user) {
            setUser({
              email: data.user.email || cleanEmail,
              name:
                (data.user.user_metadata?.full_name as string) ||
                cleanEmail.split("@")[0],
              mode: "supabase",
            });
          }
        } else {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: fullName.trim() || cleanEmail.split("@")[0],
              },
            },
          });
          if (error) throw error;
          if (data.session?.user) {
            setUser({
              email: data.session.user.email || cleanEmail,
              name: fullName.trim() || cleanEmail.split("@")[0],
              mode: "supabase",
            });
          } else {
            setInfoMsg("Akun berhasil dibuat. Silakan Sign In.");
            setAuthTab("signin");
          }
        }
      } else {
        const localUser: AuthenticatedUser = {
          email: cleanEmail,
          name: fullName.trim() || cleanEmail.split("@")[0] || "Team",
          mode: "local",
        };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            LOCAL_AUTH_STORAGE_KEY,
            JSON.stringify(localUser)
          );
        }
        setUser(localUser);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal masuk. Periksa kembali email dan password Anda."
      );
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
    return (
      <div className="lustro-bg flex items-center justify-center p-6">
        <div className="font-mono-label text-white/50">LOADING...</div>
      </div>
    );
  }

  if (user) {
    return <>{children(user, handleSignOut)}</>;
  }

  return (
    <div className="lustro-bg flex flex-col items-center justify-center min-h-screen px-5 py-12">
      {/* Minimal Brand Top */}
      <div className="mb-8 flex items-center gap-3">
        <div className="lustro-logo" />
        <span className="font-display font-semibold text-base tracking-tight text-white">
          Export CRM <span className="text-indigo-300">/</span>{" "}
          <span className="text-white/60 font-normal text-sm">
            Internal Workspace
          </span>
        </span>
      </div>

      {/* Centered Minimal Lustro Glass Card */}
      <div className="glass-card w-full max-w-[400px] p-8 sm:p-9 shadow-2xl">
        <div className="mb-7">
          <div className="font-mono-label text-indigo-300 mb-2">
            AUTHENTICATION
          </div>
          <h1 className="font-display text-2xl font-medium text-white">
            {authTab === "signin" ? "Sign in to workspace" : "Create account"}
          </h1>
          <p className="mt-1.5 text-xs text-white/50">
            Bumi Sari Lokal &amp; Karaya Living B2B Database
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-5 px-3.5 py-2.5 rounded-xl bg-rose-500/12 border border-rose-400/25 text-rose-200 text-xs"
          >
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            aria-live="polite"
            className="mb-5 px-3.5 py-2.5 rounded-xl bg-emerald-500/12 border border-emerald-400/25 text-emerald-200 text-xs"
          >
            {infoMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} method="POST" className="space-y-4">
          {authTab === "signup" && (
            <div>
              <label
                htmlFor="full-name"
                className="block font-mono-label text-white/60 mb-2"
              >
                Full Name
              </label>
              <input
                id="full-name"
                name="full_name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nama lengkap"
                className="input-lustro w-full"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block font-mono-label text-white/60 mb-2"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="current-password"
              className="block font-mono-label text-white/60 mb-2"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="current-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  authTab === "signin" ? "current-password" : "new-password"
                }
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-lustro w-full pr-10"
              />
              <button
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 p-1 cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="btn-lustro-primary w-full py-3"
            >
              <span>
                {loading
                  ? "Please wait..."
                  : authTab === "signin"
                  ? "Sign In"
                  : "Create Account"}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="mt-6 pt-5 border-t border-white/8 text-center">
          <button
            type="button"
            onClick={() => {
              setAuthTab(authTab === "signin" ? "signup" : "signin");
              setErrorMsg(null);
            }}
            className="text-xs text-white/50 hover:text-white transition cursor-pointer"
          >
            {authTab === "signin"
              ? "Belum punya akun tim? Daftar di sini"
              : "Sudah punya akun? Kembali ke Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
