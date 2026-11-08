import * as XLSX from "xlsx";
import { BuyerRecord, PipelineStatus, SectorName } from "./constants";
import {
  extractRootDomain,
  inferSectorsFromProductTags,
  mapSheetNameToProductAndSector,
  normalizeCompanyName,
} from "./deduplication";
import { UpsertBuyerInput } from "./supabase";

export interface SheetSummary {
  sheetName: string;
  mappedProductTag: string;
  mappedSector: SectorName;
  rowCount: number;
}

export interface DeduplicatedPreviewItem extends UpsertBuyerInput {
  normalized_name: string;
  company_domain: string | null;
  sourceSheets: string[];
}

export interface ExcelParseReport {
  fileName: string;
  totalRawRows: number;
  uniqueCompaniesCount: number;
  duplicateRowsMergedCount: number;
  sheetsProcessed: SheetSummary[];
  items: DeduplicatedPreviewItem[];
}

/**
 * Mengembalikan objek Date untuk hari Senin pukul 00:00:00.000 pada minggu dari tanggal acuan.
 * Menggunakan sistem kalender ISO (Senin = awal minggu).
 */
export function getMondayOfWeek(referenceDate: Date = new Date()): Date {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
  const diffToMonday = (day + 6) % 7; // Senin = 0, Selasa = 1, ..., Minggu = 6
  d.setDate(d.getDate() - diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Mendapatkan rentang waktu mingguan berbasis hari Senin:
 * - 'current_week': Sejak hari Senin minggu ini (00:00) hingga sekarang
 * - 'previous_week': 1 minggu penuh ke belakang (Senin minggu lalu 00:00 s/d Minggu 23:59:59)
 * - 'last_7_days_from_monday': Sejak Senin minggu lalu hingga sekarang (jika hari ini Senin pagi)
 */
export function getMondayWeekRange(
  mode: "current_week" | "previous_week",
  now: Date = new Date()
): { start: Date; end: Date; label: string; fileTag: string } {
  const currentMonday = getMondayOfWeek(now);

  const fmt = (dt: Date) =>
    dt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const isoDate = (dt: Date) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  if (mode === "current_week") {
    return {
      start: currentMonday,
      end: now,
      label: `Sejak Senin, ${fmt(currentMonday)}`,
      fileTag: `Sejak_Senin_${isoDate(currentMonday)}`,
    };
  }

  // mode === 'previous_week': Senin minggu lalu s/d Minggu sebelum Senin ini
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  prevMonday.setHours(0, 0, 0, 0);

  const prevSunday = new Date(currentMonday);
  prevSunday.setMilliseconds(-1); // Minggu 23:59:59.999

  return {
    start: prevMonday,
    end: prevSunday,
    label: `Senin, ${fmt(prevMonday)} – Minggu, ${fmt(prevSunday)}`,
    fileTag: `Minggu_Lalu_${isoDate(prevMonday)}_sd_${isoDate(prevSunday)}`,
  };
}

/**
 * Memfilter daftar buyer yang baru ditambahkan (created_at) atau diperbarui (updated_at)
 * dalam rentang mingguan per hari Senin.
 */
export function filterBuyersByMondayRange(
  buyers: BuyerRecord[],
  mode: "current_week" | "previous_week",
  matchField: "created_at" | "created_or_updated" = "created_at"
): BuyerRecord[] {
  const { start, end } = getMondayWeekRange(mode);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return buyers.filter((b) => {
    const createdMs = b.created_at ? new Date(b.created_at).getTime() : 0;
    const updatedMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;

    if (matchField === "created_at") {
      return createdMs >= startMs && createdMs <= endMs;
    }
    return (
      (createdMs >= startMs && createdMs <= endMs) ||
      (updatedMs >= startMs && updatedMs <= endMs)
    );
  });
}

function getColumnValue(
  row: Record<string, unknown>,
  candidateKeys: string[]
): string {
  const rowKeys = Object.keys(row);
  for (const candidate of candidateKeys) {
    const exactMatch = rowKeys.find(
      (k) => k.trim().toLowerCase() === candidate.toLowerCase()
    );
    if (exactMatch && row[exactMatch] != null) {
      const val = String(row[exactMatch]).trim();
      if (val) return val;
    }
  }
  for (const candidate of candidateKeys) {
    const partialMatch = rowKeys.find((k) =>
      k.trim().toLowerCase().includes(candidate.toLowerCase())
    );
    if (partialMatch && row[partialMatch] != null) {
      const val = String(row[partialMatch]).trim();
      if (val) return val;
    }
  }
  return "";
}

function inferPicFromLinkedIn(linkedinUrl: string): string {
  if (!linkedinUrl) return "";
  try {
    const match = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!match || !match[1]) return "";
    const decoded = decodeURIComponent(match[1]);
    const parts = decoded
      .split("-")
      .filter((p) => p && !/^[0-9a-f]{5,}$/i.test(p) && !/^\d+$/.test(p));
    if (parts.length === 0) return "";
    return parts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return "";
  }
}

export function parseAndDeduplicateExcelBuffer(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  currentUserEmail: string,
  customSheetMapping?: Record<
    string,
    { productTag: string; sector: SectorName }
  >
): ExcelParseReport {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  const sheetsProcessed: SheetSummary[] = [];
  const byNormName = new Map<string, DeduplicatedPreviewItem>();
  const byDomain = new Map<string, DeduplicatedPreviewItem>();

  let totalRawRows = 0;
  let duplicateRowsMergedCount = 0;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
    });

    const mapping =
      customSheetMapping?.[sheetName] ||
      mapSheetNameToProductAndSector(sheetName);

    let validRowsInSheet = 0;

    for (const row of rows) {
      const companyName = getColumnValue(row, [
        "Nama Perusahaan",
        "Company Name",
        "Company",
        "Perusahaan",
        "Buyer",
      ]);

      if (!companyName) continue;

      const normalized_name = normalizeCompanyName(companyName);
      if (!normalized_name) continue;

      validRowsInSheet++;
      totalRawRows++;

      const country = getColumnValue(row, ["Negara", "Country"]);
      const city = getColumnValue(row, ["Kota", "City"]);
      const website = getColumnValue(row, ["Website", "Web", "URL"]);
      const email = getColumnValue(row, ["Email", "E-mail", "Mail"]);
      const linkedin_url = getColumnValue(row, [
        "Linked in",
        "LinkedIn",
        "LinkedIn URL",
      ]);
      const rawPic = getColumnValue(row, [
        "PIC",
        "PIC Name",
        "Contact Person",
        "Nama PIC",
      ]);
      const pic_name = rawPic || inferPicFromLinkedIn(linkedin_url);
      const social_media = getColumnValue(row, [
        "Social Media",
        "Instagram",
        "Social",
      ]);
      const rawStatus = getColumnValue(row, [
        "Status",
        "Pipeline Status",
        "Pipeline",
      ]);
      const rawNotes = getColumnValue(row, ["Notes", "Catatan", "Keterangan"]);

      const explicitTagsStr = getColumnValue(row, [
        "Product Tags",
        "Produk",
        "Tags",
      ]);
      const explicitSectorsStr = getColumnValue(row, ["Sectors", "Sektor"]);

      const rowTags = explicitTagsStr
        ? explicitTagsStr
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [mapping.productTag];

      const rowSectors: SectorName[] = explicitSectorsStr
        ? (explicitSectorsStr
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(
              (s) => s === "Bumi Sari Lokal" || s === "Karaya Living"
            ) as SectorName[])
        : [mapping.sector];

      const company_domain = extractRootDomain(website, email) || null;

      const existing =
        byNormName.get(normalized_name) ||
        (company_domain ? byDomain.get(company_domain) : undefined);

      if (existing) {
        duplicateRowsMergedCount++;
        existing.product_tags = Array.from(
          new Set([...existing.product_tags, ...rowTags])
        );
        existing.sectors = inferSectorsFromProductTags(existing.product_tags, [
          ...existing.sectors,
          ...rowSectors,
        ]);
        if (!existing.sourceSheets.includes(sheetName)) {
          existing.sourceSheets.push(sheetName);
        }
        if (!existing.country && country) existing.country = country;
        if (!existing.city && city) existing.city = city;
        if (!existing.website && website) existing.website = website;
        if (!existing.email && email) existing.email = email;
        if (!existing.pic_name && pic_name) existing.pic_name = pic_name;
        if (!existing.linkedin_url && linkedin_url)
          existing.linkedin_url = linkedin_url;
        if (!existing.social_media && social_media)
          existing.social_media = social_media;
        if (!existing.company_domain && company_domain) {
          existing.company_domain = company_domain;
          byDomain.set(company_domain, existing);
        }
        existing.notes = `Merged dari sheet: ${existing.sourceSheets.join(", ")}${
          rawNotes ? ` — ${rawNotes}` : ""
        }`;
      } else {
        const validStatuses: PipelineStatus[] = [
          "New Lead",
          "Cold Outreach Sent",
          "Visited Booth / Warm",
          "Sample Requested",
          "Negotiation",
          "Deal / Active Buyer",
          "Not Interested",
        ];
        const pipeline_status: PipelineStatus = validStatuses.includes(
          rawStatus as PipelineStatus
        )
          ? (rawStatus as PipelineStatus)
          : "New Lead";

        const newItem: DeduplicatedPreviewItem = {
          company_name: companyName,
          normalized_name,
          company_domain,
          country,
          city,
          website,
          email,
          pic_name,
          linkedin_url,
          social_media,
          sectors: inferSectorsFromProductTags(rowTags, rowSectors),
          product_tags: Array.from(new Set(rowTags)),
          pipeline_status,
          notes:
            rawNotes || `Imported dari file ${fileName} (Sheet: ${sheetName})`,
          created_by: currentUserEmail || "import@bumisarilokal.com",
          sourceSheets: [sheetName],
        };

        byNormName.set(normalized_name, newItem);
        if (company_domain) {
          byDomain.set(company_domain, newItem);
        }
      }
    }

    sheetsProcessed.push({
      sheetName,
      mappedProductTag: mapping.productTag,
      mappedSector: mapping.sector,
      rowCount: validRowsInSheet,
    });
  }

  const items = Array.from(new Set(byNormName.values()));

  return {
    fileName,
    totalRawRows,
    uniqueCompaniesCount: items.length,
    duplicateRowsMergedCount,
    sheetsProcessed,
    items,
  };
}

