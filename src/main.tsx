import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./ui";
import { UpdateProvider } from "./UpdateSettings";
import { RentalSelectionProvider } from "./RentalSelection";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <UpdateProvider><RentalSelectionProvider><App /></RentalSelectionProvider></UpdateProvider>
    </ToastProvider>
  </React.StrictMode>,
);
