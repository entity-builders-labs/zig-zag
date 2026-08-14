package tours

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

// Handlers ports ToursController (be/src/modules/tours/controllers/tours.controller.ts).
type Handlers struct {
	tours      *Service
	generation *GenerationService
	location   *LocationService
}

func NewHandlers(tours *Service, generation *GenerationService, location *LocationService) *Handlers {
	return &Handlers{tours: tours, generation: generation, location: location}
}

// Register wires every /tours route. Every route except GET /tours/nearby
// requires auth, matching @UseGuards(JwtAuthGuard) on every ToursController
// method except getNearby in Nest.
func (h *Handlers) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.Handle("POST /tours", requireAuth(httpx.Handle(h.create)))
	mux.Handle("POST /tours/generate-tour", requireAuth(httpx.Handle(h.generateTour)))
	mux.Handle("POST /tours/{id}/generate-activities", requireAuth(httpx.Handle(h.generateActivities)))
	mux.HandleFunc("GET /tours/nearby", httpx.Handle(h.getNearby))
	mux.Handle("GET /tours", requireAuth(httpx.Handle(h.findAll)))
	mux.Handle("GET /tours/{id}", requireAuth(httpx.Handle(h.findOne)))
	mux.Handle("PATCH /tours/{id}", requireAuth(httpx.Handle(h.update)))
	mux.Handle("DELETE /tours/{id}", requireAuth(httpx.Handle(h.remove)))
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

func currentUserID(r *http.Request) (string, error) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return user.ID, nil
}

// --- POST /tours ---

func (h *Handlers) create(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	var input TourInput
	if err := decodeJSON(r, &input); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	input.OwnerID = &userID

	tour, err := h.tours.Create(r.Context(), input)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusCreated, tour)
}

// --- POST /tours/generate-tour ---

type generateTourRequest struct {
	Latitude                  *float64             `json:"latitude"`
	Longitude                 *float64             `json:"longitude"`
	Radius                    *float64             `json:"radius"`
	IncludeExistingActivities *bool                `json:"includeExistingActivities"`
	Days                      *int                 `json:"days"`
	BudgetLevel               *BudgetLevel         `json:"budgetLevel"`
	Interests                 []string             `json:"interests"`
	TransportationMode        []TransportationMode `json:"transportationMode"`
	GroupType                 *GroupType           `json:"groupType"`
	TravelPace                *TravelPace          `json:"travelPace"`
	DietaryRestrictions       []string             `json:"dietaryRestrictions"`
	Destination               *string              `json:"destination"`
	DestinationLatitude       *float64             `json:"destinationLatitude"`
	DestinationLongitude      *float64             `json:"destinationLongitude"`
	SkipImageGeneration       *bool                `json:"skipImageGeneration"`
	Name                      *string              `json:"name"`
	Description               *string              `json:"description"`
	TotalDistance             *float64             `json:"totalDistance"`
	Price                     *float64             `json:"price"`
	EstimatedBudget           *float64             `json:"estimatedBudget"`
	MaxGroupSize              *int                 `json:"maxGroupSize"`
	RecommendedGroupSize      *int                 `json:"recommendedGroupSize"`
	StartDates                []string             `json:"startDates"`
	Categories                []string             `json:"categories"`
	ExcludeTours              []string             `json:"excludeTours"`
}

