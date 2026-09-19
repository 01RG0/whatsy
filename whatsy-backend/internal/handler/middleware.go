package handler

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/whatsy/backend/pkg/utils"
)

type contextKey int

const claimsContextKey contextKey = iota

// JWTMiddleware validates Bearer tokens (Authorization header or ?token= query param)
// and enforces single-session: each new login increments agents.session_version, and
// any token whose sv claim doesn't match the DB value is rejected with session_invalidated.
func JWTMiddleware(secret string, db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var token string
			authorization := r.Header.Get("Authorization")
			parts := strings.Fields(authorization)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				token = parts[1]
			} else {
				token = r.URL.Query().Get("token")
			}
			if token == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}

			claims, err := utils.ValidateToken(secret, token)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}

			// Verify session version (single-session enforcement) and load tenant_id.
			// tenant_id is read from DB rather than the JWT so old tokens stay valid
			// across the multi-tenant migration, and so the value is always authoritative.
			var dbVersion int64
			var tenantID *string // nullable — NULL for legacy rows not yet assigned a tenant
			if err := db.QueryRowContext(r.Context(),
				`SELECT session_version, tenant_id::text FROM agents WHERE id = $1`, claims.AgentID,
			).Scan(&dbVersion, &tenantID); err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			if claims.SessionVersion != dbVersion {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session_invalidated"})
				return
			}
			if tenantID != nil {
				claims.TenantID = *tenantID
			}

			ctx := context.WithValue(r.Context(), claimsContextKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFromContext returns validated JWT claims added by JWTMiddleware.
func ClaimsFromContext(ctx context.Context) (*utils.JWTClaims, bool) {
	claims, ok := ctx.Value(claimsContextKey).(*utils.JWTClaims)
	return claims, ok
}

// RequireAdmin rejects requests from non-admin agents with 403.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFromContext(r.Context())
		if !ok || claims.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireNotViewer rejects requests from viewer agents with 403.
func RequireNotViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFromContext(r.Context())
		if !ok || claims.Role == "viewer" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "read-only access: action not permitted for viewer"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

