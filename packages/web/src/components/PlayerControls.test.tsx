import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControlButton } from './PlayerControls.js';

describe('ControlButton', () => {
  it('renders in an inactive visual state by default', () => {
    render(<ControlButton onClick={() => {}} label="Inactive">icon</ControlButton>);
    const button = screen.getByRole('button', { name: 'Inactive' });
    expect(button.className).toContain('text-fg-secondary');
    expect(button.className).not.toContain('text-accent');
    expect(button.className).not.toContain('bg-accent/15');
  });

  it('renders in an active visual state when active is true', () => {
    render(
      <ControlButton onClick={() => {}} label="Active" active>
        icon
      </ControlButton>,
    );
    const button = screen.getByRole('button', { name: 'Active' });
    expect(button.className).toContain('text-accent');
    expect(button.className).toContain('bg-accent/15');
    expect(button.className).not.toContain('text-fg-secondary');
  });
});
