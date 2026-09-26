import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { cn } from '../lib/cn.js';
import { PlayButton } from './PlayButton.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';
import { PlayingIndicator } from './PlayingIndicator.js';

export interface CardActionFavorite {
  starred?: boolean;
  onClick: () => void;
  label?: string;
}

export interface CardActionRating {
  value?: number;
  onRate: (rating: number) => void;
}

export interface CardActionPlay {
  onPlay: () => void;
  onShufflePlay?: () => void;
  label?: string;
}

export interface CardField {
  content: ReactNode;
  href?: string;
}

interface CardProps {
  href: string;
  title: ReactNode;
  fields?: CardField[];
  cover?: ReactNode;
  favorite?: CardActionFavorite;
  rating?: CardActionRating;
  play?: CardActionPlay;
  onContextMenu?: (e: React.MouseEvent) => void;
  isPlaying?: boolean;
}

export function Card({
  href,
  title,
  fields,
  cover,
  favorite,
  rating,
  play,
  onContextMenu,
  isPlaying = false,
}: CardProps) {
  return (
    <div
      className="group/card relative flex flex-col gap-2 rounded-xl p-1 transition-colors duration-200 hover:bg-surface"
      onContextMenu={onContextMenu}
    >
      {cover ? (
        <Link
          href={href}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => {
            e.stopPropagation();
            onContextMenu?.(e);
          }}
          className="relative block overflow-hidden rounded-xl shadow-md outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
        >
          <div className="transition duration-300 group-hover/card:scale-105">{cover}</div>
          {isPlaying && (
            <div className="pointer-events-none absolute bottom-2 right-2 z-20 rounded-full bg-bg-primary/80 p-1.5 text-accent opacity-100 transition-opacity duration-200 group-hover/card:opacity-0">
              <PlayingIndicator size={16} />
            </div>
          )}
          <div className="hover-reveal pointer-events-none absolute inset-0 flex flex-col justify-between bg-black/50 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100">
            {(favorite || rating) && (
              <div className="pointer-events-auto flex items-start justify-between p-2">
                {favorite ? (
                  <FavoriteButton
                    starred={favorite.starred}
                    onClick={favorite.onClick}
                    label={favorite.label}
                    variant="overlay"
                  />
                ) : (
                  <span />
                )}
                {rating && (
                  <StarRating rating={rating.value} onRate={rating.onRate} variant="overlay" />
                )}
              </div>
            )}
            {play && (
              <PlayButton
                variant="overlay"
                onPlay={play.onPlay}
                onShufflePlay={play.onShufflePlay}
                label={play.label}
                className="pointer-events-auto m-2 self-end"
              />
            )}
          </div>
        </Link>
      ) : null}
      <div className={cn('space-y-0.5 px-1', !cover && 'rounded-xl border border-rule bg-surface p-3')}>
        <Link href={href} className="line-clamp-2 break-words text-sm font-medium text-fg-primary hover:text-muted">
          {title}
        </Link>
        {fields?.map((field, idx) => {
          if (field.content == null) return null;
          return (
            <div key={idx} className="line-clamp-1 text-sm text-fg-secondary">
              {field.href ? (
                <Link href={field.href} className="hover:text-muted">
                  {field.content}
                </Link>
              ) : (
                field.content
              )}
            </div>
          );
        })}
      </div>

      {!cover && favorite && (
        <div
          className={cn(
            'pointer-events-none absolute left-2 top-2 z-10 transition-opacity',
            favorite.starred ? 'opacity-100' : 'hover-reveal opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100',
          )}
        >
          <FavoriteButton
            starred={favorite.starred}
            onClick={favorite.onClick}
            label={favorite.label}
          />
        </div>
      )}
      {!cover && rating && (
        <div className="hover-reveal pointer-events-auto absolute right-2 top-2 z-10 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100">
          <StarRating rating={rating.value} onRate={rating.onRate} className="p-1" />
        </div>
      )}
      {!cover && play && (
        <span className="hover-reveal pointer-events-none absolute bottom-2 right-2 z-10 opacity-0 transition-all duration-200 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100">
          <PlayButton
            variant="overlay"
            onPlay={play.onPlay}
            onShufflePlay={play.onShufflePlay}
            label={play.label}
          />
        </span>
      )}
    </div>
  );
}
