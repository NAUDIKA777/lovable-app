CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT,
  base_title TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  price NUMERIC(10,2),
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','listed','sold')),
  base_image_url TEXT,
  image_url TEXT,
  pack_count INTEGER NOT NULL DEFAULT 1 CHECK (pack_count BETWEEN 1 AND 4),
  unit_weight_oz NUMERIC(10,2),
  package_weight_oz NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
-- No policies: only the PIN-gated server code (service role) may read or write.