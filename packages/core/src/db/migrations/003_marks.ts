/**
 * Marks: saved spans of a document (text or a region screenshot). Removing a document removes its
 * marks; the screenshot files under .point/captures are never touched by the database.
 */
export default `
CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  anchor_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS marks_by_doc ON marks(doc_id, created_at);
`;
