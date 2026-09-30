"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import FeedbackWorkspace from "./feedback-workspace";
import DevelopmentWorkspace from "./development-workspace";
import GoalsWorkspace from "./goals-workspace";
import GovernanceWorkspace from "./governance-workspace";
import ContextWorkspace from "./context-workspace";
import ConflictPanel from "./conflict-panel";
import DiscussionPanel from "./discussion-panel";
import TrendWorkspace from "./trend-workspace";
import ImprovementWorkspace from "./improvement-workspace";
import OrganizationWorkspace from "./organization-workspace";
import QualityPolicyPanel from "./quality-policy-panel";
import ValidationPanel from "./validation-panel";

type Person = {
  id: string;
  name: string;
  email: string;
  role: string;
  manager_id: string | null;
  job_id: string | null;
};
type EvaluationRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  cycle_name: string;
  status: string;
  score: string | null;
  final_score?: string | null;
  effective_score?: string | null;
  created_at: string;
};
type Overview = { person: Person; evaluations: EvaluationRow[] };
type NotificationRow = {
  id: string;
  kind: string;
  resource_id: string;
  created_at: string;
  read_at: string | null;
};
type Job = {
  id: string;
  name: string;
  family: string;
  version: number;
  approved: boolean;
};
type Metric = {
  id: string;
  code: string;
  name: string;
  direction: string;
  unit: string;
  measurement_kind: string;
};
type Template = {
  id: string;
  name: string;
  version: number;
  state: string;
  job_id: string;
};
type Cycle = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  purpose: string;
};
type Catalog = {
  users: Person[];
  jobs: Job[];
  metrics: Metric[];
  templates: Template[];
  targets: { id: string; metric_id: string; version: number; target: string }[];
  cycles: Cycle[];
};
type MetricTrace = {
  metricId: string;
  metricName: string;
  state?: string;
  actual?: string | null;
  score: string | null;
  contribution: string | null;
  configuredWeight: string;
  appliedWeight: string | null;
  note?: string | null;
  evidenceId?: string | null;
  targetVersion?: number | null;
  periodAggregation?: "LATEST" | "MEAN_SCORE";
  observations?: {
    evidenceId: string;
    observedAt: string;
    state: string;
    actual?: string;
    targetVersion?: number;
    score: string | null;
  }[];
  proportionInterval?: {
    method: "WILSON_95";
    numerator: string;
    denominator: string;
    lowerPercent: string;
    upperPercent: string;
  } | null;
};
type EvaluationDetail = EvaluationRow & {
  effective_score?: string | null;
  amendments?: {
    id: string;
    previous_effective_score: string;
    amended_score: string;
    reason: string;
  }[];
  org_snapshot?: {
    assignment_id: string;
    assignment_role: string;
    code: string;
    name: string;
    kind: string;
    parent_name: string | null;
  }[];
  employee_name: string;
  template_name: string;
  manager_note: string | null;
  result_snapshot: {
    status: string;
    score: string | null;
    issues: string[];
    formulaVersion: string;
    dimensions: {
      name: string;
      weight: string;
      score: string | null;
      contribution: string | null;
      metrics: MetricTrace[];
    }[];
  };
  appeals: {
    id: string;
    reason: string;
    statement: string;
    state: string;
    outcome: string | null;
    resolution: string | null;
    remedy: string | null;
    notice_status: string;
  }[];
  calibration: {
    previous_score: string;
    proposed_score: string;
    reason: string;
  }[];
  quality_result_snapshot: {
    name: string;
    index: string;
    policyVersion: number;
    components: {
      completeness: string;
      freshness: string;
      sampleAdequacy: string;
      traceability: string;
    };
    interpretation: string;
  } | null;
  model_dossier: {
    version: number;
    intended_interpretation: string;
    intended_population: string;
    job_analysis_reference: string;
    content_evidence_reference: string;
    reliability_evidence_or_rationale: string;
    criterion_evidence_or_rationale: string;
    construct_evidence_or_rationale: string;
    fairness_review_reference: string;
    limitations: string;
    revalidate_on: string;
  } | null;
  context: {
    id: string;
    kind: string;
    description: string;
    impact: string;
    evidence_reference: string;
    expected_exposure: string | null;
    actual_exposure: string | null;
    exposure_unit: string | null;
    status: string;
    review_note: string | null;
  }[];
};
type EvidenceRow = {
  id: string;
  employee_id: string;
  metric_name: string;
  observed_at: string;
  value: string | null;
  data_state: string;
  source: string;
  verification_state: string;
  numerator: string | null;
  denominator: string | null;
};
type Tab =
  | "overview"
  | "models"
  | "goals"
  | "development"
  | "improvement"
  | "governance"
  | "context"
  | "organization"
  | "trends"
  | "evidence"
  | "feedback"
  | "notifications"
  | "reports";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    cache: "no-store",
  });
  const data: unknown = await response
    .json()
    .catch(() => ({ message: "Unexpected response" }));
  if (!response.ok)
    throw new Error(
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : `Request failed (${response.status})`,
    );
  return data as T;
}
function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}
function Select({
  name,
  items,
  placeholder,
}: {
  name: string;
  items: { id: string; name: string }[];
  placeholder: string;
}) {
  return (
    <select name={name} required defaultValue="">
      <option value="" disabled>
        {placeholder}
      </option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  );
}
function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function Workspace({
  initialOverview,
}: {
  initialOverview: Overview;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState(initialOverview);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [report, setReport] = useState<EvaluationRow[]>([]);
  const [reportNextCursor, setReportNextCursor] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [selected, setSelected] = useState<EvaluationDetail | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [evidencePerson, setEvidencePerson] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await api<Overview>("overview");
    setOverview(next);
    if (next.person.role !== "EMPLOYEE") {
      const nextCatalog = await api<Catalog>("catalog");
      setCatalog(nextCatalog);
    }
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(String(error)));
  }, [refresh]);
  useEffect(() => {
    if (tab === "reports")
      void api<{ rows: EvaluationRow[]; nextCursor: string | null }>(
        "reports/evaluations",
      )
        .then((data) => {
          setReport(data.rows);
          setReportNextCursor(data.nextCursor);
        })
        .catch((error) => setNotice(String(error)));
    if (tab === "notifications")
      void api<NotificationRow[]>("notifications")
        .then(setNotifications)
        .catch((error) => setNotice(String(error)));
  }, [tab]);
  useEffect(() => {
    if (evidencePerson)
      void api<EvidenceRow[]>(`people/${evidencePerson}/evidence`)
        .then(setEvidence)
        .catch((error) => setNotice(String(error)));
  }, [evidencePerson]);

  async function perform<T>(
    task: () => Promise<T>,
    after?: (result: T) => void,
  ) {
    setBusy(true);
    setNotice("");
    try {
      const result = await task();
      after?.(result);
      await refresh();
      setNotice("Saved successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function formAction<T>(
    build: (form: FormData) => Promise<T>,
    after?: (result: T) => void,
  ) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      void perform(
        () => build(new FormData(form)),
        (result) => {
          form.reset();
          after?.(result);
        },
      );
    };
  }
  async function selectEvaluation(id: string) {
    try {
      setSelected(await api<EvaluationDetail>(`evaluations/${id}`));
      setTab("overview");
    } catch (error) {
      setNotice(String(error));
    }
  }
  async function updateEvaluation(path: string, body: unknown = {}) {
    if (!selected) return;
    await perform(
      () => api(`evaluations/${selected.id}/${path}`, body),
      () => {
        void selectEvaluation(selected.id);
      },
    );
  }
  async function loadEvidence() {
    if (evidencePerson)
      setEvidence(
        await api<EvidenceRow[]>(`people/${evidencePerson}/evidence`),
      );
  }
  const admin = ["TENANT_ADMIN", "HR_ADMIN"].includes(overview.person.role);
  const manager = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    overview.person.role,
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <span>
            HPI<span className="brand-sub">Human Performance Intelligence</span>
          </span>
        </div>
        <nav aria-label="Primary navigation">
          {(
            [
              "overview",
              "models",
              "goals",
              "development",
              "improvement",
              "governance",
              "context",
              "organization",
              "trends",
              "evidence",
              "feedback",
              "notifications",
              "reports",
            ] as Tab[]
          )
            .filter((item) => item !== "models" || admin)
            .filter(
              (item) =>
                item !== "reports" || overview.person.role !== "EMPLOYEE",
            )
            .map((item) => (
              <button
                key={item}
                className={tab === item ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setTab(item);
                  setSelected(null);
                  setNotice("");
                }}
              >
                {item === "overview"
                  ? "Overview"
                  : item === "models"
                    ? "Role models"
                    : item === "goals"
                      ? "Goals"
                      : item === "development"
                        ? "Development"
                        : item === "improvement"
                          ? "Improvement plans"
                          : item === "governance"
                            ? "Governance cases"
                            : item === "context"
                              ? "Context"
                              : item === "organization"
                                ? "Organization"
                                : item === "trends"
                                  ? "Trends"
                                  : item === "evidence"
                                    ? "Evidence"
                                    : item === "feedback"
                                      ? "Feedback"
                                      : item === "notifications"
                                        ? "Notifications"
                                        : "Reports"}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">
            {overview.person.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{overview.person.name}</strong>
            <small>
              {overview.person.role.replaceAll("_", " ").toLowerCase()}
            </small>
          </div>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Performance workspace</span>
            <h1>
              {selected
                ? `${selected.employee_name} · ${selected.cycle_name}`
                : tab === "overview"
                  ? "Clarity for every review"
                  : tab === "models"
                    ? "Role-specific models"
                    : tab === "goals"
                      ? "Goals and check-ins"
                      : tab === "development"
                        ? "Development actions"
                        : tab === "improvement"
                          ? "Improvement plans"
                          : tab === "governance"
                            ? "Safety and compliance"
                            : tab === "context"
                              ? "Context and opportunity"
                              : tab === "organization"
                                ? "Organization history"
                                : tab === "trends"
                                  ? "Longitudinal scores"
                                  : tab === "evidence"
                                    ? "Evidence and measurement"
                                    : tab === "feedback"
                                      ? "Behavior and feedback"
                                      : tab === "notifications"
                                        ? "Notifications"
                                        : "Evaluation reports"}
            </h1>
          </div>
          <div className="actions">
            <a
              href="/api/v1/privacy/me/export"
              download="my-performance-data.json"
            >
              Download my data
            </a>
            <button
              className="text-button"
              onClick={() =>
                void api("auth/logout", {}).finally(() =>
                  window.location.assign("/login"),
                )
              }
            >
              Sign out
            </button>
          </div>
        </header>
        {notice && (
          <div
            className={
              notice === "Saved successfully." ? "notice success" : "notice"
            }
            role="status"
          >
            {notice}
          </div>
        )}

        {selected ? (
          <div className="stack">
            <button className="back" onClick={() => setSelected(null)}>
              ← Back to overview
            </button>
            <div className="summary-grid">
              <div className="stat-card">
                <span>Calculated score</span>
                <strong>{selected.score ?? "Incomplete"}</strong>
                <small>Formula result</small>
              </div>
              <div className="stat-card">
                <span>Published decision</span>
                <strong>{selected.final_score ?? "—"}</strong>
                <small>After documented calibration</small>
                {selected.effective_score &&
                  selected.effective_score !== selected.final_score && (
                    <small>
                      Amended effective score: {selected.effective_score}
                    </small>
                  )}
              </div>
              <div className="stat-card">
                <span>Review status</span>
                <strong className="status-text">{selected.status}</strong>
                <small>{selected.template_name}</small>
              </div>
            </div>
            <Card
              title="Score explanation"
              description={`Formula ${selected.result_snapshot.formulaVersion}. Scores follow the approved role model and should not be compared across unrelated jobs.`}
            >
              {selected.result_snapshot.issues.length > 0 && (
                <div className="warning">
                  <strong>Missing information</strong>
                  <ul>
                    {selected.result_snapshot.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selected.result_snapshot.dimensions.map((dim) => (
                <div className="dimension" key={dim.name}>
                  <div className="dimension-head">
                    <div>
                      <h3>{dim.name}</h3>
                      <span>Dimension weight {dim.weight}</span>
                    </div>
                    <strong>{dim.score ?? "Incomplete"}</strong>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Measure</th>
                          <th>Observation</th>
                          <th>Evidence</th>
                          <th>Weight</th>
                          <th>Score</th>
                          <th>Contribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dim.metrics.map((metric) => (
                          <tr key={metric.metricId}>
                            <td>
                              <strong>{metric.metricName}</strong>
                              {metric.note && <small>{metric.note}</small>}
                            </td>
                            <td>
                              {metric.observations
                                ? `${metric.observations.length} verified observation(s); ${metric.periodAggregation}`
                                : (metric.actual ?? metric.state)}
                              {metric.observations?.map((observation) => (
                                <small key={observation.evidenceId}>
                                  {observation.observedAt.slice(0, 10)}:{" "}
                                  {observation.actual ?? observation.state}
                                  {observation.targetVersion
                                    ? `; target v${observation.targetVersion}`
                                    : "; no target"}
                                  {observation.score
                                    ? `; score ${observation.score}`
                                    : ""}
                                </small>
                              ))}
                              {metric.proportionInterval && (
                                <small>
                                  {metric.proportionInterval.numerator}/
                                  {metric.proportionInterval.denominator} trials
                                  · 95% Wilson interval{" "}
                                  {metric.proportionInterval.lowerPercent}–
                                  {metric.proportionInterval.upperPercent}%
                                </small>
                              )}
                            </td>
                            <td>
                              {metric.observations
                                ? `${metric.observations.length} item(s) in trace`
                                : metric.evidenceId
                                  ? "Verified"
                                  : "No verified item"}
                            </td>
                            <td>{metric.appliedWeight ?? "—"}</td>
                            <td>{metric.score ?? "—"}</td>
                            <td>{metric.contribution ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </Card>
            <Card
              title="Organization at review"
              description="Assignments active at the cycle end were saved when this review was calculated."
            >
              {selected.org_snapshot && selected.org_snapshot.length > 0 ? (
                <ul>
                  {selected.org_snapshot.map((assignment) => (
                    <li key={assignment.assignment_id}>
                      {assignment.assignment_role.toLowerCase()}:{" "}
                      {assignment.name} ({assignment.kind.toLowerCase()})
                      {assignment.parent_name
                        ? ` · ${assignment.parent_name}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No dated organization assignment was captured for this review.
                </p>
              )}
            </Card>
            {[
              "TENANT_ADMIN",
              "HR_ADMIN",
              "MANAGER",
              "CALIBRATOR",
              "AUDITOR",
            ].includes(overview.person.role) && (
              <ConflictPanel
                evaluationId={selected.id}
                evaluationStatus={selected.status}
                person={overview.person}
                catalog={catalog}
              />
            )}
            <DiscussionPanel
              evaluationId={selected.id}
              evaluationStatus={selected.status}
              employeeId={selected.employee_id}
              person={overview.person}
            />
            <Card title="Evidence Quality Index">
              {selected.quality_result_snapshot ? (
                <div>
                  <p>
                    <strong>
                      {selected.quality_result_snapshot.index} / 100
                    </strong>{" "}
                    · policy version{" "}
                    {selected.quality_result_snapshot.policyVersion}
                  </p>
                  <p>{selected.quality_result_snapshot.interpretation}</p>
                  <ul>
                    {Object.entries(
                      selected.quality_result_snapshot.components,
                    ).map(([name, score]) => (
                      <li key={name}>
                        {name.replaceAll(/([A-Z])/g, " $1").toLowerCase()}:{" "}
                        {score}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>
                  No approved evidence quality policy was active when this
                  review was calculated.
                </p>
              )}
            </Card>
            {selected.model_dossier && (
              <Card
                title="Model evidence reviewed for this decision"
                description="A reviewed dossier records the evidence references used for governance. Its existence does not prove scientific validity."
              >
                <div className="config-list">
                  <p>
                    <strong>Intended interpretation:</strong>{" "}
                    {selected.model_dossier.intended_interpretation}
                  </p>
                  <p>
                    <strong>Population:</strong>{" "}
                    {selected.model_dossier.intended_population}
                  </p>
                  <p>
                    <strong>Job analysis:</strong>{" "}
                    {selected.model_dossier.job_analysis_reference}
                  </p>
                  <p>
                    <strong>Content evidence:</strong>{" "}
                    {selected.model_dossier.content_evidence_reference}
                  </p>
                  <p>
                    <strong>Reliability:</strong>{" "}
                    {selected.model_dossier.reliability_evidence_or_rationale}
                  </p>
                  <p>
                    <strong>Criterion evidence:</strong>{" "}
                    {selected.model_dossier.criterion_evidence_or_rationale}
                  </p>
                  <p>
                    <strong>Construct evidence:</strong>{" "}
                    {selected.model_dossier.construct_evidence_or_rationale}
                  </p>
                  <p>
                    <strong>Fairness review:</strong>{" "}
                    {selected.model_dossier.fairness_review_reference}
                  </p>
                  <p>
                    <strong>Limitations:</strong>{" "}
                    {selected.model_dossier.limitations}
                  </p>
                  <p>
                    <strong>Revalidation date:</strong>{" "}
                    {selected.model_dossier.revalidate_on.slice(0, 10)}
                  </p>
                </div>
              </Card>
            )}
            <Card title="Context and opportunity">
              {selected.context.length === 0 ? (
                <p>No context records were submitted for this cycle.</p>
              ) : (
                <ul>
                  {selected.context.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.kind.toLowerCase()} · {item.status.toLowerCase()}
                      </strong>
                      : {item.description}
                      <br />
                      Effect: {item.impact}
                      {item.expected_exposure !== null && (
                        <>
                          {" "}
                          · Exposure: {item.actual_exposure} of{" "}
                          {item.expected_exposure} {item.exposure_unit}
                        </>
                      )}
                      {item.review_note && <> · Review: {item.review_note}</>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {selected.manager_note && (
              <Card title="Manager assessment">
                <p>{selected.manager_note}</p>
              </Card>
            )}
            {selected.calibration.length > 0 && (
              <Card title="Calibration history">
                {selected.calibration.map((item, index) => (
                  <p key={index}>
                    {item.previous_score} → {item.proposed_score}: {item.reason}
                  </p>
                ))}
              </Card>
            )}
            {selected.appeals.length > 0 && (
              <Card title="Appeals">
                {selected.appeals.map((item) => (
                  <div key={item.id} className="appeal">
                    <strong>
                      {item.reason.replaceAll("_", " ")} · {item.state}
                    </strong>
                    <p>{item.statement}</p>
                    {item.resolution && (
                      <p>
                        <strong>{item.outcome}:</strong> {item.resolution}
                        {item.remedy && ` Remedy: ${item.remedy}`}
                        {item.notice_status === "PENDING" &&
                          " Notice pending delivery."}
                      </p>
                    )}
                    {admin && item.state === "OPEN" && (
                      <form
                        className="inline-form"
                        onSubmit={formAction(
                          (form) =>
                            api(`appeals/${item.id}/resolve`, {
                              outcome: value(form, "outcome"),
                              resolution: value(form, "resolution"),
                              remedy: value(form, "remedy"),
                              ...(value(form, "correctedScore")
                                ? {
                                    correctedScore: value(
                                      form,
                                      "correctedScore",
                                    ),
                                  }
                                : {}),
                            }),
                          () => void selectEvaluation(selected.id),
                        )}
                      >
                        <label>
                          Outcome
                          <select name="outcome" required defaultValue="">
                            <option value="" disabled>
                              Select an outcome
                            </option>
                            <option value="UPHELD">Upheld</option>
                            <option value="PARTIALLY_UPHELD">
                              Partially upheld
                            </option>
                            <option value="DENIED">Denied</option>
                          </select>
                        </label>
                        <Field label="Resolution" name="resolution" />
                        <Field
                          label="Remedy or reason for denial"
                          name="remedy"
                        />
                        <Field
                          label="Corrected score, if applicable"
                          name="correctedScore"
                        />
                        <button disabled={busy}>Resolve</button>
                      </form>
                    )}
                  </div>
                ))}
              </Card>
            )}
            <Card title="Review actions">
              <div className="actions">
                {manager && selected.status === "CALCULATED" && (
                  <form
                    className="inline-form"
                    onSubmit={formAction(
                      (form) =>
                        api(`evaluations/${selected.id}/submit`, {
                          managerNote: value(form, "managerNote"),
                        }),
                      () => void selectEvaluation(selected.id),
                    )}
                  >
                    <Field label="Manager assessment" name="managerNote" />
                    <button disabled={busy}>Submit review</button>
                  </form>
                )}
                {["TENANT_ADMIN", "CALIBRATOR"].includes(
                  overview.person.role,
                ) &&
                  selected.status === "SUBMITTED" && (
                    <form
                      className="inline-form"
                      onSubmit={formAction(
                        (form) =>
                          api(`evaluations/${selected.id}/calibrate`, {
                            proposedScore: value(form, "proposedScore"),
                            reason: value(form, "reason"),
                            evidenceReference: value(form, "evidenceReference"),
                            policyBasis: value(form, "policyBasis"),
                          }),
                        () => void selectEvaluation(selected.id),
                      )}
                    >
                      <Field
                        label="Proposed final score"
                        name="proposedScore"
                      />
                      <Field label="Reason" name="reason" />
                      <Field
                        label="Evidence reference"
                        name="evidenceReference"
                      />
                      <Field label="Policy basis" name="policyBasis" />
                      <button disabled={busy}>Record calibration</button>
                    </form>
                  )}
                {admin && selected.status === "SUBMITTED" && (
                  <button
                    onClick={() => void updateEvaluation("publish")}
                    disabled={busy}
                  >
                    Publish to employee
                  </button>
                )}
                {selected.employee_id === overview.person.id &&
                  selected.status === "PUBLISHED" && (
                    <button
                      onClick={() => void updateEvaluation("acknowledge")}
                      disabled={busy}
                    >
                      Acknowledge
                    </button>
                  )}
                {selected.employee_id === overview.person.id &&
                  ["PUBLISHED", "ACKNOWLEDGED"].includes(selected.status) && (
                    <form
                      className="inline-form"
                      onSubmit={formAction(
                        (form) =>
                          api(`evaluations/${selected.id}/appeal`, {
                            reason: value(form, "reason"),
                            statement: value(form, "statement"),
                          }),
                        () => void selectEvaluation(selected.id),
                      )}
                    >
                      <label>
                        Appeal reason
                        <select name="reason">
                          <option value="WRONG_EVIDENCE">Wrong evidence</option>
                          <option value="MISSING_EVIDENCE">
                            Missing evidence
                          </option>
                          <option value="INCORRECT_TARGET">
                            Incorrect target
                          </option>
                          <option value="CALCULATION_ERROR">
                            Calculation error
                          </option>
                          <option value="CONTEXT">Context</option>
                          <option value="RATING_DISAGREEMENT">
                            Rating disagreement
                          </option>
                        </select>
                      </label>
                      <Field
                        label="What should be reviewed?"
                        name="statement"
                      />
                      <button disabled={busy}>Submit appeal</button>
                    </form>
                  )}
                <button
                  className="secondary"
                  onClick={() =>
                    void perform(
                      () => api(`evaluations/${selected.id}/replay`),
                      (result) =>
                        setNotice(
                          (result as { matches: boolean }).matches
                            ? "Replay matches stored result."
                            : "Replay differs from stored result.",
                        ),
                    )
                  }
                >
                  Verify calculation replay
                </button>
              </div>
            </Card>
          </div>
        ) : tab === "overview" ? (
          <div className="stack">
            <div className="intro">
              <div>
                <p className="eyebrow">Your workspace</p>
                <h2>Every result has a source.</h2>
                <p>
                  Review the role model, verified observations, score trace, and
                  decision history together.
                </p>
              </div>
              <span className="intro-symbol">◎</span>
            </div>
            <div className="summary-grid">
              <div className="stat-card">
                <span>Evaluations in view</span>
                <strong>{overview.evaluations.length}</strong>
                <small>Latest 100</small>
              </div>
              <div className="stat-card">
                <span>Awaiting information</span>
                <strong>
                  {
                    overview.evaluations.filter(
                      (item) => item.status === "INCOMPLETE",
                    ).length
                  }
                </strong>
                <small>Evidence or target gaps</small>
              </div>
              <div className="stat-card">
                <span>Published</span>
                <strong>
                  {
                    overview.evaluations.filter((item) =>
                      ["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(
                        item.status,
                      ),
                    ).length
                  }
                </strong>
                <small>Visible to employees</small>
              </div>
            </div>
            <Card
              title="Evaluations"
              description="Select a review to see the exact score trace and any appeal."
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Cycle</th>
                      <th>Status</th>
                      <th>Calculated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.evaluations.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.employee_name}</strong>
                        </td>
                        <td>{item.cycle_name}</td>
                        <td>
                          <span className="pill">
                            {item.status.toLowerCase()}
                          </span>
                        </td>
                        <td>{item.score ?? "—"}</td>
                        <td>
                          <button
                            className="link-button"
                            onClick={() => void selectEvaluation(item.id)}
                          >
                            Open review →
                          </button>
                        </td>
                      </tr>
                    ))}
                    {overview.evaluations.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty">
                          No evaluations yet. Configure a role model and cycle,
                          then collect verified evidence.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : tab === "models" && catalog ? (
          <div className="stack">
            <div className="intro compact">
              <div>
                <p className="eyebrow">Model governance</p>
                <h2>Define expectations before measurement.</h2>
                <p>
                  Targets and templates are versioned. A published evaluation
                  keeps its original snapshot.
                </p>
              </div>
            </div>
            <div className="two-col">
              <Card title="1 · Job model">
                <form
                  className="form-stack"
                  onSubmit={formAction((form) =>
                    api("jobs", {
                      name: value(form, "name"),
                      family: value(form, "family"),
                      purpose: value(form, "purpose"),
                      approved: true,
                    }),
                  )}
                >
                  <Field label="Job name" name="name" />
                  <Field label="Job family" name="family" />
                  <Field label="Purpose" name="purpose" />
                  <button disabled={busy}>Create approved job</button>
                </form>
              </Card>
              <Card title="2 · Metric definition">
                <form
                  className="form-stack"
                  onSubmit={formAction((form) =>
                    api("metrics", {
                      code: value(form, "code"),
                      name: value(form, "name"),
                      construct: value(form, "construct"),
                      unit: value(form, "unit"),
                      measurementKind: value(form, "measurementKind"),
                      direction: value(form, "direction"),
                      rationale: value(form, "rationale"),
                      limitations: value(form, "limitations"),
                      controllability: value(form, "controllability"),
                      minimumSample: Number(value(form, "minimumSample")),
                    }),
                  )}
                >
                  <Field label="Code" name="code" />
                  <Field label="Name" name="name" />
                  <Field label="Construct measured" name="construct" />
                  <Field label="Unit" name="unit" />
                  <label>
                    Measurement type
                    <select name="measurementKind">
                      <option value="CONTINUOUS">Continuous or other</option>
                      <option value="BINOMIAL_PROPORTION">
                        Binary proportion (%; independent yes/no trials)
                      </option>
                    </select>
                  </label>
                  <label>
                    Direction
                    <select name="direction">
                      <option value="HIGHER">Higher is better</option>
                      <option value="LOWER">Lower is better</option>
                      <option value="RANGE">Optimal range</option>
                      <option value="BINARY">Binary</option>
                      <option value="MILESTONE">Milestone</option>
                      <option value="RUBRIC">Behavior rubric</option>
                    </select>
                  </label>
                  <Field
                    label="Business and measurement rationale"
                    name="rationale"
                  />
                  <Field label="Known limitations" name="limitations" />
                  <label>
                    Controllability
                    <select name="controllability">
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="PARTIAL">Partial</option>
                      <option value="SHARED">Shared</option>
                      <option value="EXTERNAL">Primarily external</option>
                    </select>
                  </label>
                  <Field
                    label="Minimum sample"
                    name="minimumSample"
                    type="number"
                    defaultValue="0"
                  />
                  <button disabled={busy}>Create metric</button>
                </form>
              </Card>
              <Card
                title="3 · Target version"
                description="Enter actual and score anchors as one comma-separated pair per line. They are an approved policy, not a scientific norm."
              >
                <form
                  className="form-stack"
                  onSubmit={formAction((form) =>
                    api("targets", {
                      metricId: value(form, "metricId"),
                      effectiveFrom: value(form, "effectiveFrom"),
                      critical: value(form, "critical"),
                      threshold: value(form, "threshold"),
                      target: value(form, "target"),
                      stretch: value(form, "stretch"),
                      anchors: value(form, "anchors")
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => {
                          const [actual, score] = line
                            .split(",")
                            .map((part) => part.trim());
                          return { actual, score };
                        }),
                      reason: value(form, "reason"),
                    }),
                  )}
                >
                  <label>
                    Metric
                    <Select
                      name="metricId"
                      items={catalog.metrics.map((item) => ({
                        id: item.id,
                        name: `${item.code} · ${item.name}`,
                      }))}
                      placeholder="Choose metric"
                    />
                  </label>
                  <Field
                    label="Effective from"
                    name="effectiveFrom"
                    type="date"
                  />
                  <div className="form-grid">
                    <Field label="Critical" name="critical" />
                    <Field label="Threshold" name="threshold" />
                    <Field label="Target" name="target" />
                    <Field label="Stretch" name="stretch" />
                  </div>
                  <label>
                    Anchor table
                    <textarea
                      name="anchors"
                      rows={4}
                      placeholder={"0,0\n10,60\n20,100\n30,120"}
                      required
                    />
                  </label>
                  <Field label="Reason and approval basis" name="reason" />
                  <button disabled={busy}>Save target version</button>
                </form>
              </Card>
              <Card title="4 · Review cycle">
                <form
                  className="form-stack"
                  onSubmit={formAction((form) =>
                    api("cycles", {
                      name: value(form, "name"),
                      startsOn: value(form, "startsOn"),
                      endsOn: value(form, "endsOn"),
                      purpose: value(form, "purpose"),
                    }),
                  )}
                >
                  <Field label="Cycle name" name="name" />
                  <Field label="Starts on" name="startsOn" type="date" />
                  <Field label="Ends on" name="endsOn" type="date" />
                  <label>
                    Purpose
                    <select name="purpose">
                      <option value="DEVELOPMENT">Development</option>
                      <option value="ADMINISTRATIVE">Administrative</option>
                    </select>
                  </label>
                  <button disabled={busy}>Create cycle</button>
                </form>
              </Card>
              <Card title="5 · Employee assignment">
                <form
                  className="form-stack"
                  onSubmit={formAction((form) =>
                    api("people", {
                      name: value(form, "name"),
                      email: value(form, "email"),
                      password: value(form, "password"),
                      role: value(form, "role"),
                      jobId: value(form, "jobId") || undefined,
                      managerId: value(form, "managerId") || undefined,
                    }),
                  )}
                >
                  <Field label="Name" name="name" />
                  <Field label="Email" name="email" type="email" />
                  <Field
                    label="Initial password (12+ characters)"
                    name="password"
                    type="password"
                  />
                  <label>
                    Role
                    <select name="role">
                      <option value="EMPLOYEE">Employee</option>
                      <option value="MANAGER">Manager</option>
                      <option value="HR_ADMIN">HR admin</option>
                      <option value="CALIBRATOR">Calibrator</option>
                      <option value="AUDITOR">Auditor</option>
                    </select>
                  </label>
                  <label>
                    Job
                    <select name="jobId">
                      <option value="">Unassigned</option>
                      {catalog.jobs.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · v{item.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Manager
                    <select name="managerId">
                      <option value="">None</option>
                      {catalog.users
                        .filter((item) => item.role === "MANAGER")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button disabled={busy}>Create person</button>
                </form>
              </Card>
              <TemplateForm catalog={catalog} busy={busy} submit={formAction} />
              <QualityPolicyPanel />
              <ValidationPanel templates={catalog.templates} />
            </div>
            <Card title="Current configuration">
              <div className="config-list">
                <p>
                  <strong>Jobs:</strong>{" "}
                  {catalog.jobs
                    .map((item) => `${item.name} v${item.version}`)
                    .join(" · ") || "None"}
                </p>
                <p>
                  <strong>Metrics:</strong>{" "}
                  {catalog.metrics.map((item) => item.code).join(" · ") ||
                    "None"}
                </p>
                <p>
                  <strong>Templates:</strong>{" "}
                  {catalog.templates
                    .map(
                      (item) => `${item.name} v${item.version} (${item.state})`,
                    )
                    .join(" · ") || "None"}
                </p>
                <p>
                  <strong>Cycles:</strong>{" "}
                  {catalog.cycles.map((item) => item.name).join(" · ") ||
                    "None"}
                </p>
              </div>
              <div className="actions">
                {catalog.templates
                  .filter((item) => item.state === "DRAFT")
                  .map((item) => (
                    <button
                      key={item.id}
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api(`templates/${item.id}/review`, {}),
                        )
                      }
                    >
                      Submit {item.name} v{item.version} for review
                    </button>
                  ))}
                {catalog.templates
                  .filter((item) => item.state === "REVIEW")
                  .map((item) => (
                    <form
                      key={item.id}
                      className="inline-form"
                      onSubmit={formAction((form) =>
                        api(`templates/${item.id}/validate`, {
                          validationNote: value(form, "validationNote"),
                          fixtureEvidenceReference: value(
                            form,
                            "fixtureEvidenceReference",
                          ),
                        }),
                      )}
                    >
                      <strong>
                        Validate {item.name} v{item.version}
                      </strong>
                      <Field
                        label="Scientific review note"
                        name="validationNote"
                      />
                      <Field
                        label="Golden fixture reference"
                        name="fixtureEvidenceReference"
                      />
                      <button disabled={busy}>Record validation</button>
                    </form>
                  ))}
                {catalog.templates
                  .filter((item) => item.state === "VALIDATED")
                  .map((item) => (
                    <button
                      key={item.id}
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api(`templates/${item.id}/approve`, {}),
                        )
                      }
                    >
                      Independently approve {item.name} v{item.version}
                    </button>
                  ))}
                {catalog.templates
                  .filter((item) => item.state === "APPROVED")
                  .map((item) => (
                    <button
                      key={item.id}
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api(`templates/${item.id}/activate`, {}),
                        )
                      }
                    >
                      Activate {item.name} v{item.version}
                    </button>
                  ))}
                {catalog.templates
                  .filter((item) => item.state === "ACTIVE")
                  .map((item) => (
                    <form
                      key={item.id}
                      className="inline-form"
                      onSubmit={formAction((form) =>
                        api(`templates/${item.id}/retire`, {
                          reason: value(form, "reason"),
                        }),
                      )}
                    >
                      <strong>
                        Retire {item.name} v{item.version}
                      </strong>
                      <Field label="Retirement reason" name="reason" />
                      <button disabled={busy}>Retire model</button>
                    </form>
                  ))}
              </div>
            </Card>
          </div>
        ) : tab === "goals" ? (
          <GoalsWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "development" ? (
          <DevelopmentWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "improvement" ? (
          <ImprovementWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "governance" ? (
          <GovernanceWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "context" ? (
          <ContextWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "organization" ? (
          <OrganizationWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "trends" ? (
          <TrendWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "evidence" ? (
          <div className="stack">
            <div className="intro compact">
              <div>
                <p className="eyebrow">Evidence provenance</p>
                <h2>Observations need verification.</h2>
                <p>
                  Missing evidence stays missing. An observed zero remains a
                  valid zero.
                </p>
              </div>
            </div>
            {catalog && (
              <div className="two-col">
                <Card title="Record observation">
                  <form
                    className="form-stack"
                    onSubmit={formAction(
                      (form) =>
                        api("evidence", {
                          employeeId: value(form, "employeeId"),
                          metricId: value(form, "metricId"),
                          observedAt: new Date(
                            value(form, "observedAt"),
                          ).toISOString(),
                          value: ["OBSERVED", "ZERO"].includes(
                            value(form, "dataState"),
                          )
                            ? value(form, "value")
                            : undefined,
                          dataState: value(form, "dataState"),
                          source: value(form, "source"),
                          note: value(form, "note") || undefined,
                          numerator: value(form, "numerator") || undefined,
                          denominator: value(form, "denominator") || undefined,
                        }),
                      () => void loadEvidence(),
                    )}
                  >
                    <label>
                      Employee
                      <Select
                        name="employeeId"
                        items={catalog.users}
                        placeholder="Choose employee"
                      />
                    </label>
                    <label>
                      Metric
                      <Select
                        name="metricId"
                        items={catalog.metrics}
                        placeholder="Choose metric"
                      />
                    </label>
                    <Field
                      label="Observed at"
                      name="observedAt"
                      type="datetime-local"
                    />
                    <label>
                      Data state
                      <select name="dataState">
                        <option value="OBSERVED">Observed value</option>
                        <option value="ZERO">Observed zero</option>
                        <option value="MISSING">Missing</option>
                        <option value="NOT_MEASURED">Not measured</option>
                        <option value="NOT_APPLICABLE">Not applicable</option>
                        <option value="INVALID">Invalid</option>
                        <option value="INSUFFICIENT_SAMPLE">
                          Insufficient sample
                        </option>
                        <option value="UNAVAILABLE_DUE_TO_DISRUPTION">
                          Unavailable due to disruption
                        </option>
                      </select>
                    </label>
                    <Field
                      label="Value (for observed / zero)"
                      name="value"
                      required={false}
                    />
                    <p>
                      For a binary proportion, enter the percent value and both
                      counts. A 95% uncertainty interval will accompany the
                      score trace; it does not change the score.
                    </p>
                    <Field
                      label="Numerator (optional count)"
                      name="numerator"
                      required={false}
                    />
                    <Field
                      label="Denominator (optional count)"
                      name="denominator"
                      required={false}
                    />
                    <Field label="Source" name="source" />
                    <Field label="Note" name="note" required={false} />
                    <button disabled={busy}>Submit evidence</button>
                  </form>
                </Card>
                <Card
                  title="Calculate evaluation"
                  description="The server uses the active role template, period target, and latest verified observation per metric."
                >
                  <form
                    className="form-stack"
                    onSubmit={formAction(
                      (form) =>
                        api(
                          `people/${value(form, "employeeId")}/cycles/${value(form, "cycleId")}/calculate`,
                          {},
                        ),
                      (result) => {
                        const id = (result as { id: string }).id;
                        void selectEvaluation(id);
                      },
                    )}
                  >
                    <label>
                      Employee
                      <Select
                        name="employeeId"
                        items={catalog.users}
                        placeholder="Choose employee"
                      />
                    </label>
                    <label>
                      Review cycle
                      <Select
                        name="cycleId"
                        items={catalog.cycles}
                        placeholder="Choose cycle"
                      />
                    </label>
                    <button disabled={busy || !manager}>
                      Calculate review
                    </button>
                  </form>
                </Card>
              </div>
            )}
            <Card title="Verification queue">
              <label className="filter-label">
                Show evidence for
                {catalog ? (
                  <select
                    value={evidencePerson}
                    onChange={(event) => setEvidencePerson(event.target.value)}
                  >
                    <option value="">Select an employee</option>
                    {catalog.users.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input disabled value="Your evidence" />
                )}
              </label>
              {!catalog && (
                <button onClick={() => setEvidencePerson(overview.person.id)}>
                  Load my evidence
                </button>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Observed</th>
                      <th>Value</th>
                      <th>Source</th>
                      <th>State</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map((item) => (
                      <tr key={item.id}>
                        <td>{item.metric_name}</td>
                        <td>
                          {new Date(item.observed_at).toLocaleDateString()}
                        </td>
                        <td>
                          {item.value ?? item.data_state}
                          {item.numerator !== null &&
                            item.denominator !== null && (
                              <small>
                                Count: {item.numerator}/{item.denominator}
                              </small>
                            )}
                        </td>
                        <td>{item.source}</td>
                        <td>
                          <span className="pill">
                            {item.verification_state.toLowerCase()}
                          </span>
                        </td>
                        <td>
                          {manager && item.verification_state === "PENDING" && (
                            <button
                              className="link-button"
                              onClick={() =>
                                void perform(
                                  () => api(`evidence/${item.id}/verify`, {}),
                                  () => void loadEvidence(),
                                )
                              }
                            >
                              Verify
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {evidence.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty">
                          Choose an employee to inspect evidence.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : tab === "feedback" ? (
          <FeedbackWorkspace person={overview.person} catalog={catalog} />
        ) : tab === "notifications" ? (
          <div className="stack">
            <Card
              title="Your notices"
              description="Open the related review for the full decision and its evidence."
            >
              {notifications.map((item) => (
                <div className="appeal" key={item.id}>
                  <strong>
                    {item.kind === "APPEAL_RESOLVED"
                      ? "An appeal has been resolved"
                      : item.kind}
                  </strong>
                  <p>{new Date(item.created_at).toLocaleString()}</p>
                  {item.read_at === null && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () => api(`notifications/${item.id}/read`, {}),
                          () =>
                            setNotifications((rows) =>
                              rows.map((row) =>
                                row.id === item.id
                                  ? {
                                      ...row,
                                      read_at: new Date().toISOString(),
                                    }
                                  : row,
                              ),
                            ),
                        )
                      }
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
              {notifications.length === 0 && <p>No notices in your inbox.</p>}
            </Card>
          </div>
        ) : tab === "reports" ? (
          <div className="stack">
            <div className="intro compact">
              <div>
                <p className="eyebrow">Canonical results</p>
                <h2>One source for every view.</h2>
                <p>
                  Calculated and final scores are distinct. Compare only within
                  a defensible role model.
                </p>
              </div>
            </div>
            <Card title="Evaluation register">
              <p className="report-export">
                <a
                  href="/api/v1/reports/evaluations.csv"
                  download="evaluations.csv"
                >
                  Download this register as CSV
                </a>
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Cycle</th>
                      <th>Status</th>
                      <th>Calculated</th>
                      <th>Published / effective</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.map((item) => (
                      <tr key={item.id}>
                        <td>{item.employee_name}</td>
                        <td>{item.cycle_name}</td>
                        <td>{item.status}</td>
                        <td>{item.score ?? "—"}</td>
                        <td>
                          {item.final_score ?? "—"}
                          {item.effective_score &&
                          item.effective_score !== item.final_score
                            ? ` / ${item.effective_score}`
                            : ""}
                        </td>
                      </tr>
                    ))}
                    {report.length === 0 && (
                      <tr>
                        <td colSpan={5} className="empty">
                          No report rows in your access scope.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {reportNextCursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const page = await api<{
                        rows: EvaluationRow[];
                        nextCursor: string | null;
                      }>(
                        `reports/evaluations?cursor=${encodeURIComponent(reportNextCursor)}`,
                      );
                      setReport((rows) => [...rows, ...page.rows]);
                      setReportNextCursor(page.nextCursor);
                      return page;
                    })
                  }
                >
                  Load more results
                </button>
              )}
            </Card>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function TemplateForm({
  catalog,
  busy,
  submit,
}: {
  catalog: Catalog;
  busy: boolean;
  submit: <T>(
    build: (form: FormData) => Promise<T>,
    after?: (result: T) => void,
  ) => (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [metrics, setMetrics] = useState<
    {
      metricId: string;
      weight: string;
      required: boolean;
      periodAggregation: "LATEST" | "MEAN_SCORE";
      minimumObservations: number;
    }[]
  >([
    {
      metricId: "",
      weight: "1",
      required: true,
      periodAggregation: "LATEST",
      minimumObservations: 1,
    },
  ]);
  return (
    <Card
      title="6 · Performance template"
      description="Choose job-relevant metrics. Weights in each dimension must add to 1."
    >
      <form
        className="form-stack"
        onSubmit={submit((form) =>
          api("templates", {
            jobId: value(form, "jobId"),
            name: value(form, "name"),
            version: Number(value(form, "version")),
            effectiveFrom: value(form, "effectiveFrom"),
            scientificRationale: value(form, "scientificRationale"),
            limitations: value(form, "limitations"),
            dimensions: [
              {
                name: value(form, "dimensionName"),
                weight: "1",
                missingWeightPolicy: {
                  version: 1,
                  mode: value(form, "missingWeightPolicy"),
                },
                metrics: metrics.filter((item) => item.metricId),
              },
            ],
          }),
        )}
      >
        <label>
          Job
          <Select name="jobId" items={catalog.jobs} placeholder="Choose job" />
        </label>
        <Field label="Template name" name="name" />
        <Field label="Version" name="version" type="number" defaultValue="1" />
        <Field label="Effective from" name="effectiveFrom" type="date" />
        <Field label="Scientific rationale" name="scientificRationale" />
        <Field label="Known limitations" name="limitations" />
        <Field
          label="Dimension name"
          name="dimensionName"
          defaultValue="Role outcomes"
        />
        <label>
          Missing optional metric weight
          <select name="missingWeightPolicy" defaultValue="BLOCK">
            <option value="BLOCK">Hold evaluation for review</option>
            <option value="REDISTRIBUTE">
              Redistribute among scored metrics
            </option>
          </select>
        </label>
        {metrics.map((item, index) => (
          <div className="metric-builder" key={index}>
            <label>
              Metric
              <select
                value={item.metricId}
                onChange={(event) =>
                  setMetrics((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, metricId: event.target.value }
                        : row,
                    ),
                  )
                }
              >
                <option value="">Choose metric</option>
                {catalog.metrics.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {metric.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Weight
              <input
                value={item.weight}
                onChange={(event) =>
                  setMetrics((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, weight: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={item.required}
                onChange={(event) =>
                  setMetrics((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, required: event.target.checked }
                        : row,
                    ),
                  )
                }
              />
              Required
            </label>
            <label>
              Period aggregation
              <select
                value={item.periodAggregation}
                onChange={(event) =>
                  setMetrics((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            periodAggregation: event.target.value as
                              "LATEST" | "MEAN_SCORE",
                          }
                        : row,
                    ),
                  )
                }
              >
                <option value="LATEST">Latest verified observation</option>
                <option value="MEAN_SCORE">
                  Mean of all observation scores
                </option>
              </select>
            </label>
            <label>
              Minimum observations
              <input
                type="number"
                min="1"
                max="10000"
                value={item.minimumObservations}
                onChange={(event) =>
                  setMetrics((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            minimumObservations: Number(event.target.value),
                          }
                        : row,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setMetrics((rows) => [
              ...rows,
              {
                metricId: "",
                weight: "0",
                required: true,
                periodAggregation: "LATEST",
                minimumObservations: 1,
              },
            ])
          }
        >
          Add metric
        </button>
        <button disabled={busy}>Create draft template</button>
      </form>
    </Card>
  );
}