/**
 * Mengekspor daftar buyer ke dalam file .xlsx
 */
export function exportBuyersToExcel(
  buyers: BuyerRecord[],
  filenamePrefix = "B2B_Export_CRM_Buyers",
  sheetTitle = "Buyers Data"
) {
  const rows = buyers.map((b, idx) => ({
    No: idx + 1,
    "Nama Perusahaan": b.company_name,
    "Normalized Name": b.normalized_name,
    "Company Domain": b.company_domain || "",
    Negara: b.country,
    Kota: b.city,
    Sektor: (b.sectors || []).join(", "),
    "Product Tags": (b.product_tags || []).join(", "),
    "Pipeline Status": b.pipeline_status,
    PIC: b.pic_name,
    Email: b.email,
    Website: b.website,
    "Linked in": b.linkedin_url,
    "Social Media": b.social_media,
    Notes: b.notes,
    "Created By": b.created_by,
    "Created At": b.created_at
      ? new Date(b.created_at).toLocaleString("id-ID")
      : "",
    "Updated At": b.updated_at
      ? new Date(b.updated_at).toLocaleString("id-ID")
      : "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet["!cols"] = [
    { wch: 5 }, // No
    { wch: 36 }, // Nama Perusahaan
    { wch: 28 }, // Normalized Name
    { wch: 24 }, // Company Domain
    { wch: 16 }, // Negara
    { wch: 18 }, // Kota
    { wch: 28 }, // Sektor
    { wch: 48 }, // Product Tags
    { wch: 22 }, // Pipeline Status
    { wch: 22 }, // PIC
    { wch: 30 }, // Email
    { wch: 34 }, // Website
    { wch: 42 }, // Linked in
    { wch: 20 }, // Social Media
    { wch: 45 }, // Notes
    { wch: 24 }, // Created By
    { wch: 20 }, // Created At
    { wch: 20 }, // Updated At
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    sheetTitle.slice(0, 31)
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filenamePrefix}_${dateStr}.xlsx`);
}
