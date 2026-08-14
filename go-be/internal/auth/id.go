package auth

import "github.com/google/uuid"

// newID mirrors Prisma's @default(uuid()) on User.id/EmailLoginCode.id —
// the client generates the id, not the database.
func newID() string {
	return uuid.NewString()
}
