-- Remove the generated FK index duplicated by the explicit stock lookup index.
drop index if exists public.idx_stock_movements_09e3aab4;