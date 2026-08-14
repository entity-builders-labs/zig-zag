package main

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

// healthHandler mirrors AppController.health() (be/src/app.controller.ts):
// same response shape, plus an actual DB ping since the Go process — unlike
// Nest's version — should never report healthy while it can't reach Postgres.
func healthHandler(pool *pgxpool.Pool) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if err := pool.Ping(r.Context()); err != nil {
			return httpx.Internal("database unreachable")
		}
		return httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"service":   "backend",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}
