import { Icon } from '../ui/Icon.js';

export function CoverArtLightbox({
  coverArt,
  alt,
  onClose,
}: {
  coverArt?: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Cover art preview"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 rounded-full bg-surface/80 p-2 text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="mdi-close" size={24} />
      </button>
      <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
        {coverArt ? (
          <img
            src={`/api/cover-art/${coverArt}`}
            alt={alt}
            className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-surface shadow-2xl">
            <Icon name="mdi-album" size={64} className="text-fg-secondary" />
          </div>
        )}
      </div>
    </div>
  );
}
