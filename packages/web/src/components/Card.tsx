import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { FavoriteButton, StarRating } from './ActionButtons.js';

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
  onClick: () => void;
  label?: string;
}

interface CardProps {
  href: string;
  children: ReactNode;
  cover?: ReactNode;
  favorite?: CardActionFavorite;
  rating?: CardActionRating;
  play?: CardActionPlay;
}

export function Card({ href, children, cover, favorite, rating, play }: CardProps) {
  return (
    <div className="group relative">
      <Link
        href={href}
        className="block overflow-hidden rounded-md border border-rule bg-surface p-3 transition hover:bg-surface-hover"
      >
        {cover ? (
          <div className="relative overflow-hidden">
            {cover}
            <div className="absolute inset-0 z-[1] bg-black/40 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100" />
            {favorite && (
              <div
                className={cn(
                  'pointer-events-auto absolute left-2 top-2 z-10 transition-opacity',
                  favorite.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <FavoriteButton
                  starred={favorite.starred}
                  onClick={favorite.onClick}
                  label={favorite.label}
                  variant="overlay"
                />
              </div>
            )}
            {rating && (
              <div className="pointer-events-auto absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                <StarRating
                  rating={rating.value}
                  onRate={rating.onRate}
                  variant="overlay"
                />
              </div>
            )}
            {play && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  play.onClick();
                }}
                className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg-primary opacity-0 shadow-lg transition-opacity hover:bg-accent/90 focus-visible:outline-none group-hover:pointer-events-auto group-hover:opacity-100"
                aria-label={play.label ?? 'Play'}
              >
                <Icon name="mdi-play" size={20} />
              </button>
            )}
          </div>
        ) : (
          children
        )}
        {cover && children}
      </Link>
      {!cover && favorite && (
        <div
          className={cn(
            'pointer-events-auto absolute left-2 top-2 z-10 transition-opacity',
            favorite.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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
        <div className="pointer-events-auto absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <StarRating
            rating={rating.value}
            onRate={rating.onRate}
            className="p-1"
          />
        </div>
      )}
      {!cover && play && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            play.onClick();
          }}
          className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-bg-primary opacity-0 shadow-lg transition-opacity hover:bg-accent/90 focus-visible:outline-none group-hover:pointer-events-auto group-hover:opacity-100"
          aria-label={play.label ?? 'Play'}
        >
          <Icon name="mdi-play" size={20} />
        </button>
      )}
    </div>
  );
}
