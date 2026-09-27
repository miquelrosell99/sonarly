import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SponsorButton } from './SponsorButton.js';

const mockUpdatePreferencesMutate = vi.hoisted(() => vi.fn());
const mockPreferencesState = vi.hoisted(() => ({
  // undefined models the guest / pre-login state: no server document.
  data: { supportHidden: false } as { supportHidden?: boolean } | undefined,
}));

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: mockPreferencesState.data }),
  useUpdatePreferences: () => ({ mutate: mockUpdatePreferencesMutate }),
}));

beforeEach(() => {
  mockPreferencesState.data = { supportHidden: false };
  mockUpdatePreferencesMutate.mockImplementation(() => {
    // Mirror useUpdatePreferences' onSuccess cache seed so the icon reacts.
    if (mockPreferencesState.data) mockPreferencesState.data.supportHidden = true;
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SponsorButton (logged in: server preference owns the state)', () => {
  it('renders the support button when not hidden', () => {
    render(<SponsorButton />);
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });

  it('does not render when hidden by the server preference', () => {
    mockPreferencesState.data = { supportHidden: true };
    render(<SponsorButton />);
    expect(screen.queryByRole('button', { name: /support sonarly/i })).toBeNull();
  });

  it('opens the support modal with the external GitHub Sponsors link', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    const link = screen.getByRole('link', { name: /open sponsors/i });
    expect(link.getAttribute('href')).toBe('https://github.com/sponsors/miquelrosell99');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('closes the modal on Close without persisting anything', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockUpdatePreferencesMutate).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('supportHidden')).toBeNull();
    // The icon stays: Close is not a dismissal.
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });

  it('PATCHes the server preference and hides when "Don\'t show again" is clicked', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    fireEvent.click(screen.getByRole('button', { name: /don't show again/i }));
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ supportHidden: true });
    expect(window.localStorage.getItem('supportHidden')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /support sonarly/i })).toBeNull();
  });

  it('server preference wins over a stale guest dismissal in localStorage', () => {
    window.localStorage.setItem('supportHidden', 'true');
    render(<SponsorButton />);
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });
});

describe('SponsorButton (guest: localStorage fallback, same key name)', () => {
  beforeEach(() => {
    mockPreferencesState.data = undefined;
  });

  it('renders the button when localStorage is empty', () => {
    render(<SponsorButton />);
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });

  it('does not render when localStorage carries supportHidden=true', () => {
    window.localStorage.setItem('supportHidden', 'true');
    render(<SponsorButton />);
    expect(screen.queryByRole('button', { name: /support sonarly/i })).toBeNull();
  });

  it('ignores corrupt localStorage values (validated read)', () => {
    window.localStorage.setItem('supportHidden', '{"oops":true}');
    render(<SponsorButton />);
    expect(screen.getByRole('button', { name: /support sonarly/i })).toBeTruthy();
  });

  it('persists the dismissal to localStorage and hides the icon', () => {
    render(<SponsorButton />);
    fireEvent.click(screen.getByRole('button', { name: /support sonarly/i }));
    fireEvent.click(screen.getByRole('button', { name: /don't show again/i }));
    expect(mockUpdatePreferencesMutate).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('supportHidden')).toBe('true');
    expect(screen.queryByRole('button', { name: /support sonarly/i })).toBeNull();
  });
});
