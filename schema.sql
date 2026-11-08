-- ============================================================================
-- B2B EXPORT CRM DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Single Source of Truth: Bumi Sari Lokal (F&B) & Karaya Living (Woodenware)
-- ============================================================================
-- Cara Eksekusi:
-- 1. Buka Dashboard Supabase -> SQL Editor -> New Query
-- 2. Copy-paste seluruh isi file schema.sql ini lalu klik "Run"
-- ============================================================================

-- 1. Aktifkan ekstensi UUID & pg_trgm (untuk pencarian teks cepat)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Buat Tipe / Constraint Status Pipeline
-- Daftar status resmi:
-- 'New Lead', 'Cold Outreach Sent', 'Visited Booth / Warm',
-- 'Sample Requested', 'Negotiation', 'Deal / Active Buyer', 'Not Interested'

-- 3. Buat Tabel Utama: buyers (Single Source of Truth: 1 Perusahaan = 1 Record Unik)
CREATE TABLE IF NOT EXISTS public.buyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  company_domain TEXT,
  country TEXT DEFAULT '',
  city TEXT DEFAULT '',
  website TEXT DEFAULT '',
  email TEXT DEFAULT '',
  pic_name TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  social_media TEXT DEFAULT '',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  product_tags TEXT[] NOT NULL DEFAULT '{}',
  pipeline_status TEXT NOT NULL DEFAULT 'New Lead' CHECK (
    pipeline_status IN (
      'New Lead',
      'Cold Outreach Sent',
      'Visited Booth / Warm',
      'Sample Requested',
      'Negotiation',
      'Deal / Active Buyer',
      'Not Interested'
    )
  ),
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Database Unique Constraints & Indexes (Anti-Duplikasi Level Database)
-- Constraint unik ketat pada normalized_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_normalized_name_unique
  ON public.buyers (normalized_name);

