/**
 * Limits for article verification that the dashboard form needs. They live in
 * their own file because the form is a client component: importing them from
 * lib/kb/verification.ts would drag its content hash (and node:crypto) into the
 * browser bundle.
 */

/** Longest note a verifier can attach. */
export const VERIFICATION_NOTE_MAX = 500
