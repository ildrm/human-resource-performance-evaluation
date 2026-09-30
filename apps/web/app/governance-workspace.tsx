"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = { users: Person[] };
type Case = {
  id: string;
  event_type: string;
  occurred_on: string;
  description: string;
  initial_evidence_reference: string;
  status: string;
  events: {
    id: string;
    kind: string;
    note: string;
    evidence_reference: string | null;
    policy_basis: string | null;
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
  if (status === "REPORTED" && hr)
    return [{ value: "TRIAGE", label: "Open independent investigation" }];
  if (status === "TRIAGED") {
    if (role === "EMPLOYEE")
      return [{ value: "EMPLOYEE_RESPONSE", label: "Employee response" }];
    if (hr)
      return [
        { value: "CONFIRM", label: "Confirm after employee response" },
        { value: "REJECT", label: "Reject unsubstantiated report" },
      ];
  }
  if (status === "CONFIRMED" && hr)
    return [{ value: "RESOLVE", label: "Resolve after remediation" }];
  return [];
}

export default function GovernanceWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [rows, setRows] = useState<Case[]>([]);
  const [selected, setSelected] = useState<Case | null>(null);
  const [eventKind, setEventKind] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canReport = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    person.role,
  );
  const options = selected ? eventOptions(selected.status, person.role) : [];
  const needsFindingEvidence = ["CONFIRM", "REJECT", "RESOLVE"].includes(
    eventKind,
  );
  const load = useCallback(async (id: string) => {
    const result = await api<{ cases: Case[] }>(
      `people/${id}/governance-cases`,
    );
    setRows(result.cases);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);

  async function open(id: string) {
    const record = await api<Case>(`governance-cases/${id}`);
    setSelected(record);
    setEventKind(eventOptions(record.status, person.role)[0]?.value ?? "");
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
    caseId?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      const result = await task(new FormData(form));
      form.reset();
      await load(employeeId);
      if (caseId) await open(caseId);
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
          <p className="eyebrow">Explicit governance</p>
          <h2>Safety and compliance cases</h2>
          <p>
            Independently reviewed cases are kept separate from score
            arithmetic. An open investigation or confirmed finding holds
            administrative publication until it is rejected or resolved.
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
      {canReport && catalog && (
        <section className="card">
          <div className="card-heading">
            <h2>Report a case</h2>
            <p>
              A report is not a finding. HR triage and an independent finding
              are required.
            </p>
          </div>
          <form
            className="form-stack"
            onSubmit={(event) =>
              void submit(event, (form) =>
                api("governance-cases", {
                  employeeId,
                  eventType: get(form, "eventType"),
                  occurredOn: get(form, "occurredOn"),
                  description: get(form, "description"),
                  evidenceReference: get(form, "evidenceReference"),
                }),
              )
            }
          >
            <label>
              Case type
              <select name="eventType">
                <option value="SAFETY">Safety</option>
                <option value="ETHICS">Ethics</option>
                <option value="FRAUD">Fraud</option>
                <option value="REGULATORY">Regulatory</option>
                <option value="SECURITY">Security</option>
              </select>
            </label>
            <label>
              Date of event
              <input
                name="occurredOn"
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>
              Factual description
              <textarea name="description" required minLength={20} />
            </label>
            <label>
              Initial evidence reference
              <input name="evidenceReference" required minLength={5} />
            </label>
            <button disabled={busy}>Report case</button>
          </form>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Cases in view</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Type and description</th>
                <th>Event date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.event_type.toLowerCase()}</strong>
                    <small>{record.description}</small>
                  </td>
                  <td>{record.occurred_on.slice(0, 10)}</td>
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
                    No visible cases for this employee.
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
              {selected.event_type.toLowerCase()} case ·{" "}
              {selected.status.toLowerCase()}
            </h2>
          </div>
          <div className="config-list">
            <p>
              <strong>Event:</strong> {selected.description}
            </p>
            <p>
              <strong>Initial evidence:</strong>{" "}
              {selected.initial_evidence_reference}
            </p>
          </div>
          <h3>Case history</h3>
          <ul>
            {selected.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.kind.toLowerCase().replaceAll("_", " ")} ·{" "}
                  {new Date(event.created_at).toLocaleString()}
                </strong>{" "}
                · {event.note}
                {event.evidence_reference && (
                  <> · Evidence: {event.evidence_reference}</>
                )}
                {event.policy_basis && <> · Policy: {event.policy_basis}</>}
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
                    api(`governance-cases/${selected.id}/events`, {
                      kind: get(form, "kind"),
                      note: get(form, "note"),
                      evidenceReference:
                        get(form, "evidenceReference") || undefined,
                      policyBasis: get(form, "policyBasis") || undefined,
                    }),
                  selected.id,
                )
              }
            >
              <h3>Record case event</h3>
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
                <textarea name="note" required minLength={20} />
              </label>
              {needsFindingEvidence && (
                <>
                  <label>
                    Evidence reference
                    <input name="evidenceReference" required minLength={5} />
                  </label>
                  <label>
                    Policy basis
                    <input name="policyBasis" required minLength={10} />
                  </label>
                </>
              )}
              <button disabled={busy}>Save case event</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
