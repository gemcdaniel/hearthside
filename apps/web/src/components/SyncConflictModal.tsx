import type { SaveSummaryMetadata, SaveSyncConflict } from '@hearthside/game-core';
import { useFocusTrap } from '@hearthside/ui';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { shellGameRegistry } from '../games/shellRegistry';

export interface SyncConflictModalProps {
  readonly open: boolean;
  readonly conflicts: readonly SaveSyncConflict[];
  readonly initialTarget?: { readonly gameId: string; readonly slot: string } | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly onResolveKeepLocal: (conflict: SaveSyncConflict) => Promise<void>;
  readonly onResolveKeepCloud: (conflict: SaveSyncConflict) => Promise<void>;
  readonly onClose: () => void;
}

function capitalize(word: string): string {
  if (!word) {
    return '';
  }
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

function formatDurationMMSS(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) {
    return 'Unknown';
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return iso;
  }
  return new Date(ms).toLocaleString();
}

function formatConflictTitle(conflict: SaveSyncConflict): string {
  const gameName = shellGameRegistry.get(conflict.gameId)?.metadata.name ?? conflict.gameId;
  const slot = conflict.slot;
  if (slot.startsWith('daily:')) {
    const [, dateKey = '', diff = ''] = slot.split(':');
    const diffLabel = capitalize(diff);
    return `${gameName} — Daily ${diffLabel}${dateKey ? ` (${dateKey})` : ''}`;
  }
  return `${gameName} — ${capitalize(slot)}`;
}

function resolveLocalSummary(conflict: SaveSyncConflict): SaveSummaryMetadata {
  const summary = conflict.localSave.summary;
  if (summary && typeof summary.filledCells === 'number' && typeof summary.elapsedMs === 'number') {
    return {
      puzzleId: summary.puzzleId ?? '',
      completed: summary.completed ?? false,
      elapsedMs: summary.elapsedMs,
      filledCells: summary.filledCells,
    };
  }
  const extracted = shellGameRegistry
    .get(conflict.gameId)
    ?.extractSaveSummary?.(conflict.localSave.payload);
  return {
    puzzleId: summary?.puzzleId ?? extracted?.puzzleId ?? '',
    completed: summary?.completed ?? extracted?.completed ?? false,
    elapsedMs: summary?.elapsedMs ?? extracted?.elapsedMs ?? 0,
    filledCells: summary?.filledCells ?? extracted?.filledCells ?? 0,
  };
}

function getDifferenceNotice(
  conflict: SaveSyncConflict,
  localSummary: SaveSummaryMetadata,
): string | null {
  const localDeleted = Boolean(conflict.localSave.deleted);
  const remoteDeleted = Boolean(conflict.serverSave.deleted);

  if (localDeleted !== remoteDeleted) {
    return 'One copy cleared or abandoned this save slot while the other still holds an active game.';
  }
  if (
    localSummary.puzzleId &&
    conflict.serverSave.puzzleId &&
    localSummary.puzzleId !== conflict.serverSave.puzzleId
  ) {
    return 'These two devices were playing different puzzles on the same slot.';
  }
  if (localSummary.completed !== conflict.serverSave.completed) {
    return 'One copy has already completed this puzzle.';
  }
  return 'Both devices modified this puzzle while offline or out of sync.';
}