-- Constraint unik pada company_domain (hanya jika company_domain tidak kosong/null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyers_company_domain_unique
  ON public.buyers (company_domain)
  WHERE company_domain IS NOT NULL AND company_domain <> '';

-- Index tambahan untuk pencarian & filter cepat di Dashboard
CREATE INDEX IF NOT EXISTS idx_buyers_company_name_trgm
  ON public.buyers USING gin (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_buyers_normalized_name_trgm
  ON public.buyers USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_buyers_company_domain
  ON public.buyers (company_domain);

CREATE INDEX IF NOT EXISTS idx_buyers_country
  ON public.buyers (country);

CREATE INDEX IF NOT EXISTS idx_buyers_pipeline_status
  ON public.buyers (pipeline_status);

CREATE INDEX IF NOT EXISTS idx_buyers_sectors_gin
  ON public.buyers USING gin (sectors);

CREATE INDEX IF NOT EXISTS idx_buyers_product_tags_gin
  ON public.buyers USING gin (product_tags);

-- 5. Trigger Otomatis untuk updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_buyers_updated_at ON public.buyers;
CREATE TRIGGER trg_buyers_updated_at
  BEFORE UPDATE ON public.buyers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. Row Level Security (RLS) untuk Keamanan Tim Internal
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;

-- Policy: Hanya user yang sudah login (authenticated via Supabase Auth)
-- yang dapat membaca, menambah, mengubah, dan menghapus data buyer
DROP POLICY IF EXISTS "Allow authenticated full access to buyers" ON public.buyers;
DROP POLICY IF EXISTS "Allow anon internal access to buyers" ON public.buyers;

CREATE POLICY "Allow authenticated full access to buyers"
  ON public.buyers
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 7. INITIAL SEED DATA (Hasil Deduplikasi Otomatis dari database.xlsx)
-- Menggabungkan 55 baris dari 5 sheet (VOC, Extra Olive oil, Honey, Herbal Tea, Stevia)
-- menjadi 21 Perusahaan Unik tanpa duplikasi!
-- ============================================================================
INSERT INTO public.buyers (
  company_name, normalized_name, company_domain, country, city, website, email, pic_name, linkedin_url, social_media, sectors, product_tags, pipeline_status, notes, created_by
) VALUES
  (
    'Bioriginal Food & Science Corp',
    'bioriginal food science',
    'bioriginal.com',
    'Canada',
    'Saskatoon',
    'https://www.bioriginal.com/',
    'tprentice@bioriginal.com',
    'Tessi Prentice',
    'https://www.linkedin.com/in/tessi-prentice-165b34203/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)'],
    'New Lead',
    'Imported & deduplicated from database.xlsx (Sheet: VOC)',
    'system@bumisarilokal.com'
  ),
  (
    'Ecotrend Ecologics Ltd',
    'ecotrend ecologics',
    'ecotrend.ca',
    'Canada',
    'Vancouver',
    'https://ecotrend.ca/',
    'sevinc@ecotrend.ca',
    'Sevinc Eres',
    'https://www.linkedin.com/in/sevinc-eres-87994212/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea', 'Liquid Stevia'],
    'Visited Booth / Warm',
    'Merged from 5 sheets in database.xlsx: VOC, Extra Olive oil, Honey, Herbal Tea, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'Flora Manufacturing and Distributing Ltd',
    'flora and distributing',
    'florahealth.com',
    'Canada',
    'Burnaby',
    'https://ca-en.florahealth.com/',
    'ldomingues@florahealth.com',
    'Leonardo Domingues',
    'https://www.linkedin.com/in/leonardo-domingues-52916559/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea'],
    'Cold Outreach Sent',
    'Merged from 4 sheets in database.xlsx: VOC, Extra Olive oil, Honey, Herbal Tea',
    'system@bumisarilokal.com'
  ),
  (
    'Gagan Foods International Ltd',
    'gagan foods',
    'gaganfoods.com',
    'Canada',
    'Delta',
    'https://www.gaganfoods.com/',
    'paul@gaganfoods.com',
    'Paul',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Kapok Flower Honey'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Honey',
    'system@bumisarilokal.com'
  ),
  (
    'Natures Formulae Health Products Ltd',
    'natures formulae health products',
    'naturesformulae.com',
    'Canada',
    'Kelowna',
    'https://naturesformulae.com/',
    'moira@naturesformulae.com',
    'Moira Weys',
    'https://www.linkedin.com/in/moira-weys-47a49370',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea', 'Liquid Stevia'],
    'Sample Requested',
    'Merged from 5 sheets in database.xlsx: VOC, Extra Olive oil, Honey, Herbal Tea, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'Neal Brothers Inc',
    'neal brothers',
    'nealbrothersfoods.com',
    'Canada',
    'Richmond Hill',
    'https://www.nealbrothersfoods.com/',
    'peter@nealbrothersfoods.com',
    'Peter',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey'],
    'New Lead',
    'Merged from 3 sheets in database.xlsx: VOC, Extra Olive oil, Honey',
    'system@bumisarilokal.com'
  ),
  (
    'Premier Polmarex Inc',
    'premier polmarex',
    'premierpolmarex.ca',
    'Canada',
    'Mississauga',
    'https://www.premierpolmarex.ca',
    'shahab@premierpolmarex.ca',
    'Shahab Bachani',
    'https://www.linkedin.com/in/shahabbachani/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea'],
    'Cold Outreach Sent',
    'Merged from 4 sheets in database.xlsx: VOC, Extra Olive oil, Honey, Herbal Tea',
    'system@bumisarilokal.com'
  ),
  (
    'Star Marketing Ltd',
    'star marketing',
    'starmarketingcanada.com',
    'Canada',
    'Surrey',
    'https://www.starmarketingcanada.com/',
    'john@starmarketingcanada.com',
    'John Vuckovic',
    'https://www.linkedin.com/in/john-vuckovic-12427289/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea', 'Liquid Stevia'],
    'Negotiation',
    'Merged from 5 sheets in database.xlsx: VOC, Extra Olive oil, Honey, Herbal Tea, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'Alpensonne Nederland BV',
    'alpensonne nederland',
    'alpensonne.nl',
    'Netherlands',
    'Velp Gld',
    'https://www.alpensonne.nl/',
    'wouter@alpensonne.nl',
    'Wouter Krab',
    'https://www.linkedin.com/in/wouter-krab-399a7013/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)'],
    'New Lead',
    'Imported from database.xlsx (Sheet: VOC)',
    'system@bumisarilokal.com'
  ),
  (
    'Boermarke Vers BV',
    'boermarke vers',
    'boermarke.eu',
    'Netherlands',
    'Enschede',
    'https://www.boermarke.eu/',
    'a.varvik@boermarke.eu',
    'Alex Varvik',
    'https://www.linkedin.com/in/alex-varvik-89a3a286/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Liquid Stevia'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'Bouter Cheese B.V.',
    'bouter cheese',
    'royal-aware.com',
    'Netherlands',
    'Culemborg',
    'https://www.royal-aware.com/en/',
    'alicia.carreno@royal-aware.com',
    'Alicia Fernández Carreño',
    'https://www.linkedin.com/in/alicia-fern%C3%A1ndez-carre%C3%B1o-28748a42/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Kapok Flower Honey'],
    'Cold Outreach Sent',
    'Merged from 3 sheets in database.xlsx: VOC, Extra Olive oil, Honey',
    'system@bumisarilokal.com'
  ),
  (
    'Cargill B.V.',
    'cargill',
    'cargill.com',
    'Netherlands',
    'Uden',
    'https://www.cargill.com/food-beverage/cocoa-chocolate',
    'cor_houkes@cargill.com',
    'Cor Houkes',
    'https://www.linkedin.com/in/cor-houkes-735a531/',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'RBD Coconut Oil'],
    'Visited Booth / Warm',
    'Merged from 2 sheets in database.xlsx: VOC, Extra Olive oil',
    'system@bumisarilokal.com'
  ),
  (
    'Chempri BV',
    'chempri',
    'chempri.com',
    'Netherlands',
    'Raamsdonksveer',
    'https://chempri.com/en',
    'peter@chempri.com',
    'Peter van Leijsen',
    'https://www.linkedin.com/in/peter-van-leijsen-70189614b',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'RBD Coconut Oil'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Extra Olive oil',
    'system@bumisarilokal.com'
  ),
  (
    'Danone Nederland BV',
    'danone nederland',
    'danone.com',
    'Netherlands',
    'Utrecht',
    'https://www.danone.com/',
    'natsaporn.patradul@danone.com',
    'Natsaporn Patradul',
    'https://www.linkedin.com/in/natsaporn-patradul-739318156',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Kapok Flower Honey', 'Liquid Stevia'],
    'Sample Requested',
    'Merged from 3 sheets in database.xlsx: VOC, Honey, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'De Burg BV',
    'de burg',
    'burggroup.eu',
    'Netherlands',
    'Heerhugowaard',
    'https://www.burggroup.eu/',
    'ak@burggroup.eu',
    '',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil', 'Apple Cider Vinegar'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Extra Olive oil',
    'system@bumisarilokal.com'
  ),
  (
    'M. Themans & Co. B.V.',
    'm themans',
    'themans.eu',
    'Netherlands',
    'Dordrecht',
    'https://www.themans.eu/',
    'info@themans.eu',
    '',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Extra Olive oil',
    'system@bumisarilokal.com'
  ),
  (
    'Nutricia Nederland BV',
    'nutricia nederland',
    'nutricia.nl',
    'Netherlands',
    'Zoetermeer',
    'https://www.nutricia.nl/',
    'professionals@nutricia.nl',
    '',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)'],
    'New Lead',
    'Imported from database.xlsx (Sheet: VOC)',
    'system@bumisarilokal.com'
  ),
  (
    'Van Tilburg Zuivel BV',
    'van tilburg zuivel',
    'vantilburgzuivel.nl',
    'Netherlands',
    'Bodegraven',
    'https://www.vantilburgzuivel.nl/',
    'peter@vantilburgzuivel.nl',
    'Peter',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)', 'Extra Olive Oil'],
    'New Lead',
    'Merged from 2 sheets in database.xlsx: VOC, Extra Olive oil',
    'system@bumisarilokal.com'
  ),
  (
    'Westland Kaasspecialiteiten BV',
    'westland kaasspecialiteiten',
    'westlandkaas.nl',
    'Netherlands',
    'Huizen',
    'https://westlandkaas.nl/',
    'pers@westland-kaas.nl',
    '',
    '',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Virgin Coconut Oil (VCO)'],
    'New Lead',
    'Imported from database.xlsx (Sheet: VOC)',
    'system@bumisarilokal.com'
  ),
  (
    'Cebag BV',
    'cebag',
    'cebag.com',
    'Netherlands',
    'Meppel',
    'https://cebag.com/',
    'bram@cebag.com',
    'Bram Donker',
    'https://www.linkedin.com/in/bram-donker-a3a593206',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Extra Olive Oil', 'Kapok Flower Honey', 'Herbs & Roots Tea', 'Liquid Stevia'],
    'Deal / Active Buyer',
    'Merged from 4 sheets in database.xlsx: Extra Olive oil, Honey, Herbal Tea, Stevia',
    'system@bumisarilokal.com'
  ),
  (
    'Hochwald Foods Nederland BV',
    'hochwald foods nederland',
    'hochwald.de',
    'Netherlands',
    'Bolsward',
    'https://www.hochwald.de/de/',
    't.oberschmidt@hochwald.de',
    'Thorsten Oberschmidt',
    'https://www.linkedin.com/in/thorsten-oberschmidt-881b2bb',
    '',
    ARRAY['Bumi Sari Lokal'],
    ARRAY['Liquid Stevia'],
    'New Lead',
    'Imported from database.xlsx (Sheet: Stevia)',
    'system@bumisarilokal.com'
  )
ON CONFLICT (normalized_name) DO UPDATE SET
  sectors = ARRAY(SELECT DISTINCT unnest(public.buyers.sectors || EXCLUDED.sectors)),
  product_tags = ARRAY(SELECT DISTINCT unnest(public.buyers.product_tags || EXCLUDED.product_tags)),
  updated_at = now();
