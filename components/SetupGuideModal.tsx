"use client";

import React, { useEffect, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { Check, Copy, X } from "lucide-react";

interface SetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SetupGuideModal({
  isOpen,
  onClose,
}: SetupGuideModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [copiedEnv, setCopiedEnv] = useState(false);

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

  const envSample = `NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key`;

  const handleCopyEnv = () => {
    navigator.clipboard.writeText(envSample);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="setup-guide-modal-title"
      className="lustro-dialog w-full max-w-xl p-0 m-auto"
    >
      <div className="flex items-center justify-between px-7 py-5 border-b border-white/8">
        <div>
          <div className="font-mono-label text-indigo-300 mb-1">
            CONFIGURATION
          </div>
          <h2
            id="setup-guide-modal-title"
            className="font-display text-lg font-medium text-white"
          >
            Supabase Cloud Setup
          </h2>
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Tutup panduan"
          className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-7 space-y-5 text-xs text-white/70 leading-relaxed">
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8 flex items-center justify-between">
          <span>Database Connection Status</span>
          <span className="font-mono-label text-indigo-300">
            {isSupabaseConfigured ? "SUPABASE CLOUD" : "LOCAL STORAGE"}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-display font-medium text-white text-sm">
              1. Buat file <code>.env.local</code>
            </span>
            <button
              type="button"
              onClick={handleCopyEnv}
              className="text-indigo-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
            >
              {copiedEnv ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="p-3.5 rounded-xl bg-[#070a12] border border-white/8 text-indigo-200 font-mono text-xs overflow-x-auto">
            {envSample}
          </pre>
        </div>

        <div className="space-y-1.5">
          <div className="font-display font-medium text-white text-sm">
            2. Jalankan <code>schema.sql</code>
          </div>
          <p className="text-white/55">
            Salin isi file <code>schema.sql</code> ke menu{" "}
            <strong>SQL Editor</strong> di dashboard Supabase Anda, lalu klik{" "}
            <strong>Run</strong>.
          </p>
        </div>
      </div>
    </dialog>
  );
}
