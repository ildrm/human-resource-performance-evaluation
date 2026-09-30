"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = { users: Person[] };
type Unit = {
  id: string;
  code: string;
  name: string;
  kind: string;
  parent_name: string | null;
  effective_from: string;
  effective_to: string | null;
};
type Assignment = {
  id: string;
  unit_name: string;
  code: string;
  kind: string;
  assignment_role: string;
  effective_from: string;
  effective_to: string | null;
  reason: string;
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
function get(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}
function date(value: string | null): string {
  return value?.slice(0, 10) ?? "Open-ended";
}

const kinds = [
  "ORGANIZATION",
  "SUBSIDIARY",
  "LEGAL_ENTITY",
  "COUNTRY",
  "REGION",
  "SITE",
  "DIVISION",
  "BUSINESS_UNIT",
  "DEPARTMENT",
  "TEAM",
  "COST_CENTER",
  "PROJECT_TEAM",
] as const;

export default function OrganizationWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [units, setUnits] = useState<Unit[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdminister = ["TENANT_ADMIN", "HR_ADMIN"].includes(person.role);
  const canListUnits = canAdminister || person.role === "MANAGER";
  const load = useCallback(async (id: string) => {
    const result = await api<{ assignments: Assignment[] }>(
      `people/${id}/organization`,
    );
    setAssignments(result.assignments);
  }, []);
  const loadUnits = useCallback(async () => {
    const result = await api<{ units: Unit[] }>("organization/units");
    setUnits(result.units);
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);
  useEffect(() => {
    if (canListUnits)
      void loadUnits().catch((error) => setNotice(String(error)));
  }, [canListUnits, loadUnits]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: (form: FormData) => Promise<unknown>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setNotice("");
    try {
      await task(new FormData(form));
      form.reset();
      await Promise.all([
        load(employeeId),
        ...(canListUnits ? [loadUnits()] : []),
      ]);
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
          <p className="eyebrow">Effective-dated structure</p>
          <h2>Organization history</h2>
          <p>
            Primary and matrix assignments are kept separately. A review
            captures the active assignments at the end of its cycle.
          </p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {canAdminister && (
        <div className="two-col">
          <section className="card">
            <h2>Create organization unit</h2>
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(event, (form) =>
                  api("organization/units", {
                    code: get(form, "code"),
                    name: get(form, "name"),
                    kind: get(form, "kind"),
                    parentId: get(form, "parentId") || undefined,
                    effectiveFrom: get(form, "effectiveFrom"),
                    effectiveTo: get(form, "effectiveTo") || undefined,
                  }),
                )
              }
            >
              <label>
                Code
                <input name="code" required />
              </label>
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Unit type
                <select name="kind">
                  {kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replaceAll("_", " ").toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Parent unit
                <select name="parentId">
                  <option value="">Top level</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} · {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effective from
                <input name="effectiveFrom" type="date" required />
              </label>
              <label>
                Effective to (optional)
                <input name="effectiveTo" type="date" />
              </label>
              <button disabled={busy}>Create unit</button>
            </form>
          </section>
          <section className="card">
            <h2>Assign employee</h2>
            <form
              className="form-stack"
              onSubmit={(event) =>
                void submit(event, (form) =>
                  api("organization/assignments", {
                    employeeId: get(form, "employeeId"),
                    unitId: get(form, "unitId"),
                    assignmentRole: get(form, "assignmentRole"),
                    effectiveFrom: get(form, "effectiveFrom"),
                    effectiveTo: get(form, "effectiveTo") || undefined,
                    reason: get(form, "reason"),
                  }),
                )
              }
            >
              <label>
                Employee
                <select name="employeeId" required defaultValue="">
                  <option value="" disabled>
                    Choose employee
                  </option>
                  {catalog?.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit
                <select name="unitId" required defaultValue="">
                  <option value="" disabled>
                    Choose unit
                  </option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} · {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignment role
                <select name="assignmentRole">
                  <option value="PRIMARY">Primary</option>
                  <option value="MATRIX">Matrix</option>
                </select>
              </label>
              <label>
                Effective from
                <input name="effectiveFrom" type="date" required />
              </label>
              <label>
                Effective to (optional)
                <input name="effectiveTo" type="date" />
              </label>
              <label>
                Reason
                <input name="reason" required minLength={10} />
              </label>
              <button disabled={busy}>Create assignment</button>
            </form>
          </section>
        </div>
      )}
      <section className="card">
        <h2>Assignment history</h2>
        {catalog && (
          <label className="filter-label">
            Employee
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              {catalog.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Role</th>
                <th>Period</th>
                <th>Reason</th>
                <th>End assignment</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    <strong>{assignment.unit_name}</strong>
                    <small>
                      {assignment.code} · {assignment.kind.toLowerCase()}
                    </small>
                  </td>
                  <td>{assignment.assignment_role.toLowerCase()}</td>
                  <td>
                    {date(assignment.effective_from)} –{" "}
                    {date(assignment.effective_to)}
                  </td>
                  <td>{assignment.reason}</td>
                  <td>
                    {canAdminister && (
                      <form
                        onSubmit={(event) =>
                          void submit(event, (form) =>
                            api(
                              `organization/assignments/${assignment.id}/end`,
                              {
                                effectiveTo: get(form, "effectiveTo"),
                                reason: get(form, "reason"),
                              },
                            ),
                          )
                        }
                        className="form-stack"
                      >
                        <label>
                          End date
                          <input name="effectiveTo" type="date" required />
                        </label>
                        <label>
                          Reason
                          <input name="reason" minLength={10} required />
                        </label>
                        <button disabled={busy}>End</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No dated assignments recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {canListUnits && (
        <section className="card">
          <h2>Organization units</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Parent</th>
                  <th>Effective period</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id}>
                    <td>{unit.code}</td>
                    <td>{unit.name}</td>
                    <td>{unit.kind.toLowerCase()}</td>
                    <td>{unit.parent_name ?? "Top level"}</td>
                    <td>
                      {date(unit.effective_from)} – {date(unit.effective_to)}
                    </td>
                  </tr>
                ))}
                {units.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No units recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
