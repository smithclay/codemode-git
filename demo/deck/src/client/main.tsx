import { createRoot } from "react-dom/client";
import { DeckApp } from "./Deck";
import "../design/tokens.css";
import "../design/slide.css";
import "../design/deck.css";

createRoot(document.getElementById("root")!).render(<DeckApp />);
