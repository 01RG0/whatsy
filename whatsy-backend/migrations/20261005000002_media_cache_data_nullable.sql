-- Allow data to be NULL for rows stored in R2 (storage_url set instead).
ALTER TABLE media_cache ALTER COLUMN data DROP NOT NULL;
ALTER TABLE sticker_cache ALTER COLUMN data DROP NOT NULL;
