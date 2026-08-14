package ai_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
)

// These fixtures stand in for real storage/ai-cache/ entries — none exist
// in this repo yet (AI_CACHE_MODE=read with an empty cache dir), so they're
// constructed from the malformation patterns ExtractAndCleanJSON/RepairJSON
// were written to handle in the original TS (markdown fences, trailing
// commas, comments, unescaped control chars in strings, chatty pre/postambles).
// Once real cache files accumulate, prefer harvesting fixtures from them
// directly, per the migration plan.
func TestExtractAndCleanJSON_ThenRepairJSON(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want map[string]any
	}{
		{
			name: "clean json passes through untouched",
			raw:  `{"activityIds":["a1","a2"],"notes":"chill pace"}`,
			want: map[string]any{"activityIds": []any{"a1", "a2"}, "notes": "chill pace"},
		},
		{
			name: "markdown code fence wrapper",
			raw:  "```json\n{\"activityIds\":[\"a9\"],\"notes\":\"short walk\"}\n```",
			want: map[string]any{"activityIds": []any{"a9"}, "notes": "short walk"},
		},
		{
			name: "plain fence without json tag",
			raw:  "```\n{\"activityIds\":[\"a1\"],\"notes\":\"ok\"}\n```",
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "ok"},
		},
		{
			name: "trailing commas before closing brackets",
			raw:  `{"activityIds":["a1","a2",],"notes":"chill pace",}`,
			want: map[string]any{"activityIds": []any{"a1", "a2"}, "notes": "chill pace"},
		},
		{
			name: "chatty preamble and signoff around the object",
			raw:  "Here's the JSON:\n{\"activityIds\":[\"a1\"],\"notes\":\"ok\"}\nThis is the response.",
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "ok"},
		},
		{
			name: "line and block comments stripped",
			raw: "{\n" +
				"  // this is the plan\n" +
				"  \"activityIds\": [\"a1\"], /* inline note */\n" +
				"  \"notes\": \"ok\"\n" +
				"}",
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "ok"},
		},
		{
			name: "raw newline inside a string value gets escaped",
			raw:  "{\"activityIds\":[\"a1\"],\"notes\":\"line one\nline two\"}",
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "line one\nline two"},
		},
		{
			name: "extra prose before and after the object",
			raw:  "Sure, here you go: {\"activityIds\":[\"a1\"],\"notes\":\"ok\"} Hope that helps!",
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "ok"},
		},
		{
			name: "braces inside a string value don't break balance tracking",
			raw:  `{"activityIds":["a1"],"notes":"looks like {this} but it's just text"}`,
			want: map[string]any{"activityIds": []any{"a1"}, "notes": "looks like {this} but it's just text"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cleaned := ai.ExtractAndCleanJSON(tt.raw)

			var got map[string]any
			err := json.Unmarshal([]byte(cleaned), &got)
			if err != nil {
				// Mirrors the Nest flow: extraction alone doesn't fix
				// trailing commas/comments/control chars — repair, then retry.
				repaired := ai.RepairJSON(cleaned)
				err = json.Unmarshal([]byte(repaired), &got)
			}
			require.NoError(t, err, "cleaned: %q", cleaned)
			require.Equal(t, tt.want, got)
		})
	}
}
