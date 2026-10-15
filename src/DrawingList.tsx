import { useEffect, useState } from "react";
import type { DrawingMeta } from "../shared/protocol";
import { api } from "./api";
import { getDeviceName, setDeviceName } from "./device";
import { navigate } from "./router";

export function DrawingList() {
  const [drawings, setDrawings] = useState<DrawingMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceNameState] = useState(getDeviceName);

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    run(async () => setDrawings(await api.listDrawings()));
  }, []);

  const create = () =>
    run(async () => {
      const title = prompt("Name the new drawing", "Untitled");
      if (title === null) return;
      const drawing = await api.createDrawing(title);
      navigate(`/d/${drawing.id}`);
    });

  const rename = (d: DrawingMeta) =>
    run(async () => {
      const title = prompt("Rename drawing", d.title);
      if (!title?.trim() || title === d.title) return;
      const updated = await api.renameDrawing(d.id, title);
      setDrawings((list) => list?.map((x) => (x.id === d.id ? updated : x)) ?? null);
    });

  const remove = (d: DrawingMeta) =>
    run(async () => {
      if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
      await api.deleteDrawing(d.id);
      setDrawings((list) => list?.filter((x) => x.id !== d.id) ?? null);
    });

  const saveDeviceName = () => {
    setDeviceName(deviceName);
    setDeviceNameState(getDeviceName());
  };

  return (
    <div className="page">
      <header className="list-header">
        <h1>Drawings</h1>
        <button className="primary" onClick={create}>
          New drawing
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {!drawings && !error && <p className="muted">Loading…</p>}
      {drawings?.length === 0 && <p className="muted">No drawings yet.</p>}

      <ul className="drawings">
        {drawings?.map((d) => (
          <li key={d.id}>
            <a
              href={`/d/${d.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/d/${d.id}`);
              }}
            >
              <span className="name">{d.title}</span>
              <span className="muted">{new Date(d.updatedAt).toLocaleString()}</span>
            </a>
            <button onClick={() => rename(d)}>Rename</button>
            <button className="danger" onClick={() => remove(d)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <footer className="device">
        <label>
          This device is shown to others as{" "}
          <input value={deviceName} onChange={(e) => setDeviceNameState(e.target.value)} onBlur={saveDeviceName} />
        </label>
      </footer>
    </div>
  );
}
