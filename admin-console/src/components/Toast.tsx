import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

interface ToastItem {
  id: number;
  message: string;
  kind: "success" | "error";
}

interface ToastContextValue {
  show: (message: string, kind?: "success" | "error") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, kind: "success" | "error" = "success") => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.kind === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"
            }`}
          >
            {t.kind === "success" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
