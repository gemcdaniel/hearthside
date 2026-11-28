package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gemcdaniel/hearthside/services/api/internal/leaderboards"
)

func submitLeaderboardResultHandler(svc *leaderboards.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		var req leaderboards.SubmitResultInput
		if !decodeJSON(w, r, &req) {
			return
		}

		result, err := svc.SubmitResult(r.Context(), sc.Household.ID, req)
		if err != nil {
			writeLeaderboardError(w, r, logger, "submit leaderboard result failed", err)
			return
		}

		status := http.StatusOK
		if result.Created {
			status = http.StatusCreated
		}
		WriteJSON(w, status, result)
	}
}

func dailyLeaderboardHandler(svc *leaderboards.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		q := r.URL.Query()
		noHintsOnly, ok := parseBoolQueryParam(q.Get("noHintsOnly"))
		if !ok {
			WriteError(w, r, http.StatusBadRequest, "invalid_input", "noHintsOnly must be true or false")
			return
		}

		resp, err := svc.GetDailyLeaderboard(r.Context(), sc.Household.ID, leaderboards.DailyQueryOptions{
			Date:        strings.TrimSpace(q.Get("date")),
			Difficulty:  strings.TrimSpace(q.Get("difficulty")),
			Scope:       strings.TrimSpace(q.Get("scope")),
			NoHintsOnly: noHintsOnly,
		})
		if err != nil {
			writeLeaderboardError(w, r, logger, "get daily leaderboard failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, resp)
	}
}

func puzzleLeaderboardHandler(svc *leaderboards.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		q := r.URL.Query()
		noHintsOnly, ok := parseBoolQueryParam(q.Get("noHintsOnly"))
		if !ok {
			WriteError(w, r, http.StatusBadRequest, "invalid_input", "noHintsOnly must be true or false")
			return
		}

		puzzleID := r.PathValue("puzzleId")
		resp, err := svc.GetPuzzleLeaderboard(r.Context(), sc.Household.ID, puzzleID, leaderboards.QueryOptions{
			Scope:       strings.TrimSpace(q.Get("scope")),
			NoHintsOnly: noHintsOnly,
		})
		if err != nil {
			writeLeaderboardError(w, r, logger, "get puzzle leaderboard failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, resp)
	}
}

func householdDailySummaryHandler(svc *leaderboards.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		dateStr := strings.TrimSpace(r.URL.Query().Get("date"))
		resp, err := svc.GetHouseholdDailySummary(r.Context(), sc.Household.ID, dateStr)
		if err != nil {
			writeLeaderboardError(w, r, logger, "get household daily summary failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, resp)
	}
}

func parseBoolQueryParam(raw string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "false", "0":
		return false, true
	case "true", "1":
		return true, true
	default:
		return false, false
	}
}

func writeLeaderboardError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, contextMsg string, err error) {
	switch {
	case errors.Is(err, leaderboards.ErrPuzzleNotFound):
		WriteError(w, r, http.StatusNotFound, "puzzle_not_found", "puzzle not found")
	case errors.Is(err, leaderboards.ErrNotFound):
		WriteError(w, r, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, leaderboards.ErrInvalidSolution):
		WriteError(w, r, http.StatusUnprocessableEntity, "invalid_solution", "submitted solution does not match authoritative puzzle solution")
	case errors.Is(err, leaderboards.ErrInvalidInput):
		WriteError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", RequestIDFromContext(r.Context())),
			slog.String("error", err.Error()),
		)
		WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
