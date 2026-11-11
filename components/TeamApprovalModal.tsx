"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  deleteTeamMember,
  fetchAllTeamMembers,
  preApproveTeamMemberEmail,
  supabase,
  TeamMemberRecord,
  TeamMemberRole,
  TeamMemberStatus,
  updateTeamMemberStatus,
} from "@/lib/supabase";
import {
  Check,
  Copy,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";

interface TeamApprovalModalProps {
  isOpen: boolean;
  currentUserEmail: string;
  currentUserRole: TeamMemberRole;
  onClose: () => void;
  onMembersChanged?: (members: TeamMemberRecord[]) => void;
}

const TEAM_APPROVAL_SQL_SNIPPET = `-- Jalankan di Supabase SQL Editor untuk mengaktifkan sistem ACC Admin:
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.team_members (user_id, email, full_name, role, status)
SELECT
  u.id,
  LOWER(u.email),
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  CASE WHEN ROW_NUMBER() OVER (ORDER BY u.created_at ASC) = 1 THEN 'admin' ELSE 'member' END,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY u.created_at ASC) = 1 THEN 'approved' ELSE 'pending' END
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE has_admin BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE role = 'admin' AND status = 'approved') INTO has_admin;
  INSERT INTO public.team_members (user_id, email, full_name, role, status)
  VALUES (
    NEW.id, LOWER(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    CASE WHEN NOT has_admin THEN 'admin' ELSE 'member' END,
    CASE WHEN NOT has_admin THEN 'approved' ELSE 'pending' END
  ) ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created_team_member ON auth.users;
CREATE TRIGGER on_auth_user_created_team_member AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.is_approved_member() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')) AND status = 'approved');
$$;

CREATE OR REPLACE FUNCTION public.is_admin_member() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')) AND role = 'admin' AND status = 'approved');
$$;

CREATE OR REPLACE FUNCTION public.has_any_admin() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE role = 'admin' AND status = 'approved');
$$;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team members select policy" ON public.team_members;
CREATE POLICY "Team members select policy" ON public.team_members FOR SELECT TO authenticated USING (LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')) OR public.is_approved_member() OR NOT public.has_any_admin());
DROP POLICY IF EXISTS "Team members insert policy" ON public.team_members;
CREATE POLICY "Team members insert policy" ON public.team_members FOR INSERT TO authenticated WITH CHECK (LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', '')) OR public.is_admin_member());
DROP POLICY IF EXISTS "Team members update policy" ON public.team_members;
CREATE POLICY "Team members update policy" ON public.team_members FOR UPDATE TO authenticated USING (public.is_admin_member()) WITH CHECK (public.is_admin_member());
DROP POLICY IF EXISTS "Team members delete policy" ON public.team_members;
CREATE POLICY "Team members delete policy" ON public.team_members FOR DELETE TO authenticated USING (public.is_admin_member());

DROP POLICY IF EXISTS "Allow authenticated full access to buyers" ON public.buyers;
DROP POLICY IF EXISTS "Allow approved team members access to buyers" ON public.buyers;
CREATE POLICY "Allow approved team members access to buyers" ON public.buyers FOR ALL TO authenticated USING (public.is_approved_member()) WITH CHECK (public.is_approved_member());`;

export default function TeamApprovalModal({
  isOpen,
  currentUserEmail,
  currentUserRole,
  onClose,
  onMembersChanged,
}: TeamApprovalModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);

  const isAdmin = currentUserRole === "admin";

  const loadMembers = async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchAllTeamMembers();
      setMembers(res.members);
      setTableMissing(res.tableMissing);
      onMembersChanged?.(res.members);
    } catch (err) {
      if (!silent) {
        setErrorMsg(
          err instanceof Error ? err.message : "Gagal memuat daftar anggota tim."
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
      loadMembers();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Realtime listener & polling saat modal ACC Tim sedang terbuka
  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadMembers(true);
      }
    }, 3000);

    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null =
      null;
    if (supabase) {
      channel = supabase
        .channel("team-modal-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "team_members" },
          () => {
            loadMembers(true);
          }
        )
        .subscribe();
    }

    return () => {
      clearInterval(timer);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleNativeClose);
    return () => {
      dialog.removeEventListener("close", handleNativeClose);
    };
  }, [onClose]);

  const handleStatusChange = async (
    member: TeamMemberRecord,
    status: TeamMemberStatus
  ) => {
    setErrorMsg(null);
    try {
      const updated = await updateTeamMemberStatus(member.id, { status });
      const next = members.map((m) => (m.id === member.id ? updated : m));
      setMembers(next);
      onMembersChanged?.(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal mengubah status akses."
      );
    }
  };

  const handleRoleChange = async (
    member: TeamMemberRecord,
    role: TeamMemberRole
  ) => {
    setErrorMsg(null);
    try {
      const updated = await updateTeamMemberStatus(member.id, { role });
      const next = members.map((m) => (m.id === member.id ? updated : m));
      setMembers(next);
      onMembersChanged?.(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal mengubah role anggota."
      );
    }
  };

  const handleDelete = async (member: TeamMemberRecord) => {
    if (member.email.toLowerCase() === currentUserEmail.toLowerCase()) {
      setErrorMsg("Anda tidak dapat menghapus akun Anda sendiri.");
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeletingId(member.id);
    try {
      await deleteTeamMember(member.id, member.email);
      const next = members.filter((m) => m.id !== member.id);
      setMembers(next);
      onMembersChanged?.(next);
      setConfirmingDeleteId(null);
      setSuccessMsg(`Akun ${member.email} berhasil dihapus permanen.`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus anggota."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newEmail.trim().toLowerCase();
    if (!clean) return;
    setAddingEmail(true);
    setErrorMsg(null);
    try {
      await preApproveTeamMemberEmail({
        email: clean,
        fullName: newName.trim() || clean.split("@")[0],
        role: "member",
      });
      setNewEmail("");
      setNewName("");
      await loadMembers();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menambahkan email."
      );
    } finally {
      setAddingEmail(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(TEAM_APPROVAL_SQL_SNIPPET);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const pendingMembers = members.filter((m) => m.status === "pending");
  const otherMembers = members.filter((m) => m.status !== "pending");

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="team-approval-modal-title"
      className="lustro-dialog w-full max-w-2xl p-0 m-auto"
    >
      <div className="flex items-center justify-between px-7 py-5 border-b border-white/8">
        <div>
          <div className="font-mono-label text-indigo-300 mb-1">
            ACCESS CONTROL &amp; ADMIN APPROVAL
          </div>
          <h2
            id="team-approval-modal-title"
            className="font-display text-lg font-medium text-white"
          >
            Kelola Akses Tim &amp; Persetujuan (ACC) Akun
          </h2>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Tutup panel akses tim"
          className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-7 space-y-6 max-h-[78vh] overflow-y-auto text-xs text-white/75">
        {errorMsg && (
          <div className="px-4 py-3 rounded-xl bg-rose-500/12 border border-rose-400/25 text-rose-200">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="px-4 py-3 rounded-xl bg-emerald-500/12 border border-emerald-400/25 text-emerald-200">
            {successMsg}
          </div>
        )}

        {tableMissing ? (
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-400/25 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-medium text-amber-200 text-sm">
                Aktifkan Tabel Persetujuan (ACC) di Supabase
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="btn-lustro-primary py-1.5 px-3 text-xs"
              >
                {copiedSql ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> SQL Tersalin!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy SQL Approval
                  </>
                )}
              </button>
            </div>
            <p className="text-white/65 leading-relaxed">
              Agar sistem <strong>ACC Admin</strong> aktif di database Supabase
              Anda, klik tombol <strong>Copy SQL Approval</strong> di atas, buka{" "}
              <strong>Supabase Dashboard → SQL Editor → New Query</strong>,
              tempelkan (Paste), lalu klik <strong>Run</strong>. Akun Anda akan
              otomatis menjadi <strong>Admin Utama</strong>.
            </p>
            <pre className="p-3 rounded-xl bg-[#070a12] border border-white/8 text-indigo-200 font-mono text-[11px] max-h-44 overflow-y-auto">
              {TEAM_APPROVAL_SQL_SNIPPET}
            </pre>
            <button
              type="button"
              onClick={() => loadMembers()}
              className="btn-lustro-secondary py-2 px-4"
            >
              Saya Sudah Menjalankan SQL — Cek Ulang
            </button>
          </div>
        ) : (
          <>
            {/* 1. Daftar Pendaftar Baru yang Menunggu ACC (Pending) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display font-medium text-white text-sm">
                  Menunggu Persetujuan / ACC ({pendingMembers.length})
                </span>
                <span className="text-[11px] text-white/45">
                  Pendaftar baru tidak bisa masuk sebelum Anda klik ACC
                </span>
              </div>

              {pendingMembers.length === 0 ? (
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/8 text-white/45 text-center">
                  Tidak ada pendaftar baru yang menunggu persetujuan saat ini.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {pendingMembers.map((m) => (
                    <div
                      key={m.id}
                      className="p-4 rounded-xl bg-amber-500/10 border border-amber-400/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-medium text-white text-sm">
                          {m.full_name || m.email}
                        </div>
                        <div className="text-amber-200/80 font-mono text-[11px]">
                          {m.email} • Status: PENDING ACC
                        </div>
                      </div>

                      {isAdmin && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStatusChange(m, "approved")}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-200 font-medium inline-flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>ACC / Setujui</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusChange(m, "rejected")}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 inline-flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>Tolak</span>
                          </button>

                          {confirmingDeleteId === m.id ? (
                            <div className="inline-flex items-center gap-1.5 bg-rose-500/20 border border-rose-400/40 px-2.5 py-1 rounded-lg">
                              <span className="text-rose-200 text-[11px]">
                                Hapus permanen?
                              </span>
                              <button
                                type="button"
                                disabled={deletingId === m.id}
                                onClick={() => handleDelete(m)}
                                className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white font-medium text-[11px] cursor-pointer"
                              >
                                {deletingId === m.id ? "Menghapus..." : "Ya"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[11px] cursor-pointer"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(m.id)}
                              className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-200 inline-flex items-center gap-1.5 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hapus Akun</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Form Whitelist / Pre-Approve Email Sebelum Sign Up */}
            {isAdmin && (
              <form
                onSubmit={handlePreApproveSubmit}
                className="p-4 rounded-xl bg-white/[0.03] border border-white/8 space-y-3"
              >
                <div className="font-display font-medium text-white text-sm flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-indigo-300" />
                  <span>Pre-Approve (Whitelist) Email Anggota Tim</span>
                </div>
                <p className="text-white/50 text-[11px]">
                  Anda juga bisa mendaftarkan email rekan tim terlebih dahulu di
                  sini agar saat mereka Sign Up nanti langsung otomatis
                  disetujui (Approved).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="email.rekan@perusahaan.com"
                    className="input-lustro sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nama Lengkap (opsional)"
                    className="input-lustro sm:col-span-2"
                  />
                  <button
                    type="submit"
                    disabled={addingEmail}
                    className="btn-lustro-primary justify-center py-2"
                  >
                    <span>{addingEmail ? "Menyimpan..." : "Tambah ACC"}</span>
                  </button>
                </div>
              </form>
            )}

            {/* 3. Daftar Seluruh Anggota Tim Terdaftar */}
            <div className="space-y-3">
              <div className="font-display font-medium text-white text-sm">
                Daftar Anggota Tim ({otherMembers.length})
              </div>

              {loading && members.length === 0 ? (
                <div className="p-4 text-center text-white/40">
                  Memuat daftar anggota tim...
                </div>
              ) : (
                <div className="space-y-2">
                  {otherMembers.map((m) => {
                    const isSelf =
                      m.email.toLowerCase() === currentUserEmail.toLowerCase();
                    return (
                      <div
                        key={m.id}
                        className="p-3.5 rounded-xl bg-white/[0.025] border border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">
                              {m.full_name || m.email}
                            </span>
                            {m.role === "admin" && (
                              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-[10px] font-mono inline-flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> ADMIN
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                                m.status === "approved"
                                  ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                                  : "bg-rose-500/15 border-rose-400/30 text-rose-200"
                              }`}
                            >
                              {m.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-white/45 font-mono text-[11px]">
                            {m.email}
                            {isSelf ? " (Anda)" : ""}
                          </div>
                        </div>

                        {isAdmin && !isSelf && (
                          <div className="flex items-center gap-2">
                            {m.status === "approved" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(m, "rejected")
                                }
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/30 text-white/70 hover:text-rose-200 text-[11px] transition cursor-pointer"
                              >
                                Cabut Akses
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(m, "approved")
                                }
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-200 text-[11px] transition cursor-pointer"
                              >
                                Pulihkan (ACC)
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                handleRoleChange(
                                  m,
                                  m.role === "admin" ? "member" : "admin"
                                )
                              }
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-[11px] transition cursor-pointer"
                            >
                              {m.role === "admin"
                                ? "Jadikan Member"
                                : "Jadikan Admin"}
                            </button>

                            {confirmingDeleteId === m.id ? (
                              <div className="inline-flex items-center gap-1.5 bg-rose-500/20 border border-rose-400/40 px-2.5 py-1 rounded-lg">
                                <span className="text-rose-200 text-[11px]">
                                  Hapus permanen?
                                </span>
                                <button
                                  type="button"
                                  disabled={deletingId === m.id}
                                  onClick={() => handleDelete(m)}
                                  className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white font-medium text-[11px] cursor-pointer"
                                >
                                  {deletingId === m.id ? "Menghapus..." : "Ya"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingDeleteId(null)}
                                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[11px] cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(m.id)}
                                aria-label={`Hapus ${m.email}`}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-200 text-[11px] inline-flex items-center gap-1 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus Akun</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
