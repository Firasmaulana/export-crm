"use client";

import React from "react";
import { BuyerRecord } from "@/lib/constants";

interface AnalyticsCardsProps {
  buyers: BuyerRecord[];
  selectedSector: string;
  onSelectSector: (sector: string) => void;
  selectedCountry: string;
  onSelectCountry: (country: string) => void;
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
}

export default function AnalyticsCards({
  buyers,
  selectedSector,
  onSelectSector,
  selectedCountry,
  onSelectCountry,
}: AnalyticsCardsProps) {
  const totalUnique = buyers.length;

  const bumiSariCount = buyers.filter((b) =>
    b.sectors?.includes("Bumi Sari Lokal")
  ).length;
  const karayaLivingCount = buyers.filter((b) =>
    b.sectors?.includes("Karaya Living")
  ).length;

  // Hitung distribusi negara teratas
  const countryMap = new Map<string, number>();
  for (const b of buyers) {
    const c = (b.country || "").trim();
    if (!c) continue;
    countryMap.set(c, (countryMap.get(c) || 0) + 1);
  }
  const topCountries = Array.from(countryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <section
      aria-label="Ringkasan Analytics"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {/* 01: Total Unique Buyers */}
      <div className="glass-card p-6 flex flex-col justify-between min-h-[132px]">
        <div className="font-mono-label text-white/45">
          01 <span className="text-indigo-300">/</span> UNIQUE BUYERS
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="font-display text-4xl font-medium text-grad">
            {totalUnique}
          </span>
          <span className="text-xs text-white/45">Single Source</span>
        </div>
      </div>

      {/* 02: Bumi Sari Lokal */}
      <button
        type="button"
        onClick={() =>
          onSelectSector(
            selectedSector === "Bumi Sari Lokal" ? "ALL" : "Bumi Sari Lokal"
          )
        }
        className={`glass-card p-6 text-left flex flex-col justify-between min-h-[132px] transition cursor-pointer ${
          selectedSector === "Bumi Sari Lokal"
            ? "border-indigo-400/60 bg-indigo-500/10"
            : "hover:border-white/25"
        }`}
      >
        <div className="flex items-center justify-between w-full">
          <span className="font-mono-label text-indigo-300">
            02 / BUMI SARI LOKAL
          </span>
          {selectedSector === "Bumi Sari Lokal" && (
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
          )}
        </div>
        <div className="mt-4 flex items-baseline justify-between w-full">
          <span className="font-display text-4xl font-medium text-white">
            {bumiSariCount}
          </span>
          <span className="text-xs text-white/45">F&amp;B Natural</span>
        </div>
      </button>

      {/* 03: Karaya Living */}
      <button
        type="button"
        onClick={() =>
          onSelectSector(
            selectedSector === "Karaya Living" ? "ALL" : "Karaya Living"
          )
        }
        className={`glass-card p-6 text-left flex flex-col justify-between min-h-[132px] transition cursor-pointer ${
          selectedSector === "Karaya Living"
            ? "border-pink-400/60 bg-pink-500/10"
            : "hover:border-white/25"
        }`}
      >
        <div className="flex items-center justify-between w-full">
          <span className="font-mono-label text-pink-300">
            03 / KARAYA LIVING
          </span>
          {selectedSector === "Karaya Living" && (
            <span className="w-2 h-2 rounded-full bg-pink-400" />
          )}
        </div>
        <div className="mt-4 flex items-baseline justify-between w-full">
          <span className="font-display text-4xl font-medium text-white">
            {karayaLivingCount}
          </span>
          <span className="text-xs text-white/45">Wooden Craft</span>
        </div>
      </button>

      {/* 04: Top Markets */}
      <div className="glass-card p-6 flex flex-col justify-between min-h-[132px]">
        <div className="font-mono-label text-white/45">
          04 <span className="text-indigo-300">/</span> TOP MARKETS
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topCountries.map(([country, count]) => {
            const active = selectedCountry === country;
            return (
              <button
                key={country}
                type="button"
                onClick={() =>
                  onSelectCountry(active ? "ALL" : country)
                }
                className={`px-2.5 py-1 rounded-full text-xs transition cursor-pointer border ${
                  active
                    ? "bg-white text-[#0a0e1a] border-white font-semibold"
                    : "bg-white/5 text-white/75 border-white/10 hover:border-white/25"
                }`}
              >
                {country} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
