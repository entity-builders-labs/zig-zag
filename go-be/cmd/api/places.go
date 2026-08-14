package main

import (
	"net/http"

	appactivities "github.com/juanobrach/zig-zag/go-be/internal/activities"
	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	appplaces "github.com/juanobrach/zig-zag/go-be/internal/places"
)

// wirePlacesProvider picks Google or Geoapify per PLACES_PROVIDER, then
// wraps it with the file-cache/mock layer when USE_MOCK_MAPS=true —
// matching IntegrationsModule's two-stage provider factory. This
// project's actual .env has PLACES_PROVIDER=geoapify, USE_MOCK_MAPS=true.
func wirePlacesProvider(cfg config.PlacesConfig, storageDir string) appplaces.Provider {
	var real appplaces.Provider
	if cfg.Provider == "geoapify" {
		real = appplaces.NewGeoapifyProvider(cfg.GeoapifyAPIKey, http.DefaultClient)
	} else {
		real = appplaces.NewGoogleProvider(cfg.GoogleMapsAPIKey, http.DefaultClient)
	}

	if !cfg.UseMockMaps {
		return real
	}
	return appplaces.NewCachedProvider(real, storageDir+"/maps-cache", appplaces.CacheMode(cfg.MockMapsMode))
}

func wirePlacesService(queries *sqlcgen.Queries, provider appplaces.Provider, chat *appai.ChatService, activitiesSvc *appactivities.Service, vectorStore *appai.VectorStore, providerName string) *appplaces.Service {
	return appplaces.NewService(queries, provider, chat, activitiesSvc, vectorStore, providerName)
}
