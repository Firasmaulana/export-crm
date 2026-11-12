"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ensureAndGetTeamMember,
  isSupabaseConfigured,
  supabase,
  TeamMemberRole,
  TeamMemberStatus,
} from "@/lib/supabase";
import {
  Eye,
  EyeOff,
  ArrowRight,
  Clock,
  ShieldAlert,
  RefreshCw,
  LogOut,
} from "lucide-react";

export interface AuthenticatedUser {
  email: string;
  name: string;
  mode: "supabase" | "local";
  role: TeamMemberRole;
  status: TeamMemberStatus;
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
  const [honeypot, setHoneypot] = useState("");
  const [challengeNumA, setChallengeNumA] = useState(() => Math.floor(Math.random() * 8) + 2);
  const [challengeNumB, setChallengeNumB] = useState(() => Math.floor(Math.random() * 8) + 1);
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const regenerateChallenge = () => {
    setChallengeNumA(Math.floor(Math.random() * 8) + 2);
    setChallengeNumB(Math.floor(Math.random() * 8) + 1);
    setChallengeAnswer("");
  };

  const resolveUserWithApproval = useCallback(
    async (params: {
      userId?: string;
      email: string;
      name: string;
      mode: "supabase" | "local";
      onlyCheckExisting?: boolean;
    }): Promise<AuthenticatedUser | null> => {
      try {
        const member = await ensureAndGetTeamMember({
          userId: params.userId,
          email: params.email,
          fullName: params.name,
          onlyCheckExisting: params.onlyCheckExisting,
        });
        return {
          email: params.email,
          name: member.full_name || params.name,
          mode: params.mode,
          role: member.role,
          status: member.status,
        };
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === "ACCOUNT_DELETED_BY_ADMIN"
        ) {
          if (isSupabaseConfigured && supabase) {
            await supabase.auth.signOut();
          }
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
          }
          setErrorMsg("Akun ini telah dihapus oleh Admin.");
          return null;
        }
        return {
          email: params.email,
          name: params.name,
          mode: params.mode,
          role: "member",
          status: "pending",
        };
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    // Safety timeout agar tidak pernah tertahan di state loading
    const safetyTimer = setTimeout(() => {
      if (mounted) setInitializing(false);
    }, 1500);

    async function checkSession() {
      try {
        if (isSupabaseConfigured && supabase) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
          }
          const { data } = await supabase.auth.getSession();
          if (mounted && data?.session?.user) {
            const u = data.session.user;
            const resolved = await resolveUserWithApproval({
              userId: u.id,
              email: u.email || "user@internal.team",
              name:
                (u.user_metadata?.full_name as string) ||
                u.email?.split("@")[0] ||
                "Internal Team",
              mode: "supabase",
              onlyCheckExisting: true,
            });
            if (mounted) setUser(resolved);
          }
          return;
        }

        if (typeof window !== "undefined") {
          const saved = window.localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as AuthenticatedUser;
              if (parsed && parsed.email) {
                const resolved = await resolveUserWithApproval({
                  email: parsed.email,
                  name: parsed.name,
                  mode: "local",
                });
                if (mounted) setUser(resolved);
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        console.warn("Session check warning:", err);
      } finally {
        clearTimeout(safetyTimer);
        if (mounted) setInitializing(false);
      }
    }

    checkSession();

    if (isSupabaseConfigured && supabase) {
      const { data: listener } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (session?.user) {
            const resolved = await resolveUserWithApproval({
              userId: session.user.id,
              email: session.user.email || "user@internal.team",
              name:
                (session.user.user_metadata?.full_name as string) ||
                session.user.email?.split("@")[0] ||
                "Internal Team",
              mode: "supabase",
              onlyCheckExisting: true,
            });
            if (mounted) setUser(resolved);
          } else {
            if (mounted) setUser(null);
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
  }, [resolveUserWithApproval]);

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

    // 1. Proteksi Honeypot Anti-Bot (field tersembunyi tidak boleh diisi oleh manusia)
    if (honeypot.trim() !== "") {
      setErrorMsg("Permintaan ditolak oleh sistem keamanan.");
      return;
    }

    // 2. Cooldown jika terlalu banyak percobaan gagal (Anti Brute-Force)
    if (Date.now() < cooldownUntil) {
      const sisaDetik = Math.ceil((cooldownUntil - Date.now()) / 1000);
      setErrorMsg(`Terlalu banyak percobaan gagal. Silakan tunggu ${sisaDetik} detik.`);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg("Masukkan alamat email Anda.");
      return;
    }

    if (authTab === "signup") {
      if (password.length < 8) {
        setErrorMsg("Password pendaftaran minimal harus 8 karakter.");
        return;
      }
      if (parseInt(challengeAnswer.trim(), 10) !== challengeNumA + challengeNumB) {
        setErrorMsg("Jawaban verifikasi keamanan salah. Silakan hitung ulang.");
        regenerateChallenge();
        return;
      }
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
          setFailedAttempts(0);
          if (data.user) {
            const resolved = await resolveUserWithApproval({
              userId: data.user.id,
              email: data.user.email || cleanEmail,
              name:
                (data.user.user_metadata?.full_name as string) ||
                cleanEmail.split("@")[0],
              mode: "supabase",
              onlyCheckExisting: true,
            });
            setUser(resolved);
          }
        } else {
          const displayName = fullName.trim() || cleanEmail.split("@")[0];

          // Coba daftar langsung lewat fungsi RPC database (bebas Email Rate Limit + Anti-Account Takeover)
          const { error: rpcErr } = await supabase.rpc("register_user_direct", {
            p_email: cleanEmail,
            p_password: password,
            p_full_name: displayName,
          });

          if (rpcErr) {
            // Jika error berasal dari validasi keamanan RPC (email sudah ada, rate limit, password < 8), langsung tolak!
            const msgLower = (rpcErr.message || "").toLowerCase();
            if (
              msgLower.includes("sudah terdaftar") ||
              msgLower.includes("terlalu banyak") ||
              msgLower.includes("antrean") ||
              msgLower.includes("minimal") ||
              msgLower.includes("tidak valid")
            ) {
              throw new Error(rpcErr.message);
            }
          }

          if (!rpcErr) {
            const { data: signInData, error: signInErr } =
              await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
              });
            if (signInErr) throw signInErr;
            if (signInData.user) {
              const resolved = await resolveUserWithApproval({
                userId: signInData.user.id,
                email: signInData.user.email || cleanEmail,
                name: displayName,
                mode: "supabase",
                onlyCheckExisting: false,
              });
              setUser(resolved);
              return;
            }
          }

