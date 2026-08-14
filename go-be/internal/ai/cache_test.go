package ai_test

import (
	"crypto/md5" //nolint:gosec // matching AiCacheService's key scheme, not a security use
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
)

// expectedKey reproduces AiCacheService.getCacheKey's exact algorithm
// (MD5 of JSON.stringify({prompt, options: options||{}})) independently of
// the implementation under test, so the test can't pass by both sides
// sharing a bug.
func expectedKey(t *testing.T, prompt string, options any) string {
	t.Helper()
	if options == nil {
		options = map[string]any{}
	}
	payload, err := json.Marshal(struct {
		Prompt  string `json:"prompt"`
		Options any    `json:"options"`
	}{prompt, options})
	require.NoError(t, err)
	sum := md5.Sum(payload) //nolint:gosec
	return hex.EncodeToString(sum[:]) + ".json"
}

func TestCache_KeyParity(t *testing.T) {
	tests := []struct {
		name    string
		prompt  string
		options any
	}{
		{name: "no options", prompt: "describe this activity"},
		{name: "nil options explicit", prompt: "describe this activity", options: nil},
		{name: "with options", prompt: "generate a tour", options: map[string]any{"temperature": 0.7, "model": "llama-3.1-8b-instant"}},
	}

	dir := t.TempDir()
	c := ai.NewCache(dir, ai.CacheModeWrite)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NoError(t, c.Set(tt.prompt, tt.options, "cached response"))

			wantKey := expectedKey(t, tt.prompt, tt.options)
			_, err := os.Stat(filepath.Join(dir, wantKey))
			require.NoError(t, err, "expected cache file %s to exist", wantKey)

			got, ok, err := c.Get(tt.prompt, tt.options)
			require.NoError(t, err)
			require.True(t, ok)
			require.Equal(t, "cached response", got)
		})
	}
}

func TestCache_ModeSemantics(t *testing.T) {
	tests := []struct {
		name             string
		mode             ai.CacheMode
		preSeed          bool
		wantHitAfterGet  bool
		wantFileAfterSet bool
	}{
		{
			name:             "off: never reads, never writes",
			mode:             ai.CacheModeOff,
			preSeed:          true,
			wantHitAfterGet:  false,
			wantFileAfterSet: false,
		},
		{
			name:             "read: reads existing entries but doesn't write new ones",
			mode:             ai.CacheModeRead,
			preSeed:          true,
			wantHitAfterGet:  true,
			wantFileAfterSet: false,
		},
		{
			name:             "write: reads existing entries and writes new ones",
			mode:             ai.CacheModeWrite,
			preSeed:          true,
			wantHitAfterGet:  true,
			wantFileAfterSet: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()

			if tt.preSeed {
				seed := ai.NewCache(dir, ai.CacheModeWrite)
				require.NoError(t, seed.Set("seeded prompt", nil, "seeded response"))
			}

			c := ai.NewCache(dir, tt.mode)

			_, ok, err := c.Get("seeded prompt", nil)
			require.NoError(t, err)
			require.Equal(t, tt.wantHitAfterGet, ok)

			require.NoError(t, c.Set("new prompt", nil, "new response"))
			key := expectedKey(t, "new prompt", nil)
			_, statErr := os.Stat(filepath.Join(dir, key))
			if tt.wantFileAfterSet {
				require.NoError(t, statErr)
			} else {
				require.True(t, os.IsNotExist(statErr))
			}
		})
	}
}
