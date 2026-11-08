"use client";

import React, { useEffect, useRef, useState } from "react";
import { BuyerRecord } from "@/lib/constants";
import {
  ExcelParseReport,
  parseAndDeduplicateExcelBuffer,
} from "@/lib/excel";
import { mergeImportedBuyersToDb } from "@/lib/supabase";
import { Upload, X } from "lucide-react";

interface ExcelImportModalProps {
  isOpen: boolean;
  currentUserEmail: string;
  onClose: () => void;
  onImportComplete: (
    allBuyers: BuyerRecord[],
    summaryText: string
  ) => void;
}

export default function ExcelImportModal({
  isOpen,
  currentUserEmail,
  onClose,
  onImportComplete,
}: ExcelImportModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [report, setReport] = useState<ExcelParseReport | null>(null);
  const [loadingParse, setLoadingParse] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      setErrorMsg(null);
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setLoadingParse(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseAndDeduplicateExcelBuffer(
        buffer,
        file.name,
        currentUserEmail
      );
      setReport(parsed);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal membaca file Excel (.xlsx)."
      );
    } finally {
      setLoadingParse(false);
    }
  };

  const handleConfirmMergeImport = async () => {
    if (!report || report.items.length === 0) return;

    setImporting(true);
    setErrorMsg(null);
    try {
      const { insertedCount, mergedWithExistingCount, allBuyers } =
        await mergeImportedBuyersToDb(report.items);

      const summary = `Imported ${report.uniqueCompaniesCount} unique companies (${insertedCount} new, ${mergedWithExistingCount} merged).`;
      onImportComplete(allBuyers, summary);
      setReport(null);
      dialogRef.current?.close();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyimpan hasil import."
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="excel-import-modal-title"
      className="lustro-dialog w-full max-w-2xl p-0 m-auto max-h-[85vh] overflow-y-auto"
    >
      <div className="sticky top-0 z-20 flex items-center justify-between px-7 py-5 bg-[#12172a]/95 backdrop-blur border-b border-white/8">
        <div>
          <div className="font-mono-label text-indigo-300 mb-1">
            MULTI-SHEET DEDUPLICATION
          </div>
          <h2
            id="excel-import-modal-title"
            className="font-display text-lg font-medium text-white"
          >
            Import Excel (.xlsx)
          </h2>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Tutup modal import"
          className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-7 space-y-6">
        {errorMsg && (
          <div
            role="alert"
            className="px-4 py-3 rounded-xl bg-rose-500/12 border border-rose-400/25 text-rose-200 text-xs"
          >
            {errorMsg}
          </div>
        )}

        <div className="p-8 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] flex flex-col items-center justify-center text-center">
          <Upload className="w-6 h-6 text-indigo-300 mb-3" />
          <div className="font-display text-sm font-medium text-white">
            Select .xlsx file to import &amp; deduplicate
          </div>
          <p className="text-xs text-white/45 mt-1 mb-5 max-w-md">
            Semua sheet akan dibaca otomatis. Perusahaan yang sama di beberapa
            sheet akan digabungkan menjadi 1 baris unik.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingParse}
            className="btn-lustro-primary"
          >
            {loadingParse ? "Reading sheets..." : "Choose .xlsx File"}
          </button>
        </div>

        {report && (
          <div className="space-y-5 pt-2 border-t border-white/8">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="font-mono-label text-white/45">RAW ROWS</div>
                <div className="font-display text-2xl font-medium text-white mt-1">
                  {report.totalRawRows}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="font-mono-label text-pink-300">MERGED</div>
                <div className="font-display text-2xl font-medium text-pink-200 mt-1">
                  -{report.duplicateRowsMergedCount}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="font-mono-label text-indigo-300">UNIQUE</div>
                <div className="font-display text-2xl font-medium text-white mt-1">
                  {report.uniqueCompaniesCount}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReport(null)}
                className="btn-lustro-secondary"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleConfirmMergeImport}
                disabled={importing}
                className="btn-lustro-primary"
              >
                {importing
                  ? "Merging..."
                  : `Import ${report.uniqueCompaniesCount} Companies`}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
