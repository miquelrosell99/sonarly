import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { PlayButton } from './PlayButton.js';

describe('PlayButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('calls onPlay on quick click', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('calls onShufflePlay after holding 500 ms', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(button);

    expect(onShufflePlay).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('does not call anything when pointer leaves before threshold', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerLeave(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onPlay).not.toHaveBeenCalled();
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('stops pointer event propagation so parent click handlers are not triggered', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    const parentPointerDown = vi.fn();
    const parentPointerUp = vi.fn();

    render(
      <div onPointerDown={parentPointerDown} onPointerUp={parentPointerUp}>
        <PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />
      </div>,
    );

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentPointerUp).not.toHaveBeenCalled();
  });

  it('does not call anything when pointer is cancelled before threshold', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerCancel(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onPlay).not.toHaveBeenCalled();
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('does not call anything on non-primary pointer up', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button, { button: 2 });
    fireEvent.pointerUp(button, { button: 2 });

    expect(onPlay).not.toHaveBeenCalled();
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('uses the visible text as the accessible name when label is absent', () => {
    render(
      <PlayButton onPlay={vi.fn()} onShufflePlay={vi.fn()}>
        Play all
      </PlayButton>,
    );

    expect(screen.getByRole('button', { name: 'Play all (hold to shuffle)' })).toBeTruthy();
  });

  it('uses the provided label verbatim as the accessible name', () => {
    render(<PlayButton onPlay={vi.fn()} onShufflePlay={vi.fn()} label="Alpha" />);

    expect(screen.getByRole('button', { name: 'Alpha (hold to shuffle)' })).toBeTruthy();
  });

  it('falls back to a simple button without hold behavior when onShufflePlay is absent', () => {
    const onPlay = vi.fn();
    render(<PlayButton onPlay={onPlay}>Play all</PlayButton>);

    const button = screen.getByRole('button', { name: 'Play all' });
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('does not trigger shuffle when onShufflePlay is absent', () => {
    const onPlay = vi.fn();
    render(<PlayButton onPlay={onPlay} label="Play" />);

    const button = screen.getByRole('button', { name: 'Play' });
    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(button);

    expect(onPlay).not.toHaveBeenCalled();
  });

  it('calls onPlay when activated via keyboard Enter with onShufflePlay', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('calls onPlay when activated via keyboard Space with onShufflePlay', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).not.toHaveBeenCalled();
  });

  it('calls onPlay when activated via keyboard Enter without onShufflePlay', () => {
    const onPlay = vi.fn();
    render(<PlayButton onPlay={onPlay} label="Play" />);

    const button = screen.getByRole('button', { name: 'Play' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('calls onPlay when activated via keyboard Space without onShufflePlay', () => {
    const onPlay = vi.fn();
    render(<PlayButton onPlay={onPlay} label="Play" />);

    const button = screen.getByRole('button', { name: 'Play' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire onPlay when a synthetic click follows a pointer click', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    render(<PlayButton onPlay={onPlay} onShufflePlay={onShufflePlay} label="Play" />);

    const button = screen.getByRole('button', { name: /Play/ });
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).not.toHaveBeenCalled();
  });
});
