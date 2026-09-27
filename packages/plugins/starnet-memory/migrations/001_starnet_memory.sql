-- Starnet Memory (plugin starnet.memory). Namespace is host-derived: plugin_starnet_memory_<sha256("starnet.memory")[0:10]>.
-- No raw transcripts are stored: memory_items only holds admitted notes/pins, session_l1 only deterministic summaries.

CREATE TABLE plugin_starnet_memory_94b82c7db8.memory_items (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope_kind text NOT NULL,
  scope_id uuid NOT NULL,
  kind text NOT NULL,
  tier text NOT NULL,
  body text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind text NOT NULL,
  source_id text,
  created_by_type text NOT NULL,
  created_by_id text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);

CREATE UNIQUE INDEX memory_items_source_uq ON plugin_starnet_memory_94b82c7db8.memory_items (company_id, source_kind, source_id);

CREATE INDEX memory_items_scope_idx ON plugin_starnet_memory_94b82c7db8.memory_items (company_id, scope_kind, scope_id, created_at);

CREATE INDEX memory_items_tsv_idx ON plugin_starnet_memory_94b82c7db8.memory_items USING gin (tsv);

-- L1 session memory. issue_id = '00000000-0000-0000-0000-000000000000' is the agent-level L1 (recent runs across issues).
CREATE TABLE plugin_starnet_memory_94b82c7db8.session_l1 (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  summary text NOT NULL,
  pin_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_count integer NOT NULL DEFAULT 0,
  last_run_id uuid,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, agent_id, issue_id)
);

-- Every context bundle handed to an agent (what the agent saw), with its size and the naive-transcript size.
CREATE TABLE plugin_starnet_memory_94b82c7db8.bundle_log (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL,
  agent_id uuid,
  run_id uuid,
  via text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  chars integer NOT NULL,
  est_tokens integer NOT NULL,
  naive_chars integer NOT NULL,
  naive_tokens integer NOT NULL,
  bundle_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bundle_log_issue_idx ON plugin_starnet_memory_94b82c7db8.bundle_log (company_id, issue_id, created_at);

-- Admission decisions (no text: rejected input may contain secrets or transcripts).
CREATE TABLE plugin_starnet_memory_94b82c7db8.admission_log (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_id text,
  scope_kind text,
  scope_id uuid,
  decision text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admission_log_company_idx ON plugin_starnet_memory_94b82c7db8.admission_log (company_id, created_at);
