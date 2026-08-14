package tours

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/juanobrach/zig-zag/go-be/internal/ai"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
	"github.com/juanobrach/zig-zag/go-be/internal/domain"
)

// CandidateActivity is the subset of an existing Activity the generation
// pipeline needs — a narrow, tours-owned shape (not activities.ActivityWithDistance)
// so this package doesn't depend on the activities package's full surface;
// see cmd/api's wiring for the adapter that builds these from real Activity rows.
type CandidateActivity struct {
	ID                      string
	Name                    string
	Type                    string
	Description             string
	Latitude, Longitude     float64
	Duration                *float64
	Rating                  *float64
	RatingCount             *int
	PriceLevel              *int
	OpeningHoursWeekdayText []string
}

// ActivityFinder is the narrow slice of activities.Service's surface the
// generation pipeline needs.
type ActivityFinder interface {
	FindAll(ctx context.Context, latitude, longitude string, radiusMeters float64, limit int, types []string) ([]CandidateActivity, error)
}

// Crawler is the narrow slice of places.Service's surface needed —
// triggering a background/foreground crawl when no local activities exist.
type Crawler interface {
	CrawlAndSaveActivities(ctx context.Context, latitude, longitude, radius float64) ([]string, error)
}

// Chatter is the narrow slice of ai.ChatService's surface needed.
type Chatter interface {
	GenerateChatResponse(ctx context.Context, systemPromptTemplate, userPromptTemplate string, variables map[string]string) (string, error)
}

// ImageGenerator is the narrow slice of ai.ImageGenerator's surface needed.
type ImageGenerator interface {
	GenerateImage(ctx context.Context, prompt string, size string, bypass bool) string
}

// GenerationQuerier is the narrow slice of sqlcgen.Queries the generation
// pipeline needs beyond Service's own Querier.
type GenerationQuerier interface {
	DeleteTourActivities(ctx context.Context, tourID string) error
	CreateTourActivity(ctx context.Context, arg sqlcgen.CreateTourActivityParams) error
	GetActivityLatLngByIDs(ctx context.Context, ids []string) ([]sqlcgen.GetActivityLatLngByIDsRow, error)
	UpdateTourCoverImage(ctx context.Context, arg sqlcgen.UpdateTourCoverImageParams) error
}

// GenerationService ports TourGenerationService (createTourFromWizard) and
// TourActivityGenerationService (generateTourActivities) — the highest
// orchestration-risk piece in the whole migration.
type GenerationService struct {
	tours      *Service
	db         GenerationQuerier
	pool       Pool
	activities ActivityFinder
	crawler    Crawler
	chat       Chatter
	image      ImageGenerator
}

func NewGenerationService(tours *Service, db GenerationQuerier, pool Pool, activities ActivityFinder, crawler Crawler, chat Chatter, image ImageGenerator) *GenerationService {
	return &GenerationService{tours: tours, db: db, pool: pool, activities: activities, crawler: crawler, chat: chat, image: image}
}

// tourChainResponse mirrors the JSON schema in createTourJSONSystemPrompt.
type tourChainResponse struct {
	Title                string       `json:"title"`
	Description          string       `json:"description"`
	Reasoning            string       `json:"reasoning"`
	EstimatedDuration    float64      `json:"estimatedDuration"`
	Activities           []AIActivity `json:"activities"`
	TotalDays            int          `json:"totalDays"`
	TotalDistance        float64      `json:"totalDistance"`
	EstimatedBudget      float64      `json:"estimatedBudget"`
	RecommendedGroupSize int          `json:"recommendedGroupSize"`
}

// InvokeTourChain mirrors createTourChain's invoke — always the
// freeform-JSON-mode path (extractAndCleanJson -> parse -> repairJson ->
// parse), since that's the one that matters given AI_PROVIDER=groq. The
// OpenAI function-calling variant isn't ported (see prompts.go).
func (s *GenerationService) InvokeTourChain(ctx context.Context, input, activitiesText string) (tourChainResponse, error) {
	userPrompt := createTourJSONUserPrompt(input, activitiesText)
	response, err := s.chat.GenerateChatResponse(ctx, createTourJSONSystemPrompt, userPrompt, nil)
	if err != nil {
		return tourChainResponse{}, fmt.Errorf("generate chat response: %w", err)
	}

	cleaned := ai.ExtractAndCleanJSON(response)

	var parsed tourChainResponse
	if err := json.Unmarshal([]byte(cleaned), &parsed); err == nil {
		return parsed, nil
	}

	repaired := ai.RepairJSON(cleaned)
	if err := json.Unmarshal([]byte(repaired), &parsed); err != nil {
		return tourChainResponse{}, fmt.Errorf("AI returned invalid JSON format: %w", err)
	}
	return parsed, nil
}

