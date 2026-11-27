package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	cloudsync "github.com/gemcdaniel/hearthside/services/api/internal/sync"
)

const (
	maxSaveRequestBodyBytes  int64 = 300 * 1024
	maxRecordsBatchBodyBytes int64 = 512 * 1024
)

type syncConflictResponse struct {
	Error      ErrorBody      `json:"error"`
	ServerSave cloudsync.Save `json:"serverSave"`
}

type batchRecordsRequest struct {
	Records []cloudsync.PuzzleRecordInput `json:"records"`
}

func pullProfileSyncHandler(svc *cloudsync.Service, logger *slog.Logger) http.HandlerFunc {
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

		profileID := r.PathValue("profileId")
		q := r.URL.Query()
		snapshot, err := svc.PullProfileSync(r.Context(), sc.Household.ID, profileID, cloudsync.PullOptions{
			GameID: strings.TrimSpace(q.Get("gameId")),
			Since:  strings.TrimSpace(q.Get("since")),
		})
		if err != nil {
			writeSyncError(w, r, logger, "pull profile sync failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, snapshot)
	}
}

func upsertSaveHandler(svc *cloudsync.Service, logger *slog.Logger) http.HandlerFunc {
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

		var req cloudsync.UpsertSaveInput
		if !decodeJSONWithLimit(w, r, &req, maxSaveRequestBodyBytes) {
			return
		}

		profileID := r.PathValue("profileId")
		gameID := r.PathValue("gameId")
		slot := r.PathValue("slot")

		result, err := svc.UpsertSave(r.Context(), sc.Household.ID, profileID, gameID, slot, req)
		if err != nil {
			writeSyncError(w, r, logger, "upsert save failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, result)
	}
}

func upsertRecordsBatchHandler(svc *cloudsync.Service, logger *slog.Logger) http.HandlerFunc {
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

		var req batchRecordsRequest
		if !decodeJSONWithLimit(w, r, &req, maxRecordsBatchBodyBytes) {
			return
		}

		profileID := r.PathValue("profileId")
		result, err := svc.UpsertRecordsBatch(r.Context(), sc.Household.ID, profileID, req.Records)
		if err != nil {
			writeSyncError(w, r, logger, "upsert records batch failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, result)
	}
}

func upsertPreferencesHandler(svc *cloudsync.Service, logger *slog.Logger) http.HandlerFunc {
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

		var req cloudsync.UpsertPreferencesInput
		if !decodeJSON(w, r, &req) {
			return
		}

		profileID := r.PathValue("profileId")
		result, err := svc.UpsertPreferences(r.Context(), sc.Household.ID, profileID, req)
		if err != nil {
			writeSyncError(w, r, logger, "upsert preferences failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, result)
	}
}

func writeSyncError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, contextMsg string, err error) {
	var conflictErr *cloudsync.ConflictError
	switch {
	case errors.As(err, &conflictErr):
		WriteJSON(w, http.StatusConflict, syncConflictResponse{
			Error: ErrorBody{
				Code:      "sync_conflict",
				Message:   "save slot diverged from server revision",
				RequestID: RequestIDFromContext(r.Context()),
			},
			ServerSave: conflictErr.ServerSave,
		})
	case errors.Is(err, cloudsync.ErrNotFound):
		WriteError(w, r, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, cloudsync.ErrPayloadTooLarge):
		WriteError(w, r, http.StatusRequestEntityTooLarge, "payload_too_large", "payload exceeds maximum allowed size")
	case errors.Is(err, cloudsync.ErrInvalidInput):
		WriteError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", RequestIDFromContext(r.Context())),
			slog.String("error", err.Error()),
		)
		WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