          // Fallback ke signUp standar jika RPC belum dijalankan di SQL Editor
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: displayName,
              },
            },
          });
          if (error) throw error;
          if (data.session?.user) {
            const resolved = await resolveUserWithApproval({
              userId: data.session.user.id,
              email: data.session.user.email || cleanEmail,
              name: displayName,
              mode: "supabase",
              onlyCheckExisting: false,
            });
            setUser(resolved);
          } else {
            await resolveUserWithApproval({
              userId: data.user?.id,
              email: cleanEmail,
              name: displayName,
              mode: "supabase",
              onlyCheckExisting: false,
            });
            setInfoMsg(
              "Pendaftaran berhasil dikirim! Akun Anda menunggu persetujuan (ACC) Admin sebelum dapat mengakses database."
            );
            setAuthTab("signin");
          }
        }
      } else {
        const resolved = await resolveUserWithApproval({
          email: cleanEmail,
          name: fullName.trim() || cleanEmail.split("@")[0] || "Team",
          mode: "local",
        });
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            LOCAL_AUTH_STORAGE_KEY,
            JSON.stringify(resolved)
          );
        }
        setUser(resolved);
      }
    } catch (err) {
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      if (nextFailed >= 5) {
        setCooldownUntil(Date.now() + 30_000);
        setFailedAttempts(0);
      }
      if (authTab === "signup") {
        regenerateChallenge();
      }
      const rawMsg =
        err instanceof Error
          ? err.message
          : "Gagal masuk. Periksa kembali email dan password Anda.";
      const lower = rawMsg.toLowerCase();

      if (lower.includes("rate limit")) {
        setErrorMsg(
          "Batas pengiriman email konfirmasi Supabase tercapai (Email Rate Limit)."
        );
      } else if (lower.includes("email not confirmed")) {
        setErrorMsg(
          "Email belum dikonfirmasi. Hubungi Admin untuk mengaktifkan akun."
        );
      } else {
        setErrorMsg(rawMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshApproval = useCallback(async () => {
    if (!user) return;
    setCheckingApproval(true);
    try {
      const updated = await resolveUserWithApproval({
        email: user.email,
        name: user.name,
        mode: user.mode,
        onlyCheckExisting: true,
      });
      setUser(updated);
    } finally {
      setCheckingApproval(false);
    }
  }, [user, resolveUserWithApproval]);

  // Cek otomatis secara real-time saat user tertahan di halaman "Menunggu Persetujuan Admin"
  // MAUPUN saat user sudah masuk Dashboard (agar langsung ter-kick jika Admin menghapus/mencabut aksesnya)
  useEffect(() => {
    if (!user) return;

    const verifyMembership = async () => {
      const updated = await resolveUserWithApproval({
        email: user.email,
        name: user.name,
        mode: user.mode,
        onlyCheckExisting: true,
      });
      if (
        !updated ||
        updated.status !== user.status ||
        updated.role !== user.role
      ) {
        setUser(updated);
      }
    };

    const intervalMs = user.status === "approved" ? 4000 : 3000;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        verifyMembership();
      }
    }, intervalMs);

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        verifyMembership();
      }
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleFocus);

    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null =
      null;
    if (supabase) {
      channel = supabase
        .channel("authgate-approval-sync")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "team_members" },
          () => {
            verifyMembership();
          }
        )
        .subscribe();
    }

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("visibilitychange", handleFocus);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [user, resolveUserWithApproval]);

  if (user) {
    if (user.status === "approved") {
      return <>{children(user, handleSignOut)}</>;
    }

    const isRejected = user.status === "rejected";

    return (
      <div className="lustro-bg flex flex-col items-center justify-center min-h-screen px-5 py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="lustro-logo" />
          <span className="font-display font-semibold text-base tracking-tight text-white">
            Export CRM <span className="text-indigo-300">/</span>{" "}
            <span className="text-white/60 font-normal text-sm">
              Access Control
            </span>
          </span>
        </div>

        <div className="glass-card w-full max-w-[430px] p-8 sm:p-9 shadow-2xl text-center">
          <div
            className={`w-12 h-12 rounded-2xl mx-auto mb-5 flex items-center justify-center border ${
              isRejected
                ? "bg-rose-500/15 border-rose-400/30 text-rose-300"
                : "bg-amber-500/15 border-amber-400/30 text-amber-300"
            }`}
          >
            {isRejected ? (
              <ShieldAlert className="w-6 h-6" />
            ) : (
              <Clock className="w-6 h-6" />
            )}
          </div>

          <div className="font-mono-label text-indigo-300 mb-2">
            {isRejected ? "ACCESS REVOKED" : "PENDING ADMIN APPROVAL"}
          </div>

          <h1 className="font-display text-xl font-medium text-white">
            {isRejected
              ? "Akses Akun Ditolak / Dicabut"
              : "Menunggu Persetujuan (ACC) Admin"}
          </h1>

          <p className="mt-3 text-xs text-white/60 leading-relaxed">
            {isRejected ? (
              <>
                Maaf, akses untuk akun{" "}
                <strong className="text-white">{user.email}</strong> telah
                ditolak atau dicabut oleh Admin Export CRM.
              </>
            ) : (
              <>
                Akun <strong className="text-white">{user.email}</strong> sudah
                terdaftar, namun harus{" "}
                <strong className="text-amber-200">di-ACC terlebih dahulu</strong>{" "}
                oleh Admin sebelum dapat melihat atau mengelola database Bumi
                Sari Lokal &amp; Karaya Living.
              </>
            )}
          </p>

          <div className="mt-7 space-y-3">
            {!isRejected && (
              <button
                type="button"
                onClick={handleRefreshApproval}
                disabled={checkingApproval}
                className="btn-lustro-primary w-full py-3"
              >
                <RefreshCw
                  className={`w-4 h-4 ${checkingApproval ? "animate-spin" : ""}`}
                />
                <span>
                  {checkingApproval
                    ? "Mengecek status..."
                    : "Cek Status Persetujuan"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              className="btn-lustro-secondary w-full py-2.5 justify-center"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar / Ganti Akun</span>
            </button>
          </div>
        </div>
      </div>
    );
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
          {/* Anti-bot honeypot field (hidden from real users) */}
          <div
            aria-hidden="true"
            className="sr-only"
          >
            <label htmlFor="company-website">Company Website</label>
            <input
              id="company-website"
              name="company_website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

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
              Password{" "}
              {authTab === "signup" && (
                <span className="text-white/40 normal-case">(min. 8 karakter)</span>
              )}
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
                minLength={authTab === "signup" ? 8 : 6}
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

          {authTab === "signup" && (
            <div>
              <label
                htmlFor="security-challenge"
                className="block font-mono-label text-white/60 mb-2"
              >
                Verifikasi Keamanan: Berapa {challengeNumA} + {challengeNumB}?
              </label>
              <input
                id="security-challenge"
                name="security_challenge"
                type="number"
                inputMode="numeric"
                required
                value={challengeAnswer}
                onChange={(e) => setChallengeAnswer(e.target.value)}
                placeholder="Masukkan hasil penjumlahan"
                className="input-lustro w-full"
              />
            </div>
          )}

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
              const nextTab = authTab === "signin" ? "signup" : "signin";
              setAuthTab(nextTab);
              setErrorMsg(null);
              if (nextTab === "signup") {
                regenerateChallenge();
              }
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
