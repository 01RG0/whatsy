package service

import (
	"context"
	"log"
	"time"
)

// BackfillMediaToR2 migrates existing BYTEA rows in media_cache and sticker_cache
// to Cloudflare R2. Runs in the background — callers should invoke via go.
// Each row is uploaded then atomically updated: storage_url is set and data is
// cleared, freeing Postgres space. Rows that fail upload are left untouched and
// continue serving via the BYTEA fallback.
func (s *ChatService) BackfillMediaToR2(ctx context.Context) {
	if s.r2 == nil {
		return
	}
	// Wait for the server and connection pool to fully settle before starting.
	select {
	case <-time.After(2 * time.Minute):
	case <-ctx.Done():
		return
	}

	total := s.backfillTable(ctx, "media_cache", "media")
	total += s.backfillTable(ctx, "sticker_cache", "sticker")
	if total > 0 {
		log.Printf("[r2-backfill] done — migrated %d rows from Postgres to R2", total)
	}
}

func (s *ChatService) backfillTable(ctx context.Context, table, prefix string) int {
	const batchSize = 10
	migrated := 0

	for {
		if ctx.Err() != nil {
			return migrated
		}

		rows, err := s.db.QueryContext(ctx,
			`SELECT url_hash, data, mime_type FROM `+table+
				` WHERE storage_url IS NULL AND data IS NOT NULL LIMIT $1`,
			batchSize,
		)
		if err != nil {
			log.Printf("[r2-backfill] query %s: %v", table, err)
			return migrated
		}

		type row struct {
			hash     string
			data     []byte
			mimeType string
		}
		var batch []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.hash, &r.data, &r.mimeType); err == nil {
				batch = append(batch, r)
			}
		}
		rows.Close()

		if len(batch) == 0 {
			return migrated
		}

		for _, r := range batch {
			if ctx.Err() != nil {
				return migrated
			}
			key := prefix + "/" + r.hash
			storageURL, uploadErr := s.r2.Upload(ctx, key, r.data, r.mimeType)
			if uploadErr != nil {
				log.Printf("[r2-backfill] upload %s/%s: %v (skipping)", table, r.hash[:8], uploadErr)
				continue
			}
			_, err := s.db.ExecContext(ctx,
				`UPDATE `+table+` SET storage_url=$1, data=NULL WHERE url_hash=$2`,
				storageURL, r.hash,
			)
			if err != nil {
				log.Printf("[r2-backfill] update %s/%s: %v", table, r.hash[:8], err)
				continue
			}
			migrated++
		}

		// Long pause between batches — keeps DB connection pressure minimal
		// so normal webhook writes and worker syncs are never starved.
		select {
		case <-time.After(5 * time.Second):
		case <-ctx.Done():
			return migrated
		}
	}
}
