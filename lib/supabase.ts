import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { BuyerRecord, PipelineStatus, SectorName } from "./constants";
import {
  extractRootDomain,
  findDuplicateBuyers,
  inferSectorsFromProductTags,
  normalizeCompanyName,
} from "./deduplication";
import { INITIAL_DEDUPLICATED_BUYERS } from "./seed-data";

const rawSupabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
// Sanitize URL jika user menyalin endpoint '/rest/v1/' dari Supabase Settings
const supabaseUrl = rawSupabaseUrl
  .replace(/\/rest\/v1\/?$/i, "")
  .replace(/\/+$/, "");
const supabaseAnonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
).trim();

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes("your-project-ref.supabase.co") &&
  !supabaseAnonKey.includes("your-supabase-anon-public-key") &&
  supabaseUrl.startsWith("http");

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const LOCAL_STORAGE_KEY = "b2b_export_crm_buyers_v1";

function getLocalBuyers(): BuyerRecord[] {
  if (typeof window === "undefined") return INITIAL_DEDUPLICATED_BUYERS;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(INITIAL_DEDUPLICATED_BUYERS)
      );
      return INITIAL_DEDUPLICATED_BUYERS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return INITIAL_DEDUPLICATED_BUYERS;
  } catch {
    return INITIAL_DEDUPLICATED_BUYERS;
  }
}

function saveLocalBuyers(buyers: BuyerRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(buyers));
  } catch (err) {
    console.error("Failed to save to localStorage:", err);
  }
}

export async function fetchAllBuyers(): Promise<BuyerRecord[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("buyers")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data || []).map((row) => ({
      ...row,
      sectors: Array.isArray(row.sectors) ? row.sectors : [],
      product_tags: Array.isArray(row.product_tags) ? row.product_tags : [],
    })) as BuyerRecord[];
  }

  return getLocalBuyers();
}

/**
 * Real-time query ke database (atau local fallback) untuk mengecek potensi duplikasi
 * berdasarkan Nama Perusahaan (normalized_name) maupun Website/Email (company_domain).
 */
export async function checkBuyerDuplicatesLive(
  input: {
    company_name?: string;
    website?: string;
    email?: string;
    excludeId?: string;
  },
  cachedBuyers?: BuyerRecord[]
) {
  const normName = normalizeCompanyName(input.company_name);
  const rootDomain = extractRootDomain(input.website, input.email);

  if (!normName && !rootDomain) {
    return [];
  }

  // Jika menggunakan Supabase, lakukan query langsung ke PostgreSQL agar selalu akurat & real-time
  if (supabase) {
    const orFilters: string[] = [];
    if (normName && normName.length >= 2) {
      // Escape karakter khusus PostgREST filter
      const safeNorm = normName.replace(/[,()*]/g, " ").trim();
      if (safeNorm) {
        orFilters.push(`normalized_name.ilike.%${safeNorm}%`);
        const firstToken = safeNorm.split(" ")[0];
        if (firstToken && firstToken.length >= 4) {
          orFilters.push(`normalized_name.ilike.%${firstToken}%`);
        }
      }
    }
    if (rootDomain) {
      orFilters.push(`company_domain.eq.${rootDomain}`);
    }

    if (orFilters.length > 0) {
      const { data, error } = await supabase
        .from("buyers")
        .select("*")
        .or(orFilters.join(","))
        .limit(10);

      if (!error && data) {
        const combinedPool = [...data] as BuyerRecord[];
        if (cachedBuyers) {
          const seen = new Set(combinedPool.map((b) => b.id));
          for (const b of cachedBuyers) {
            if (!seen.has(b.id)) combinedPool.push(b);
          }
        }
        return findDuplicateBuyers(input, combinedPool);
      }
    }
  }

  const pool = cachedBuyers || getLocalBuyers();
  return findDuplicateBuyers(input, pool);
}

export interface UpsertBuyerInput {
  id?: string;
  company_name: string;
  country: string;
  city: string;
  website: string;
  email: string;
  whatsapp?: string;
  pic_name: string;
  linkedin_url: string;
  social_media: string;
  sectors: SectorName[];
  product_tags: string[];
  pipeline_status: PipelineStatus;
  notes: string;
  created_by: string;
}

/**
 * Menyimpan atau memperbarui 1 record Buyer dengan validasi normalisasi & anti-duplikasi ketat.
 */
