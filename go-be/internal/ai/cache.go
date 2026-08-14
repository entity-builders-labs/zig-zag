// Package ai ports be/src/shared/ai: response caching, embeddings, chat
// providers, JSON repair for freeform LLM output, the pgvector store, and
// DALL-E image generation.
package ai

import (
	"crypto/md5" //nolint:gosec // cache key, not a security boundary — matches AiCacheService's use of MD5 exactly.
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type CacheMode string

const (
	CacheModeOff   CacheMode = "off"
	CacheModeRead  CacheMode = "read"
	CacheModeWrite CacheMode = "write"
)

// Cache ports AiCacheService (be/src/shared/ai/services/ai-cache.service.ts)
// exactly: same cache directory layout, same MD5-of-{prompt,options} key,
// same {timestamp,prompt,options,response} file shape — so it reads and
// writes the very same storage/ai-cache/ files the Nest backend does.
type Cache struct {
	dir  string
	mode CacheMode
}

func NewCache(dir string, mode CacheMode) *Cache {
	return &Cache{dir: dir, mode: mode}
}

func (c *Cache) Enabled() bool { return c.mode != CacheModeOff }

type cachePayload struct {
	Prompt  string `json:"prompt"`
	Options any    `json:"options"`
}

type cacheFile struct {
	Timestamp string `json:"timestamp"`
	Prompt    string `json:"prompt"`
	Options   any    `json:"options"`
	Response  string `json:"response"`
}

// cacheKey mirrors AiCacheService.getCacheKey: an options-less call hashes
// the same as one passed an explicit empty object, since Nest's
// `options || {}` normalizes both to `{}` before JSON.stringify.
func cacheKey(prompt string, options any) (string, error) {
	if options == nil {
		options = map[string]any{}
	}
	payload, err := json.Marshal(cachePayload{Prompt: prompt, Options: options})
	if err != nil {
		return "", err
	}
	sum := md5.Sum(payload) //nolint:gosec
	return hex.EncodeToString(sum[:]) + ".json", nil
}

// Get returns the cached response for (prompt, options), or ("", false) on
// a miss or when caching is off. Mirrors getCachedResponse: both "read" and
// "write" modes read existing entries — only "write" mode also persists
// new ones (see Set).
func (c *Cache) Get(prompt string, options any) (string, bool, error) {
	if c.mode == CacheModeOff {
		return "", false, nil
	}

	key, err := cacheKey(prompt, options)
	if err != nil {
		return "", false, err
	}

	data, err := os.ReadFile(filepath.Join(c.dir, key))
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}

	var entry cacheFile
	if err := json.Unmarshal(data, &entry); err != nil {
		return "", false, err
	}
	return entry.Response, true, nil
}

// Set writes (prompt, options) -> response to the cache. A no-op unless
// mode is "write", mirroring cacheResponse.
func (c *Cache) Set(prompt string, options any, response string) error {
	if c.mode != CacheModeWrite {
		return nil
	}

	if err := os.MkdirAll(c.dir, 0o755); err != nil {
		return err
	}

	key, err := cacheKey(prompt, options)
	if err != nil {
		return err
	}

	entry := cacheFile{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Prompt:    prompt,
		Options:   options,
		Response:  response,
	}
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(c.dir, key), data, 0o644)
}
