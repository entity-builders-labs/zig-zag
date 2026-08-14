package auth_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
)

func TestParseExpiresIn(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    time.Duration
		wantErr bool
	}{
		{name: "minutes, matches JWT_ACCESS_EXPIRES_IN default", input: "15m", want: 15 * time.Minute},
		{name: "days, matches JWT_REFRESH_EXPIRES_IN default", input: "30d", want: 30 * 24 * time.Hour},
		{name: "hours", input: "2h", want: 2 * time.Hour},
		{name: "seconds", input: "45s", want: 45 * time.Second},
		{name: "invalid day count", input: "xd", wantErr: true},
		{name: "garbage", input: "not-a-duration", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := auth.ParseExpiresIn(tt.input)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}
