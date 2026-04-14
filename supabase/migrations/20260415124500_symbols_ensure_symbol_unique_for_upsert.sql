-- PostgREST / supabase-py upsert(..., on_conflict='symbol') requires a UNIQUE index or PK on
-- public.symbols.symbol alone. Without it, Postgres raises 42P10. Skip if symbol is already the
-- sole column of a PK or UNIQUE constraint (avoids a redundant second unique index).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'symbols'
          AND c.contype IN ('p', 'u')
          AND array_length(c.conkey, 1) = 1
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.conrelid
                AND a.attnum = c.conkey[1]
                AND NOT a.attisdropped
                AND a.attname = 'symbol'
          )
    ) THEN
        CREATE UNIQUE INDEX idx_symbols_symbol_unique_upsert
            ON public.symbols (symbol);
    END IF;
END $$;
