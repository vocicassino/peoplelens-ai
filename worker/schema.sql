CREATE TABLE IF NOT EXISTS nodes (
  room TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (room, node_id)
);
CREATE INDEX IF NOT EXISTS idx_nodes_room_seen ON nodes(room, last_seen DESC);
