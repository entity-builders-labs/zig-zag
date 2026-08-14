// Command api is the Go replacement for be/'s NestJS HTTP server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	appauth "github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logLevel := slog.LevelInfo
	if !cfg.App.IsProduction() {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()

	queries := sqlcgen.New(pool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", httpx.Handle(healthHandler(pool)))

	authHandlers := wireAuth(ctx, cfg, queries)
	authHandlers.Register(mux, appauth.RequireAuth(cfg.Auth.JWTAccessSecret))

	core := wireCore(cfg, queries)

	activitiesHandlers := wireActivities(core, queries)
	activitiesHandlers.Register(mux)

	toursHandlers := wireTours(core, queries, pool)
	toursHandlers.Register(mux, appauth.RequireAuth(cfg.Auth.JWTAccessSecret))

	handler := httpx.Chain(
		httpx.Recoverer,
		httpx.RequestLogger,
		httpx.CORS(cfg.CORS),
	)(mux)

	srv := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", cfg.App.Port),
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", srv.Addr, "env", cfg.App.Environment)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
