/**
 * App toasts — Base UI only (no Sonner).
 * Use for success / warning / error feedback in the shell and pages.
 */
import { toast } from "@/components/ui/toast";

export function appToastSuccess(title: string, description?: string, timeout = 2000) {
  toast.add({
    title,
    description,
    type: "success",
    timeout,
  });
}

export function appToastWarning(title: string, description?: string, timeout = 4000) {
  toast.add({
    title,
    description,
    type: "warning",
    timeout,
  });
}

/** Errors use the same Base UI toaster (not Sonner). */
export function appToastError(title: string, description?: string, timeout = 4500) {
  toast.add({
    title,
    description,
    type: "warning",
    timeout,
  });
}

export function appToastInfo(title: string, description?: string, timeout = 3000) {
  toast.add({
    title,
    description,
    timeout,
  });
}
