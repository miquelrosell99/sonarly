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
});
