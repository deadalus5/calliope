import { dismissToast, useToasts } from '../../state/toasts'
import './toast.css'

/**
 * Fixed toast stack, mounted once in the app shell (outside the start-gate
 * conditional so it can surface pre-gate failures too). Restrained: a small
 * dim panel per toast, simple fade, no other animation.
 */
export function ToastHost() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action?.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-dismiss" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