export async function saveBuyerRecord(
  input: UpsertBuyerInput
): Promise<{ record: BuyerRecord; action: "created" | "updated" }> {
  const normalized_name = normalizeCompanyName(input.company_name);
  if (!normalized_name) {
    throw new Error("Nama perusahaan tidak valid setelah normalisasi.");
  }

  const company_domain = extractRootDomain(input.website, input.email) || null;
  const uniqueTags = Array.from(new Set(input.product_tags));
  const uniqueSectors = inferSectorsFromProductTags(uniqueTags, input.sectors);
  const nowIso = new Date().toISOString();

  if (supabase) {
    // Jika tambah baru (tanpa id), cek apakah normalized_name atau company_domain sudah ada
    if (!input.id) {
      const orClauses = [`normalized_name.eq.${normalized_name}`];
      if (company_domain) {
        orClauses.push(`company_domain.eq.${company_domain}`);
      }
      const { data: existing } = await supabase
        .from("buyers")
        .select("*")
        .or(orClauses.join(","))
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error(
          `DUPLICATE_DETECTED: Perusahaan "${existing[0].company_name}" sudah terdaftar di database dengan nama/domain yang sama.`
        );
      }

      const payload = {
        company_name: input.company_name.trim(),
        normalized_name,
        company_domain,
        country: input.country.trim(),
        city: input.city.trim(),
        website: input.website.trim(),
        email: input.email.trim(),
        whatsapp: (input.whatsapp || "").trim(),
        pic_name: input.pic_name.trim(),
        linkedin_url: input.linkedin_url.trim(),
        social_media: input.social_media.trim(),
        sectors: uniqueSectors,
        product_tags: uniqueTags,
        pipeline_status: input.pipeline_status,
        notes: input.notes.trim(),
        created_by: input.created_by.trim(),
      };

      const { data, error } = await supabase
        .from("buyers")
        .insert([payload])
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "DUPLICATE_DETECTED: Constraint Database menolak penyimpanan karena Nama Perusahaan atau Domain sudah terdaftar."
          );
        }
        throw new Error(error.message);
      }

      return { record: data as BuyerRecord, action: "created" };
    } else {
      const payload = {
        company_name: input.company_name.trim(),
        normalized_name,
        company_domain,
        country: input.country.trim(),
        city: input.city.trim(),
        website: input.website.trim(),
        email: input.email.trim(),
        whatsapp: (input.whatsapp || "").trim(),
        pic_name: input.pic_name.trim(),
        linkedin_url: input.linkedin_url.trim(),
        social_media: input.social_media.trim(),
        sectors: uniqueSectors,
        product_tags: uniqueTags,
        pipeline_status: input.pipeline_status,
        notes: input.notes.trim(),
        updated_at: nowIso,
      };

      const { data, error } = await supabase
        .from("buyers")
        .update(payload)
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(
            "DUPLICATE_DETECTED: Perubahan ini bentrok dengan Nama Perusahaan atau Domain buyer lain yang sudah ada."
          );
        }
        throw new Error(error.message);
      }

      return { record: data as BuyerRecord, action: "updated" };
    }
  }

  // Fallback Local Mode
  const current = getLocalBuyers();
  if (!input.id) {
    const duplicate = current.find(
      (b) =>
        b.normalized_name === normalized_name ||
        (company_domain && b.company_domain === company_domain)
    );
    if (duplicate) {
      throw new Error(
        `DUPLICATE_DETECTED: Perusahaan "${duplicate.company_name}" sudah terdaftar di database.`
      );
    }

    const newRecord: BuyerRecord = {
      id: crypto.randomUUID(),
      company_name: input.company_name.trim(),
      normalized_name,
      company_domain,
      country: input.country.trim(),
      city: input.city.trim(),
      website: input.website.trim(),
      email: input.email.trim(),
      whatsapp: (input.whatsapp || "").trim(),
      pic_name: input.pic_name.trim(),
      linkedin_url: input.linkedin_url.trim(),
      social_media: input.social_media.trim(),
      sectors: uniqueSectors,
      product_tags: uniqueTags,
      pipeline_status: input.pipeline_status,
      notes: input.notes.trim(),
      created_by: input.created_by.trim(),
      created_at: nowIso,
      updated_at: nowIso,
    };

    const next = [newRecord, ...current];
    saveLocalBuyers(next);
    return { record: newRecord, action: "created" };
  } else {
    const duplicate = current.find(
      (b) =>
        b.id !== input.id &&
        (b.normalized_name === normalized_name ||
          (company_domain && b.company_domain === company_domain))
    );
    if (duplicate) {
      throw new Error(
        `DUPLICATE_DETECTED: Perubahan ini bentrok dengan "${duplicate.company_name}".`
      );
    }

    let updatedRecord: BuyerRecord | null = null;
    const next = current.map((b) => {
      if (b.id !== input.id) return b;
      updatedRecord = {
        ...b,
        company_name: input.company_name.trim(),
        normalized_name,
        company_domain,
        country: input.country.trim(),
        city: input.city.trim(),
        website: input.website.trim(),
        email: input.email.trim(),
        whatsapp: (input.whatsapp || "").trim(),
        pic_name: input.pic_name.trim(),
        linkedin_url: input.linkedin_url.trim(),
        social_media: input.social_media.trim(),
        sectors: uniqueSectors,
        product_tags: uniqueTags,
        pipeline_status: input.pipeline_status,
        notes: input.notes.trim(),
        updated_at: nowIso,
      };
      return updatedRecord;
    });

    if (!updatedRecord) {
      throw new Error("Data buyer tidak ditemukan.");
    }

    saveLocalBuyers(next);
    return { record: updatedRecord, action: "updated" };
  }
}

