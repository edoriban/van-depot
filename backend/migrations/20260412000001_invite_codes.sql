ALTER TABLE users
  ADD COLUMN invite_code_hash VARCHAR(255),
  ADD COLUMN invite_expires_at TIMESTAMPTZ,
  ADD COLUMN must_set_password BOOLEAN NOT NULL DEFAULT false;
