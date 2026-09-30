"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = {
  users: Person[];
  cycles: { id: string; name: string; purpose: string }[];
};
type RecordRow = {
  id: string;
  cycle_name: string;
  kind: string;
  description: string;
  impact: string;
  evidence_reference: string;
  expected_exposure: string | null;
  actual_exposure: string | null;
  exposure_unit: string | null;
  status: string;
  created_by: string;
  review: {
    decision: string;
    note: string;
    evidence_reference: string | null;
  } | null;
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

export default function ContextWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [availableCycles, setAvailableCycles] = useState<Catalog["cycles"]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canCreate = [
    "TENANT_ADMIN",
    "HR_ADMIN",
    "MANAGER",
    "EMPLOYEE",
  ].includes(person.role);
  const canReview = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    person.role,
  );
  const load = useCallback(async (id: string) => {
    const result = await api<{ records: RecordRow[] }>(`people/${id}/context`);
    setRows(result.records);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);
  useEffect(() => {
    void api<{ cycles: Catalog["cycles"] }>(
      `people/${employeeId}/context-cycles`,
    )
      .then((result) => setAvailableCycles(result.cycles))
      .catch((error) => setNotice(String(error)));
  }, [employeeId]);

  async function open(id: string) {
    setSelected(await api<RecordRow>(`context/${id}`));
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
    recordId?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      const result = await task(new FormData(form));
      form.reset();
      await load(employeeId);
      if (recordId) await open(recordId);
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
          <p className="eyebrow">Conditions of work</p>
          <h2>Context and opportunity</h2>
          <p>
            Document opportunity, complexity, resources, and disruption with
            evidence. Reviewers verify the context separately; it never changes
            the score by itself.
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
      {canCreate && (
        <section className="card">
          <div className="card-heading">
            <h2>Submit context</h2>
            <p>
              Give a factual description and a source that an independent
              reviewer can check.
            </p>
          </div>
          <form
            className="form-stack"
            onSubmit={(event) =>
              void submit(event, (form) =>
                api("context", {
                  employeeId,
                  cycleId: get(form, "cycleId"),
                  kind: get(form, "kind"),
                  description: get(form, "description"),
                  impact: get(form, "impact"),
                  evidenceReference: get(form, "evidenceReference"),
                  expectedExposure: get(form, "expectedExposure") || undefined,
                  actualExposure: get(form, "actualExposure") || undefined,
                  exposureUnit: get(form, "exposureUnit") || undefined,
                }),
              )
            }
          >
            <label>
              Review cycle
              <select name="cycleId" required defaultValue="">
                <option value="" disabled>
                  Choose cycle
                </option>
                {availableCycles.map((cycle) => (
                  <option value={cycle.id} key={cycle.id}>
                    {cycle.name} · {cycle.purpose.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Context type
              <select name="kind">
                <option value="OPPORTUNITY">Opportunity or exposure</option>
                <option value="COMPLEXITY">Task complexity</option>
                <option value="RESOURCE">Resources</option>
                <option value="DISRUPTION">Disruption</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              Factual description
              <textarea name="description" required minLength={20} />
            </label>
            <label>
              Effect on the work
              <textarea name="impact" required minLength={10} />
            </label>
            <label>
              Evidence reference
              <input name="evidenceReference" required minLength={5} />
            </label>
            <p>
              Optional comparable exposure counts. Fill all three fields
              together.
            </p>
            <label>
              Expected exposure
              <input name="expectedExposure" type="number" min="0" step="any" />
            </label>
            <label>
              Actual exposure
              <input name="actualExposure" type="number" min="0" step="any" />
            </label>
            <label>
              Exposure unit
              <input name="exposureUnit" />
            </label>
            <button disabled={busy}>Submit context</button>
          </form>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Context in view</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Context</th>
                <th>Cycle</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.description}</strong>
                    <small>{record.kind.toLowerCase()}</small>
                  </td>
                  <td>{record.cycle_name}</td>
                  <td>{record.status.toLowerCase()}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() =>
                        void open(record.id).catch((error) =>
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
                  <td colSpan={4} className="empty">
                    No context records in this employee scope.
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
            <h2>
              {selected.kind.toLowerCase()} · {selected.status.toLowerCase()}
            </h2>
          </div>
          <div className="config-list">
            <p>
              <strong>Cycle:</strong> {selected.cycle_name}
            </p>
            <p>
              <strong>Context:</strong> {selected.description}
            </p>
            <p>
              <strong>Effect:</strong> {selected.impact}
            </p>
            <p>
              <strong>Source:</strong> {selected.evidence_reference}
            </p>
            {selected.expected_exposure !== null && (
              <p>
                <strong>Exposure:</strong> {selected.actual_exposure} of{" "}
                {selected.expected_exposure} {selected.exposure_unit}
              </p>
            )}
            {selected.review && (
              <p>
                <strong>Review:</strong>{" "}
                {selected.review.decision.toLowerCase()} ·{" "}
                {selected.review.note}
                {selected.review.evidence_reference && (
                  <> · {selected.review.evidence_reference}</>
                )}
              </p>
            )}
          </div>
          {canReview &&
            selected.status === "SUBMITTED" &&
            selected.created_by !== person.id && (
              <form
                className="form-stack"
                onSubmit={(event) =>
                  void submit(
                    event,
                    (form) =>
                      api(`context/${selected.id}/review`, {
                        decision: get(form, "decision"),
                        note: get(form, "note"),
                        evidenceReference:
                          get(form, "evidenceReference") || undefined,
                      }),
                    selected.id,
                  )
                }
              >
                <h3>Independent context review</h3>
                <label>
                  Decision
                  <select name="decision">
                    <option value="VERIFIED">Verify</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                </label>
                <label>
                  Review note
                  <textarea name="note" required minLength={20} />
                </label>
                <label>
                  Verification evidence reference
                  <input name="evidenceReference" />
                </label>
                <button disabled={busy}>Save review</button>
              </form>
            )}
        </section>
      )}
    </div>
  );
}