/**
 * Menggabungkan (Merge / Upsert) banyak record hasil import Excel ke database.
 * Jika perusahaan sudah ada di database (berdasarkan normalized_name atau company_domain),
 * maka sectors dan product_tags digabungkan tanpa membuat baris ganda!
 */
export async function mergeImportedBuyersToDb(
  importedItems: UpsertBuyerInput[]
): Promise<{
  insertedCount: number;
  mergedWithExistingCount: number;
  allBuyers: BuyerRecord[];
}> {
  const existingBuyers = await fetchAllBuyers();
  const byNormName = new Map<string, BuyerRecord>();
  const byDomain = new Map<string, BuyerRecord>();

  for (const b of existingBuyers) {
    if (b.normalized_name) byNormName.set(b.normalized_name, b);
    if (b.company_domain) byDomain.set(b.company_domain, b);
  }

  let insertedCount = 0;
  let mergedWithExistingCount = 0;
  const nowIso = new Date().toISOString();

  for (const item of importedItems) {
    const normName = normalizeCompanyName(item.company_name);
    if (!normName) continue;

    const domain = extractRootDomain(item.website, item.email) || null;
    const match =
      byNormName.get(normName) || (domain ? byDomain.get(domain) : undefined);

    if (match) {
      // Merge product_tags, sectors, dan lengkapi kolom kosong
      const mergedTags = Array.from(
        new Set([...(match.product_tags || []), ...item.product_tags])
      );
      const mergedSectors = inferSectorsFromProductTags(mergedTags, [
        ...(match.sectors || []),
        ...item.sectors,
      ]);

      const updatedPayload: UpsertBuyerInput = {
        id: match.id,
        company_name: match.company_name || item.company_name,
        country: match.country || item.country,
        city: match.city || item.city,
        website: match.website || item.website,
        email: match.email || item.email,
        whatsapp: match.whatsapp || item.whatsapp || "",
        pic_name: match.pic_name || item.pic_name,
        linkedin_url: match.linkedin_url || item.linkedin_url,
        social_media: match.social_media || item.social_media,
        sectors: mergedSectors,
        product_tags: mergedTags,
        pipeline_status: match.pipeline_status || item.pipeline_status,
        notes: match.notes
          ? match.notes.includes(item.notes)
            ? match.notes
            : `${match.notes} | ${item.notes}`
          : item.notes,
        created_by: match.created_by || item.created_by,
      };

      const { record } = await saveBuyerRecord(updatedPayload);
      byNormName.set(record.normalized_name, record);
      if (record.company_domain) byDomain.set(record.company_domain, record);
      mergedWithExistingCount++;
    } else {
      const { record } = await saveBuyerRecord({
        ...item,
        id: undefined,
      });
      byNormName.set(record.normalized_name, record);
      if (record.company_domain) byDomain.set(record.company_domain, record);
      insertedCount++;
    }
  }

  const allBuyers = await fetchAllBuyers();
  return {
    insertedCount,
    mergedWithExistingCount,
    allBuyers,
  };
}

