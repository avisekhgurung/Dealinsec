import { CheckCircle, AlertCircle, Info } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

function ToastIcon({ variant }: { variant?: string }) {
  if (variant === "destructive") {
    return <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
  }
  if (variant === "success") {
    return <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
  }
  return <Info className="w-5 h-5 text-primary shrink-0" />
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <ToastIcon variant={props.variant as string} />
            <div className="grid gap-0.5 flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
