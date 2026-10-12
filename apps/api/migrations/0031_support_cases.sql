-- Internal synthetic cases: additive to abuse_reports; no existing report rewritten.
CREATE TABLE support_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','resolved','closed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 assigned_to uuid REFERENCES admin_principals(id),
 created_by uuid NOT NULL REFERENCES admin_principals(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX support_cases_assigned ON support_cases(assigned_to,created_at DESC,id DESC);
CREATE TABLE support_case_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES support_cases(id),
 source_kind text NOT NULL CHECK(source_kind IN ('report','game')),
 report_id uuid REFERENCES abuse_reports(id),
 game_id uuid REFERENCES games(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((source_kind='report' AND report_id IS NOT NULL AND game_id IS NULL) OR (source_kind='game' AND game_id IS NOT NULL AND report_id IS NULL)),
 UNIQUE(report_id), UNIQUE(case_id,game_id), UNIQUE(id,case_id)
);
CREATE TABLE support_case_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES support_cases(id),
 case_version integer NOT NULL,
 audit_id uuid NOT NULL REFERENCES privileged_audit_events(id),
 action text NOT NULL CHECK(action IN ('create','assign','status','note','link_report','link_game','capture_evidence')),
 note_code text CHECK(note_code IN ('review_started','awaiting_information','information_checked','escalated','resolution_recorded')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,case_version)
);
CREATE TABLE case_evidence_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES support_cases(id),
 link_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('report_summary','game_state')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 classification text NOT NULL CHECK(classification='synthetic_minimal'),
 policy_id text NOT NULL CHECK(policy_id='internal_synthetic_v1'),
 expires_at timestamptz NOT NULL,
 legal_hold boolean NOT NULL DEFAULT false,
 audit_id uuid NOT NULL REFERENCES privileged_audit_events(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(link_id,case_id) REFERENCES support_case_links(id,case_id),
 CHECK(expires_at>created_at)
);
CREATE INDEX case_evidence_case ON case_evidence_items(case_id,created_at DESC,id DESC);
CREATE FUNCTION support_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Support history/evidence is immutable; no maintenance policy admitted' USING ERRCODE='42501';
END $$;
CREATE TRIGGER support_links_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON support_case_links FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();
CREATE TRIGGER support_actions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON support_case_actions FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();
CREATE TRIGGER case_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON case_evidence_items FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();