// CreateTourFromWizard ports createTourFromWizard: creates the tour
// structure synchronously, then starts activity generation in the
// background (fire-and-forget, matching Nest's un-awaited
// .catch(logger.error) call).
func (s *GenerationService) CreateTourFromWizard(ctx context.Context, options GenerateTourOptions) (domain.Tour, error) {
	tour, err := s.createTourStructure(ctx, options)
	if err != nil {
		return domain.Tour{}, err
	}

	slog.Info("tour created, starting background activity generation", "tourId", tour.ID)
	go func() {
		bgCtx := context.Background()
		if _, err := s.GenerateTourActivities(bgCtx, tour.ID); err != nil {
			slog.Error("background activity generation failed", "tourId", tour.ID, "error", err)
		}
	}()

	return tour, nil
}

// createTourStructure builds the basic tour row (no activities yet) from
// wizard options, storing everything GenerateTourActivities later needs to
// rebuild the prompt and re-run generation. Shared by CreateTourFromWizard
// (backgrounds generation) and LocationService.GetNearbyTours (awaits it
// synchronously, since that endpoint's contract is a list of complete tours).
func (s *GenerationService) createTourStructure(ctx context.Context, options GenerateTourOptions) (domain.Tour, error) {
	promptName := ""
	if options.Name != nil {
		promptName = *options.Name
	} else if options.Destination != nil {
		promptName = *options.Destination
	}

	finalPrompt := s.buildPrompt(promptName, options)
	preferences := BuildPreferencesObject(options)

	tourName := "Nuevo Tour"
	if options.Name != nil {
		tourName = *options.Name
	} else if options.Destination != nil {
		tourName = *options.Destination
	}

	description := "Tour personalizado"
	if options.Description != nil {
		description = *options.Description
	}

	metadata := map[string]any{
		"generatedAt":      time.Now().UTC().Format(time.RFC3339),
		"options":          options,
		"originalPrompt":   finalPrompt,
		"generationStatus": "pending",
	}
	if len(preferences) > 0 {
		metadata["preferences"] = preferences
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return domain.Tour{}, fmt.Errorf("marshal tour metadata: %w", err)
	}

	tour, err := s.tours.Create(ctx, TourInput{
		OwnerID: options.OwnerID, Name: tourName, Description: &description,
		TotalDays: options.Days, TotalDistance: options.TotalDistance, EstimatedBudget: options.EstimatedBudget,
		RecommendedGroupSize: options.RecommendedGroupSize, Prompt: &finalPrompt,
		Categories: options.Categories, Metadata: metadataJSON,
	})
	if err != nil {
		return domain.Tour{}, fmt.Errorf("failed to create tour: %w", err)
	}
	return tour, nil
}

func (s *GenerationService) buildPrompt(name string, options GenerateTourOptions) string {
	p := promptParams{Name: name}
	if options.Description != nil {
		p.Description = *options.Description
	}
	if options.Days != nil {
		p.Days = *options.Days
	}
	if options.StartDates != nil {
		p.StartDates = options.StartDates
	}
	if options.Categories != nil {
		p.Categories = options.Categories
	}
	if options.Interests != nil {
		p.Interests = options.Interests
	}
	if options.BudgetLevel != nil {
		p.BudgetLevel = string(*options.BudgetLevel)
	}
	for _, m := range options.TransportationMode {
		p.TransportationMode = append(p.TransportationMode, string(m))
	}
	if options.TravelPace != nil {
		p.TravelPace = string(*options.TravelPace)
	}
	if options.DietaryRestrictions != nil {
		p.DietaryRestrictions = options.DietaryRestrictions
	}
	if options.GroupType != nil {
		p.GroupType = string(*options.GroupType)
	}
	if options.Latitude != nil && options.Longitude != nil {
		p.HasLocation = true
		p.Latitude, p.Longitude = *options.Latitude, *options.Longitude
	}
	return BuildPromptFromParams(p)
}

