import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TimerScene from "./TimerScene.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TimerScene />
  </React.StrictMode>
);
