import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./ui";
import { UpdateProvider } from "./UpdateSettings";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <UpdateProvider><App /></UpdateProvider>
    </ToastProvider>
  </React.StrictMode>,
);
