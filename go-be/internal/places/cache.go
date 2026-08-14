package places

import (
	"context"
	"crypto/md5" //nolint:gosec // cache key, not a security boundary — matches CachedPlacesApiService's use of MD5.
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type CacheMode string

const (
	CacheModeRead   CacheMode = "read"
	CacheModeWrite  CacheMode = "write"
	CacheModeStrict CacheMode = "strict"
)

// CachedProvider ports CachedPlacesApiService — the layer actually in
// front of the real provider in this project (USE_MOCK_MAPS=true,
// MOCK_MAPS_MODE=read), backed by storage/maps-cache/ JSON files keyed by
// method+params, same as the AI response cache is keyed by prompt+options.
type CachedProvider struct {
	real Provider
	dir  string
	mode CacheMode
}

func NewCachedProvider(real Provider, dir string, mode CacheMode) *CachedProvider {
	return &CachedProvider{real: real, dir: dir, mode: mode}
}

func cacheKey(method string, params any) (string, error) {
	data, err := json.Marshal(params)
	if err != nil {
		return "", err
	}
	sum := md5.Sum(data) //nolint:gosec
	return fmt.Sprintf("%s-%s.json", method, hex.EncodeToString(sum[:])), nil
}

func handleRequest[T any](c *CachedProvider, method string, params any, real func() (T, error)) (T, error) {
	var zero T

	key, err := cacheKey(method, params)
	if err != nil {
		return zero, err
	}
	path := filepath.Join(c.dir, key)

	if data, err := os.ReadFile(path); err == nil {
		var cached T
		if err := json.Unmarshal(data, &cached); err != nil {
			return zero, err
		}
		return cached, nil
	}

	if c.mode == CacheModeStrict {
		return zero, fmt.Errorf("strict mode: cache miss for %s (%s) and real API calls are disabled", method, key)
	}

	result, err := real()
	if err != nil {
		return zero, err
	}

	if c.mode == CacheModeWrite {
		if err := os.MkdirAll(c.dir, 0o755); err == nil {
			if data, err := json.MarshalIndent(result, "", "  "); err == nil {
				_ = os.WriteFile(path, data, 0o644)
			}
		}
	}

	return result, nil
}

func (c *CachedProvider) SearchNearby(ctx context.Context, params SearchNearbyParams) ([]PlaceData, error) {
	return handleRequest(c, "searchNearby", params, func() ([]PlaceData, error) {
		return c.real.SearchNearby(ctx, params)
	})
}

func (c *CachedProvider) SearchText(ctx context.Context, params SearchTextParams) ([]PlaceData, error) {
	return handleRequest(c, "searchText", params, func() ([]PlaceData, error) {
		return c.real.SearchText(ctx, params)
	})
}

func (c *CachedProvider) GetPlaceDetails(ctx context.Context, placeID string) (PlaceData, error) {
	return handleRequest(c, "getPlaceDetails", map[string]string{"placeId": placeID}, func() (PlaceData, error) {
		return c.real.GetPlaceDetails(ctx, placeID)
	})
}
