ALTER TABLE media_cache ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE sticker_cache ADD COLUMN IF NOT EXISTS storage_url TEXT;
