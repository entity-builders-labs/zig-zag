package activities

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

// Handlers ports ActivitiesController (be/src/modules/activities/controllers/activities.controller.ts).
type Handlers struct {
	svc    *Service
	hybrid *HybridSearchService
}

func NewHandlers(svc *Service, hybrid *HybridSearchService) *Handlers {
	return &Handlers{svc: svc, hybrid: hybrid}
}

func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /activities", httpx.Handle(h.create))
	mux.HandleFunc("GET /activities/all", httpx.Handle(h.findAll))
	mux.HandleFunc("GET /activities/{id}", httpx.Handle(h.findOne))
	mux.HandleFunc("PATCH /activities/{id}", httpx.Handle(h.update))
	mux.HandleFunc("DELETE /activities/{id}", httpx.Handle(h.remove))
	mux.HandleFunc("POST /activities/nearby", httpx.Handle(h.findNearby))
	mux.HandleFunc("GET /activities/{id}/similar", httpx.Handle(h.getSimilar))
	mux.HandleFunc("POST /activities/search-hybrid", httpx.Handle(h.searchHybrid))
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

// --- POST /activities ---

func (h *Handlers) create(w http.ResponseWriter, r *http.Request) error {
	var input ActivityInput
	if err := decodeJSON(r, &input); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if input.Name == nil || strings.TrimSpace(*input.Name) == "" {
		return httpx.ValidationFailed([]httpx.FieldError{{Property: "name", Message: "name should not be empty", Value: ""}})
	}

	activity, err := h.svc.Create(r.Context(), input)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusCreated, activity)
}

// --- GET /activities/all ---

func (h *Handlers) findAll(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	latitude := queryOrDefault(q, "latitude", "-34.5748341")
	longitude := queryOrDefault(q, "longitude", "-58.4084219")
	radius := queryFloatOrDefault(q, "radius", 50000)
	limit := queryIntOrDefault(q, "limit", 100)
	types := q["types"]

	activities, err := h.svc.FindAll(r.Context(), latitude, longitude, radius, limit, types)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activities)
}

// --- GET /activities/{id} ---

func (h *Handlers) findOne(w http.ResponseWriter, r *http.Request) error {
	activity, err := h.svc.FindOne(r.Context(), r.PathValue("id"))
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}

// --- PATCH /activities/{id} ---

func (h *Handlers) update(w http.ResponseWriter, r *http.Request) error {
	var input ActivityInput
	if err := decodeJSON(r, &input); err != nil {
		return httpx.BadRequest("invalid request body")
	}

	activity, err := h.svc.Update(r.Context(), r.PathValue("id"), input)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}

// --- DELETE /activities/{id} ---

func (h *Handlers) remove(w http.ResponseWriter, r *http.Request) error {
	activity, err := h.svc.Remove(r.Context(), r.PathValue("id"))
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activity)
}

// --- POST /activities/nearby ---

type findNearbyRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Radius    *float64 `json:"radius"`
	Limit     *int     `json:"limit"`
}

func (req findNearbyRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if req.Latitude == nil {
		errs = append(errs, httpx.FieldError{Property: "latitude", Message: "Latitude must be a number", Value: nil})
	}
	if req.Longitude == nil {
		errs = append(errs, httpx.FieldError{Property: "longitude", Message: "Longitude must be a number", Value: nil})
	}
	if req.Radius == nil {
		errs = append(errs, httpx.FieldError{Property: "radius", Message: "Radius must be a number", Value: nil})
	}
	return errs
}

func (h *Handlers) findNearby(w http.ResponseWriter, r *http.Request) error {
	var req findNearbyRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	limit := 10
	if req.Limit != nil {
		limit = *req.Limit
	}

	activities, err := h.svc.FindNearbyActivities(r.Context(), *req.Latitude, *req.Longitude, *req.Radius, limit)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activities)
}

// --- GET /activities/{id}/similar ---

func (h *Handlers) getSimilar(w http.ResponseWriter, r *http.Request) error {
	limit := queryIntOrDefault(r.URL.Query(), "limit", 10)

	activities, err := h.svc.FindSimilar(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, activities)
}

// --- POST /activities/search-hybrid ---

type hybridSearchRequest struct {
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	Radius       *float64 `json:"radius"`
	Limit        *int     `json:"limit"`
	ForceRefresh *bool    `json:"forceRefresh"`
	Types        []string `json:"types"`
}

func (req hybridSearchRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if req.Latitude == nil || *req.Latitude < -90 || *req.Latitude > 90 {
		errs = append(errs, httpx.FieldError{Property: "latitude", Message: "Latitude must be between -90 and 90", Value: req.Latitude})
	}
	if req.Longitude == nil || *req.Longitude < -180 || *req.Longitude > 180 {
		errs = append(errs, httpx.FieldError{Property: "longitude", Message: "Longitude must be between -180 and 180", Value: req.Longitude})
	}
	if req.Radius == nil || *req.Radius < 0 || *req.Radius > 50000 {
		errs = append(errs, httpx.FieldError{Property: "radius", Message: "Radius must be at most 50km (50000 meters)", Value: req.Radius})
	}
	return errs
}

func (h *Handlers) searchHybrid(w http.ResponseWriter, r *http.Request) error {
	var req hybridSearchRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	params := HybridSearchParams{Latitude: *req.Latitude, Longitude: *req.Longitude, Radius: *req.Radius, Types: req.Types}
	if req.Limit != nil {
		params.Limit = *req.Limit
	}
	if req.ForceRefresh != nil {
		params.ForceRefresh = *req.ForceRefresh
	}

	result, err := h.hybrid.SearchActivitiesWithCrawling(r.Context(), params)
	if err != nil {
		return activitiesError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

func queryOrDefault(q map[string][]string, key, def string) string {
	if v, ok := q[key]; ok && len(v) > 0 && v[0] != "" {
		return v[0]
	}
	return def
}

func queryFloatOrDefault(q map[string][]string, key string, def float64) float64 {
	if v, ok := q[key]; ok && len(v) > 0 && v[0] != "" {
		if f, err := strconv.ParseFloat(v[0], 64); err == nil {
			return f
		}
	}
	return def
}

func queryIntOrDefault(q map[string][]string, key string, def int) int {
	if v, ok := q[key]; ok && len(v) > 0 && v[0] != "" {
		if n, err := strconv.Atoi(v[0]); err == nil {
			return n
		}
	}
	return def
}

func activitiesError(err error) error {
	switch {
	case errors.Is(err, ErrActivityNotFound):
		return httpx.NotFound("Activity not found")
	case errors.Is(err, ErrInvalidCoordinates):
		return httpx.BadRequest(err.Error())
	case errors.Is(err, errBadActivityInput):
		return httpx.BadRequest(err.Error())
	default:
		return httpx.Internal("Internal server error")
	}
}
