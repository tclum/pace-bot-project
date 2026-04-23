-- Corpus tagging for existing doc pipeline
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS corpus TEXT NOT NULL DEFAULT 'org'
  CHECK (corpus IN ('org', 'curriculum'));

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS corpus TEXT NOT NULL DEFAULT 'org'
  CHECK (corpus IN ('org', 'curriculum'));

CREATE INDEX IF NOT EXISTS document_chunks_corpus_idx ON document_chunks (corpus);

-- PACE programs
CREATE TABLE IF NOT EXISTS programs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL
                      CHECK (category IN ('accelerator','competition','leadership','workshop','grant','other')),
  short_description   TEXT NOT NULL,
  long_description    TEXT,
  eligibility         TEXT,
  application_url     TEXT,
  next_deadline       DATE,
  award_amount_min    INT,
  award_amount_max    INT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programs_active_category_idx
  ON programs (category) WHERE is_active = TRUE;

-- Events
CREATE TABLE IF NOT EXISTS events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID REFERENCES programs(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ,
  location            TEXT,
  registration_url    TEXT,
  is_public           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events (starts_at);
CREATE INDEX IF NOT EXISTS events_program_id_idx ON events (program_id);

-- People
CREATE TABLE IF NOT EXISTS people (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  role                TEXT NOT NULL,
  bio                 TEXT,
  program_slugs       TEXT[] NOT NULL DEFAULT '{}',
  email_public        TEXT,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS people_program_slugs_gin ON people USING gin (program_slugs);

-- Curriculum concepts
CREATE TABLE IF NOT EXISTS concepts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL
                          CHECK (category IN ('mindset','framework','cultural','practice')),
  short_definition        TEXT NOT NULL,
  long_explanation        TEXT NOT NULL,
  pacific_asian_context   TEXT,
  example_ventures        JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_concept_slugs   TEXT[] NOT NULL DEFAULT '{}',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concepts_category_idx ON concepts (category);
CREATE INDEX IF NOT EXISTS concepts_related_slugs_gin ON concepts USING gin (related_concept_slugs);
