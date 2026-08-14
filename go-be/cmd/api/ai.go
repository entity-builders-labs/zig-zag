package main

import (
	appai "github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/wiring"
)

func wireChatModel(cfg config.AIConfig) appai.ChatModel     { return wiring.ChatModel(cfg) }
func wireEmbedder(cfg config.AIConfig) appai.Embedder       { return wiring.Embedder(cfg) }
func wireImageClient(cfg config.AIConfig) appai.ImageClient { return wiring.ImageClient(cfg) }
