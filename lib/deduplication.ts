import {
  BUMI_SARI_PRODUCTS,
  BuyerRecord,
  KARAYA_LIVING_PRODUCTS,
  SectorName,
} from "./constants";

/**
 * Daftar suffix badan usaha umum yang diabaikan saat normalisasi nama perusahaan
 * sesuai spesifikasi: ltd, inc, corp, bv, b.v., co, llc, pt, gmbh, international, manufacturing, dll.
 */
const LEGAL_ENTITY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "bv",
  "nv",
  "co",
  "company",
  "llc",
  "llp",
  "pt",
  "cv",
  "tbk",
  "gmbh",
  "ag",
  "kg",
  "sa",
  "srl",
  "spa",
  "plc",
  "pty",
  "oy",
  "ab",
  "aps",
  "as",
  "international",
  "manufacturing",
]);

/**
 * Daftar domain email gratis / sosial media yang tidak boleh dianggap sebagai
 * root domain unik milik satu perusahaan B2B.
 */
const GENERIC_NON_CORPORATE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "yahoo.co.uk",
  "yahoo.ca",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "yandex.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
]);

/**
 * Daftar Second-Level Domain (SLD) umum pada Country-Code TLD (ccTLD)
 * agar ekstraksi root domain menghasilkan eTLD+1 yang akurat (misal: company.co.uk).
 */
const COMMON_CC_SLDS = new Set([
  "co",
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "ac",
  "or",
  "go",
  "ne",
  "ltd",
  "plc",
]);

/**
 * Normalisasi Nama Perusahaan:
 * 1. Ubah ke lowercase
 * 2. Gabungkan singkatan bertitik seperti "b.v.", "n.v.", "p.t.", "l.l.c." menjadi "bv", "nv", "pt", "llc"
 * 3. Hapus seluruh tanda baca (diganti spasi)
 * 4. Hapus kata-kata suffix badan usaha umum (ltd, inc, corp, bv, b.v., co, llc, pt, gmbh, international, manufacturing)
 * 5. Rapikan spasi ganda
 */
export function normalizeCompanyName(rawName: string | null | undefined): string {
  if (!rawName) return "";

  let cleaned = rawName.toLowerCase().trim();

  // Tangani singkatan dengan titik seperti b.v., n.v., l.l.c., p.t., s.a.
  cleaned = cleaned
    .replace(/\bb\.?\s*v\.?\b/g, " bv ")
    .replace(/\bn\.?\s*v\.?\b/g, " nv ")
    .replace(/\bl\.?\s*l\.?\s*c\.?\b/g, " llc ")
    .replace(/\bp\.?\s*t\.?\b/g, " pt ")
    .replace(/\bc\.?\s*v\.?\b/g, " cv ");

  // Hapus tanda baca dan karakter non-alfanumerik (mendukung huruf Unicode internasional)
  cleaned = cleaned.replace(/[^\p{L}\p{N}\s]/gu, " ");

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const filteredTokens = tokens.filter(
    (token) => !LEGAL_ENTITY_SUFFIXES.has(token)
  );

  // Jika semua kata terhapus (kasus ekstrem), gunakan tokens asli
  const resultTokens = filteredTokens.length > 0 ? filteredTokens : tokens;
  return resultTokens.join(" ").trim();
}

/**
 * Ekstrak Root Domain dari satu string (baik berupa URL Website maupun alamat Email).
 * Contoh:
 * - "https://ca-en.florahealth.com/" -> "florahealth.com"
 * - "ldomingues@florahealth.com" -> "florahealth.com"
 * - "https://www.cargill.com/food-beverage/cocoa-chocolate" -> "cargill.com"
 */
