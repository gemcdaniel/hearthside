import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nestedRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(dialogRef, {
    active: open,
    onEscape: () => setOpen(false),
    returnFocusRef: triggerRef,
  });

  useFocusTrap(nestedRef, {
    active: nestedOpen,
    onEscape: () => setNestedOpen(false),
  });

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open Dialog
      </button>

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Outer Dialog"
          tabIndex={-1}
        >
          <button type="button">First</button>
          <button type="button" onClick={() => setNestedOpen(true)}>
            Open Nested
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Close Outer
          </button>
        </div>
      ) : null}

      {nestedOpen ? (
        <div
          ref={nestedRef}
          role="dialog"
          aria-modal="true"
          aria-label="Nested Dialog"
          tabIndex={-1}
        >
          <button type="button" onClick={() => setNestedOpen(false)}>
            Close Nested
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(() => {
    cleanup();
  });

  it('moves initial focus inside, wraps Tab and Shift+Tab, and restores focus on Escape', () => {
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: 'Open Dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const firstBtn = screen.getByRole('button', { name: 'First' });
    const closeOuterBtn = screen.getByRole('button', { name: 'Close Outer' });
    expect(document.activeElement).toBe(firstBtn);

    // Shift+Tab from first wraps to last focusable element
    fireEvent.keyDown(document, { key: 'Shift', shiftKey: true });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeOuterBtn);

    // Tab from last wraps back to first focusable element
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(firstBtn);

    // Escape closes dialog and restores focus to trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Outer Dialog' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('gives Escape precedence to topmost stacked dialog', () => {
    render(<DialogHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Dialog' }));
    const openNestedBtn = screen.getByRole('button', { name: 'Open Nested' });
    openNestedBtn.focus();
    fireEvent.click(openNestedBtn);

    expect(screen.getByRole('dialog', { name: 'Nested Dialog' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Nested' }));

    // First Escape closes only the nested dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Nested Dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Outer Dialog' })).toBeInTheDocument();
    expect(document.activeElement).toBe(openNestedBtn);

    // Second Escape closes the outer dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Outer Dialog' })).not.toBeInTheDocument();
  });
});
