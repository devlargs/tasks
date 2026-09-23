import { useEffect, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  // Red confirm button, and Cancel takes the first focus, so an Enter pressed
  // out of habit doesn't destroy anything
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A modal yes/no. Built on <dialog> opened with showModal(): the browser traps
// focus inside it, makes the page behind it inert and closes it on Escape —
// and unlike window.confirm() it doesn't freeze the page or look like an error.
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    (destructive ? cancelRef : confirmRef).current?.focus();
    return () => dialog.close();
  }, [destructive]);

  return (
    <dialog
      ref={dialogRef}
      className="todo-confirm"
      aria-labelledby="todo-confirm-title"
      // Escape fires "cancel"; the parent unmounts the dialog instead of the
      // browser closing it under React
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // The <dialog> has no padding, so a press that lands on it rather than
      // on the panel inside was on the backdrop
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="todo-confirm-panel">
        <h2 id="todo-confirm-title" className="todo-confirm-title">
          {title}
        </h2>
        <div className="todo-confirm-body">{children}</div>
        <div className="todo-confirm-actions">
          <button ref={cancelRef} type="button" className="todo-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`todo-confirm-ok ${destructive ? "todo-confirm-ok-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
