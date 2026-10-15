import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { DrawingList } from "./DrawingList";
import { Editor } from "./Editor";
import { usePathname } from "./router";

function App() {
  const path = usePathname();
  const drawing = path.match(/^\/d\/([\w-]+)$/);
  // Keyed so switching drawings remounts the editor and its lock connection.
  return drawing ? <Editor key={drawing[1]} id={drawing[1]} /> : <DrawingList />;
}

createRoot(document.getElementById("root")!).render(<App />);
