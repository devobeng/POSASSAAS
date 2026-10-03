import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../Modal';

describe('Modal accessibility', () => {
  it('exposes dialog semantics and labels the dialog by its title', () => {
    render(
      <Modal open onClose={vi.fn()} onConfirm={vi.fn()} title="Delete product?" description="This cannot be undone." />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Delete product?');
  });

  it('moves focus into the dialog on open and restores it to the trigger on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Modal open={open} onClose={() => setOpen(false)} onConfirm={vi.fn()} title="Confirm" />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    await user.click(trigger);

    expect(document.activeElement).not.toBe(trigger);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab within the dialog\'s focusable elements', async () => {
    const user = userEvent.setup();
    render(<Modal open onClose={vi.fn()} onConfirm={vi.fn()} title="Confirm" cancelLabel="Cancel" confirmLabel="Delete" />);

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });

    // Focus starts on the first focusable element (Cancel)
    expect(document.activeElement).toBe(cancelBtn);

    await user.tab();
    expect(document.activeElement).toBe(confirmBtn);

    // Tabbing past the last element wraps back to the first, never escaping
    // to the (dimmed) page behind the dialog.
    await user.tab();
    expect(document.activeElement).toBe(cancelBtn);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open onClose={onClose} onConfirm={vi.fn()} title="Confirm" />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={vi.fn()} onConfirm={vi.fn()} title="Confirm" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
