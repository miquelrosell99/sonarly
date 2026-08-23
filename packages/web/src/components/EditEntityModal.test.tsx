import { describe, it, expect, vi, afterEach } from 'vitest';
import { render as baseRender, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditEntityModal } from './EditEntityModal.js';

const originalFetch = global.fetch;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function render(ui: React.ReactElement) {
  return baseRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('EditEntityModal', () => {
  it('renders song fields and calls onSave', () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', artist: 'Artist' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={onDelete}
      />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Title' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title', artist: ['Artist'] }));
  });

  it('does not include the entity id in the song patch', () => {
    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', artist: 'Artist', filePath: '/music/track.mp3' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const [patch] = onSave.mock.calls[0];
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('filePath');
  });

  it('renders the file path in an info button tooltip for songs', () => {
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', artist: 'Artist', filePath: '/music/track.mp3' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const infoButton = screen.getByRole('button', { name: /show file path/i });
    expect(infoButton).toBeTruthy();
    fireEvent.mouseEnter(infoButton);
    expect(screen.getByText('/music/track.mp3')).toBeTruthy();
  });

  it('renders lyrics field and synced lyrics button for songs', () => {
    const onEditSyncedLyrics = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '1', title: 'Track', lyrics: 'Line 1', syncedLyrics: [{ time: 1, text: 'Line 1' }] }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEditSyncedLyrics={onEditSyncedLyrics}
      />,
    );
    expect(screen.getByLabelText(/lyrics/i)).toBeTruthy();
    expect(screen.getByText('1 synced lines')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /edit synced lyrics/i }));
    expect(onEditSyncedLyrics).toHaveBeenCalledTimes(1);
  });

  it('renders album tag fields and calls onSave', () => {
    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="album"
        entity={{ id: '2', title: 'Album', albumArtist: 'Album Artist' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Album' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Album', albumArtist: ['Album Artist'] }));
  });

  it('renders playlist fields and calls onSave', () => {
    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="playlist"
        entity={{ id: '3', name: 'Playlist', visibility: 'private' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'New Playlist' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Playlist' }));
  });

  it('renders smart playlist editor only when playlist is smart', () => {
    const onSave = vi.fn();
    const rules = { rules: { all: [{ field: 'title', operator: 'contains', value: 'rock' }] } };
    render(
      <EditEntityModal
        open
        entityType="playlist"
        entity={{ id: '4', name: 'Smart', visibility: 'private', isSmart: true, rules }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/match/i)).toBeTruthy();
    expect(screen.getByDisplayValue('rock')).toBeTruthy();
  });

  it('does not render smart playlist editor for regular playlist', () => {
    render(
      <EditEntityModal
        open
        entityType="playlist"
        entity={{ id: '5', name: 'Regular', visibility: 'private', isSmart: false }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText(/match/i)).toBeFalsy();
  });

  it('calls onDelete only after confirm', () => {
    const onDelete = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '6', title: 'Track' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does not call onDelete when confirm is cancelled', () => {
    const onDelete = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '7', title: 'Track' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '8', title: 'Track' }}
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <EditEntityModal
        open={false}
        entityType="song"
        entity={{ id: '9', title: 'Track' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeFalsy();
  });

  it('disables save and delete while saving or deleting', () => {
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '10', title: 'Track' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        saving
        deleting
      />,
    );
    expect(screen.getByRole('button', { name: /save/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /delete/i }).hasAttribute('disabled')).toBe(true);
  });

  it('renders artist in read-only mode without save or delete', () => {
    const onClose = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="artist"
        entity={{ id: '11', name: 'Read Only Artist' }}
        onClose={onClose}
        readOnly
      />,
    );
    expect(screen.getByText('Read Only Artist')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /save/i })).toBeFalsy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeFalsy();
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const footerClose = closeButtons.find((b) => b.textContent === 'Close');
    expect(footerClose).toBeTruthy();
    fireEvent.click(footerClose!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows cover art edit and delete buttons on hover', () => {
    const onEditCoverArt = vi.fn();
    const onDeleteCoverArt = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="album"
        entity={{ id: '12', title: 'Album', coverArt: 'cover-1' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEditCoverArt={onEditCoverArt}
        onDeleteCoverArt={onDeleteCoverArt}
      />,
    );
    const cover = screen.getByAltText(/cover art/i).parentElement;
    expect(cover).toBeTruthy();
    fireEvent.mouseEnter(cover!);
    fireEvent.click(screen.getByRole('button', { name: /change cover art/i }));
    expect(onEditCoverArt).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /remove cover art/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(onDeleteCoverArt).toHaveBeenCalledTimes(1);
  });

  it('hides cover art edit controls in read-only mode', () => {
    render(
      <EditEntityModal
        open
        entityType="album"
        entity={{ id: '13', title: 'Album', coverArt: 'cover-1' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEditCoverArt={vi.fn()}
        onDeleteCoverArt={vi.fn()}
        readOnly
      />,
    );
    expect(screen.queryByRole('button', { name: /change cover art/i })).toBeFalsy();
    expect(screen.queryByRole('button', { name: /remove cover art/i })).toBeFalsy();
  });

  it('hides cover art delete button when there is no cover art', () => {
    render(
      <EditEntityModal
        open
        entityType="album"
        entity={{ id: '14', title: 'Album' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onEditCoverArt={vi.fn()}
        onDeleteCoverArt={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /remove cover art/i })).toBeFalsy();
    expect(screen.getByRole('button', { name: /change cover art/i })).toBeTruthy();
  });

  it('opens MusicBrainz fetch modal and applies fetched metadata', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          matches: [{ id: 'mb-1', title: 'Fetched Title', artist: 'Fetched Artist' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '15', title: 'Track', artist: 'Artist' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /musicbrainz/i }));
    await waitFor(() => expect(screen.queryByText(/searching musicbrainz/i)).toBeFalsy());

    fireEvent.click(screen.getAllByTitle('Transfer value')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fetched Title', artist: ['Artist'] }));
  });

  it('renders multi-value artist and genre as pills', () => {
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '16', title: 'Track', artists: ['Artist A', 'Artist B'], genres: ['Rock', 'Pop'] }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Artist A')).toBeTruthy();
    expect(screen.getByText('Artist B')).toBeTruthy();
    expect(screen.getByText('Rock')).toBeTruthy();
    expect(screen.getByText('Pop')).toBeTruthy();
  });

  it('removes a pill when its remove button is clicked', () => {
    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '17', title: 'Track', artists: ['Artist A', 'Artist B'] }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove Artist B/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ artist: ['Artist A'] }));
  });

  it('clears the autocomplete input after selecting a genre suggestion', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/suggestions?field=genre')) {
        return new Response(JSON.stringify({ suggestions: ['Rock', 'Pop'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '18', title: 'Track' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    const genreInput = screen.getByPlaceholderText('Genre');
    fireEvent.focus(genreInput);
    fireEvent.change(genreInput, { target: { value: 'Roc' } });

    await waitFor(() => expect(screen.getAllByText('Rock').length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getAllByText('Rock')[0]);
    expect(screen.getByRole('button', { name: 'Remove Rock' })).toBeTruthy();
    expect((genreInput as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(screen.queryByText('Pop')).toBeFalsy());
  });

  it('does not render the album artist field for songs', () => {
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '19', title: 'Track', albumArtist: 'Album Artist' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/album artist/i)).toBeFalsy();
  });

  it('renders a file path info button for songs with a file path', () => {
    render(
      <EditEntityModal
        open
        entityType="song"
        entity={{ id: '20', title: 'Track', filePath: '/music/artist/album/track.mp3' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /show file path/i })).toBeTruthy();
  });
});
