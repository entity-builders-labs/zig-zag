package tours_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/tours"
)

func TestVerifyAndDedupeActivities(t *testing.T) {
	candidates := map[string]bool{"a1": true, "a2": true}

	tests := []struct {
		name                        string
		raw                         []tours.AIActivity
		wantIDs                     []string
		wantHallucinated, wantDupes int
	}{
		{
			name:    "all real, no dupes: nothing dropped",
			raw:     []tours.AIActivity{{ActivityID: "a1"}, {ActivityID: "a2"}},
			wantIDs: []string{"a1", "a2"},
		},
		{
			name:             "hallucinated id (not in candidate set) is dropped",
			raw:              []tours.AIActivity{{ActivityID: "a1"}, {ActivityID: "made-up-id"}},
			wantIDs:          []string{"a1"},
			wantHallucinated: 1,
		},
		{
			name:             "empty activityId is dropped as hallucinated, not a match",
			raw:              []tours.AIActivity{{ActivityID: "a1"}, {ActivityID: ""}},
			wantIDs:          []string{"a1"},
			wantHallucinated: 1,
		},
		{
			name:      "repeated real id is deduped, first occurrence kept, order preserved",
			raw:       []tours.AIActivity{{ActivityID: "a2"}, {ActivityID: "a1"}, {ActivityID: "a2"}},
			wantIDs:   []string{"a2", "a1"},
			wantDupes: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, hallucinated, dupes := tours.VerifyAndDedupeActivities(tt.raw, candidates)

			gotIDs := make([]string, len(got))
			for i, a := range got {
				gotIDs[i] = a.ActivityID
			}
			require.Equal(t, tt.wantIDs, gotIDs)
			require.Equal(t, tt.wantHallucinated, hallucinated)
			require.Equal(t, tt.wantDupes, dupes)
		})
	}
}
