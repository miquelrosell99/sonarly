import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { useSongContextMenu } from './useSongContextMenu.js';

const playActions = vi.hoisted(() => ({
  playSong: vi.fn(),
  playSongs: vi.fn(),
  shufflePlay: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('./usePlayActions.js', () => ({
  usePlayActions: () => playActions,
}));

const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => mockNotify,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createHarness(song: Song, onEdit: () => void) {
  return function SongMenuHarness() {
    const sections = useSongContextMenu(song, onEdit);
    return React.createElement(
      'div',
      { 'data-testid': 'menu' },
      sections.map((section, sectionIndex) =>
        React.createElement(
          'div',
          { key: sectionIndex, 'data-section': String(sectionIndex) },
          section.title && React.createElement('div', { 'data-testid': `title-${sectionIndex}` }, section.title),
          section.items.map((item) =>
            React.createElement('button', {
              key: item.id,
              'data-testid': item.id,
              disabled: item.disabled,
              onClick: item.onClick,
            }, item.label),
          ),
        ),
      ),
    );
  };
}

const song: Song = {
  id: 'song-1',
  filePath: '/music/track.mp3',
  title: 'Track One',
  duration: 180,
  mtime: 1,
  checksum: 'abc',
};

describe('useSongContextMenu', () => {
  it('returns Playback and Edit sections with the expected items', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    expect(screen.getByTestId('play')).toBeTruthy();
    expect(screen.getByTestId('play-next')).toBeTruthy();
    expect(screen.getByTestId('add-to-queue')).toBeTruthy();
    expect(screen.getByTestId('edit')).toBeTruthy();
    expect(screen.getByText('Playback')).toBeTruthy();
  });

  it('calls playSong when Play is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play'));
    expect(playActions.playSong).toHaveBeenCalledTimes(1);
    expect(playActions.playSong).toHaveBeenCalledWith(song);
  });

  it('calls playNext when Play next is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('play-next'));
    expect(playActions.playNext).toHaveBeenCalledTimes(1);
    expect(playActions.playNext).toHaveBeenCalledWith(song);
  });

  it('calls addToQueue with the song when Add to queue is clicked', () => {
    const Harness = createHarness(song, vi.fn());
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('add-to-queue'));
    expect(playActions.addToQueue).toHaveBeenCalledTimes(1);
    expect(playActions.addToQueue).toHaveBeenCalledWith([song]);
  });

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn();
    const Harness = createHarness(song, onEdit);
    render(React.createElement(Harness));

    fireEvent.click(screen.getByTestId('edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
