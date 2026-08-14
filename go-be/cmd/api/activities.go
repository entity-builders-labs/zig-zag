package main

import (
	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	appplaces "github.com/juanobrach/zig-zag/go-be/internal/places"
)

// coreServices bundles the AI layer, places integration, and activities
// service — shared between activities' own HTTP handlers and tours'
// generation pipeline (which needs the chat model, image generator, and
// activities/places services too). Built once in wireCore so both call
// sites use the exact same instances (one AI cache, one vector store, etc.).
type coreServices struct {
	chat        *appai.ChatService
	image       *appai.ImageGenerator
	vectorStore *appai.VectorStore
	activities  *appactivities.Service
	places      *appplaces.Service
}

// wireCore builds the AI layer, the places integration, and the
// activities module together — construction order matters here:
// activities.Service must exist before places.Service (which needs it as
// an ActivityCreator). No import cycle: only internal/activities imports
// internal/places (for the ActivityDraft type), never the reverse.
func wireCore(cfg *config.Config, queries *sqlcgen.Queries) coreServices {
	cache := appai.NewCache(cfg.AI.CacheDir, appai.CacheMode(cfg.AI.CacheMode))
	chatModel := wireChatModel(cfg.AI)
	chatService := appai.NewChatService(chatModel, cache)

	embedder := wireEmbedder(cfg.AI)
	vectorStore := appai.NewVectorStore(queries, embedder)

	imageGenerator := appai.NewImageGenerator(wireImageClient(cfg.AI), cfg.AI.Enabled)

	metadataService := appactivities.NewMetadataService(chatService, imageGenerator)
	activitiesSvc := appactivities.NewService(queries, metadataService, vectorStore)

	placesProvider := wirePlacesProvider(cfg.Places, cfg.StoragePath)
	placesSvc := wirePlacesService(queries, placesProvider, chatService, activitiesSvc, vectorStore, cfg.Places.Provider)

	return coreServices{
		chat: chatService, image: imageGenerator, vectorStore: vectorStore,
		activities: activitiesSvc, places: placesSvc,
	}
}

func wireActivities(core coreServices, queries *sqlcgen.Queries) *appactivities.Handlers {
	hybridSearchSvc := appactivities.NewHybridSearchService(core.activities, core.places, queries)
	return appactivities.NewHandlers(core.activities, hybridSearchSvc)
}
