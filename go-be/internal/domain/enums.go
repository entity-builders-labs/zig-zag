package domain

// AuthProvider mirrors the Prisma `AuthProvider` enum.
type AuthProvider string

const (
	AuthProviderGoogle AuthProvider = "GOOGLE"
	AuthProviderApple  AuthProvider = "APPLE"
	AuthProviderEmail  AuthProvider = "EMAIL"
)

// Difficulty mirrors the Prisma `Difficulty` enum.
type Difficulty string

const (
	DifficultyEasy   Difficulty = "EASY"
	DifficultyMedium Difficulty = "MEDIUM"
	DifficultyHard   Difficulty = "HARD"
)

// RelationType mirrors the Prisma `RelationType` enum.
type RelationType string

const (
	RelationTypeSequential    RelationType = "SEQUENTIAL"
	RelationTypeSimilar       RelationType = "SIMILAR"
	RelationTypeComplementary RelationType = "COMPLEMENTARY"
)