func (h *Handlers) generateTour(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	var req generateTourRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}

	includeExisting := true
	if req.IncludeExistingActivities != nil {
		includeExisting = *req.IncludeExistingActivities
	}

	options := GenerateTourOptions{
		OwnerID: &userID, Latitude: req.Latitude, Longitude: req.Longitude, Radius: req.Radius,
		IncludeExistingActivities: &includeExisting, Days: req.Days, BudgetLevel: req.BudgetLevel,
		Interests: req.Interests, TransportationMode: req.TransportationMode, GroupType: req.GroupType,
		TravelPace: req.TravelPace, DietaryRestrictions: req.DietaryRestrictions, Destination: req.Destination,
		DestinationLatitude: req.DestinationLatitude, DestinationLongitude: req.DestinationLongitude,
		Name: req.Name, Description: req.Description, TotalDistance: req.TotalDistance, Price: req.Price,
		EstimatedBudget: req.EstimatedBudget, MaxGroupSize: req.MaxGroupSize, RecommendedGroupSize: req.RecommendedGroupSize,
		StartDates: req.StartDates, Categories: req.Categories, ExcludeTours: req.ExcludeTours,
	}

	tour, err := h.generation.CreateTourFromWizard(r.Context(), options)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusCreated, tour)
}

// --- POST /tours/{id}/generate-activities ---

func (h *Handlers) generateActivities(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	id := r.PathValue("id")
	if _, err := h.tours.FindOne(r.Context(), id, &userID); err != nil {
		return toursError(err)
	}

	tour, err := h.generation.GenerateTourActivities(r.Context(), id)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, tour)
}

// --- GET /tours/nearby ---

func (h *Handlers) getNearby(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	lat, err := strconv.ParseFloat(q.Get("lat"), 64)
	if err != nil {
		return httpx.BadRequest("lat is required and must be a number")
	}
	lng, err := strconv.ParseFloat(q.Get("lng"), 64)
	if err != nil {
		return httpx.BadRequest("lng is required and must be a number")
	}
	category := q.Get("category")

	var radius *float64
	if v := q.Get("radius"); v != "" {
		if r, err := strconv.ParseFloat(v, 64); err == nil {
			radius = &r
		}
	}

	tours, err := h.location.GetNearbyTours(r.Context(), lat, lng, category, radius)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, tours)
}

// --- GET /tours ---

func (h *Handlers) findAll(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	q := r.URL.Query()
	page := queryIntOrDefault(q, "page", 1)
	limit := queryIntOrDefault(q, "limit", 10)

	var category *string
	if v := q.Get("category"); v != "" {
		category = &v
	}

	result, err := h.tours.FindAll(r.Context(), FindAllParams{OwnerID: userID, Page: page, Limit: limit, Category: category})
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

// --- GET /tours/{id} ---

func (h *Handlers) findOne(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	tour, err := h.tours.FindOne(r.Context(), r.PathValue("id"), &userID)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, tour)
}

// --- PATCH /tours/{id} ---

func (h *Handlers) update(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	var input TourInput
	if err := decodeJSON(r, &input); err != nil {
		return httpx.BadRequest("invalid request body")
	}

	tour, err := h.tours.Update(r.Context(), r.PathValue("id"), input, userID)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, tour)
}

// --- DELETE /tours/{id} ---

func (h *Handlers) remove(w http.ResponseWriter, r *http.Request) error {
	userID, err := currentUserID(r)
	if err != nil {
		return err
	}

	tour, err := h.tours.Remove(r.Context(), r.PathValue("id"), userID)
	if err != nil {
		return toursError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, tour)
}

func queryIntOrDefault(q map[string][]string, key string, def int) int {
	if v, ok := q[key]; ok && len(v) > 0 && v[0] != "" {
		if n, err := strconv.Atoi(v[0]); err == nil {
			return n
		}
	}
	return def
}

func toursError(err error) error {
	switch {
	case errors.Is(err, ErrTourNotFound):
		return httpx.NotFound("Tour not found")
	case errors.Is(err, ErrForbidden):
		return httpx.Forbidden(err.Error())
	case errors.Is(err, ErrGenerationAlreadyInProgress), errors.Is(err, ErrActivitiesAlreadyGenerated):
		return httpx.BadRequest(err.Error())
	case errors.Is(err, ErrNoGenerationOptions), errors.Is(err, ErrNoGenerationPrompt), errors.Is(err, ErrNoRealActivitiesFound):
		return httpx.BadRequest(err.Error())
	default:
		return httpx.Internal("Internal server error")
	}
}
