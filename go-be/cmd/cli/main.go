// Command cli is the Go replacement for be/'s nest-commander scripts
// (be/src/commands/, run via `yarn script <name>`) — maintenance/data
// commands that bootstrap just the services they need, no HTTP server.
//
// Only 3 of the 4 commands referenced in be/'s tooling are ported:
// match-activities, audit-images, and check-metadata (be/src/commands/scripts/commands/).
// `yarn crawl` (be/package.json) invokes `src/cli.ts crawl ...`, but no
// @Command({name: 'crawl', ...}) exists anywhere in be/src — that script
// reference is already dead in the Nest codebase, not something this port
// dropped.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: cli <match-activities|audit-images|check-metadata> [options]")
		os.Exit(2)
	}

	if err := run(os.Args[1], os.Args[2:]); err != nil {
		slog.Error("command failed", "error", err)
		os.Exit(1)
	}
}

func run(command string, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()

	env := wireCLI(cfg, pool)

	switch command {
	case "match-activities":
		return runMatchActivities(ctx, env, args)
	case "audit-images":
		return runAuditImages(ctx, env, args)
	case "check-metadata":
		return runCheckMetadata(ctx, env)
	default:
		return fmt.Errorf("unknown command %q", command)
	}
}

// cliEnv bundles the services the commands need — a small, CLI-only
// duplicate of cmd/api's coreServices wiring (chat/image/vectorStore are
// shared, but none of these commands touch places/tours, so pulling in
// their wiring here too would be wasted setup for a maintenance script).
type cliEnv struct {
	chat        *appai.ChatService
	image       *appai.ImageGenerator
	vectorStore *appai.VectorStore
	activities  *appactivities.Service
	metadata    *appactivities.MetadataService
	queries     *sqlcgen.Queries
}

func printf(format string, args ...any) {
	fmt.Printf(format+"\n", args...)
}
