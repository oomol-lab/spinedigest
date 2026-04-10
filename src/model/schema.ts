export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS serial_states (
    serial_id INTEGER PRIMARY KEY,
    topology_ready INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    FOREIGN KEY (serial_id) REFERENCES serials(id)
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    generation INTEGER NOT NULL,
    serial_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    retention TEXT,
    importance TEXT,
    tokens INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0.0
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_sentence
  ON chunks(serial_id, fragment_id, sentence_index);

  CREATE TABLE IF NOT EXISTS chunk_sentences (
    chunk_id INTEGER NOT NULL,
    serial_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    sentence_index INTEGER NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    PRIMARY KEY (chunk_id, serial_id, fragment_id, sentence_index)
  );

  CREATE TABLE IF NOT EXISTS knowledge_edges (
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    strength TEXT,
    weight REAL NOT NULL DEFAULT 0.1,
    PRIMARY KEY (from_id, to_id),
    FOREIGN KEY (from_id) REFERENCES chunks(id),
    FOREIGN KEY (to_id) REFERENCES chunks(id)
  );

  CREATE TABLE IF NOT EXISTS snakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    local_snake_id INTEGER NOT NULL,
    size INTEGER NOT NULL,
    first_label TEXT NOT NULL,
    last_label TEXT NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0.0,
    UNIQUE(serial_id, group_id, local_snake_id)
  );

  CREATE TABLE IF NOT EXISTS snake_chunks (
    snake_id INTEGER NOT NULL,
    chunk_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (snake_id) REFERENCES snakes(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    PRIMARY KEY (snake_id, chunk_id)
  );

  CREATE TABLE IF NOT EXISTS snake_edges (
    from_snake_id INTEGER NOT NULL,
    to_snake_id INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 0.1,
    PRIMARY KEY (from_snake_id, to_snake_id),
    FOREIGN KEY (from_snake_id) REFERENCES snakes(id),
    FOREIGN KEY (to_snake_id) REFERENCES snakes(id)
  );

  CREATE TABLE IF NOT EXISTS fragment_groups (
    serial_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    fragment_id INTEGER NOT NULL,
    PRIMARY KEY (serial_id, group_id, fragment_id)
  );
`;
