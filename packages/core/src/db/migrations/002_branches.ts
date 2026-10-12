/**
 * Branching conversations: messages form a tree via parent_id; branch_origin records which
 * span of an assistant answer a branch was forked from. Existing messages become one
 * linear chain per conversation, ordered by created_at then id.
 */
export default `
ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN parts_json TEXT;
CREATE INDEX IF NOT EXISTS messages_by_parent ON messages(parent_id);
UPDATE messages SET parent_id = (
  SELECT p.id FROM messages p
  WHERE p.conversation_id = messages.conversation_id
    AND (p.created_at < messages.created_at OR (p.created_at = messages.created_at AND p.id < messages.id))
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
);
CREATE TABLE IF NOT EXISTS branch_origin (
  child_msg_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  source_msg_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  quote TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS branch_origin_by_source ON branch_origin(source_msg_id);
`;
