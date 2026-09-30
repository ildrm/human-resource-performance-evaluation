ALTER TABLE metrics ADD COLUMN measurement_kind text NOT NULL DEFAULT 'CONTINUOUS'
  CHECK (measurement_kind IN ('CONTINUOUS','BINOMIAL_PROPORTION'));

ALTER TABLE evidence ADD CONSTRAINT evidence_count_pair CHECK (
  (numerator IS NULL AND denominator IS NULL)
  OR (numerator IS NOT NULL AND denominator IS NOT NULL AND numerator >= 0 AND denominator > 0)
);
