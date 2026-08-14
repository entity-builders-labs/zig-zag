package auth

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ParseExpiresIn parses duration strings in the shape JWT_ACCESS_EXPIRES_IN
// / JWT_REFRESH_EXPIRES_IN use (e.g. "15m", "30d"), matching what
// jsonwebtoken's ms()-based expiresIn option accepts on the Nest side.
// time.ParseDuration has no "d" (day) unit, so that suffix is handled
// separately; everything else is delegated to it.
func ParseExpiresIn(s string) (time.Duration, error) {
	if strings.HasSuffix(s, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(s, "d"))
		if err != nil {
			return 0, fmt.Errorf("invalid day duration %q: %w", s, err)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("invalid duration %q: %w", s, err)
	}
	return d, nil
}