func (s *GenerationService) updateGenerationStatus(ctx context.Context, tourID, status, message string) {
	_, err := s.tours.UpdateMetadata(ctx, tourID, func(meta map[string]any) {
		meta["generationStatus"] = status
		meta["generationMessage"] = message
		if status == "generating" {
			if _, ok := meta["generationStartedAt"]; !ok {
				meta["generationStartedAt"] = time.Now().UTC().Format(time.RFC3339)
			}
		}
	})
	if err != nil {
		slog.Error("failed to update generation status", "tourId", tourID, "error", err)
	}
}

var (
	ErrGenerationAlreadyInProgress = errors.New("activities are already being generated for this tour")
	ErrActivitiesAlreadyGenerated  = errors.New("activities have already been generated")
	ErrNoGenerationOptions         = errors.New("tour does not have generation options stored")
	ErrNoGenerationPrompt          = errors.New("tour does not have a prompt stored")
	ErrNoRealActivitiesFound       = errors.New("no se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio")
)

// GenerateTourActivities ports generateTourActivities — the core
// orchestration: search for real candidate activities (falling back to a
// crawl if none exist locally), generate an itinerary via the AI chain,
// verify/dedupe against the real candidates (hard safety net against
// hallucination), reorder with the route optimizer, calculate travel
// times, persist, and generate a cover image.
func (s *GenerationService) GenerateTourActivities(ctx context.Context, tourID string) (domain.Tour, error) {
	tour, err := s.tours.FindOne(ctx, tourID, nil)
	if err != nil {
		return domain.Tour{}, err
	}

	meta := decodeMetadata(tour.Metadata)
	if meta["generationStatus"] == "generating" {
		return domain.Tour{}, ErrGenerationAlreadyInProgress
	}
	if meta["generationStatus"] == "completed" && len(tour.Activities) > 0 {
		return domain.Tour{}, ErrActivitiesAlreadyGenerated
	}

	s.updateGenerationStatus(ctx, tourID, "generating", "Iniciando generación de actividades...")

	options, prompt, err := LoadGenerationOptions(meta)
	if err != nil {
		s.failGeneration(ctx, tourID, err)
		return domain.Tour{}, err
	}

	enhancedPrompt := prompt
	if v, ok := meta["enhancedPrompt"].(string); ok && v != "" {
		enhancedPrompt = v
	}

	availableActivitiesText, candidateIDs, candidatesByID := s.GatherCandidateActivities(ctx, tourID, options)
	if availableActivitiesText == "" {
		s.failGeneration(ctx, tourID, ErrNoRealActivitiesFound)
		return domain.Tour{}, ErrNoRealActivitiesFound
	}

	s.updateGenerationStatus(ctx, tourID, "generating", "Creando itinerario optimizado con inteligencia artificial...")

	aiResponse, err := s.InvokeTourChain(ctx, enhancedPrompt+availableActivitiesText, availableActivitiesText)
	if err != nil {
		s.failGeneration(ctx, tourID, err)
		return domain.Tour{}, err
	}

	s.updateGenerationStatus(ctx, tourID, "generating", "Itinerario generado. Guardando actividades...")

	uniqueActivities, hallucinatedCount, duplicateCount := VerifyAndDedupeActivities(aiResponse.Activities, candidateIDs)
	if hallucinatedCount > 0 {
		slog.Warn("dropped hallucinated activities", "tourId", tourID, "count", hallucinatedCount)
	}
	if duplicateCount > 0 {
		slog.Warn("dropped duplicate activities", "tourId", tourID, "count", duplicateCount)
	}
	if len(uniqueActivities) == 0 {
		s.failGeneration(ctx, tourID, ErrNoRealActivitiesFound)
		return domain.Tour{}, ErrNoRealActivitiesFound
	}

	auditResult := s.auditActivities(uniqueActivities, candidatesByID, options)

	orderedActivities := uniqueActivities
	if options.Latitude != nil && options.Longitude != nil {
		orderedActivities = OptimizeActivityOrder(Coordinates{Latitude: *options.Latitude, Longitude: *options.Longitude}, uniqueActivities)
	}

	tourActivities := TransformAiActivitiesToDto(orderedActivities, 0)
	tourActivities = s.withRealTravelTimes(ctx, tourActivities)

	if err := s.replaceTourActivities(ctx, tourID, tourActivities); err != nil {
		s.failGeneration(ctx, tourID, err)
		return domain.Tour{}, err
	}

	if _, err := s.tours.UpdateMetadata(ctx, tourID, func(m map[string]any) {
		m["generationStatus"] = "completed"
		m["generationMessage"] = fmt.Sprintf("¡Listo! %d actividades generadas exitosamente.", len(tourActivities))
		m["generationCompletedAt"] = time.Now().UTC().Format(time.RFC3339)
		m["generationTrace"] = map[string]any{
			"candidatesOffered": availableActivitiesText,
			"aiReasoning":       aiResponse.Reasoning,
			"hallucinatedCount": hallucinatedCount,
			"duplicateCount":    duplicateCount,
			"auditFindings":     auditResult,
		}
	}); err != nil {
		slog.Error("failed to mark generation completed", "tourId", tourID, "error", err)
	}

	slog.Info("activities generated successfully", "tourId", tourID, "count", len(tourActivities))

	s.updateGenerationStatus(ctx, tourID, "generating", "Generando imagen de portada...")
	if _, err := s.GenerateTourCoverImage(ctx, tourID); err != nil {
		slog.Warn("failed to generate cover image", "tourId", tourID, "error", err)
	}
	s.updateGenerationStatus(ctx, tourID, "completed", fmt.Sprintf("¡Listo! %d actividades generadas exitosamente.", len(tourActivities)))

	return s.tours.FindOne(ctx, tourID, nil)
}

