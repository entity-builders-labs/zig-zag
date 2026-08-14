// Package db owns the shared pgx connection pool. Every domain package
// depends on a narrow, consumer-defined query interface (see e.g.
// internal/activities), never on *pgxpool.Pool directly, so this package's
// only exported surface is pool construction.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool connects to Postgres and verifies connectivity with a ping,
// mirroring PrismaService.onModuleInit's eager $connect() — the process
// should fail fast at boot if the database is unreachable, not on first request.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}
