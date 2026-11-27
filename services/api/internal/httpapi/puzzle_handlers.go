package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/puzzles"
)

func dailyPuzzleHandler(svc *puzzles.Service, nowFn func() time.Time, logger *slog.Logger) http.HandlerFunc {
	if nowFn == nil {
		nowFn = time.Now
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		q := r.URL.Query()
		dateStr := strings.TrimSpace(q.Get("date"))
		if dateStr == "" {
			dateStr = nowFn().UTC().Format("2006-01-02")
		}
		diffStr := strings.TrimSpace(q.Get("difficulty"))

		if diffStr != "" {
			puzzle, err := svc.GetDaily(r.Context(), dateStr, sudoku.Difficulty(diffStr))
			if err != nil {
				writePuzzleError(w, r, logger, "get daily puzzle failed", err)
				return
			}
			WriteJSON(w, http.StatusOK, map[string]any{
				"date":   dateStr,
				"puzzle": puzzle,
			})
			return
		}

		all, err := svc.GetDailyAll(r.Context(), dateStr)
		if err != nil {
			writePuzzleError(w, r, logger, "get daily puzzles failed", err)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{
			"date":    dateStr,
			"puzzles": all,
		})
	}
}

func bankPuzzlesHandler(svc *puzzles.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		q := r.URL.Query()
		diffStr := strings.TrimSpace(q.Get("difficulty"))
		if diffStr == "" {
			WriteError(w, r, http.StatusBadRequest, "invalid_input", "difficulty query parameter is required")
			return
		}

		var afterSeq int64
		if rawAfter := strings.TrimSpace(q.Get("afterSeq")); rawAfter != "" {
			parsed, err := strconv.ParseInt(rawAfter, 10, 64)
			if err != nil || parsed < 0 {
				WriteError(w, r, http.StatusBadRequest, "invalid_input", "afterSeq must be a non-negative integer")
				return
			}
			afterSeq = parsed
		}

		limit := puzzles.DefaultBankLimit
		if rawLimit := strings.TrimSpace(q.Get("limit")); rawLimit != "" {
			parsed, err := strconv.Atoi(rawLimit)
			if err != nil || parsed <= 0 {
				WriteError(w, r, http.StatusBadRequest, "invalid_input", "limit must be a positive integer")
				return
			}
			limit = parsed
		}

		page, err := svc.GetBank(r.Context(), sudoku.Difficulty(diffStr), afterSeq, limit)
		if err != nil {
			writePuzzleError(w, r, logger, "get puzzle bank failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, page)
	}
}

func getPuzzleByIDHandler(svc *puzzles.Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		id := r.PathValue("id")
		puzzle, err := svc.GetByID(r.Context(), id)
		if err != nil {
			writePuzzleError(w, r, logger, "get puzzle by id failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string]puzzles.Puzzle{"puzzle": puzzle})
	}
}

func writePuzzleError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, contextMsg string, err error) {
	switch {
	case errors.Is(err, puzzles.ErrNotFound):
		WriteError(w, r, http.StatusNotFound, "not_found", "puzzle not found")
	case errors.Is(err, puzzles.ErrDateOutOfRange):
		WriteError(w, r, http.StatusBadRequest, "date_out_of_range", err.Error())
	case errors.Is(err, puzzles.ErrInvalidInput):
		WriteError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", RequestIDFromContext(r.Context())),
			slog.String("error", err.Error()),
		)
		WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
