import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ControlButton, Slider } from './PlayerControls.js';

afterEach(cleanup);

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

describe('Slider', () => {
  it('renders a range input with its aria attributes and current value', () => {
    render(
      <Slider
        min={0}
        max={200}
        step={0.1}
        value={50}
        onChange={() => {}}
        variant="progress"
        ariaLabel="Seek"
        ariaValueText="0:50 of 3:20"
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('50');
    expect(slider.getAttribute('aria-valuetext')).toBe('0:50 of 3:20');
  });

  it('reports parsed numeric changes', () => {
    const onChange = vi.fn();
    render(<Slider min={0} max={200} step={0.1} value={50} onChange={onChange} ariaLabel="Seek" />);
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '75.5' } });
    expect(onChange).toHaveBeenCalledWith(75.5);
  });

  it('exposes the filled portion as the --slider-fill percentage of min..max', () => {
    render(<Slider min={0} max={1} step={0.01} value={0.25} onChange={() => {}} ariaLabel="Volume" />);
    const slider = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(slider.style.getPropertyValue('--slider-fill')).toBe('25%');
  });

  it('maps a non-zero min correctly', () => {
    render(<Slider min={10} max={20} step={1} value={15} onChange={() => {}} ariaLabel="Volume" />);
    const slider = screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement;
    expect(slider.style.getPropertyValue('--slider-fill')).toBe('50%');
  });

  it('marks the slider disabled', () => {
    render(<Slider min={0} max={1} step={0.01} value={0} onChange={() => {}} ariaLabel="Seek" disabled />);
    const slider = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(slider.className).toContain('disabled:opacity-50');
  });
});
