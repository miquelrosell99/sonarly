import { useState } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { EditableCoverArt } from './EditableCoverArt.js';
import { CoverArtLightbox } from './CoverArtLightbox.js';
import { getCommonValue } from './tagValues.js';

interface CoverArtSectionProps {
  entityType: 'song' | 'album';
  entity?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  isMulti: boolean;
  title: string | string[] | undefined;
  readOnly?: boolean;
  coverArtBusy?: boolean;
  onEditCoverArt?: () => void;
  onDeleteCoverArt?: () => void;
}

export function CoverArtSection({
  entityType,
  entity,
  entities,
  isMulti,
  title,
  readOnly,
  coverArtBusy,
  onEditCoverArt,
  onDeleteCoverArt,
}: CoverArtSectionProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [confirmDeleteCoverArt, setConfirmDeleteCoverArt] = useState(false);
  const activeEntities = entities && entities.length > 0 ? entities : entity ? [entity] : [];
  const coverArt = isMulti
    ? (getCommonValue(activeEntities, entityType === 'song' ? 'albumCoverArt' : 'coverArt') as string | undefined) ??
      (getCommonValue(activeEntities, 'coverArt') as string | undefined)
    : (entityType === 'song'
        ? (entity!.albumCoverArt as string | undefined)
        : (entity!.coverArt as string | undefined)) ??
      (entity!.coverArt as string | undefined);
  const alt = `Cover art for ${title ?? entityType}`;
  return (
    <div className="shrink-0">
      <EditableCoverArt
        coverArt={coverArt}
        alt={alt}
        readOnly={readOnly || entityType === 'song' || isMulti}
        busy={coverArtBusy}
        onEdit={onEditCoverArt}
        onRequestDelete={onDeleteCoverArt && !isMulti ? () => setConfirmDeleteCoverArt(true) : undefined}
        onView={() => setLightboxOpen(true)}
        className="h-60 w-60"
      />
      {lightboxOpen && (
        <CoverArtLightbox
          coverArt={coverArt}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
        />
      )}
      <ConfirmModal
        open={confirmDeleteCoverArt}
        onClose={() => setConfirmDeleteCoverArt(false)}
        title="Remove cover art"
        message="Are you sure you want to remove the cover art? This action cannot be undone."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          setConfirmDeleteCoverArt(false);
          onDeleteCoverArt?.();
        }}
      />
    </div>
  );
}
