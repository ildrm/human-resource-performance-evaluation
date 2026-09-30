"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = {
  users: Person[];
  cycles: { id: string; name: string; purpose: string }[];
};
type Action = {
  id: string;
  cycle_name: string;
  competency_gap: string;
  current_level: string;
  target_level: string;
  activity: string;
  training: string | null;
  stretch_assignment: string | null;
  due_date: string;
  status: string;
  events: {
    id: string;
    kind: string;
    note: string;
    evidence_reference: string | null;
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

export default function DevelopmentWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [actions, setActions] = useState<Action[]>([]);
  const [selected, setSelected] = useState<Action | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    person.role,
  );
  const load = useCallback(async (id: string) => {
    const result = await api<{ actions: Action[] }>(
      `people/${id}/development-actions`,
    );
    setActions(result.actions);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);

  async function open(id: string) {
    const action = await api<Action>(`development-actions/${id}`);
    setSelected(action);
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
    actionId?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      const result = await task(new FormData(form));
      form.reset();
      await load(employeeId);
      if (actionId) await open(actionId);
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
          <p className="eyebrow">Growth and support</p>
          <h2>Development actions</h2>
          <p>
            Record the gap, the activity and the desired capability. Progress
            and manager decisions remain in the action history.
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
            <h2>Create development action</h2>
            <p>Use a development cycle. A linked goal is optional.</p>
          </div>
          <form
            className="form-stack"
            onSubmit={(event) =>
              void submit(event, (form) =>
                api("development-actions", {
                  employeeId,
                  cycleId: get(form, "cycleId"),
                  goalId: get(form, "goalId") || undefined,
                  competencyGap: get(form, "competencyGap"),
                  currentLevel: get(form, "currentLevel"),
                  targetLevel: get(form, "targetLevel"),
                  activity: get(form, "activity"),
                  training: get(form, "training") || undefined,
                  mentorId: get(form, "mentorId") || undefined,
                  stretchAssignment:
                    get(form, "stretchAssignment") || undefined,
                  dueDate: get(form, "dueDate"),
                }),
              )
            }
          >
            <label>
              Development cycle
              <select name="cycleId" required defaultValue="">
                <option value="" disabled>
                  Choose cycle
                </option>
                {catalog.cycles
                  .filter((cycle) => cycle.purpose === "DEVELOPMENT")
                  .map((cycle) => (
                    <option value={cycle.id} key={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Competency gap
              <textarea name="competencyGap" required minLength={10} />
            </label>
            <label>
              Current level
              <input name="currentLevel" required />
            </label>
            <label>
              Target level
              <input name="targetLevel" required />
            </label>
            <label>
              Development activity
              <textarea name="activity" required minLength={10} />
            </label>
            <label>
              Training (optional)
              <input name="training" />
            </label>
            <label>
              Mentor
              <select name="mentorId" defaultValue="">
                <option value="">None</option>
                {catalog.users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stretch assignment (optional)
              <input name="stretchAssignment" />
            </label>
            <label>
              Linked development goal ID (optional)
              <input name="goalId" />
            </label>
            <label>
              Due date
              <input name="dueDate" type="date" required />
            </label>
            <button disabled={busy}>Create action</button>
          </form>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Actions in view</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Gap and activity</th>
                <th>Cycle</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.id}>
                  <td>
                    <strong>{action.competency_gap}</strong>
                    <small>{action.activity}</small>
                  </td>
                  <td>{action.cycle_name}</td>
                  <td>{action.due_date.slice(0, 10)}</td>
                  <td>{action.status.toLowerCase().replaceAll("_", " ")}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() =>
                        void open(action.id).catch((error) =>
                          setNotice(String(error)),
                        )
                      }
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {actions.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No development actions in this employee scope.
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
              {selected.cycle_name} ·{" "}
              {selected.status.toLowerCase().replaceAll("_", " ")}
            </h2>
          </div>
          <div className="config-list">
            <p>
              <strong>Gap:</strong> {selected.competency_gap}
            </p>
            <p>
              <strong>Current level:</strong> {selected.current_level}
            </p>
            <p>
              <strong>Target level:</strong> {selected.target_level}
            </p>
            <p>
              <strong>Activity:</strong> {selected.activity}
            </p>
            {selected.training && (
              <p>
                <strong>Training:</strong> {selected.training}
              </p>
            )}
            {selected.stretch_assignment && (
              <p>
                <strong>Stretch assignment:</strong>{" "}
                {selected.stretch_assignment}
              </p>
            )}
          </div>
          <h3>Action history</h3>
          <ul>
            {selected.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {event.kind.toLowerCase()} ·{" "}
                  {new Date(event.created_at).toLocaleString()}
                </strong>{" "}
                · {event.note}
                {event.evidence_reference && (
                  <> · Evidence: {event.evidence_reference}</>
                )}
              </li>
            ))}
          </ul>
          {!["COMPLETED", "CANCELLED"].includes(selected.status) && (
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(
                  event,
                  (form) =>
                    api(`development-actions/${selected.id}/events`, {
                      kind: get(form, "kind"),
                      note: get(form, "note"),
                      evidenceReference:
                        get(form, "evidenceReference") || undefined,
                    }),
                  selected.id,
                )
              }
            >
              <h3>Record update</h3>
              <label>
                Update type
                <select name="kind">
                  <option value="PROGRESS">Progress</option>
                  {canManage && (
                    <>
                      <option value="REVIEW">Manager review</option>
                      <option value="COMPLETED">Complete</option>
                      <option value="CANCELLED">Cancel</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                Note
                <textarea name="note" required minLength={10} />
              </label>
              <label>
                Evidence reference (required for completion)
                <input name="evidenceReference" />
              </label>
              <button disabled={busy}>Save update</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
