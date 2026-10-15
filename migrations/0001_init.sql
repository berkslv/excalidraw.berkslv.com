CREATE TABLE drawings (
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_drawings_owner ON drawings (owner_email, updated_at DESC);
