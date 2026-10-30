-- The bank or e-wallet a source belongs to (an id from src/shared/banks.ts). Optional.
ALTER TABLE payment_sources ADD COLUMN bank TEXT;
