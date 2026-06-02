import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FloatingPanel } from "./components/FloatingPanel";
import { AppPickerWindow } from "./components/AppPickerWindow";
import { SettingsWindow } from "./components/SettingsWindow";
import { TodoWindow } from "./components/TodoWindow";

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    const label = getCurrentWebviewWindow().label;
    setWindowLabel(label);

    const logFatal = (message: string) => {
      invoke("log_from_frontend", { level: "error", message }).catch(() => {});
    };
    const handleError = (event: ErrorEvent) => {
      logFatal(
        `[App:${label}] window error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
      );
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      logFatal(`[App:${label}] unhandled rejection: ${String(event.reason)}`);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  if (windowLabel === null) return null; // Still resolving.

  if (windowLabel.startsWith("app-picker")) {
    return <AppPickerWindow />;
  }

  if (windowLabel === "settings") {
    return <SettingsWindow />;
  }

  if (windowLabel.startsWith("space-todo-") || windowLabel === "todos-overview") {
    return <TodoWindow />;
  }

  return <FloatingPanel />;
}

export default App;
