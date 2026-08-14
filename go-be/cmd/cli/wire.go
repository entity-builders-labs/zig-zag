package main

import (
	"github.com/jackc/pgx/v5/pgxpool"

	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/wiring"
)

func wireCLI(cfg *config.Config, pool *pgxpool.Pool) cliEnv {
	queries := sqlcgen.New(pool)

	cache := appai.NewCache(cfg.AI.CacheDir, appai.CacheMode(cfg.AI.CacheMode))
	chatModel := wiring.ChatModel(cfg.AI)
	chatService := appai.NewChatService(chatModel, cache)

	embedder := wiring.Embedder(cfg.AI)
	vectorStore := appai.NewVectorStore(queries, embedder)

	imageGenerator := appai.NewImageGenerator(wiring.ImageClient(cfg.AI), cfg.AI.Enabled)

	metadataService := appactivities.NewMetadataService(chatService, imageGenerator)
	activitiesSvc := appactivities.NewService(queries, metadataService, vectorStore)

	return cliEnv{
		chat: chatService, image: imageGenerator, vectorStore: vectorStore,
		activities: activitiesSvc, metadata: metadataService, queries: queries,
	}
}
