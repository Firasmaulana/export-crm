export type SectorName = "Bumi Sari Lokal" | "Karaya Living";

export type PipelineStatus =
  | "New Lead"
  | "Cold Outreach Sent"
  | "Visited Booth / Warm"
  | "Sample Requested"
  | "Negotiation"
  | "Deal / Active Buyer"
  | "Not Interested";

export interface BuyerRecord {
  id: string;
  company_name: string;
  normalized_name: string;
  company_domain: string | null;
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
  created_at: string;
  updated_at: string;
}

export const SECTORS: {
  id: SectorName;
  label: string;
  subtitle: string;
  badgeClass: string;
  products: string[];
}[] = [
  {
    id: "Bumi Sari Lokal",
    label: "Bumi Sari Lokal",
    subtitle: "F&B / Natural Ingredients",
    badgeClass:
      "bg-indigo-500/12 text-indigo-200 border-indigo-400/25",
    products: [
      "Virgin Coconut Oil (VCO)",
      "RBD Coconut Oil",
      "Liquid Stevia",
      "Liquid Cassava Sugar",
      "Apple Cider Vinegar",
      "Noni Vinegar",
      "Herbs & Roots Tea",
      "Bitter Black Honey",
      "Red Yeast Rice & Date Honey",
      "Kapok Flower Honey",
      "Extra Olive Oil",
    ],
  },
  {
    id: "Karaya Living",
    label: "Karaya Living",
    subtitle: "Homeware / Wooden Craft",
    badgeClass:
      "bg-pink-500/12 text-pink-200 border-pink-400/25",
    products: [
      "Cutting Boards",
      "Cooking Spatulas & Utensils",
      "Wooden Spoons & Tongs",
      "Plates & Salad Bowls",
      "Serving Trays",
      "Egg & Cutting Board Holders",
      "Custom Woodenware",
    ],
  },
];

export const BUMI_SARI_PRODUCTS = SECTORS[0].products;
export const KARAYA_LIVING_PRODUCTS = SECTORS[1].products;
export const ALL_PRODUCTS = [...BUMI_SARI_PRODUCTS, ...KARAYA_LIVING_PRODUCTS];

export const PIPELINE_STATUSES: {
  value: PipelineStatus;
  label: string;
  colorClass: string;
  dotColor: string;
}[] = [
  {
    value: "New Lead",
    label: "New Lead",
    colorClass: "bg-white/6 text-white/80 border-white/12",
    dotColor: "bg-white/50",
  },
  {
    value: "Cold Outreach Sent",
    label: "Cold Outreach Sent",
    colorClass: "bg-cyan-500/12 text-cyan-200 border-cyan-400/25",
    dotColor: "bg-cyan-400",
  },
  {
    value: "Visited Booth / Warm",
    label: "Visited Booth / Warm",
    colorClass: "bg-amber-500/12 text-amber-200 border-amber-400/25",
    dotColor: "bg-amber-400",
  },
  {
    value: "Sample Requested",
    label: "Sample Requested",
    colorClass: "bg-pink-500/12 text-pink-200 border-pink-400/25",
    dotColor: "bg-pink-400",
  },
  {
    value: "Negotiation",
    label: "Negotiation",
    colorClass: "bg-indigo-500/15 text-indigo-200 border-indigo-400/30",
    dotColor: "bg-indigo-400",
  },
  {
    value: "Deal / Active Buyer",
    label: "Deal / Active Buyer",
    colorClass: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    dotColor: "bg-emerald-400",
  },
  {
    value: "Not Interested",
    label: "Not Interested",
    colorClass: "bg-rose-500/12 text-rose-300 border-rose-400/20",
    dotColor: "bg-rose-400",
  },
];
