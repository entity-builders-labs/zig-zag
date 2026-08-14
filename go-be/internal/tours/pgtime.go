package tours

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type pgtypeTimestamp = pgtype.Timestamp

// toPgTimestamp converts to UTC before building a pgtype.Timestamp — this
// schema's "timestamp" (no time zone) columns store UTC wall-clock numbers
// (see internal/auth/service.go's pgTimestamp for the regression this
// exact mistake caused there when skipped).
func toPgTimestamp(t time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: t.UTC(), Valid: true}
}

func fromPgTimestamps(ts []pgtype.Timestamp) []time.Time {
	out := make([]time.Time, len(ts))
	for i, t := range ts {
		out[i] = t.Time
	}
	return out
}
