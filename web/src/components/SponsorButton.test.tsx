import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SponsorButton } from './SponsorButton.js';

const mockUpdatePreferencesMutate = vi.hoisted(() => vi.fn());
const mockPreferences = vi.hoisted(() => ({
  hideSponsorButton: false,
}));

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: mockPreferences }),
  useUpdatePreferences: () => ({ mutate: mockUpdatePreferencesMutate }),
}));

beforeEach(() => {
  mockPreferences.hideSponsorButton = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SponsorButton', () => {
  it('renders the support button when not hidden', () => {
    render(<SponsorButton />);
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });

  it('does not render when hidden by preference', () => {
    mockPreferences.hideSponsorButton = true;
    render(<SponsorButton />);
    expect(screen.queryByRole('button', { name: /support sonarly/i })).toBeNull();
  });

  it('opens the support modal on click', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/support sonarly/i)).toBeTruthy();
  });

  it('closes the modal when Close is clicked', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('updates preferences and hides when "Don\'t show again" is clicked', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    fireEvent.click(screen.getByRole('button', { name: /don't show/i }));
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ hideSponsorButton: true });
  });
});
