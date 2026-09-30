"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = { users: Person[] };
type Evaluation = {
  id: string;
  employee_id: string;
  employee_name: string;
  cycle_name: string;
  purpose: string;
  status: string;
};
type Plan = {
  id: string;
  gap: string;
  expected_standard: string;
  supporting_evidence: string;
  required_improvement: string;
  support_provided: string;
  measurement_criteria: string;
  starts_on: string;
  ends_on: string;
  status: string;
  decision: string | null;
  final_decision: string | null;
  events: {
    id: string;
    kind: string;
    note: string;
    occurred_on: string | null;
    outcome: string | null;
    evidence_reference: string | null;
    policy_reference: string | null;
    created_at: string;
  }[];
};

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
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function get(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function eventOptions(
  status: string,
  role: string,
): { value: string; label: string }[] {
  const hr = ["TENANT_ADMIN", "HR_ADMIN"].includes(role);
  const manager = role === "MANAGER" || hr;
  if (status === "DRAFT" && hr)
    return [
      { value: "ACTIVATED", label: "Activate after independent HR review" },
    ];
  if (status === "ACTIVE") {
    if (role === "EMPLOYEE")
      return [{ value: "EMPLOYEE_RESPONSE", label: "Employee response" }];
    if (manager)
      return [
        { value: "REVIEW_MEETING", label: "Review meeting" },
        { value: "SUPPORT_UPDATE", label: "Support update" },
        ...(hr ? [{ value: "DECISION", label: "HR decision" }] : []),
      ];
  }
  if (status === "DECIDED") {
    if (role === "EMPLOYEE")
      return [{ value: "APPEAL", label: "Appeal decision" }];
    if (hr) return [{ value: "CLOSED", label: "Close after appeal window" }];
  }
  if (status === "APPEALED" && hr)
    return [
      { value: "APPEAL_RESOLUTION", label: "Resolve appeal independently" },
    ];
  return [];
}

export default function ImprovementWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [rows, setRows] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [eventKind, setEventKind] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    person.role,
  );
  const options = selected ? eventOptions(selected.status, person.role) : [];
  const eligibleEvaluations = evaluations.filter(
    (item) =>
      item.employee_id === employeeId &&
      item.purpose === "ADMINISTRATIVE" &&
      ["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(item.status),
  );
  const load = useCallback(async (id: string) => {
    const result = await api<{ plans: Plan[] }>(
      `people/${id}/improvement-plans`,
    );
    setRows(result.plans);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);
  useEffect(() => {
    if (!canManage) return;
    void api<{ rows: Evaluation[] }>("reports/evaluations")
      .then((result) => setEvaluations(result.rows))
      .catch((error) => setNotice(String(error)));
  }, [canManage]);

  async function open(id: string) {
    const plan = await api<Plan>(`improvement-plans/${id}`);
    setSelected(plan);
    setEventKind(eventOptions(plan.status, person.role)[0]?.value ?? "");
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
    planId?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      const result = await task(new FormData(form));
      form.reset();
      await load(employeeId);
      if (planId) await open(planId);
      else if (typeof result === "object" && result !== null && "id" in result)
        await open(String(result.id));
      setNotice("Saved successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="intro compact">
        <div>
          <p className="eyebrow">Formal personnel process</p>
          <h2>Improvement plans</h2>
          <p>
            A plan records the standard, evidence, support, employee response,
            meetings, decision, and appeal. It does not automate an employment
            action.
          </p>
        </div>
      </div>
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
      {catalog && (
        <label className="filter-label">
          Employee
          <select
            value={employeeId}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setSelected(null);
            }}
          >
            {catalog.users.map((user) => (
              <option value={user.id} key={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {canManage && catalog && (
        <section className="card">
          <div className="card-heading">
            <h2>Draft improvement plan</h2>
            <p>
              Start from this employee&apos;s published administrative
              evaluation. Independent HR review is required before the employee
              sees the plan.
            </p>
          </div>
          {eligibleEvaluations.length === 0 ? (
            <p>
              No published administrative evaluation is available for this
              employee in the current report.
            </p>
          ) : (
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(event, (form) =>
                  api("improvement-plans", {
                    employeeId,
                    sourceEvaluationId: get(form, "sourceEvaluationId"),
                    gap: get(form, "gap"),
                    expectedStandard: get(form, "expectedStandard"),
                    supportingEvidence: get(form, "supportingEvidence"),
                    requiredImprovement: get(form, "requiredImprovement"),
                    supportProvided: get(form, "supportProvided"),
                    measurementCriteria: get(form, "measurementCriteria"),
                    startsOn: get(form, "startsOn"),
                    endsOn: get(form, "endsOn"),
                  }),
                )
              }
            >
              <label>
                Published administrative evaluation
                <select name="sourceEvaluationId" required defaultValue="">
                  <option value="" disabled>
                    Choose evaluation
                  </option>
                  {eligibleEvaluations.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.cycle_name} · {item.employee_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Specific performance gap
                <textarea name="gap" required minLength={10} />
              </label>
              <label>
                Expected standard
                <textarea name="expectedStandard" required minLength={10} />
              </label>
              <label>
                Supporting evidence and source
                <textarea name="supportingEvidence" required minLength={10} />
              </label>
              <label>
                Required improvement
                <textarea name="requiredImprovement" required minLength={10} />
              </label>
              <label>
                Support provided
                <textarea name="supportProvided" required minLength={10} />
              </label>
              <label>
                Measurement criteria
                <textarea name="measurementCriteria" required minLength={10} />
              </label>
              <label>
                Start date
                <input name="startsOn" type="date" required />
              </label>
              <label>
                End date
                <input name="endsOn" type="date" required />
              </label>
              <button disabled={busy}>Create draft</button>
            </form>
          )}
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Plans in view</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Gap</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Decision</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.gap}</strong>
                  </td>
                  <td>
                    {plan.starts_on.slice(0, 10)} to {plan.ends_on.slice(0, 10)}
                  </td>
                  <td>{plan.status.toLowerCase()}</td>
                  <td>{plan.final_decision ?? plan.decision ?? "Pending"}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() =>
                        void open(plan.id).catch((error) =>
                          setNotice(String(error)),
                        )
                      }
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No improvement plans in this employee scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {selected && (
        <section className="card">
          <div className="card-heading">
            <h2>Plan · {selected.status.toLowerCase()}</h2>
            <p>
              Outcome is a documented human decision. The original decision and
              appeal result remain visible.
            </p>
          </div>
          <div className="config-list">
            <p>
              <strong>Gap:</strong> {selected.gap}
            </p>
            <p>
              <strong>Expected standard:</strong> {selected.expected_standard}
            </p>
            <p>
              <strong>Supporting evidence:</strong>{" "}
              {selected.supporting_evidence}
            </p>
            <p>
              <strong>Required improvement:</strong>{" "}
              {selected.required_improvement}
            </p>
            <p>
              <strong>Support provided:</strong> {selected.support_provided}
            </p>
            <p>
              <strong>Measurement criteria:</strong>{" "}
              {selected.measurement_criteria}
            </p>
            {selected.decision && (
              <p>
                <strong>Initial decision:</strong> {selected.decision}
              </p>
            )}
            {selected.final_decision && (
              <p>
                <strong>Final decision:</strong> {selected.final_decision}
              </p>
            )}
          </div>
          <h3>Immutable event history</h3>
          <ul>
            {selected.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.kind.toLowerCase().replaceAll("_", " ")} ·{" "}
                  {new Date(event.created_at).toLocaleString()}
                </strong>{" "}
                · {event.note}
                {event.occurred_on && (
                  <> · Date: {event.occurred_on.slice(0, 10)}</>
                )}
                {event.outcome && <> · Outcome: {event.outcome}</>}
                {event.evidence_reference && (
                  <> · Evidence: {event.evidence_reference}</>
                )}
                {event.policy_reference && (
                  <> · Policy: {event.policy_reference}</>
                )}
              </li>
            ))}
          </ul>
          {options.length > 0 && (
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(
                  event,
                  (form) =>
                    api(`improvement-plans/${selected.id}/events`, {
                      kind: get(form, "kind"),
                      note: get(form, "note"),
                      occurredOn: get(form, "occurredOn") || undefined,
                      outcome: get(form, "outcome") || undefined,
                      evidenceReference:
                        get(form, "evidenceReference") || undefined,
                      policyReference:
                        get(form, "policyReference") || undefined,
                    }),
                  selected.id,
                )
              }
            >
              <h3>Record plan event</h3>
              <label>
                Event type
                <select
                  name="kind"
                  value={eventKind}
                  onChange={(event) => setEventKind(event.target.value)}
                >
                  {options.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <textarea name="note" required minLength={10} />
              </label>
              {eventKind === "REVIEW_MEETING" && (
                <label>
                  Meeting date
                  <input name="occurredOn" type="date" required />
                </label>
              )}
              {["DECISION", "APPEAL_RESOLUTION"].includes(eventKind) && (
                <>
                  <label>
                    Outcome
                    <select name="outcome" required defaultValue="">
                      <option value="" disabled>
                        Choose outcome
                      </option>
                      <option value="MET">Standard met</option>
                      <option value="NOT_MET">Standard not met</option>
                    </select>
                  </label>
                  <label>
                    Evidence reference
                    <input name="evidenceReference" required minLength={5} />
                  </label>
                </>
              )}
              {eventKind === "CLOSED" && (
                <>
                  <label>
                    Appeal deadline date
                    <input name="occurredOn" type="date" required />
                  </label>
                  <label>
                    Local appeal-window policy reference
                    <input name="policyReference" required minLength={10} />
                  </label>
                </>
              )}
              <button disabled={busy}>Save plan event</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
