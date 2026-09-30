"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = {
  users: Person[];
  cycles: { id: string; name: string; purpose: string }[];
};
type GoalRow = {
  id: string;
  cycle_name: string;
  purpose: string;
  kind: string;
  version: number;
  description: string;
  target: string;
  due_date: string;
  status: string;
};
type Revision = {
  version: number;
  effective_at: string;
  description: string;
  baseline: string;
  threshold: string;
  target: string;
  stretch: string;
  due_date: string;
  priority: string;
  weight: string | null;
  review_cadence: string;
  dependencies: string[];
  status: string;
  reason: string;
};
type GoalDetail = {
  id: string;
  purpose: string;
  kind: string;
  cycle_name: string;
  revisions: Revision[];
  checkins: {
    id: string;
    progress: string;
    obstacle: string | null;
    support_needed: string | null;
    next_action: string;
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

function fields(form: FormData) {
  return {
    description: get(form, "description"),
    baseline: get(form, "baseline"),
    threshold: get(form, "threshold"),
    target: get(form, "target"),
    stretch: get(form, "stretch"),
    dueDate: get(form, "dueDate"),
    priority: get(form, "priority"),
    weight: get(form, "weight") || undefined,
    reviewCadence: get(form, "reviewCadence"),
    dependencies: get(form, "dependencies")
      ? get(form, "dependencies")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    status: get(form, "status"),
    reason: get(form, "reason"),
  };
}

function GoalFields({ revision }: { revision?: Revision }) {
  return (
    <>
      <label>
        Description
        <textarea
          name="description"
          required
          minLength={10}
          maxLength={3000}
          defaultValue={revision?.description}
        />
      </label>
      <label>
        Baseline
        <input name="baseline" required defaultValue={revision?.baseline} />
      </label>
      <label>
        Threshold
        <input name="threshold" required defaultValue={revision?.threshold} />
      </label>
      <label>
        Target
        <input name="target" required defaultValue={revision?.target} />
      </label>
      <label>
        Stretch
        <input name="stretch" required defaultValue={revision?.stretch} />
      </label>
      <label>
        Due date
        <input
          name="dueDate"
          type="date"
          required
          defaultValue={revision?.due_date?.slice(0, 10)}
        />
      </label>
      <label>
        Priority
        <select name="priority" defaultValue={revision?.priority ?? "NORMAL"}>
          <option value="LOW">Low</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
        </select>
      </label>
      <label>
        Optional weight (0 to 1)
        <input
          name="weight"
          type="number"
          min="0"
          max="1"
          step="0.00001"
          defaultValue={revision?.weight ?? ""}
        />
      </label>
      <label>
        Review cadence
        <select
          name="reviewCadence"
          defaultValue={revision?.review_cadence ?? "MONTHLY"}
        >
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Every two weeks</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
        </select>
      </label>
      <label>
        Dependency goal IDs (comma separated)
        <input
          name="dependencies"
          defaultValue={revision?.dependencies.join(", ") ?? ""}
        />
      </label>
      <label>
        Status
        <select name="status" defaultValue={revision?.status ?? "PLANNED"}>
          <option value="PLANNED">Planned</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      <label>
        Reason for this version
        <input
          name="reason"
          required
          minLength={10}
          defaultValue={revision?.reason}
        />
      </label>
    </>
  );
}

export default function GoalsWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [selected, setSelected] = useState<GoalDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(
    person.role,
  );
  const canCheckin = canManage || person.role === "EMPLOYEE";
  const current = selected?.revisions
    .filter(
      (revision) => new Date(revision.effective_at).getTime() <= Date.now(),
    )
    .at(-1);
  const latest = selected?.revisions.at(-1);

  const load = useCallback(async (id: string) => {
    const data = await api<{ goals: GoalRow[] }>(`people/${id}/goals`);
    setRows(data.goals);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);

  async function open(id: string) {
    try {
      setSelected(await api<GoalDetail>(`goals/${id}`));
      setNotice("");
    } catch (error) {
      setNotice(String(error));
    }
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
    goalId?: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      const result = await task(new FormData(form));
      form.reset();
      await load(employeeId);
      if (goalId) await open(goalId);
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
          <p className="eyebrow">Continuous performance</p>
          <h2>Goals and check-ins</h2>
          <p>
            Each change has a future effective time and preserved history.
            Development goals remain distinct from administrative cycles.
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
            <h2>Create goal</h2>
            <p>
              Define observable expectations and review them during the cycle.
              This record does not calculate an employee score.
            </p>
          </div>
          <form
            className="form-stack"
            onSubmit={(event) =>
              void submit(event, (form) =>
                api("goals", {
                  ...fields(form),
                  employeeId,
                  cycleId: get(form, "cycleId"),
                  kind: get(form, "kind"),
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
                {catalog.cycles.map((cycle) => (
                  <option value={cycle.id} key={cycle.id}>
                    {cycle.name} · {cycle.purpose.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Goal type
              <select name="kind">
                <option value="PERFORMANCE">Performance</option>
                <option value="LEARNING">Learning</option>
                <option value="PROJECT">Project</option>
                <option value="TEAM">Team</option>
                <option value="STRATEGIC">Strategic</option>
                <option value="COMPLIANCE">Compliance</option>
                <option value="IMPROVEMENT">Improvement</option>
                <option value="RECOVERY">Recovery</option>
              </select>
            </label>
            <GoalFields />
            <button disabled={busy}>Create goal</button>
          </form>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Goals in view</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Goal</th>
                <th>Cycle</th>
                <th>Purpose</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((goal) => (
                <tr key={goal.id}>
                  <td>
                    <strong>{goal.description}</strong>
                    <small>
                      {goal.kind.toLowerCase()} · version {goal.version}
                    </small>
                  </td>
                  <td>{goal.cycle_name}</td>
                  <td>{goal.purpose.toLowerCase()}</td>
                  <td>{goal.due_date.slice(0, 10)}</td>
                  <td>{goal.status.toLowerCase()}</td>
                  <td>
                    <button
                      className="link-button"
                      onClick={() => void open(goal.id)}
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No goals in this employee scope.
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
              {selected.kind.toLowerCase()} goal · {selected.cycle_name}
            </h2>
            <p>
              {selected.purpose.toLowerCase()} purpose; revisions take effect at
              their recorded time.
            </p>
          </div>
          {current && (
            <div className="config-list">
              <p>
                <strong>Current expectation:</strong> {current.description}
              </p>
              <p>
                <strong>Baseline:</strong> {current.baseline}
              </p>
              <p>
                <strong>Threshold:</strong> {current.threshold}
              </p>
              <p>
                <strong>Target:</strong> {current.target}
              </p>
              <p>
                <strong>Stretch:</strong> {current.stretch}
              </p>
            </div>
          )}
          <h3>Version history</h3>
          <ul>
            {selected.revisions.map((revision) => (
              <li key={revision.version}>
                v{revision.version} · effective{" "}
                {new Date(revision.effective_at).toLocaleString()} ·{" "}
                {revision.status.toLowerCase()} · {revision.reason}
              </li>
            ))}
          </ul>
          <h3>Check-ins</h3>
          <ul>
            {selected.checkins.map((checkin) => (
              <li key={checkin.id}>
                <strong>{new Date(checkin.created_at).toLocaleString()}</strong>{" "}
                · {checkin.progress}
                <br />
                Next: {checkin.next_action}
                {checkin.support_needed && (
                  <> · Support: {checkin.support_needed}</>
                )}
                {checkin.evidence_reference && (
                  <> · Evidence: {checkin.evidence_reference}</>
                )}
              </li>
            ))}
          </ul>
          {canCheckin && (
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(
                  event,
                  (form) =>
                    api(`goals/${selected.id}/check-ins`, {
                      progress: get(form, "progress"),
                      obstacle: get(form, "obstacle") || undefined,
                      supportNeeded: get(form, "supportNeeded") || undefined,
                      evidenceReference:
                        get(form, "evidenceReference") || undefined,
                      nextAction: get(form, "nextAction"),
                    }),
                  selected.id,
                )
              }
            >
              <h3>Record check-in</h3>
              <label>
                Progress
                <textarea name="progress" required minLength={10} />
              </label>
              <label>
                Obstacle
                <input name="obstacle" />
              </label>
              <label>
                Support needed
                <input name="supportNeeded" />
              </label>
              <label>
                Evidence reference
                <input name="evidenceReference" />
              </label>
              <label>
                Next action
                <input name="nextAction" required minLength={5} />
              </label>
              <button disabled={busy}>Save check-in</button>
            </form>
          )}
          {canManage && latest && (
            <form
              className="form-stack"
              key={`${selected.id}-${latest.version}`}
              onSubmit={(event) =>
                void submit(
                  event,
                  (form) =>
                    api(`goals/${selected.id}/revisions`, {
                      ...fields(form),
                      expectedVersion: latest.version,
                      effectiveAt: new Date(
                        get(form, "effectiveAt"),
                      ).toISOString(),
                    }),
                  selected.id,
                )
              }
            >
              <h3>Schedule a prospective revision</h3>
              <label>
                Effective date and time
                <input name="effectiveAt" type="datetime-local" required />
              </label>
              <GoalFields revision={latest} />
              <button disabled={busy}>Schedule revision</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
