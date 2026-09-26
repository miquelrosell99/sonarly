import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EntityDetailSkeleton,
  GridPageSkeleton,
  ListPageSkeleton,
  PageSkeleton,
} from './Skeletons.js';
import { Skeleton } from './ui/Skeleton.js';
import { EmptyState } from './ui/EmptyState.js';
import { PageState } from './PageState.js';

describe('skeletons (route Suspense fallbacks)', () => {
  afterEach(cleanup);

  it('renders pulse placeholders with the reduced-motion guard', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('animate-pulse');
    // Skeletons render static when the user prefers reduced motion.
    expect(el.className).toContain('motion-reduce:animate-none');
  });

  it('index.css has a global prefers-reduced-motion guard', () => {
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('list skeleton mirrors table content shape with a status role', () => {
    const { container } = render(<ListPageSkeleton />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    const rows = container.querySelectorAll('[role="status"] > div');
    expect(rows.length).toBe(12);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(20);
  });

  it('grid skeleton mirrors the responsive card grid', () => {
    const { container } = render(<GridPageSkeleton cards={5} />);
    const grid = container.querySelector('[role="status"]') as HTMLElement;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-5');
    expect(grid.querySelectorAll('.aspect-square').length).toBe(5);
  });

  it('entity skeleton mirrors a detail page header', () => {
    const { container } = render(<EntityDetailSkeleton />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
  });

  it('page skeleton renders section blocks', () => {
    const { container } = render(<PageSkeleton sections={2} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
  });
});

describe('EmptyState', () => {
  afterEach(cleanup);

  it('renders title, one-line description and a primary action', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon="mdi-playlist-music"
        title="This playlist is empty"
        description="Add songs from any track, album, artist, or search page using the context menu."
        actionLabel="Add songs"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('This playlist is empty')).toBeTruthy();
    expect(screen.getByText(/add songs from any track/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add songs' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action when none exists', () => {
    render(<EmptyState title="Nothing here" description="Nothing to do about it." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PageState empty/error affordances', () => {
  afterEach(cleanup);

  it('empty state renders description and action', () => {
    const onClick = vi.fn();
    render(
      <PageState isEmpty emptyMessage="No tracks match." emptyDescription="Try different filters." emptyAction={{ label: 'Clear filters', onClick }}>
        {null}
      </PageState>,
    );
    expect(screen.getByText('No tracks match.')).toBeTruthy();
    expect(screen.getByText('Try different filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('error state surfaces the server message text with a retry', () => {
    const onRetry = vi.fn();
    render(
      <PageState error={new Error('Library scan in progress — try again shortly.')} onRetry={onRetry}>
        {null}
      </PageState>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Library scan in progress');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
