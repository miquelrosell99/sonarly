import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Modal } from './Modal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Modal (FF11 aria-labelledby scoping)', () => {
  it('scopes the title id per modal instance', () => {
    render(
      <>
        <Modal open onClose={() => {}} title="First">
          <p>one</p>
        </Modal>
        <Modal open onClose={() => {}} title="Second">
          <p>two</p>
        </Modal>
      </>,
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);

    const labelledBy = dialogs.map((dialog) => dialog.getAttribute('aria-labelledby'));
    // No duplicate ids across simultaneously open modals.
    expect(new Set(labelledBy).size).toBe(2);
    expect(labelledBy.every((id) => Boolean(id))).toBe(true);

    // Each dialog labels itself by its own title heading.
    const headings = screen.getAllByRole('heading', { level: 3 });
    const headingIds = headings.map((heading) => heading.id);
    expect(new Set(headingIds).size).toBe(2);
    for (const id of labelledBy) {
      expect(headingIds).toContain(id);
    }
  });
});
