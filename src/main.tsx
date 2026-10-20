import { createRoot } from "react-dom/client";
import { App } from "./App";
import { start } from "./store";
import "./styles.css";
import { watchForUpdates } from "./updates";

createRoot(document.getElementById("root")!).render(<App />);
void start();
watchForUpdates();