export async function updateBuyerStatusOrNotes(
  id: string,
  updates: { pipeline_status?: PipelineStatus; notes?: string }
): Promise<BuyerRecord> {
  const nowIso = new Date().toISOString();
  if (supabase) {
    const { data, error } = await supabase
      .from("buyers")
      .update({ ...updates, updated_at: nowIso })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as BuyerRecord;
  }

  const current = getLocalBuyers();
  let updated: BuyerRecord | null = null;
  const next = current.map((b) => {
    if (b.id !== id) return b;
    updated = { ...b, ...updates, updated_at: nowIso };
    return updated;
  });
  if (!updated) throw new Error("Buyer tidak ditemukan");
  saveLocalBuyers(next);
  return updated;
}

export async function deleteBuyerRecord(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("buyers").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }

  const current = getLocalBuyers();
  saveLocalBuyers(current.filter((b) => b.id !== id));
}

export async function deleteAllBuyers(): Promise<void> {
  if (supabase) {
    const { error } = await supabase
      .from("buyers")
      .delete()
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return;
  }

  saveLocalBuyers([]);
}

// ============================================================================
// SISTEM PERSETUJUAN AKUN TIM (ADMIN APPROVAL / ACC SYSTEM)
// ============================================================================

export type TeamMemberRole = "admin" | "member";
export type TeamMemberStatus = "pending" | "approved" | "rejected";

export interface TeamMemberRecord {
  id: string;
  user_id?: string | null;
  email: string;
  full_name: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  created_at: string;
  updated_at: string;
  tableMissing?: boolean;
}

const LOCAL_TEAM_STORAGE_KEY = "b2b_export_crm_team_members_v1";

function getLocalTeamMembers(): TeamMemberRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_TEAM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalTeamMembers(members: TeamMemberRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_TEAM_STORAGE_KEY, JSON.stringify(members));
  } catch {
    // ignore
  }
}

function isTableMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42P17" ||
    error.code === "PGRST205" ||
    msg.includes("infinite recursion") ||
    (msg.includes("team_members") &&
      (msg.includes("does not exist") || msg.includes("schema cache")))
  );
}

/**
 * Mengecek atau mendaftarkan user yang baru login/signup ke tabel team_members.
 * - Akun pertama yang terdaftar otomatis menjadi Admin & Approved.
 * - Akun berikutnya otomatis berstatus 'pending' (harus di-ACC oleh Admin).
 */
export async function ensureAndGetTeamMember(params: {
  userId?: string;
  email: string;
  fullName?: string;
  onlyCheckExisting?: boolean;
}): Promise<TeamMemberRecord> {
  const cleanEmail = params.email.trim().toLowerCase();
  const displayName = (params.fullName || cleanEmail.split("@")[0] || "Team").trim();
  const nowIso = new Date().toISOString();

  if (supabase) {
    const { data: existing, error: selectErr } = await supabase
      .from("team_members")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (selectErr) {
      if (isTableMissingError(selectErr)) {
        return {
          id: "legacy-owner",
          user_id: params.userId || null,
          email: cleanEmail,
          full_name: displayName,
          role: "admin",
          status: "approved",
          created_at: nowIso,
          updated_at: nowIso,
          tableMissing: true,
        };
      }
      throw new Error(selectErr.message);
    }

    if (existing) {
      return existing as TeamMemberRecord;
    }

    // Cek apakah sudah ada admin yang approved di tabel team_members
    const { count, error: countErr } = await supabase
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "approved");

    if (countErr && isTableMissingError(countErr)) {
      return {
        id: "legacy-owner",
        user_id: params.userId || null,
        email: cleanEmail,
        full_name: displayName,
        role: "admin",
        status: "approved",
        created_at: nowIso,
        updated_at: nowIso,
        tableMissing: true,
      };
    }

    const isFirstAdmin = (count ?? 0) === 0;

    // Jika sedang mengecek sesi lama (bukan klik Sign Up baru) dan baris sudah tidak ada,
    // berarti akun ini telah dihapus oleh Admin! Jangan re-insert kembali.
    if (params.onlyCheckExisting && !isFirstAdmin) {
      throw new Error("ACCOUNT_DELETED_BY_ADMIN");
    }

    const role: TeamMemberRole = isFirstAdmin ? "admin" : "member";
    const status: TeamMemberStatus = isFirstAdmin ? "approved" : "pending";

    const { data: inserted, error: insertErr } = await supabase
      .from("team_members")
      .insert([
        {
          user_id: params.userId || null,
          email: cleanEmail,
          full_name: displayName,
          role,
          status,
        },
      ])
      .select("*")
      .single();

    if (insertErr) {
      throw new Error(insertErr.message);
    }

    return inserted as TeamMemberRecord;
  }

  // Fallback Local Mode
  const members = getLocalTeamMembers();
  const found = members.find((m) => m.email.toLowerCase() === cleanEmail);
  if (found) return found;

  const hasAdmin = members.some((m) => m.role === "admin" && m.status === "approved");
  const newMember: TeamMemberRecord = {
    id: crypto.randomUUID(),
    user_id: params.userId || null,
    email: cleanEmail,
    full_name: displayName,
    role: hasAdmin ? "member" : "admin",
    status: hasAdmin ? "pending" : "approved",
    created_at: nowIso,
    updated_at: nowIso,
  };
  saveLocalTeamMembers([...members, newMember]);
  return newMember;
}

