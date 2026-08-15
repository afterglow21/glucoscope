PRAGMA foreign_keys = ON;

-- The buyer confirmation belongs to the adult who manages the Plus account.
-- Do not add a child name, birth date, display name, glucose value, or CGM field.
ALTER TABLE accounts ADD COLUMN buyer_role TEXT CHECK (
  buyer_role IS NULL OR buyer_role IN ('self', 'guardian')
);
ALTER TABLE accounts ADD COLUMN buyer_confirmation_version TEXT CHECK (
  buyer_confirmation_version IS NULL
  OR length(buyer_confirmation_version) = 10
);
ALTER TABLE accounts ADD COLUMN adult_confirmed_at INTEGER CHECK (
  adult_confirmed_at IS NULL OR adult_confirmed_at >= 0
);
ALTER TABLE accounts ADD COLUMN guardian_confirmed_at INTEGER CHECK (
  guardian_confirmed_at IS NULL OR guardian_confirmed_at >= 0
);

ALTER TABLE account_auth_challenges ADD COLUMN adult_confirmed INTEGER
  NOT NULL DEFAULT 0 CHECK (adult_confirmed IN (0, 1));
ALTER TABLE account_auth_challenges ADD COLUMN guardian_confirmed INTEGER
  NOT NULL DEFAULT 0 CHECK (guardian_confirmed IN (0, 1));
ALTER TABLE account_auth_challenges ADD COLUMN buyer_confirmation_version TEXT CHECK (
  buyer_confirmation_version IS NULL
  OR length(buyer_confirmation_version) = 10
);

CREATE TRIGGER accounts_validate_buyer_confirmation_insert
BEFORE INSERT ON accounts
WHEN COALESCE((
  (
    NEW.buyer_role IS NULL
    AND NEW.buyer_confirmation_version IS NULL
    AND NEW.adult_confirmed_at IS NULL
    AND NEW.guardian_confirmed_at IS NULL
  )
  OR (
    NEW.buyer_role = 'self'
    AND NEW.buyer_confirmation_version IS NOT NULL
    AND NEW.adult_confirmed_at IS NOT NULL
    AND NEW.guardian_confirmed_at IS NULL
  )
  OR (
    NEW.buyer_role = 'guardian'
    AND NEW.buyer_confirmation_version IS NOT NULL
    AND NEW.adult_confirmed_at IS NOT NULL
    AND NEW.guardian_confirmed_at IS NOT NULL
  )
), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid buyer confirmation');
END;

CREATE TRIGGER accounts_validate_buyer_confirmation_update
BEFORE UPDATE OF buyer_role, buyer_confirmation_version,
  adult_confirmed_at, guardian_confirmed_at ON accounts
WHEN COALESCE((
  (
    NEW.buyer_role IS NULL
    AND NEW.buyer_confirmation_version IS NULL
    AND NEW.adult_confirmed_at IS NULL
    AND NEW.guardian_confirmed_at IS NULL
  )
  OR (
    NEW.buyer_role = 'self'
    AND NEW.buyer_confirmation_version IS NOT NULL
    AND NEW.adult_confirmed_at IS NOT NULL
    AND NEW.guardian_confirmed_at IS NULL
  )
  OR (
    NEW.buyer_role = 'guardian'
    AND NEW.buyer_confirmation_version IS NOT NULL
    AND NEW.adult_confirmed_at IS NOT NULL
    AND NEW.guardian_confirmed_at IS NOT NULL
  )
), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid buyer confirmation');
END;

CREATE TRIGGER account_auth_challenges_validate_buyer_insert
BEFORE INSERT ON account_auth_challenges
WHEN NOT (
  (
    NEW.adult_confirmed = 0
    AND NEW.guardian_confirmed = 0
    AND NEW.buyer_confirmation_version IS NULL
  )
  OR (
    NEW.contact_role = 'self'
    AND NEW.adult_confirmed = 1
    AND NEW.guardian_confirmed = 0
    AND NEW.buyer_confirmation_version IS NOT NULL
  )
  OR (
    NEW.contact_role = 'guardian'
    AND NEW.adult_confirmed = 1
    AND NEW.guardian_confirmed = 1
    AND NEW.buyer_confirmation_version IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid challenge buyer confirmation');
END;
