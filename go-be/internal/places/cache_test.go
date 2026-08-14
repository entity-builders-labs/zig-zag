package places_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/places"
	"github.com/juanobrach/zig-zag/go-be/internal/places/mocks"
)

func TestCachedProvider_SearchNearby(t *testing.T) {
	params := places.SearchNearbyParams{Latitude: 1, Longitude: 2, Radius: 5000, IncludedTypes: []string{"museum"}}
	want := []places.PlaceData{{ID: "p1", Name: "Museo"}}

	tests := []struct {
		name       string
		mode       places.CacheMode
		preSeed    bool
		setupMocks func(real *mocks.Provider)
		wantErr    string
	}{
		{
			name: "cache miss in read mode calls through and does not persist",
			mode: places.CacheModeRead,
			setupMocks: func(real *mocks.Provider) {
				real.EXPECT().SearchNearby(mock.Anything, params).Return(want, nil)
			},
		},
		{
			name:       "cache hit never calls the real provider",
			mode:       places.CacheModeRead,
			preSeed:    true,
			setupMocks: func(real *mocks.Provider) {},
		},
		{
			name:       "strict mode errors on a cache miss instead of calling through",
			mode:       places.CacheModeStrict,
			setupMocks: func(real *mocks.Provider) {},
			wantErr:    "strict mode",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			real := mocks.NewProvider(t)
			tt.setupMocks(real)

			if tt.preSeed {
				seed := places.NewCachedProvider(mustProvider(t, want), dir, places.CacheModeWrite)
				_, err := seed.SearchNearby(context.Background(), params)
				require.NoError(t, err)
			}

			cached := places.NewCachedProvider(real, dir, tt.mode)
			got, err := cached.SearchNearby(context.Background(), params)

			if tt.wantErr != "" {
				require.ErrorContains(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, want, got)
		})
	}
}

func TestCachedProvider_WriteModePersists(t *testing.T) {
	dir := t.TempDir()
	params := places.SearchTextParams{TextQuery: "hiking trail"}
	want := []places.PlaceData{{ID: "p1"}}

	real := mocks.NewProvider(t)
	real.EXPECT().SearchText(mock.Anything, params).Return(want, nil).Once()

	writeProvider := places.NewCachedProvider(real, dir, places.CacheModeWrite)
	got, err := writeProvider.SearchText(context.Background(), params)
	require.NoError(t, err)
	require.Equal(t, want, got)

	// Second call, even against a provider that would error if hit, must be
	// served from the file the first (write-mode) call persisted.
	erroringReal := mocks.NewProvider(t)
	readProvider := places.NewCachedProvider(erroringReal, dir, places.CacheModeRead)
	got2, err := readProvider.SearchText(context.Background(), params)
	require.NoError(t, err)
	require.Equal(t, want, got2)
}

// mustProvider returns a stub Provider whose SearchNearby always returns data,nil.
func mustProvider(t *testing.T, data []places.PlaceData) places.Provider {
	t.Helper()
	m := mocks.NewProvider(t)
	m.EXPECT().SearchNearby(mock.Anything, mock.Anything).Return(data, nil)
	return m
}
