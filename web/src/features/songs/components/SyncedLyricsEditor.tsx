import { createPortal } from 'react-dom';
import { Button } from '../../../components/ui/button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Input } from '../../../components/ui/input.js';
import { Modal } from '../../../components/ui/Modal.js';
import { PageState } from '../../shell/PageState.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { cn } from '../../../lib/cn.js';
import { useSyncedLyricsEditor, type SyncedLyricsEditorProps } from './synced-lyrics-editor/useSyncedLyricsEditor.js';
import { formatTime, PX_PER_SECOND } from './synced-lyrics-editor/model.js';

export type { SyncedLyricsEditorProps };

export function SyncedLyricsEditor({ songId, title, artistName, duration, onClose, onSaved }: SyncedLyricsEditorProps) {
  const editor = useSyncedLyricsEditor({ songId, title, artistName, duration, onClose, onSaved });
  const {
    loading, loadError, saving, actionError, isPlaying, currentTime,
    peaksLoading, draggingId, editId, editText, fetching, pendingMatch,
    effectiveDuration, editLine, visibleLines, centerY,
    audioRef, dialogRef, areaRef, canvasRef,
    setEditText, fetchFromLrcLib, togglePlay, addLineAtCenter, handleSave,
    handleAreaPointerDown, handleAreaKeyDown, handlePillPointerDown,
    handlePillClick, handlePillKeyDown, closeEdit, saveEdit, deleteEdit,
    setPendingMatch,
  } = editor;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-black/70 sm:items-center sm:justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <audio ref={audioRef} preload="metadata" src={`/rest/stream.view?id=${songId}`} className="hidden" />

      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="synced-lyrics-title"
        className="flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl outline-none sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-dialog"
      >
        <div className="flex items-center justify-between gap-2 border-b border-outline px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 id="synced-lyrics-title" className="font-display text-lg font-semibold">Synced Lyrics</h3>
            <p className="truncate text-sm text-on-surface-variant">{title}{artistName ? ` • ${artistName}` : ''}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={fetchFromLrcLib}
              disabled={fetching}
              aria-label="Fetch lyrics from LRCLIB"
              title="Fetch lyrics from LRCLIB"
              className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <Icon
                name={fetching ? 'mdi-loading' : 'mdi-cloud-download-outline'}
                size={20}
                className={fetching ? 'animate-spin motion-reduce:animate-none' : undefined}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Icon name="mdi-close" size={20} />
            </button>
          </div>
        </div>

        <PageState loading={loading} error={loadError} className="flex-1 justify-center">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Waveform viewport: tape scrolls under the pinned center line */}
            <div
              ref={areaRef}
              role="slider"
              tabIndex={0}
              aria-label="Seek position"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={Math.round(effectiveDuration)}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={formatTime(currentTime)}
              onPointerDown={handleAreaPointerDown}
              onKeyDown={handleAreaKeyDown}
              className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />

              {/* Pinned center line + mono time */}
              <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-primary" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-item bg-surface/80 px-1.5 py-0.5 font-mono text-xs tabular-nums text-primary"
              >
                {formatTime(currentTime)}
              </div>

              {peaksLoading && (
                <div
                  role="status"
                  className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-outline bg-surface px-3 py-1 text-xs text-on-surface-variant"
                >
                  <Icon name="mdi-loading" size={14} className="animate-spin motion-reduce:animate-none" />
                  Analyzing waveform…
                </div>
              )}

              {/* Lyric pills anchored to their timestamps */}
              <div className="pointer-events-none absolute inset-y-0 left-16 right-2 sm:left-24 sm:right-4">
                {visibleLines.map((line) => {
                  const y = centerY + (line.time - currentTime) * PX_PER_SECOND;
                  const nearCenter = Math.abs(line.time - currentTime) < 0.25;
                  return (
                    <div
                      key={line.id}
                      className="pointer-events-auto absolute left-0 flex w-full items-center"
                      style={{ top: y, transform: 'translateY(-50%)' }}
                    >
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-primary/60 sm:w-5" />
                      <button
                        data-pill
                        type="button"
                        onPointerDown={handlePillPointerDown(line)}
                        onClick={handlePillClick(line)}
                        onKeyDown={handlePillKeyDown(line)}
                        aria-label={`Edit line: ${line.text || '(empty)'} at ${formatTime(line.time)}`}
                        title="Click to edit, drag to retime, arrow keys to nudge"
                        className={cn(
                          'flex h-11 min-w-0 max-w-full cursor-ns-resize items-center rounded-full border bg-surface px-3 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          nearCenter ? 'border-primary' : 'border-outline hover:border-on-surface-variant',
                          draggingId === line.id && 'border-primary ring-2 ring-primary',
                        )}
                      >
                        <span
                          className={cn(
                            'truncate',
                            draggingId === line.id
                              ? 'font-mono text-xs tabular-nums text-primary'
                              : line.text
                                ? 'text-on-surface'
                                : 'italic text-on-surface-variant',
                          )}
                        >
                          {draggingId === line.id ? formatTime(line.time) : line.text || '(empty)'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {actionError && (
              <p role="alert" className="border-t border-outline px-4 py-2 text-sm text-error sm:px-6">
                {actionError}
              </p>
            )}

            {/* Transport + insert, thumb-reachable at the bottom */}
            <div className="flex items-center gap-3 border-t border-outline px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Icon name={isPlaying ? 'mdi-pause' : 'mdi-play'} size={22} />
              </button>
              <Button onClick={addLineAtCenter} className="flex-1 justify-center gap-2 py-3">
                <Icon name="mdi-plus" size={18} />
                Add line at current position
              </Button>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-outline px-4 py-4 sm:px-6">
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save</Button>
            </div>
          </div>
        </PageState>
      </div>

      <Modal
        open={editId !== null}
        onClose={closeEdit}
        title={editLine ? `Edit line at ${formatTime(editLine.time)}` : 'Edit line'}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="danger" onClick={deleteEdit} className="mr-auto">Delete</Button>
            <Button variant="ghost" onClick={closeEdit}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </div>
        }
      >
        <Input
          value={editText}
          variant="boxed"
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
          }}
          aria-label="Line text"
          placeholder="Lyric line"
          className="w-full"
        />
      </Modal>

      <ConfirmModal
        open={pendingMatch !== null}
        onClose={() => setPendingMatch(null)}
        title="Replace current lyrics?"
        message={
          pendingMatch
            ? `Apply "${pendingMatch.title}"${pendingMatch.artistName ? ` by ${pendingMatch.artistName}` : ''} from LRCLIB? This overwrites the current ${pendingMatch.syncedLyrics?.length ? 'synced lines' : 'lyrics'} in the editor (not yet saved).`
            : ''
        }
        confirmLabel="Apply"
        onConfirm={() => editor.pendingMatch && editor.applyMatch(editor.pendingMatch)}
      />
    </div>,
    document.body,
  );
}
