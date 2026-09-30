"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string; job_id: string | null };
type Catalog = {
  users: Person[];
  jobs: { id: string; name: string }[];
  cycles: { id: string; name: string }[];
};
type Scale = {
  id: string;
  job_id: string;
  name: string;
  version: number;
  state: string;
};
type Campaign = {
  id: string;
  employee_name: string;
  employee_id: string;
  scale_id: string;
  state: string;
  purpose: string;
};
type Assignment = {
  campaign_id: string;
  subject_name: string;
  scale_name: string;
  relationship: string;
  anchors: { level: number; behavior: string }[];
};
type Summary = {
  status: string;
  scaleName?: string;
  weightedScore?: string;
  selfScore?: string | null;
  reason?: string;
  interpretation?: string;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/feedback/${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    cache: "no-store",
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : `Request failed (${response.status})`,
    );
  return data as T;
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export default function FeedbackWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const admin = ["TENANT_ADMIN", "HR_ADMIN"].includes(person.role);
  const [scales, setScales] = useState<Scale[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [summary, setSummary] = useState<{
    id: string;
    result: Summary;
  } | null>(null);
  const [subject, setSubject] = useState("");
  const [relationship, setRelationship] = useState("PEER");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [list, tasks] = await Promise.all([
      request<{ scales: Scale[]; campaigns: Campaign[] }>("catalog"),
      request<{ assignments: Assignment[] }>("assignments"),
    ]);
    setScales(list.scales);
    setCampaigns(list.campaigns);
    setAssignments(tasks.assignments);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(String(error)));
  }, [refresh]);

  async function run<T>(task: () => Promise<T>, done?: (result: T) => void) {
    setBusy(true);
    setNotice("");
    try {
      const result = await task();
      done?.(result);
      await refresh();
      setNotice("Saved successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function submit<T>(build: (form: FormData) => Promise<T>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      void run(
        () => build(new FormData(form)),
        () => form.reset(),
      );
    };
  }

  return (
    <div className="stack">
      <div className="intro compact">
        <div>
          <p className="eyebrow">Observable behavior</p>
          <h2>Anchored feedback for each role.</h2>
          <p>
            Feedback is descriptive. Self ratings do not enter the weighted
            summary, and feedback never changes the authoritative score
            automatically.
          </p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {admin && catalog && (
        <div className="two-col">
          <section className="card">
            <div className="card-heading">
              <h2>Create a BARS scale</h2>
              <p>
                Write an observable behavior for every level, then seek
                independent approval.
              </p>
            </div>
            <form
              className="form-stack"
              onSubmit={submit((form) =>
                request("scales", {
                  jobId: value(form, "jobId"),
                  name: value(form, "name"),
                  version: Number(value(form, "version")),
                  jobAnalysisReference: value(form, "jobAnalysisReference"),
                  developmentMethod: value(form, "developmentMethod"),
                  limitations: value(form, "limitations"),
                  anchors: [1, 2, 3, 4, 5].map((level) => ({
                    level,
                    behavior: value(form, `level${level}`),
                  })),
                }),
              )}
            >
              <label>
                Job
                <select name="jobId" required defaultValue="">
                  <option value="" disabled>
                    Choose job
                  </option>
                  {catalog.jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Scale name
                <input name="name" required />
              </label>
              <label>
                Version
                <input
                  name="version"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Job analysis reference
                <textarea name="jobAnalysisReference" required />
              </label>
              <label>
                Development method
                <textarea name="developmentMethod" required />
              </label>
              <label>
                Limitations
                <textarea name="limitations" required />
              </label>
              {[1, 2, 3, 4, 5].map((level) => (
                <label key={level}>
                  Level {level} observable anchor
                  <textarea name={`level${level}`} required />
                </label>
              ))}
              <button disabled={busy}>Create draft scale</button>
            </form>
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>Open a feedback campaign</h2>
              <p>
                Use a single relationship group in this form. The API supports
                configured groups and weights.
              </p>
            </div>
            <form
              className="form-stack"
              onSubmit={submit((form) =>
                request("campaigns", {
                  employeeId: value(form, "employeeId"),
                  cycleId: value(form, "cycleId"),
                  scaleId: value(form, "scaleId"),
                  minimumRespondents: Number(value(form, "minimumRespondents")),
                  weights: [{ relationship, weight: "1" }],
                  invitations: form
                    .getAll("respondents")
                    .map((id) => ({ respondentId: String(id), relationship })),
                }),
              )}
            >
              <label>
                Employee
                <select
                  name="employeeId"
                  required
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                >
                  <option value="">Choose employee</option>
                  {catalog.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cycle
                <select name="cycleId" required defaultValue="">
                  <option value="" disabled>
                    Choose cycle
                  </option>
                  {catalog.cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Active scale
                <select key={subject} name="scaleId" required defaultValue="">
                  <option value="" disabled>
                    Choose scale
                  </option>
                  {scales
                    .filter(
                      (scale) =>
                        scale.state === "ACTIVE" &&
                        (!subject ||
                          scale.job_id ===
                            catalog.users.find((user) => user.id === subject)
                              ?.job_id),
                    )
                    .map((scale) => (
                      <option key={scale.id} value={scale.id}>
                        {scale.name} v{scale.version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Relationship
                <select
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                >
                  <option value="PEER">Peer</option>
                  <option value="DIRECT_REPORT">Direct report</option>
                  <option value="PROJECT_LEADER">Project leader</option>
                  <option value="MATRIX_MANAGER">Matrix manager</option>
                  <option value="INTERNAL_CUSTOMER">Internal customer</option>
                  <option value="EXTERNAL_STAKEHOLDER">
                    External stakeholder
                  </option>
                  <option value="MANAGER">Manager</option>
                </select>
              </label>
              <label>
                Minimum anonymous respondents
                <input
                  name="minimumRespondents"
                  type="number"
                  min="3"
                  max="20"
                  defaultValue="3"
                  required
                />
              </label>
              <label>
                Respondents (select several)
                <select
                  name="respondents"
                  multiple
                  required
                  size={Math.min(8, Math.max(3, catalog.users.length))}
                >
                  {catalog.users
                    .filter((user) => user.id !== subject)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                </select>
              </label>
              <button disabled={busy}>Open campaign</button>
            </form>
          </section>
        </div>
      )}

      {admin && scales.some((scale) => scale.state === "DRAFT") && (
        <section className="card">
          <div className="card-heading">
            <h2>Scale approval queue</h2>
          </div>
          <div className="actions">
            {scales
              .filter((scale) => scale.state === "DRAFT")
              .map((scale) => (
                <form
                  key={scale.id}
                  className="inline-form"
                  onSubmit={submit((form) =>
                    request(`scales/${scale.id}/activate`, {
                      approvalReference: value(form, "approvalReference"),
                    }),
                  )}
                >
                  <span>
                    {scale.name} v{scale.version}
                  </span>
                  <label>
                    Review reference
                    <input name="approvalReference" required />
                  </label>
                  <button disabled={busy}>Activate</button>
                </form>
              ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-heading">
          <h2>My rating assignments</h2>
          <p>
            Only invited respondents can submit one observation. Individual
            responses are never shown in summaries.
          </p>
        </div>
        {assignments.length === 0 && <p>No open assignments.</p>}
        {assignments.map((assignment) => (
          <div key={assignment.campaign_id} className="appeal">
            <h3>
              {assignment.subject_name} · {assignment.scale_name}
            </h3>
            <p>
              Relationship:{" "}
              {assignment.relationship.replaceAll("_", " ").toLowerCase()}
            </p>
            <ol>
              {assignment.anchors.map((anchor) => (
                <li key={anchor.level}>
                  {anchor.level}: {anchor.behavior}
                </li>
              ))}
            </ol>
            <form
              className="form-stack"
              onSubmit={submit((form) =>
                request(`campaigns/${assignment.campaign_id}/ratings`, {
                  level: Number(value(form, "level")),
                  observedExample: value(form, "observedExample"),
                }),
              )}
            >
              <label>
                Anchored level
                <select name="level" required defaultValue="">
                  <option value="" disabled>
                    Choose level
                  </option>
                  {assignment.anchors.map((anchor) => (
                    <option key={anchor.level} value={anchor.level}>
                      {anchor.level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observed example
                <textarea name="observedExample" required />
              </label>
              <button disabled={busy}>Submit rating</button>
            </form>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-heading">
          <h2>Feedback summaries</h2>
          <p>
            Summaries appear only after closure. Anonymous groups below the
            threshold stay suppressed.
          </p>
        </div>
        {campaigns.length === 0 && <p>No campaigns in your access scope.</p>}
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="appeal">
            <strong>
              {campaign.employee_name} · {campaign.purpose.toLowerCase()} ·{" "}
              {campaign.state.toLowerCase()}
            </strong>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => request<Summary>(`campaigns/${campaign.id}/summary`),
                    (result) => setSummary({ id: campaign.id, result }),
                  )
                }
              >
                View summary
              </button>
              {admin && campaign.state === "OPEN" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      request(`campaigns/${campaign.id}/close`, {}),
                    )
                  }
                >
                  Close campaign
                </button>
              )}
            </div>
            {summary?.id === campaign.id && (
              <div role="status">
                <p>Status: {summary.result.status}</p>
                {summary.result.weightedScore && (
                  <p>
                    Weighted behavior rating: {summary.result.weightedScore} / 5
                  </p>
                )}
                {summary.result.selfScore && (
                  <p>Your self rating: {summary.result.selfScore} / 5</p>
                )}
                {summary.result.reason && <p>{summary.result.reason}</p>}
                {summary.result.interpretation && (
                  <p>{summary.result.interpretation}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
