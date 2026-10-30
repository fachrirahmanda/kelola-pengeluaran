-- Time of day a transaction was made (HH:MM). Optional: older transactions have none.
ALTER TABLE transactions ADD COLUMN occurred_time TEXT CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]');