func (s *GenerationService) failGeneration(ctx context.Context, tourID string, cause error) {
	if _, err := s.tours.UpdateMetadata(ctx, tourID, func(m map[string]any) {
		m["generationStatus"] = "failed"
		m["generationMessage"] = "Error: " + cause.Error()
		m["generationError"] = cause.Error()
		m["generationFailedAt"] = time.Now().UTC().Format(time.RFC3339)
	}); err != nil {
		slog.Error("failed to mark generation failed", "tourId", tourID, "error", err)
	}
}

// LoadGenerationOptions rebuilds GenerateTourOptions + the original prompt
// from a tour's stored metadata (round-tripped through JSON), mirroring
// how generateTourActivities recovers `options` and `prompt`.
func LoadGenerationOptions(meta map[string]any) (GenerateTourOptions, string, error) {
	var options GenerateTourOptions
	raw, ok := meta["options"]
	if !ok {
		return options, "", ErrNoGenerationOptions
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return options, "", fmt.Errorf("re-marshal stored options: %w", err)
	}
	if err := json.Unmarshal(data, &options); err != nil {
		return options, "", fmt.Errorf("decode stored options: %w", err)
	}

	prompt, _ := meta["originalPrompt"].(string)
	if prompt == "" {
		prompt, _ = meta["enhancedPrompt"].(string)
	}
	if prompt == "" {
		return options, "", ErrNoGenerationPrompt
	}

	return options, prompt, nil
}

// GatherCandidateActivities mirrors the local-search -> crawl-fallback
// block in generateTourActivities: never let the AI invent activities out
// of thin air — every stop must come from real places found in our
// database or crawled from Google/Geoapify.
func (s *GenerationService) GatherCandidateActivities(ctx context.Context, tourID string, options GenerateTourOptions) (string, map[string]bool, map[string]CandidateActivity) {
	candidateIDs := map[string]bool{}
	candidatesByID := map[string]CandidateActivity{}

	if options.Latitude == nil || options.Longitude == nil {
		return "", candidateIDs, candidatesByID
	}

	radius := 25000.0
	if options.Radius != nil {
		radius = *options.Radius
	}
	const activityLimit = 20

	s.updateGenerationStatus(ctx, tourID, "generating", fmt.Sprintf("Buscando actividades en la zona (radio %dkm)...", int(radius/1000)))

	latStr := strconv.FormatFloat(*options.Latitude, 'f', -1, 64)
	lngStr := strconv.FormatFloat(*options.Longitude, 'f', -1, 64)

	nearby, err := s.activities.FindAll(ctx, latStr, lngStr, radius, activityLimit, nil)
	if err != nil {
		slog.Warn("activity search failed", "tourId", tourID, "error", err)
		s.updateGenerationStatus(ctx, tourID, "generating", "Búsqueda de actividades completada. Generando itinerario con IA...")
		return "", candidateIDs, candidatesByID
	}

	if len(nearby) > 0 {
		s.updateGenerationStatus(ctx, tourID, "generating", fmt.Sprintf("%d actividades encontradas. Ordenando según tus preferencias...", len(nearby)))
		return formatCandidates(nearby, radius, candidateIDs, candidatesByID), candidateIDs, candidatesByID
	}

	s.updateGenerationStatus(ctx, tourID, "generating", "No se encontraron actividades locales. Buscando en Google Maps...")

	if _, err := s.crawler.CrawlAndSaveActivities(ctx, *options.Latitude, *options.Longitude, minFloat(radius, 5000)); err != nil {
		slog.Error("google/geoapify crawling failed", "tourId", tourID, "error", err)
		s.updateGenerationStatus(ctx, tourID, "generating", "La búsqueda en Google Maps falló.")
		return "", candidateIDs, candidatesByID
	}

	refreshed, err := s.activities.FindAll(ctx, latStr, lngStr, radius, activityLimit, nil)
	if err != nil || len(refreshed) == 0 {
		s.updateGenerationStatus(ctx, tourID, "generating", "No se encontraron lugares reales cerca de esta ubicación.")
		return "", candidateIDs, candidatesByID
	}

	s.updateGenerationStatus(ctx, tourID, "generating", fmt.Sprintf("¡Encontrados %d lugares nuevos en Google Maps! Analizando...", len(refreshed)))
	return formatCandidates(refreshed, radius, candidateIDs, candidatesByID), candidateIDs, candidatesByID
}

