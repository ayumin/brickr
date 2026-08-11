import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";
import { applyTheme, readPreferredTheme } from "./services/theme";

applyTheme(readPreferredTheme());

const container = document.getElementById("root");

if (!container) {
  throw new Error("#root element was not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
