-- Blog newsletter signups. Separate from `waitlist`: a waitlist signup means
-- "let me into the product," a newsletter signup means "email me new posts."
-- Keeping them apart avoids running blog subscribers through
-- waitlist-acceptance copy that has nothing to do with why they signed up.

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT now()
);
