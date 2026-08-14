package tours

import "github.com/google/uuid"

// newTourID mirrors Prisma's @default(uuid()) on Tour.id.
func newTourID() string {
	return uuid.NewString()
}
