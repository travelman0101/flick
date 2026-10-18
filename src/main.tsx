import { createRoot } from "react-dom/client";
import { App } from "./App";
import { start } from "./store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
void start();
