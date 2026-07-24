import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EditEntityModal } from './EditEntityModal.js';

afterEach(() => cleanup());

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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
  });

  it('renders album tag fields and calls onSave', () => {
    const onSave = vi.fn();
    render(
      <EditEntityModal
        open
        entityType="album"
        entity={{ id: '2', title: 'Album', artist: 'Album Artist' }}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New Album' } });
    fireEvent.change(screen.getByLabelText(/album artist/i), { target: { value: 'New Artist' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Album', albumArtist: 'New Artist' }));
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
    fireEvent.change(screen.getByLabelText(/visibility/i), { target: { value: 'public' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Playlist', visibility: 'public' }));
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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
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
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('does not call onDelete when confirm is cancelled', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
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
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
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
});
