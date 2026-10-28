CREATE TABLE IF NOT EXISTS catalog_summaries (
  generation TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  dataset_id TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (length(summary_json) <= 65536),
  PRIMARY KEY (generation, ordinal),
  UNIQUE (generation, dataset_id)
);
