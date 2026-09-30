"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Policy = {
  id: string;
  version: number;
  state: string;
  freshness_days: number;
  rationale: string;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/evidence-quality/${path}`, {
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

export default function QualityPolicyPanel() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const result = await request<{ policies: Policy[] }>("policies");
    setPolicies(result.policies);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(String(error)));
  }, [refresh]);
  async function run(task: () => Promise<unknown>, form?: HTMLFormElement) {
    setBusy(true);
    setNotice("");
    try {
      await task();
      form?.reset();
      await refresh();
      setNotice("Saved successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(
      () =>
        request("policies", {
          version: Number(value(data, "version")),
          freshnessDays: Number(value(data, "freshnessDays")),
          unreferencedEvidenceFactor: value(data, "unreferencedEvidenceFactor"),
          weights: {
            completeness: value(data, "completeness"),
            freshness: value(data, "freshness"),
            sampleAdequacy: value(data, "sampleAdequacy"),
            traceability: value(data, "traceability"),
          },
          rationale: value(data, "rationale"),
        }),
      form,
    );
  }
  return (
    <section className="card">
      <div className="card-heading">
        <h2>Evidence Quality Index policy</h2>
        <p>
          This disclosed index describes the evidence record. It is not a
          probability, confidence interval, or scientific validation of a score.
        </p>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <form className="form-stack" onSubmit={create}>
        <label>
          Version
          <input
            key={Math.max(0, ...policies.map((policy) => policy.version)) + 1}
            name="version"
            type="number"
            min="1"
            defaultValue={
              Math.max(0, ...policies.map((policy) => policy.version)) + 1
            }
            required
          />
        </label>
        <label>
          Freshness window (days)
          <input
            name="freshnessDays"
            type="number"
            min="1"
            max="3650"
            defaultValue="90"
            required
          />
        </label>
        <label>
          Factor for evidence without an external reference
          <input
            name="unreferencedEvidenceFactor"
            defaultValue="0.5"
            required
          />
        </label>
        <p>Positive component weights must total exactly 1.</p>
        <label>
          Completeness weight
          <input name="completeness" defaultValue="0.25" required />
        </label>
        <label>
          Freshness weight
          <input name="freshness" defaultValue="0.25" required />
        </label>
        <label>
          Sample adequacy weight
          <input name="sampleAdequacy" defaultValue="0.25" required />
        </label>
        <label>
          Traceability weight
          <input name="traceability" defaultValue="0.25" required />
        </label>
        <label>
          Policy rationale
          <textarea name="rationale" required />
        </label>
        <button disabled={busy}>Create draft policy</button>
      </form>
      {policies.length > 0 && (
        <div className="config-list">
          {policies.map((policy) => (
            <div key={policy.id}>
              <strong>
                Version {policy.version} · {policy.state.toLowerCase()}
              </strong>
              <p>{policy.rationale}</p>
              {policy.state === "DRAFT" && (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    void run(
                      () =>
                        request(`policies/${policy.id}/activate`, {
                          reviewReference: value(data, "reviewReference"),
                        }),
                      form,
                    );
                  }}
                >
                  <label>
                    Independent review reference
                    <input name="reviewReference" required />
                  </label>
                  <button disabled={busy}>Activate</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
