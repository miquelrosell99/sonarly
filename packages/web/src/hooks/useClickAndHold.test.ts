import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClickAndHold } from './useClickAndHold.js';

describe('useClickAndHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onClick on a quick pointer up', () => {
    const onClick = vi.fn();
    const onHold = vi.fn();
    const { result } = renderHook(() => useClickAndHold({ onClick, onHold }));

    act(() => {
      result.current.handlers.onPointerDown({ button: 0 } as React.PointerEvent);
    });
    act(() => {
      const button = document.createElement('button');
      result.current.handlers.onPointerUp({ currentTarget: button, target: button } as unknown as React.PointerEvent);
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('calls onHold after the threshold and not onClick', () => {
    const onClick = vi.fn();
    const onHold = vi.fn();
    const { result } = renderHook(() => useClickAndHold({ onClick, onHold, threshold: 500 }));

    act(() => {
      result.current.handlers.onPointerDown({ button: 0 } as React.PointerEvent);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onHold).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handlers.onPointerUp({ currentTarget: document.createElement('button'), target: document.createElement('button') } as unknown as React.PointerEvent);
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('cancels when pointer leaves before threshold', () => {
    const onClick = vi.fn();
    const onHold = vi.fn();
    const { result } = renderHook(() => useClickAndHold({ onClick, onHold }));

    act(() => {
      result.current.handlers.onPointerDown({ button: 0 } as React.PointerEvent);
    });
    act(() => {
      result.current.handlers.onPointerLeave();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount so onHold is not called later', () => {
    const onClick = vi.fn();
    const onHold = vi.fn();
    const { result, unmount } = renderHook(() => useClickAndHold({ onClick, onHold }));

    act(() => {
      result.current.handlers.onPointerDown({ button: 0 } as React.PointerEvent);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onHold).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('cancels when pointer is cancelled before threshold', () => {
    const onClick = vi.fn();
    const onHold = vi.fn();
    const { result } = renderHook(() => useClickAndHold({ onClick, onHold }));

    act(() => {
      result.current.handlers.onPointerDown({ button: 0 } as React.PointerEvent);
    });
    act(() => {
      result.current.handlers.onPointerCancel();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });
});
