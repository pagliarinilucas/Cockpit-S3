import { ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast { id: number; msg: string; kind: ToastKind; }

const toasts = ref<Toast[]>([]);
let seq = 0;

export function useToast() {
  const push = (msg: string, kind: ToastKind = 'info') => {
    const id = ++seq;
    toasts.value = [...toasts.value, { id, msg, kind }];
    setTimeout(() => dismiss(id), 3400);
  };
  const dismiss = (id: number) => { toasts.value = toasts.value.filter((t) => t.id !== id); };
  return {
    toasts,
    info: (m: string) => push(m, 'info'),
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error'),
    dismiss,
  };
}
