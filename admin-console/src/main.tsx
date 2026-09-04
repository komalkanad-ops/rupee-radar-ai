import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "./index.css";

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>
);
