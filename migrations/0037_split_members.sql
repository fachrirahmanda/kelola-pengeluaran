-- A split bill person can be a registered account (the owner, or a member). Recording a bill makes one expense per such person;
-- split_records keeps which person and which transaction it became, so a person is recorded once.
ALTER TABLE split_people ADD COLUMN member_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE split_records (
  split_id TEXT NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES split_people(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (split_id, person_id)
);