export function extractDomainFromSingleInput(
  rawInput: string | null | undefined,
  ignoreGenericProviders = true
): string {
  if (!rawInput) return "";

  let str = rawInput.trim().toLowerCase();
  if (!str) return "";

  // Jika input mengandung beberapa email/URL yang dipisahkan koma/garis miring/titik koma, ambil yang pertama
  str = str.split(/[,;\s]+/)[0] || "";

  // Jika berupa email (mengandung '@' dan tidak diawali http)
  if (str.includes("@") && !str.startsWith("http://") && !str.startsWith("https://")) {
    const parts = str.split("@");
    str = parts[parts.length - 1] || "";
  } else {
    // Hapus protokol jika ada (http://, https://, dll.)
    str = str.replace(/^[a-z0-9+.-]+:\/\//i, "");
    // Jika ada user:pass@host di URL
    if (str.includes("@")) {
      const parts = str.split("@");
      str = parts[parts.length - 1] || "";
    }
  }

  // Hapus path, query string, fragment, dan port
  str = str.split(/[/?#:]/)[0] || "";

  // Bersihkan titik di awal/akhir dan karakter tidak valid
  str = str.replace(/^\.+|\.+$/g, "").replace(/[^a-z0-9.-]/g, "");

  // Hapus prefix www.
  str = str.replace(/^www\d*\./, "");

  const segments = str.split(".").filter(Boolean);
  if (segments.length < 2) return "";

  const tld = segments[segments.length - 1];
  const sld = segments[segments.length - 2];

  // Validasi TLD minimal 2 karakter
  if (!tld || tld.length < 2) return "";

  let rootDomain = `${sld}.${tld}`;

  // Cek apakah menggunakan ccTLD + SLD (contoh: .co.uk, .com.au, .co.id, .co.jp)
  if (
    segments.length >= 3 &&
    tld.length === 2 &&
    COMMON_CC_SLDS.has(sld)
  ) {
    const thirdLevel = segments[segments.length - 3];
    rootDomain = `${thirdLevel}.${sld}.${tld}`;
  }

  if (ignoreGenericProviders && GENERIC_NON_CORPORATE_DOMAINS.has(rootDomain)) {
    return "";
  }

  return rootDomain;
}

/**
 * Ekstrak Root Domain utama perusahaan dari kombinasi Website dan/atau Email.
 * Prioritaskan domain dari Website terlebih dahulu; jika kosong atau generic, ambil dari Email.
 */
export function extractRootDomain(
  website?: string | null,
  email?: string | null
): string {
  const fromWebsite = extractDomainFromSingleInput(website, true);
  if (fromWebsite) return fromWebsite;

  const fromEmail = extractDomainFromSingleInput(email, true);
  if (fromEmail) return fromEmail;

  return "";
}

export interface DuplicateMatchResult {
  buyer: BuyerRecord;
  matchType: "exact_name" | "exact_domain" | "similar_name";
  reason: string;
}

/**
 * Mengecek potensi duplikasi perusahaan secara komprehensif terhadap daftar buyer yang ada.
 * Digunakan baik untuk Live Check (Debounced 300ms) maupun saat proses Import Excel.
 */
export function findDuplicateBuyers(
  input: {
    company_name?: string;
    website?: string;
    email?: string;
    excludeId?: string;
  },
  existingBuyers: BuyerRecord[]
): DuplicateMatchResult[] {
  const inputNormalizedName = normalizeCompanyName(input.company_name);
  const inputWebsiteDomain = extractDomainFromSingleInput(input.website, true);
  const inputEmailDomain = extractDomainFromSingleInput(input.email, true);
  const inputPrimaryDomain = inputWebsiteDomain || inputEmailDomain;

  if (!inputNormalizedName && !inputPrimaryDomain) {
    return [];
  }

  const results: DuplicateMatchResult[] = [];
  const inputTokens = inputNormalizedName
    ? inputNormalizedName.split(" ").filter((t) => t.length >= 2)
    : [];

  for (const buyer of existingBuyers) {
    if (input.excludeId && buyer.id === input.excludeId) {
      continue;
    }

    const buyerNorm =
      buyer.normalized_name || normalizeCompanyName(buyer.company_name);
    const buyerDomain =
      buyer.company_domain || extractRootDomain(buyer.website, buyer.email);

    // 1. Cek kecocokan persis pada normalized_name
    if (inputNormalizedName && buyerNorm && inputNormalizedName === buyerNorm) {
      results.push({
        buyer,
        matchType: "exact_name",
        reason: `Nama ternormalisasi identik ("${buyerNorm}")`,
      });
      continue;
    }

    // 2. Cek kecocokan persis pada root domain (website atau email)
    if (
      buyerDomain &&
      ((inputWebsiteDomain && inputWebsiteDomain === buyerDomain) ||
        (inputEmailDomain && inputEmailDomain === buyerDomain))
    ) {
      results.push({
        buyer,
        matchType: "exact_domain",
        reason: `Root domain perusahaan sama ("${buyerDomain}")`,
      });
      continue;
    }

    // 3. Cek kemiripan nama (Substring / Token Overlap) untuk Live Warning saat mengetik
    if (inputNormalizedName.length >= 4 && buyerNorm.length >= 4) {
      if (
        buyerNorm.includes(inputNormalizedName) ||
        inputNormalizedName.includes(buyerNorm)
      ) {
        results.push({
          buyer,
          matchType: "similar_name",
          reason: `Nama perusahaan sangat mirip dengan "${buyer.company_name}"`,
        });
        continue;
      }

      if (inputTokens.length > 0) {
        const buyerTokens = buyerNorm.split(" ").filter((t) => t.length >= 2);
        const sharedTokens = inputTokens.filter((t) =>
          buyerTokens.some((bt) => bt === t || (t.length >= 4 && bt.startsWith(t)))
        );
        const overlapRatio =
          sharedTokens.length /
          Math.max(1, Math.min(inputTokens.length, buyerTokens.length));

        // Jika kata pertama (nama inti brand) sama persis dan panjangnya >= 5 karakter, atau overlap >= 0.75
        const firstTokenMatch =
          inputTokens[0].length >= 5 &&
          buyerTokens.length > 0 &&
          inputTokens[0] === buyerTokens[0];

        if (firstTokenMatch || (sharedTokens.length >= 2 && overlapRatio >= 0.75)) {
          results.push({
            buyer,
            matchType: "similar_name",
            reason: `Kemiripan kata kunci nama perusahaan ("${sharedTokens.join(", ")}")`,
          });
        }
      }
    }
  }

  // Urutkan agar exact_name dan exact_domain tampil paling atas
  const priorityOrder: Record<DuplicateMatchResult["matchType"], number> = {
    exact_name: 1,
    exact_domain: 2,
    similar_name: 3,
  };

  return results.sort(
    (a, b) => priorityOrder[a.matchType] - priorityOrder[b.matchType]
  );
}

/**
 * Memetakan nama sheet Excel (seperti di database.xlsx: 'VOC', 'Extra Olive oil', 'Honey', 'Herbal Tea', 'Stevia')
 * ke Product Tag resmi dan Sektor yang sesuai.
 */
export function mapSheetNameToProductAndSector(sheetName: string): {
  productTag: string;
  sector: SectorName;
} {
  const clean = sheetName.trim();
  const lower = clean.toLowerCase();

  // Pemetaan spesifik untuk sheet di database.xlsx & sinonim umum
  if (lower === "voc" || lower === "vco" || lower.includes("virgin coconut")) {
    return {
      productTag: "Virgin Coconut Oil (VCO)",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("rbd")) {
    return {
      productTag: "RBD Coconut Oil",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("olive")) {
    return {
      productTag: "Extra Olive Oil",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower === "honey" || lower.includes("kapok")) {
    return {
      productTag: "Kapok Flower Honey",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("bitter") && lower.includes("honey")) {
    return {
      productTag: "Bitter Black Honey",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("red yeast") || lower.includes("date honey") || lower.includes("angkak")) {
    return {
      productTag: "Red Yeast Rice & Date Honey",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("herbal tea") || lower.includes("herbs") || lower.includes("roots tea") || lower === "tea") {
    return {
      productTag: "Herbs & Roots Tea",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("stevia")) {
    return {
      productTag: "Liquid Stevia",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("cassava") || lower.includes("tapioca")) {
    return {
      productTag: "Liquid Cassava Sugar",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("apple cider") || lower.includes("acv")) {
    return {
      productTag: "Apple Cider Vinegar",
      sector: "Bumi Sari Lokal",
    };
  }
  if (lower.includes("noni")) {
    return {
      productTag: "Noni Vinegar",
      sector: "Bumi Sari Lokal",
    };
  }

  // Cek kecocokan dengan produk Karaya Living
  if (lower.includes("cutting board") && lower.includes("holder")) {
    return {
      productTag: "Egg & Cutting Board Holders",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("cutting board")) {
    return {
      productTag: "Cutting Boards",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("spatula") || lower.includes("utensil")) {
    return {
      productTag: "Cooking Spatulas & Utensils",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("spoon") || lower.includes("tong")) {
    return {
      productTag: "Wooden Spoons & Tongs",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("plate") || lower.includes("bowl")) {
    return {
      productTag: "Plates & Salad Bowls",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("tray")) {
    return {
      productTag: "Serving Trays",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("egg") || lower.includes("holder")) {
    return {
      productTag: "Egg & Cutting Board Holders",
      sector: "Karaya Living",
    };
  }
  if (lower.includes("wood") || lower.includes("karaya")) {
    return {
      productTag: "Custom Woodenware",
      sector: "Karaya Living",
    };
  }

  // Cek kecocokan langsung di daftar konstanta
  const exactBumi = BUMI_SARI_PRODUCTS.find(
    (p) => p.toLowerCase() === lower
  );
  if (exactBumi) {
    return { productTag: exactBumi, sector: "Bumi Sari Lokal" };
  }

  const exactKaraya = KARAYA_LIVING_PRODUCTS.find(
    (p) => p.toLowerCase() === lower
  );
  if (exactKaraya) {
    return { productTag: exactKaraya, sector: "Karaya Living" };
  }

  // Default fallback: gunakan nama sheet apa adanya di bawah Bumi Sari Lokal
  return {
    productTag: clean,
    sector: "Bumi Sari Lokal",
  };
}

/**
 * Helper untuk menentukan daftar sektor secara otomatis berdasarkan product_tags yang dipilih,
 * sambil tetap mempertahankan sektor yang dipilih secara eksplisit oleh user.
 */
export function inferSectorsFromProductTags(
  productTags: string[],
  existingSectors: SectorName[] = []
): SectorName[] {
  const sectorSet = new Set<SectorName>(existingSectors);

  for (const tag of productTags) {
    if (BUMI_SARI_PRODUCTS.includes(tag)) {
      sectorSet.add("Bumi Sari Lokal");
    } else if (KARAYA_LIVING_PRODUCTS.includes(tag)) {
      sectorSet.add("Karaya Living");
    }
  }

  return Array.from(sectorSet);
}
