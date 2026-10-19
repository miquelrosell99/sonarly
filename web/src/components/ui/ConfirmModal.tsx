import { Modal } from './Modal.js';
import { Button } from './button.js';

// Confirm dialog composed on the app Modal — NOT the Radix alert-dialog.
// The overlay-authority register (.agents/design-overrides.md) keeps the app
// Modal as the dialog authority: ConfirmModal legitimately stacks as a
// sibling over edit Modals (FF11) and must keep the underneath layer
// accessible, which Radix modal semantics (topmost-only a11y tree) cannot
// express. The catalog alert-dialog is for new surfaces that never stack.

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-on-surface-variant">{message}</p>
    </Modal>
  );
}