export async function fetchAllTeamMembers(): Promise<{
  members: TeamMemberRecord[];
  tableMissing: boolean;
}> {
  if (supabase) {
    const { data, error } = await supabase
      .from("team_members")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      if (isTableMissingError(error)) {
        return { members: [], tableMissing: true };
      }
      throw new Error(error.message);
    }

    return { members: (data || []) as TeamMemberRecord[], tableMissing: false };
  }

  return { members: getLocalTeamMembers(), tableMissing: false };
}

export async function updateTeamMemberStatus(
  id: string,
  updates: { status?: TeamMemberStatus; role?: TeamMemberRole }
): Promise<TeamMemberRecord> {
  const nowIso = new Date().toISOString();
  if (supabase) {
    const { data, error } = await supabase
      .from("team_members")
      .update({ ...updates, updated_at: nowIso })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as TeamMemberRecord;
  }

  const members = getLocalTeamMembers();
  let updated: TeamMemberRecord | null = null;
  const next = members.map((m) => {
    if (m.id !== id) return m;
    updated = { ...m, ...updates, updated_at: nowIso };
    return updated;
  });
  if (!updated) throw new Error("Anggota tim tidak ditemukan.");
  saveLocalTeamMembers(next);
  return updated;
}

export async function preApproveTeamMemberEmail(params: {
  email: string;
  fullName?: string;
  role?: TeamMemberRole;
}): Promise<TeamMemberRecord> {
  const cleanEmail = params.email.trim().toLowerCase();
  const displayName = (params.fullName || cleanEmail.split("@")[0] || "Team").trim();
  const role: TeamMemberRole = params.role || "member";
  const nowIso = new Date().toISOString();

  if (supabase) {
    const { data, error } = await supabase
      .from("team_members")
      .upsert(
        [
          {
            email: cleanEmail,
            full_name: displayName,
            role,
            status: "approved",
            updated_at: nowIso,
          },
        ],
        { onConflict: "email" }
      )
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as TeamMemberRecord;
  }

  const members = getLocalTeamMembers();
  const existing = members.find((m) => m.email.toLowerCase() === cleanEmail);
  if (existing) {
    return updateTeamMemberStatus(existing.id, { status: "approved", role });
  }
  const newMember: TeamMemberRecord = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    full_name: displayName,
    role,
    status: "approved",
    created_at: nowIso,
    updated_at: nowIso,
  };
  saveLocalTeamMembers([...members, newMember]);
  return newMember;
}

export async function deleteTeamMember(
  id: string,
  email?: string
): Promise<void> {
  if (supabase) {
    // 1. Coba hapus permanen dari team_members sekaligus auth.users lewat RPC
    if (email) {
      const { error: rpcErr } = await supabase.rpc(
        "admin_delete_user_account",
        {
          p_member_id: id,
          p_email: email.trim().toLowerCase(),
        }
      );
      if (!rpcErr) {
        return;
      }
    }

    // 2. Fallback hapus dari tabel public.team_members & verifikasi baris terhapus
    const { data: deletedRows, error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw new Error(error.message);
    if (!deletedRows || deletedRows.length === 0) {
      throw new Error(
        "Gagal menghapus akun. Pastikan akun Anda berstatus ADMIN dan policy DELETE sudah aktif di Supabase SQL Editor."
      );
    }
    return;
  }

  const members = getLocalTeamMembers();
  saveLocalTeamMembers(members.filter((m) => m.id !== id));
}