export function SyncConflictModal({
  open,
  conflicts,
  initialTarget,
  returnFocusRef,
  onResolveKeepLocal,
  onResolveKeepCloud,
  onClose,
}: SyncConflictModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<'local' | 'cloud' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || conflicts.length === 0) {
      setSelectedIndex(0);
      setErrorMessage(null);
      return;
    }
    if (initialTarget) {
      const targetIdx = conflicts.findIndex(
        (c) => c.gameId === initialTarget.gameId && c.slot === initialTarget.slot,
      );
      if (targetIdx >= 0) {
        setSelectedIndex(targetIdx);
        return;
      }
    }
    setSelectedIndex((prev) => (prev < conflicts.length ? prev : 0));
  }, [open, conflicts, initialTarget]);

  useFocusTrap(modalRef, {
    active: open && conflicts.length > 0,
    onEscape: () => {
      if (!busyAction) {
        onClose();
      }
    },
    returnFocusRef,
  });

  if (!open || conflicts.length === 0) {
    return null;
  }

  const safeIndex = Math.min(selectedIndex, conflicts.length - 1);
  const conflict = conflicts[safeIndex];
  if (!conflict) {
    return null;
  }

  const localSummary = resolveLocalSummary(conflict);
  const localDeleted = Boolean(conflict.localSave.deleted);
  const remoteDeleted = Boolean(conflict.serverSave.deleted);
  const differenceNotice = getDifferenceNotice(conflict, localSummary);
  const localTimestamp = conflict.localSave.clientUpdatedAt ?? conflict.localSave.updatedAt;
  const remoteTimestamp = conflict.serverSave.clientUpdatedAt || conflict.serverSave.updatedAt;

  async function handleChooseLocal() {
    if (!conflict) {
      return;
    }
    setBusyAction('local');
    setErrorMessage(null);
    try {
      await onResolveKeepLocal(conflict);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to push local copy right now.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleChooseCloud() {
    if (!conflict) {
      return;
    }
    setBusyAction('cloud');
    setErrorMessage(null);
    try {
      await onResolveKeepCloud(conflict);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to apply cloud copy right now.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      className="hs-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyAction) {
          onClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className="hs-modal hs-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="hs-modal-header">
          <div>
            <h2 id={titleId} className="hs-section-title">
              Resolve Sync Conflict
            </h2>
            <p className="hs-account-meta">{formatConflictTitle(conflict)}</p>
          </div>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            disabled={busyAction !== null}
            onClick={onClose}
          >
            Decide Later
          </button>
        </div>

        <div className="hs-modal-body">
          {conflicts.length > 1 ? (
            <div className="hs-conflict-pager">
              <span className="hs-badge" data-tone="warning">
                Conflict {safeIndex + 1} of {conflicts.length}
              </span>
              <div className="hs-btn-group">
                <button
                  type="button"
                  className="hs-btn hs-btn-secondary"
                  disabled={busyAction !== null || safeIndex === 0}
                  onClick={() => setSelectedIndex((idx) => Math.max(0, idx - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="hs-btn hs-btn-secondary"
                  disabled={busyAction !== null || safeIndex >= conflicts.length - 1}
                  onClick={() => setSelectedIndex((idx) => Math.min(conflicts.length - 1, idx + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          {differenceNotice ? (
            <p className="hs-conflict-notice" role="status">
              {differenceNotice}
            </p>
          ) : null}

          <div className="hs-conflict-grid">
            <article className="hs-conflict-card" aria-label="This Device save copy">
              <div className="hs-conflict-card-header">
                <h3 className="hs-settings-subheading">This Device</h3>
                <span className="hs-badge" data-tone="warning">
                  Local Copy
                </span>
              </div>
              <dl className="hs-conflict-dl">
                <div className="hs-conflict-dl-row">
                  <dt>Progress</dt>
                  <dd>
                    {localDeleted
                      ? 'Cleared / Abandoned'
                      : `${localSummary.filledCells} / 81 cells${localSummary.completed ? ' (Solved)' : ''}`}
                  </dd>
                </div>
                <div className="hs-conflict-dl-row">
                  <dt>Elapsed time</dt>
                  <dd className="hs-conflict-mono">{formatDurationMMSS(localSummary.elapsedMs)}</dd>
                </div>
                <div className="hs-conflict-dl-row">
                  <dt>Last updated</dt>
                  <dd>{formatTimestamp(localTimestamp)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="hs-btn hs-btn-primary hs-conflict-choose-btn"
                disabled={busyAction !== null}
                onClick={() => void handleChooseLocal()}
              >
                {busyAction === 'local' ? 'Keeping This Device...' : 'Keep This Device'}
              </button>
            </article>

            <article className="hs-conflict-card" aria-label="Cloud save copy">
              <div className="hs-conflict-card-header">
                <h3 className="hs-settings-subheading">Cloud</h3>
                <span className="hs-badge" data-tone="success">
                  Rev {conflict.serverSave.revision}
                </span>
              </div>
              <dl className="hs-conflict-dl">
                <div className="hs-conflict-dl-row">
                  <dt>Progress</dt>
                  <dd>
                    {remoteDeleted
                      ? 'Cleared / Abandoned'
                      : `${conflict.serverSave.filledCells} / 81 cells${conflict.serverSave.completed ? ' (Solved)' : ''}`}
                  </dd>
                </div>
                <div className="hs-conflict-dl-row">
                  <dt>Elapsed time</dt>
                  <dd className="hs-conflict-mono">
                    {formatDurationMMSS(conflict.serverSave.elapsedMs)}
                  </dd>
                </div>
                <div className="hs-conflict-dl-row">
                  <dt>Last updated</dt>
                  <dd>{formatTimestamp(remoteTimestamp)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="hs-btn hs-btn-secondary hs-conflict-choose-btn"
                disabled={busyAction !== null}
                onClick={() => void handleChooseCloud()}
              >
                {busyAction === 'cloud' ? 'Keeping Cloud Copy...' : 'Keep Cloud Copy'}
              </button>
            </article>
          </div>

          {errorMessage ? (
            <p className="hs-conflict-notice" data-tone="error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
