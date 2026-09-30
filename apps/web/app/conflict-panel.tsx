"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; name: string; role: string };
type Conflict = {
  id: string;
  stage: "SUBMISSION" | "CALIBRATION" | "PUBLICATION";
  category: string;
  reason: string;
  declared_by: string;
  declarer_name: string;
  status: string;
  replacement_name: string | null;
  resolution_note: string | null;
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
const categories = [
  "PERSONAL_RELATIONSHIP",
  "REPORTING_CONFLICT",
  "FINANCIAL_INTEREST",
  "PRIOR_INVOLVEMENT",
  "OTHER",
] as const;

export default function ConflictPanel({
  evaluationId,
  evaluationStatus,
  person,
  catalog,
}: {
  evaluationId: string;
  evaluationStatus: string;
  person: Person;
  catalog: { users: Person[] } | null;
}) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canResolve = ["TENANT_ADMIN", "HR_ADMIN"].includes(person.role);
  const stages =
    evaluationStatus === "CALCULATED"
      ? ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"].includes(person.role)
        ? ["SUBMISSION"]
        : []
      : evaluationStatus === "SUBMITTED"
        ? [
            ...(["TENANT_ADMIN", "CALIBRATOR"].includes(person.role)
              ? ["CALIBRATION"]
              : []),
            ...(["TENANT_ADMIN", "HR_ADMIN"].includes(person.role)
              ? ["PUBLICATION"]
              : []),
          ]
        : [];
  const load = useCallback(async () => {
    const result = await api<{ conflicts: Conflict[] }>(
      `evaluations/${evaluationId}/conflicts`,
    );
    setConflicts(result.conflicts);
  }, [evaluationId]);
  useEffect(() => {
    void load().catch((error) => setNotice(String(error)));
  }, [load]);

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
      await load();
      setNotice("Saved successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-heading">
        <h2>Review conflicts</h2>
        <p>
          Eligible actors can disclose a conflict. An unresolved declaration
          holds the stage until a separate HR reviewer assigns a replacement.
        </p>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {stages.length > 0 && (
        <form
          className="form-stack"
          onSubmit={(event) =>
            void submit(event, (form) =>
              api(`evaluations/${evaluationId}/conflicts`, {
                stage: get(form, "stage"),
                category: get(form, "category"),
                reason: get(form, "reason"),
              }),
            )
          }
        >
          <label>
            Review stage
            <select name="stage">
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conflict category
            <select name="category">
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Disclosure reason
            <textarea name="reason" required minLength={20} />
          </label>
          <button disabled={busy}>Declare conflict</button>
        </form>
      )}
      {conflicts.length === 0 ? (
        <p>No review conflict declarations recorded.</p>
      ) : (
        <div className="stack">
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="dimension">
              <h3>
                {conflict.stage.toLowerCase()} · {conflict.status.toLowerCase()}
              </h3>
              <p>
                <strong>{conflict.declarer_name}</strong> ·{" "}
                {conflict.category.replaceAll("_", " ").toLowerCase()}
              </p>
              <p>{conflict.reason}</p>
              {conflict.replacement_name && (
                <p>
                  Approved replacement: {conflict.replacement_name}.{" "}
                  {conflict.resolution_note}
                </p>
              )}
              {canResolve && conflict.status === "OPEN" && (
                <form
                  className="form-stack"
                  onSubmit={(event) =>
                    void submit(event, (form) =>
                      api(`conflicts/${conflict.id}/resolve`, {
                        replacementActorId: get(form, "replacementActorId"),
                        resolutionNote: get(form, "resolutionNote"),
                      }),
                    )
                  }
                >
                  <label>
                    Replacement actor
                    <select name="replacementActorId" defaultValue="" required>
                      <option value="" disabled>
                        Choose independent actor
                      </option>
                      {catalog?.users
                        .filter(
                          (user) =>
                            user.id !== person.id &&
                            user.id !== conflict.declared_by,
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name} · {user.role.toLowerCase()}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Resolution note
                    <textarea name="resolutionNote" required minLength={20} />
                  </label>
                  <button disabled={busy}>Resolve and reassign</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
