-- Public view-only links. At most one per drawing; deleting the row revokes it.
CREATE TABLE shares (
  token      TEXT PRIMARY KEY,
  drawing_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
