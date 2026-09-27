import { describe, it, expect, vi, afterEach } from 'vitest';
import { render as baseRender, screen, cleanup, fireEvent } from '@testing-library/react';
import { SongEditor } from './SongEditor.js';
import { AlbumEditor } from './AlbumEditor.js';
import { ArtistEditor } from './ArtistEditor.js';
import { PlaylistEditor } from './PlaylistEditor.js';

function render(ui: React.ReactElement) {
  return baseRender(ui);
}

afterEach(() => {
  cleanup();
});

describe('edit-entity per-type editors (smoke)', () => {
  it('SongEditor renders song fields and reports value changes', () => {
    const onValueChange = vi.fn();
    render(
      <SongEditor
        entity={{ id: '1', title: 'Track' }}
        isMulti={false}
        values={{ title: 'Track', album: '', trackNumber: '', discNumber: '', artist: [], genre: [], year: '', lyrics: '' }}
        onValueChange={onValueChange}
        explicit={false}
        onExplicitChange={vi.fn()}
        albumStats={null}
        syncedLinesCount={0}
      />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Title' } });
    expect(onValueChange).toHaveBeenCalledWith('title', 'New Title');
  });

  it('AlbumEditor renders album fields', () => {
    render(
      <AlbumEditor
        entity={{ id: '2', title: 'Album' }}
        isMulti={false}
        values={{ title: 'Album', albumArtist: [], year: '', releaseType: '', lyrics: '' }}
        onValueChange={vi.fn()}
        albumStats={null}
      />,
    );
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByPlaceholderText('Album artist')).toBeTruthy();
  });

  it('ArtistEditor renders the artist name', () => {
    render(
      <ArtistEditor
        entity={{ id: '3', name: 'Some Artist' }}
        values={{ name: 'Some Artist' }}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Some Artist')).toBeTruthy();
  });

  it('PlaylistEditor renders the name field', () => {
    render(
      <PlaylistEditor
        isSmart={false}
        values={{ name: 'My Playlist' }}
        onValueChange={vi.fn()}
        rules={undefined}
        onRulesChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/name/i)).toBeTruthy();
  });
});
