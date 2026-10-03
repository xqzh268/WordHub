import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts";
import "./styles/punct.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/sessions.css";
import "./styles/chat.css";
import "./styles/paper.css";
import "./styles/pages.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
