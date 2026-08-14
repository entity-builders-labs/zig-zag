// Package auth ports be/src/modules/auth: JWT issuance/verification plus
// (once built out further) Google/Apple/email-OTP login.
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims mirrors JwtPayload from
// be/src/modules/auth/interfaces/jwt-payload.interface.ts ({sub, email}).
type Claims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

// RequestUser mirrors the RequestUser interface JwtStrategy.validate
// returns ({id, email}) — what a guarded handler gets for "the caller".
type RequestUser struct {
	ID    string
	Email string
}

var ErrInvalidToken = errors.New("invalid token")

// SignToken issues an HS256 JWT with {sub: userID, email}, mirroring
// AuthService.issueSession's jwtService.sign(payload, {secret, expiresIn}).
func SignToken(userID, email, secret string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// VerifyToken validates an HS256 JWT signed with secret (rejecting any
// other signing method, same as passport-jwt's fixed secretOrKey strategy)
// and returns its claims.
func VerifyToken(tokenString, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
