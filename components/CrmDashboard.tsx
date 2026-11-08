"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BUMI_SARI_PRODUCTS,
  BuyerRecord,
  KARAYA_LIVING_PRODUCTS,
  PIPELINE_STATUSES,
  PipelineStatus,
  SECTORS,
} from "@/lib/constants";
import {
  deleteBuyerRecord,
  fetchAllBuyers,
  supabase,
  updateBuyerStatusOrNotes,
} from "@/lib/supabase";
import {
  exportBuyersToExcel,
  filterBuyersByMondayRange,
  getMondayWeekRange,
} from "@/lib/excel";
import { AuthenticatedUser } from "./AuthGate";
import AnalyticsCards from "./AnalyticsCards";
import BuyerFormModal from "./BuyerFormModal";
import ExcelImportModal from "./ExcelImportModal";
import SetupGuideModal from "./SetupGuideModal";
import {
  Calendar,
  Download,
  Edit3,
  ExternalLink,
  Linkedin,
  LogOut,
  Mail,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

interface CrmDashboardProps {
  user: AuthenticatedUser;
  onSignOut: () => void;
}

export default function CrmDashboard({ user, onSignOut }: CrmDashboardProps) {
  const [buyers, setBuyers] = useState<BuyerRecord[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState<string>("ALL");
  const [selectedProductTag, setSelectedProductTag] = useState<string>("ALL");
  const [selectedCountry, setSelectedCountry] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedTimeRange, setSelectedTimeRange] = useState<
    "ALL" | "CURRENT_MONDAY" | "PREVIOUS_MONDAY"
  >("ALL");

  // Modal States
  const [isBuyerModalOpen, setIsBuyerModalOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<BuyerRecord | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const loadBuyers = async () => {
    try {
      const data = await fetchAllBuyers();
      setBuyers(data);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal memuat data buyer."
      );
    }
  };

  useEffect(() => {
    loadBuyers();

    // Sinkronisasi otomatis lintas perangkat (Realtime & saat tab kembali aktif)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadBuyers();
      }
    };
    window.addEventListener("visibilitychange", handleVisibility);

    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null =
      null;
    if (supabase) {
      channel = supabase
        .channel("buyers-realtime-sync")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "buyers" },
          () => {
            loadBuyers();
          }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener("visibilitychange", handleVisibility);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const uniqueCountries = useMemo(() => {
    const set = new Set<string>();
    for (const b of buyers) {
      if (b.country && b.country.trim()) {
        set.add(b.country.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [buyers]);

  // Hitung data mingguan (per hari Senin)
  const currentMondayInfo = useMemo(
    () => getMondayWeekRange("current_week"),
    []
  );
  const previousMondayInfo = useMemo(
    () => getMondayWeekRange("previous_week"),
    []
  );

  const currentWeekBuyers = useMemo(
    () => filterBuyersByMondayRange(buyers, "current_week", "created_at"),
    [buyers]
  );

  const previousWeekBuyers = useMemo(
    () => filterBuyersByMondayRange(buyers, "previous_week", "created_at"),
    [buyers]
  );

  const filteredBuyers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    let basePool = buyers;
    if (selectedTimeRange === "CURRENT_MONDAY") {
      basePool = currentWeekBuyers;
    } else if (selectedTimeRange === "PREVIOUS_MONDAY") {
      basePool = previousWeekBuyers;
    }

    return basePool.filter((b) => {
      if (selectedSector === "Bumi Sari Lokal") {
        if (!b.sectors?.includes("Bumi Sari Lokal")) return false;
      } else if (selectedSector === "Karaya Living") {
        if (!b.sectors?.includes("Karaya Living")) return false;
      } else if (selectedSector === "CROSS_SECTOR") {
        if (
          !(
            b.sectors?.includes("Bumi Sari Lokal") &&
            b.sectors?.includes("Karaya Living")
          )
        ) {
          return false;
        }
      }

      if (selectedProductTag !== "ALL") {
        if (!b.product_tags?.includes(selectedProductTag)) return false;
      }

      if (selectedCountry !== "ALL") {
        if (
          (b.country || "").trim().toLowerCase() !==
          selectedCountry.toLowerCase()
        ) {
          return false;
        }
      }

      if (selectedStatus !== "ALL") {
        if (b.pipeline_status !== selectedStatus) return false;
      }

      if (q) {
        const haystack = [
          b.company_name,
          b.normalized_name,
          b.company_domain || "",
          b.country,
          b.city,
          b.pic_name,
          b.email,
          b.website,
          ...(b.sectors || []),
          ...(b.product_tags || []),
          b.notes,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    buyers,
    currentWeekBuyers,
    previousWeekBuyers,
    selectedTimeRange,
    searchQuery,
    selectedSector,
    selectedProductTag,
    selectedCountry,
    selectedStatus,
  ]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedSector !== "ALL" ||
    selectedProductTag !== "ALL" ||
    selectedCountry !== "ALL" ||
    selectedStatus !== "ALL" ||
    selectedTimeRange !== "ALL";

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedSector("ALL");
    setSelectedProductTag("ALL");
    setSelectedCountry("ALL");
    setSelectedStatus("ALL");
    setSelectedTimeRange("ALL");
  };

  const handleExportWeeklyMonday = () => {
    // Jika user sedang memilih filter "PREVIOUS_MONDAY", export minggu lalu (Senin-Minggu);
    // defaultnya export data baru sejak hari Senin minggu ini.
    const mode =
      selectedTimeRange === "PREVIOUS_MONDAY"
        ? "previous_week"
        : "current_week";
    const rangeInfo = getMondayWeekRange(mode);
    const weeklyData = filterBuyersByMondayRange(buyers, mode, "created_at");

    if (weeklyData.length === 0) {
      showToast(
        `Tidak ada data buyer baru pada periode ${rangeInfo.label}.`
      );
      return;
    }

    exportBuyersToExcel(
      weeklyData,
      `Buyers_Weekly_${rangeInfo.fileTag}`,
      `Weekly (${rangeInfo.fileTag})`
    );
    showToast(
      `Berhasil mengunduh ${weeklyData.length} data buyer baru (${rangeInfo.label}).`
    );
  };

  const handleOpenAddBuyer = () => {
    setEditingBuyer(null);
    setIsBuyerModalOpen(true);
  };

  const handleOpenEditBuyer = (buyer: BuyerRecord) => {
    setEditingBuyer(buyer);
    setIsBuyerModalOpen(true);
  };

  const handleBuyerSaved = (
    saved: BuyerRecord,
    action: "created" | "updated"
  ) => {
    setBuyers((prev) => {
      if (action === "created") {
        return [saved, ...prev];
      }
      return prev.map((b) => (b.id === saved.id ? saved : b));
    });
    showToast(
      action === "created"
        ? `Buyer "${saved.company_name}" ditambahkan.`
        : `Data "${saved.company_name}" diperbarui.`
    );
  };

  const handleQuickStatusChange = async (
    buyer: BuyerRecord,
    newStatus: PipelineStatus
  ) => {
    try {
      const updated = await updateBuyerStatusOrNotes(buyer.id, {
        pipeline_status: newStatus,
      });
      setBuyers((prev) =>
        prev.map((b) => (b.id === buyer.id ? updated : b))
      );
      showToast(`Status "${buyer.company_name}" diubah ke ${newStatus}.`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal memperbarui status."
      );
    }
  };

  const handleDeleteBuyer = async (buyer: BuyerRecord) => {
    const confirmed = window.confirm(
      `Hapus perusahaan "${buyer.company_name}" dari database?`
    );
    if (!confirmed) return;

    try {
      await deleteBuyerRecord(buyer.id);
      setBuyers((prev) => prev.filter((b) => b.id !== buyer.id));
      showToast(`"${buyer.company_name}" dihapus.`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal menghapus data buyer."
      );
    }
  };

  return (
    <div className="lustro-bg min-h-screen flex flex-col">
      {/* Minimal Lustro Top Chrome */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0a0e1a]/80 backdrop-blur-xl">
        <div className="max-w-[1380px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="lustro-logo" />
            <div className="flex items-center gap-2.5">
              <span className="font-display font-semibold text-base tracking-tight text-white">
                Export CRM
              </span>
              <span className="text-indigo-300 font-light">/</span>
              <span className="text-xs text-white/55 hidden sm:inline">
                Bumi Sari Lokal &amp; Karaya Living
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="btn-lustro-secondary"
            >
              <Upload className="w-3.5 h-3.5 text-indigo-300" />
              <span className="hidden md:inline">Import .xlsx</span>
            </button>

            {/* Tombol Export Mingguan (Per Hari Senin) */}
            <button
              type="button"
              onClick={handleExportWeeklyMonday}
              title={`Export data buyer baru (${
                selectedTimeRange === "PREVIOUS_MONDAY"
                  ? previousMondayInfo.label
                  : currentMondayInfo.label
              })`}
              className="btn-lustro-secondary"
            >
              <Calendar className="w-3.5 h-3.5 text-pink-300" />
              <span className="hidden sm:inline">
                Export Mingguan ({
                  selectedTimeRange === "PREVIOUS_MONDAY"
                    ? previousWeekBuyers.length
                    : currentWeekBuyers.length
                })
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportBuyersToExcel(
                  filteredBuyers,
                  hasActiveFilters ? "Buyers_Filtered" : "Buyers_All"
                )
              }
              title="Export seluruh data yang tampil di tabel saat ini"
              className="btn-lustro-secondary"
            >
              <Download className="w-3.5 h-3.5 text-white/70" />
              <span className="hidden lg:inline">
                Export ({filteredBuyers.length})
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenAddBuyer}
              className="btn-lustro-primary"
            >
              <Plus className="w-4 h-4" />
              <span>New Buyer</span>
            </button>

            <div className="h-5 w-[1px] bg-white/10 mx-1 hidden sm:block" />

            <button
              type="button"
              onClick={() => setIsSetupModalOpen(true)}
              title="Database Settings"
              className="w-9 h-9 rounded-full bg-white/6 hover:bg-white/14 border border-white/12 flex items-center justify-center text-white/70 hover:text-white transition cursor-pointer"
            >
              <Settings2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onSignOut}
              title={`Sign out (${user.email})`}
              className="w-9 h-9 rounded-full bg-white/6 hover:bg-white/14 border border-white/12 flex items-center justify-center text-white/70 hover:text-white transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-5 sm:px-8 py-8 space-y-6">
        {/* Subtle Toast */}
        {toastMsg && (
          <div
            role="status"
            aria-live="polite"
            className="glass-card px-4 py-3 border-indigo-400/35 flex items-center justify-between gap-4 text-xs text-white/90"
          >
            <span>{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              aria-label="Tutup notifikasi"
              className="text-white/50 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Minimal 4-Card Analytics Strip */}
        <AnalyticsCards
          buyers={buyers}
          selectedSector={selectedSector}
          onSelectSector={setSelectedSector}
          selectedCountry={selectedCountry}
          onSelectCountry={setSelectedCountry}
          selectedStatus={selectedStatus}
          onSelectStatus={setSelectedStatus}
        />

        {/* Sleek Single-Row Filter Bar */}
        <section
          aria-label="Pencarian dan Filter Buyer"
          className="glass-card p-3.5"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
            <div className="md:col-span-3 relative">
              <Search className="w-4 h-4 text-white/35 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Cari perusahaan, domain, PIC, negara, atau produk"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search company, domain, PIC..."
                className="input-lustro w-full pl-10 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Bersihkan pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Periode Mingguan (Per Hari Senin) */}
            <div className="md:col-span-3">
              <select
                aria-label="Filter berdasarkan Periode Mingguan (Per Senin)"
                value={selectedTimeRange}
                onChange={(e) =>
                  setSelectedTimeRange(
                    e.target.value as
                      | "ALL"
                      | "CURRENT_MONDAY"
                      | "PREVIOUS_MONDAY"
                  )
                }
                className="input-lustro w-full"
              >
                <option value="ALL">Semua Waktu ({buyers.length})</option>
                <option value="CURRENT_MONDAY">
                  Baru Minggu Ini — {currentMondayInfo.label} (
                  {currentWeekBuyers.length})
                </option>
                <option value="PREVIOUS_MONDAY">
                  1 Minggu Lalu — {previousMondayInfo.label} (
                  {previousWeekBuyers.length})
                </option>
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Filter berdasarkan Sektor"
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="input-lustro w-full"
              >
                <option value="ALL">All Sectors</option>
                <option value="Bumi Sari Lokal">Bumi Sari Lokal</option>
                <option value="Karaya Living">Karaya Living</option>
                <option value="CROSS_SECTOR">Both Sectors</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Filter berdasarkan Tag Produk"
                value={selectedProductTag}
                onChange={(e) => setSelectedProductTag(e.target.value)}
                className="input-lustro w-full"
              >
                <option value="ALL">All Products</option>
                <optgroup label="Bumi Sari Lokal">
                  {BUMI_SARI_PRODUCTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Karaya Living">
                  {KARAYA_LIVING_PRODUCTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Filter berdasarkan Negara"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="input-lustro w-full"
              >
                <option value="ALL">All Countries</option>
                {uniqueCountries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/6 px-1 text-xs text-white/50">
              <span>
                Showing{" "}
                <strong className="text-white">{filteredBuyers.length}</strong>{" "}
                of {buyers.length} buyers
                {selectedTimeRange === "CURRENT_MONDAY" &&
                  ` • Periode: ${currentMondayInfo.label}`}
                {selectedTimeRange === "PREVIOUS_MONDAY" &&
                  ` • Periode: ${previousMondayInfo.label}`}
              </span>
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-indigo-300 hover:text-white transition cursor-pointer"
              >
                Clear filters
              </button>
            </div>
          )}
        </section>

        {/* Lustro Comparison-Style Data Table */}
        <section className="glass-card overflow-hidden">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="buyers-table-caption"
            className="table-wrapper overflow-auto max-w-full max-h-[70vh]"
          >
            <table className="w-full text-left border-separate border-spacing-0 text-sm">
              <caption id="buyers-table-caption" className="sr-only">
                Daftar Buyer Ekspor B2B Bumi Sari Lokal dan Karaya Living
              </caption>
              <thead className="sticky top-0 z-20 bg-[#0d1220]/95 backdrop-blur-xl">
                <tr>
                  <th
                    scope="col"
                    className="py-4 px-5 font-mono-label text-white/45 border-b border-white/10 sticky left-0 z-20 bg-[#0d1220] min-w-[230px]"
                  >
                    Company
                  </th>
                  <th
                    scope="col"
                    className="py-4 px-4 font-display font-medium text-white/70 border-b border-white/10 min-w-[140px]"
                  >
                    Location
                  </th>
                  <th
                    scope="col"
                    className="py-4 px-4 font-display font-medium text-white/70 border-b border-white/10 min-w-[300px]"
                  >
                    Sectors &amp; Products
                  </th>
                  <th
                    scope="col"
                    className="py-4 px-4 font-display font-medium text-white/70 border-b border-white/10 min-w-[180px]"
                  >
                    Contact / PIC
                  </th>
                  <th
                    scope="col"
                    className="py-4 px-4 font-display font-medium text-white/70 border-b border-white/10 min-w-[180px]"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="py-4 px-5 font-display font-medium text-white/70 border-b border-white/10 text-right min-w-[140px]"
                  >
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/6">
                {filteredBuyers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-16 px-6 text-center text-white/45"
                    >
                      <div className="font-display text-base text-white/75">
                        No matching companies found
                      </div>
                      <p className="text-xs mt-1">
                        Try adjusting your search or filter criteria.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredBuyers.map((buyer) => {
                    const statusMeta =
                      PIPELINE_STATUSES.find(
                        (s) => s.value === buyer.pipeline_status
                      ) || PIPELINE_STATUSES[0];

                    return (
                      <tr
                        key={buyer.id}
                        className="group hover:bg-white/[0.03] transition align-top"
                      >
                        {/* Company & Domain */}
                        <th
                          scope="row"
                          className="py-4 px-5 font-normal text-left sticky left-0 z-10 bg-[#0b101d] group-hover:bg-[#111729] transition border-r border-white/5"
                        >
                          <div className="font-display font-medium text-white text-[15px] leading-snug">
                            {buyer.company_name}
                          </div>
                          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-white/40">
                            {buyer.company_domain && (
                              <span>{buyer.company_domain}</span>
                            )}
                            {buyer.created_at && (
                              <span className="text-[10px] text-white/30">
                                •{" "}
                                {new Date(buyer.created_at).toLocaleDateString(
                                  "id-ID",
                                  { day: "2-digit", month: "short" }
                                )}
                              </span>
                            )}
                          </div>
                        </th>

                        {/* Location */}
                        <td className="py-4 px-4">
                          <div className="text-white/85 font-medium text-xs">
                            {buyer.country || "—"}
                          </div>
                          {buyer.city && (
                            <div className="text-xs text-white/45 mt-0.5">
                              {buyer.city}
                            </div>
                          )}
                        </td>

                        {/* Sectors & Products */}
                        <td className="py-4 px-4">
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {(buyer.sectors || []).map((sec) => {
                              const isBumi = sec === "Bumi Sari Lokal";
                              return (
                                <span
                                  key={sec}
                                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                                    isBumi
                                      ? SECTORS[0].badgeClass
                                      : SECTORS[1].badgeClass
                                  }`}
                                >
                                  {sec}
                                </span>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {(buyer.product_tags || []).map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() =>
                                  setSelectedProductTag(
                                    selectedProductTag === tag ? "ALL" : tag
                                  )
                                }
                                className="px-2 py-0.5 rounded-md text-[11px] bg-white/5 hover:bg-white/12 text-white/70 border border-white/8 transition cursor-pointer"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </td>

                        {/* Contact / PIC */}
                        <td className="py-4 px-4">
                          <div className="text-xs font-medium text-white/85">
                            {buyer.pic_name || (
                              <span className="text-white/30">—</span>
                            )}
                          </div>
                          {buyer.email && (
                            <div className="text-xs text-white/45 truncate max-w-[190px] mt-0.5">
                              {buyer.email}
                            </div>
                          )}
                        </td>

                        {/* Pipeline Status */}
                        <td className="py-4 px-4">
                          <select
                            aria-label={`Ubah status pipeline untuk ${buyer.company_name}`}
                            value={buyer.pipeline_status}
                            onChange={(e) =>
                              handleQuickStatusChange(
                                buyer,
                                e.target.value as PipelineStatus
                              )
                            }
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer focus:outline-none ${statusMeta.colorClass}`}
                          >
                            {PIPELINE_STATUSES.map((st) => (
                              <option
                                key={st.value}
                                value={st.value}
                                className="bg-[#0d1220] text-white"
                              >
                                {st.label}
                              </option>
                            ))}
                          </select>

                          {buyer.notes && (
                            <p
                              title={buyer.notes}
                              className="text-[11px] text-white/40 line-clamp-1 mt-1.5"
                            >
                              {buyer.notes}
                            </p>
                          )}
                        </td>

                        {/* Quick Actions */}
                        <td className="py-4 px-5 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            {buyer.website && (
                              <a
                                href={
                                  buyer.website.startsWith("http")
                                    ? buyer.website
                                    : `https://${buyer.website}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                title={buyer.website}
                                className="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/8 transition"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}

                            {buyer.email && (
                              <a
                                href={`mailto:${buyer.email}`}
                                title={buyer.email}
                                className="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/8 transition"
                              >
                                <Mail className="w-4 h-4" />
                              </a>
                            )}

                            {buyer.linkedin_url && (
                              <a
                                href={
                                  buyer.linkedin_url.startsWith("http")
                                    ? buyer.linkedin_url
                                    : `https://${buyer.linkedin_url}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                title="LinkedIn"
                                className="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/8 transition"
                              >
                                <Linkedin className="w-4 h-4" />
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenEditBuyer(buyer)}
                              title="Edit"
                              className="p-1.5 rounded-lg text-white/45 hover:text-indigo-300 hover:bg-white/8 transition cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteBuyer(buyer)}
                              title="Delete"
                              className="p-1.5 rounded-lg text-white/35 hover:text-rose-400 hover:bg-white/8 transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Modals */}
      <BuyerFormModal
        isOpen={isBuyerModalOpen}
        initialBuyer={editingBuyer}
        allBuyers={buyers}
        currentUserEmail={user.email}
        onClose={() => setIsBuyerModalOpen(false)}
        onSaved={handleBuyerSaved}
      />

      <ExcelImportModal
        isOpen={isImportModalOpen}
        currentUserEmail={user.email}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={(allUpdatedBuyers, summaryText) => {
          setBuyers(allUpdatedBuyers);
          showToast(summaryText);
        }}
      />

      <SetupGuideModal
        isOpen={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
      />
    </div>
  );
}
