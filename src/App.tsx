import { useEffect, useState } from "react";
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
