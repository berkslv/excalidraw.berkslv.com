import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { DrawingList } from "./DrawingList";
import { Editor } from "./Editor";
import { usePathname } from "./router";
import { SharedView } from "./SharedView";

function App() {
  const path = usePathname();
  const shared = path.match(/^\/s\/([\w-]+)\/?$/);
  if (shared) return <SharedView token={shared[1]} />;
  const drawing = path.match(/^\/d\/([\w-]+)$/);
  // Keyed so switching drawings remounts the editor and its lock connection.
  return drawing ? <Editor key={drawing[1]} id={drawing[1]} /> : <DrawingList />;
}

createRoot(document.getElementById("root")!).render(<App />);