func formatCandidates(candidates []CandidateActivity, radius float64, candidateIDs map[string]bool, candidatesByID map[string]CandidateActivity) string {
	sample := candidates
	if len(sample) > 15 {
		sample = sample[:15]
	}

	text := fmt.Sprintf("\n\nAvailable activities in the area (within %gkm):\n", radius/1000)
	for i, c := range sample {
		candidateIDs[c.ID] = true
		candidatesByID[c.ID] = c
		if i > 0 {
			text += "\n"
		}
		text += FormatActivityForPrompt(ActivityForPrompt{
			ID: c.ID, Name: c.Name, Type: c.Type, Description: c.Description,
			Latitude: c.Latitude, Longitude: c.Longitude, Duration: c.Duration,
			Rating: c.Rating, RatingCount: c.RatingCount, PriceLevel: c.PriceLevel,
			OpeningHoursWeekday: c.OpeningHoursWeekdayText,
		})
	}
	return text
}

func (s *GenerationService) auditActivities(activities []AIActivity, candidatesByID map[string]CandidateActivity, options GenerateTourOptions) GenerationAuditResult {
	inputs := make([]AuditActivityInput, len(activities))
	for i, act := range activities {
		input := AuditActivityInput{
			ActivityID: act.ActivityID, ActivityName: act.ActivityName, StartTime: act.StartTime,
			Type: act.Type, Notes: act.Notes,
		}
		if act.ActivityID != "" {
			if c, ok := candidatesByID[act.ActivityID]; ok {
				input.OpeningHoursWeekdayText = c.OpeningHoursWeekdayText
				input.PriceLevel = c.PriceLevel
			}
		}
		inputs[i] = input
	}
	return AuditGeneration(inputs, options.BudgetLevel, options.DietaryRestrictions)
}

func (s *GenerationService) withRealTravelTimes(ctx context.Context, activities []TourActivityInput) []TourActivityInput {
	var ids []string
	for _, a := range activities {
		if a.ActivityID != nil {
			ids = append(ids, *a.ActivityID)
		}
	}
	entities := map[string]activityEntityCoords{}
	if len(ids) > 0 {
		rows, err := s.db.GetActivityLatLngByIDs(ctx, ids)
		if err != nil {
			slog.Warn("failed to fetch activity coordinates for travel-time calc", "error", err)
		} else {
			for _, r := range rows {
				entities[r.ID] = activityEntityCoords{Latitude: r.Latitude, Longitude: r.Longitude}
			}
		}
	}
	return UpdateTravelTimesForActivities(activities, entities)
}

// replaceTourActivities deletes and recreates a tour's activities in a
// single transaction, matching generateTourActivities' `$transaction` block.
func (s *GenerationService) replaceTourActivities(ctx context.Context, tourID string, activities []TourActivityInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	txDB := sqlcgen.New(tx)
	if err := txDB.DeleteTourActivities(ctx, tourID); err != nil {
		return fmt.Errorf("delete existing activities: %w", err)
	}
	if err := createTourActivities(ctx, txDB, tourID, activities); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
