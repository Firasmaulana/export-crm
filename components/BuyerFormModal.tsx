"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BUMI_SARI_PRODUCTS,
  BuyerRecord,
  KARAYA_LIVING_PRODUCTS,
  PIPELINE_STATUSES,
  PipelineStatus,
  SECTORS,
  SectorName,
} from "@/lib/constants";
import {
  DuplicateMatchResult,
  inferSectorsFromProductTags,
} from "@/lib/deduplication";
import {
  checkBuyerDuplicatesLive,
  saveBuyerRecord,
  UpsertBuyerInput,
} from "@/lib/supabase";
import { AlertTriangle, Check, X } from "lucide-react";

interface BuyerFormModalProps {
  isOpen: boolean;
  initialBuyer: BuyerRecord | null;
  allBuyers: BuyerRecord[];
  currentUserEmail: string;
  onClose: () => void;
  onSaved: (saved: BuyerRecord, action: "created" | "updated") => void;
}

export default function BuyerFormModal({
  isOpen,
  initialBuyer,
  allBuyers,
  currentUserEmail,
  onClose,
  onSaved,
}: BuyerFormModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [editingBuyer, setEditingBuyer] = useState<BuyerRecord | null>(
    initialBuyer
  );

  const [companyName, setCompanyName] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [picName, setPicName] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [socialMedia, setSocialMedia] = useState("");
  const [sectors, setSectors] = useState<SectorName[]>(["Bumi Sari Lokal"]);
  const [productTags, setProductTags] = useState<string[]>([]);
  const [pipelineStatus, setPipelineStatus] =
    useState<PipelineStatus>("New Lead");
  const [notes, setNotes] = useState("");

  const [duplicateMatches, setDuplicateMatches] = useState<
    DuplicateMatchResult[]
  >([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setEditingBuyer(initialBuyer);
    setErrorMsg(null);

    if (initialBuyer) {
      setCompanyName(initialBuyer.company_name || "");
      setCountry(initialBuyer.country || "");
      setCity(initialBuyer.city || "");
      setWebsite(initialBuyer.website || "");
      setEmail(initialBuyer.email || "");
      setWhatsapp(initialBuyer.whatsapp || "");
      setPicName(initialBuyer.pic_name || "");
      setLinkedinUrl(initialBuyer.linkedin_url || "");
      setSocialMedia(initialBuyer.social_media || "");
      setSectors(
        initialBuyer.sectors?.length
          ? initialBuyer.sectors
          : ["Bumi Sari Lokal"]
      );
      setProductTags(initialBuyer.product_tags || []);
      setPipelineStatus(initialBuyer.pipeline_status || "New Lead");
      setNotes(initialBuyer.notes || "");
      setDuplicateMatches([]);
    } else {
      setCompanyName("");
      setCountry("");
      setCity("");
      setWebsite("");
      setEmail("");
      setWhatsapp("");
      setPicName("");
      setLinkedinUrl("");
      setSocialMedia("");
      setSectors(["Bumi Sari Lokal"]);
      setProductTags([]);
      setPipelineStatus("New Lead");
      setNotes("");
      setDuplicateMatches([]);
    }
  }, [initialBuyer, isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      dialog.returnValue = "";
      onClose();
    };

    dialog.addEventListener("close", handleNativeClose);

    let removeFallbackClick: (() => void) | null = null;
    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener("click", handleBackdropClick);
      removeFallbackClick = () =>
        dialog.removeEventListener("click", handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleNativeClose);
      if (removeFallbackClick) removeFallbackClick();
    };
  }, [onClose]);

  // Debounce 300ms Live Duplicate Check
  useEffect(() => {
    if (!isOpen) return;

    const trimmedName = companyName.trim();
    const trimmedWeb = website.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName && !trimmedWeb && !trimmedEmail) {
      setDuplicateMatches([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const matches = await checkBuyerDuplicatesLive(
          {
            company_name: trimmedName,
            website: trimmedWeb,
            email: trimmedEmail,
            excludeId: editingBuyer?.id,
          },
          allBuyers
        );
        setDuplicateMatches(matches);
      } catch {
        // ignore
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [companyName, website, email, editingBuyer?.id, allBuyers, isOpen]);

  const handleSwitchToExistingBuyer = (existing: BuyerRecord) => {
    setEditingBuyer(existing);
    setCompanyName(existing.company_name);
    setCountry((prev) => existing.country || prev);
    setCity((prev) => existing.city || prev);
    setWebsite((prev) => existing.website || prev);
    setEmail((prev) => existing.email || prev);
    setPicName((prev) => existing.pic_name || prev);
    setLinkedinUrl((prev) => existing.linkedin_url || prev);
    setSocialMedia((prev) => existing.social_media || prev);

    const mergedTags = Array.from(
      new Set([...(existing.product_tags || []), ...productTags])
    );
    const mergedSectors = inferSectorsFromProductTags(mergedTags, [
      ...(existing.sectors || []),
      ...sectors,
    ]);
    setProductTags(mergedTags);
    setSectors(mergedSectors.length ? mergedSectors : ["Bumi Sari Lokal"]);
    setPipelineStatus(existing.pipeline_status || "New Lead");
    setNotes(existing.notes || "");
    setDuplicateMatches([]);
    setErrorMsg(null);
  };

  const toggleProductTag = (tag: string, sectorOfTag: SectorName) => {
    setProductTags((prev) => {
      const exists = prev.includes(tag);
      const nextTags = exists ? prev.filter((t) => t !== tag) : [...prev, tag];
      if (!exists && !sectors.includes(sectorOfTag)) {
        setSectors((sPrev) => [...sPrev, sectorOfTag]);
      }
      return nextTags;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!companyName.trim()) {
      setErrorMsg("Nama perusahaan wajib diisi.");
      return;
    }

    if (sectors.length === 0 && productTags.length === 0) {
      setErrorMsg("Pilih minimal 1 produk yang relevan.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: UpsertBuyerInput = {
        id: editingBuyer?.id,
        company_name: companyName,
        country,
        city,
        website,
        email,
        whatsapp,
        pic_name: picName,
        linkedin_url: linkedinUrl,
        social_media: socialMedia,
        sectors: inferSectorsFromProductTags(productTags, sectors),
        product_tags: productTags,
        pipeline_status: pipelineStatus,
        notes,
        created_by: editingBuyer?.created_by || currentUserEmail,
      };

      const { record, action } = await saveBuyerRecord(payload);
      onSaved(record, action);
      dialogRef.current?.close();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyimpan data buyer."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="buyer-modal-title"
      className="lustro-dialog w-full max-w-3xl p-0 m-auto max-h-[88vh] overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-7 py-5 bg-[#12172a]/95 backdrop-blur border-b border-white/8">
        <div>
          <div className="font-mono-label text-indigo-300 mb-1">
            {editingBuyer ? "EDIT RECORD" : "NEW RECORD"}
          </div>
          <h2
            id="buyer-modal-title"
            className="font-display text-lg font-medium text-white"
          >
            {editingBuyer ? editingBuyer.company_name : "Tambah Buyer Baru"}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Tutup modal"
          className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form Body */}
      <form onSubmit={handleSubmit} method="POST" className="p-7 space-y-6">
        {errorMsg && (
          <div
            role="alert"
            className="px-4 py-3 rounded-xl bg-rose-500/12 border border-rose-400/25 text-rose-200 text-xs"
          >
            {errorMsg}
          </div>
        )}

        {/* Primary Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="buyer-company-name"
              className="block font-mono-label text-white/55 mb-2"
            >
              Nama Perusahaan *
            </label>
            <input
              id="buyer-company-name"
              name="company_name"
              type="text"
              required
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ecotrend Ecologics Ltd"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-website"
              className="block font-mono-label text-white/55 mb-2"
            >
              Website
            </label>
            <input
              id="buyer-website"
              name="website"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://company.com"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-email"
              className="block font-mono-label text-white/55 mb-2"
            >
              Email
            </label>
            <input
              id="buyer-email"
              name="email"
              type="email"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@company.com"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-whatsapp"
              className="block font-mono-label text-emerald-400 mb-2"
            >
              WhatsApp
            </label>
            <input
              id="buyer-whatsapp"
              name="whatsapp"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+62812... / +1..."
              className="input-lustro w-full"
            />
          </div>
        </div>

        {/* Warning Card Anti-Duplikasi (Real-Time 300ms Debounce) */}
        {duplicateMatches.length > 0 && (
          <div
            role="alert"
            aria-live="polite"
            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/35 space-y-3"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-100 leading-relaxed">
                <strong>
                  Perusahaan ini sudah terdaftar di database! Klik di sini untuk
                  melihat/mengedit produk yang ditawarkan.
                </strong>
              </div>
            </div>

            <div className="space-y-2">
              {duplicateMatches.map((match) => (
                <div
                  key={match.buyer.id}
                  className="px-3.5 py-2.5 rounded-xl bg-[#0a0e1a]/75 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-medium text-white">
                      {match.buyer.company_name}{" "}
                      <span className="text-white/45">
                        ({match.buyer.country || "—"})
                      </span>
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">
                      {match.reason} • Produk:{" "}
                      {(match.buyer.product_tags || []).join(", ") || "—"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSwitchToExistingBuyer(match.buyer)}
                    className="btn-lustro-primary py-1.5 px-3.5 text-xs shrink-0"
                  >
                    Lihat / Edit Produk
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Secondary Details */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="buyer-country"
              className="block font-mono-label text-white/55 mb-2"
            >
              Negara
            </label>
            <input
              id="buyer-country"
              name="country"
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Canada, Netherlands..."
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-city"
              className="block font-mono-label text-white/55 mb-2"
            >
              Kota
            </label>
            <input
              id="buyer-city"
              name="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Vancouver, Utrecht..."
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-pic"
              className="block font-mono-label text-white/55 mb-2"
            >
              PIC
            </label>
            <input
              id="buyer-pic"
              name="pic_name"
              type="text"
              value={picName}
              onChange={(e) => setPicName(e.target.value)}
              placeholder="Nama kontak"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-linkedin"
              className="block font-mono-label text-white/55 mb-2"
            >
              LinkedIn URL
            </label>
            <input
              id="buyer-linkedin"
              name="linkedin_url"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-social"
              className="block font-mono-label text-white/55 mb-2"
            >
              Social Media
            </label>
            <input
              id="buyer-social"
              name="social_media"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={socialMedia}
              onChange={(e) => setSocialMedia(e.target.value)}
              placeholder="@handle"
              className="input-lustro w-full"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-pipeline-status"
              className="block font-mono-label text-white/55 mb-2"
            >
              Pipeline Status
            </label>
            <select
              id="buyer-pipeline-status"
              name="pipeline_status"
              value={pipelineStatus}
              onChange={(e) =>
                setPipelineStatus(e.target.value as PipelineStatus)
              }
              className="input-lustro w-full"
            >
              {PIPELINE_STATUSES.map((st) => (
                <option
                  key={st.value}
                  value={st.value}
                  className="bg-[#0d1220]"
                >
                  {st.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Multi-Sector & Product Tagging */}
        <div className="space-y-4 pt-2 border-t border-white/8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bumi Sari Lokal */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/8">
              <div className="font-mono-label text-indigo-300 mb-3">
                BUMI SARI LOKAL (F&amp;B)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SECTORS[0].products.map((prod) => {
                  const active = productTags.includes(prod);
                  return (
                    <button
                      key={prod}
                      type="button"
                      onClick={() =>
                        toggleProductTag(prod, "Bumi Sari Lokal")
                      }
                      className={`px-2.5 py-1.5 rounded-full text-xs transition inline-flex items-center gap-1.5 cursor-pointer border ${
                        active
                          ? "bg-indigo-500/25 text-white border-indigo-400/60"
                          : "bg-white/4 text-white/60 border-white/8 hover:text-white hover:border-white/20"
                      }`}
                    >
                      {active && <Check className="w-3 h-3 text-indigo-300" />}
                      <span>{prod}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Karaya Living */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/8">
              <div className="font-mono-label text-pink-300 mb-3">
                KARAYA LIVING (WOODENWARE)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SECTORS[1].products.map((prod) => {
                  const active = productTags.includes(prod);
                  return (
                    <button
                      key={prod}
                      type="button"
                      onClick={() => toggleProductTag(prod, "Karaya Living")}
                      className={`px-2.5 py-1.5 rounded-full text-xs transition inline-flex items-center gap-1.5 cursor-pointer border ${
                        active
                          ? "bg-pink-500/25 text-white border-pink-400/60"
                          : "bg-white/4 text-white/60 border-white/8 hover:text-white hover:border-white/20"
                      }`}
                    >
                      {active && <Check className="w-3 h-3 text-pink-300" />}
                      <span>{prod}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label
            htmlFor="buyer-notes"
            className="block font-mono-label text-white/55 mb-2"
          >
            Notes
          </label>
          <textarea
            id="buyer-notes"
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Catatan singkat follow-up..."
            className="input-lustro w-full"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/8">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="btn-lustro-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-lustro-primary"
          >
            {submitting
              ? "Saving..."
              : editingBuyer
              ? "Save Changes"
              : "Create Buyer"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
