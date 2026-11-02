import { X } from 'lucide-react';

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmIcon: ConfirmIcon,
  onConfirm,
  onCancel,
  loading = false,
  intent = 'danger',
}) {
  if (!open) {
    return null;
  }

  const confirmButtonClass =
    intent === 'success'
      ? 'bg-emerald-950 hover:bg-emerald-900'
      : 'bg-rose-600 hover:bg-rose-700';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-emerald-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[1.75rem] border border-emerald-900/10 bg-[#fbfaf7] p-5 shadow-2xl shadow-emerald-950/25 sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-emerald-900/10 pb-4">
          <div>
            <p className="section-label">Please confirm</p>
            <h2 className="section-heading mt-2">{title}</h2>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/65 transition hover:bg-emerald-50 hover:text-emerald-950"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-5 text-sm leading-6 text-emerald-900/70">{description}</p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center rounded-2xl border border-emerald-900/10 bg-white px-5 py-3 text-sm font-medium text-emerald-900/70 transition hover:bg-emerald-50 hover:text-emerald-950"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmButtonClass}`}
          >
            {ConfirmIcon && <ConfirmIcon className="h-4 w-4" />}
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}