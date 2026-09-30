"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Template = { id: string; name: string; version: number; state: string };
type Dossier = {
  id: string;
  template_id: string;
  template_name: string;
  template_version: number;
  job_name: string;
  version: number;
  state: string;
  revalidate_on: string;
  limitations: string;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/validation/${path}`, {
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

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export default function ValidationPanel({
  templates,
}: {
  templates: Template[];
}) {
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const data = await request<{ dossiers: Dossier[] }>("dossiers");
    setDossiers(data.dossiers);
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
        request("dossiers", {
          templateId: value(data, "templateId"),
          intendedInterpretation: value(data, "intendedInterpretation"),
          intendedPopulation: value(data, "intendedPopulation"),
          jobAnalysisReference: value(data, "jobAnalysisReference"),
          contentEvidenceReference: value(data, "contentEvidenceReference"),
          reliabilityEvidenceOrRationale: value(
            data,
            "reliabilityEvidenceOrRationale",
          ),
          criterionEvidenceOrRationale: value(
            data,
            "criterionEvidenceOrRationale",
          ),
          constructEvidenceOrRationale: value(
            data,
            "constructEvidenceOrRationale",
          ),
          fairnessReviewReference: value(data, "fairnessReviewReference"),
          limitations: value(data, "limitations"),
          revalidateOn: value(data, "revalidateOn"),
        }),
      form,
    );
  }
  return (
    <section className="card">
      <div className="card-heading">
        <h2>Model evidence dossier</h2>
        <p>
          Administrative publication requires a current dossier reviewed by
          someone other than its author. These references record a human review;
          they do not establish empirical validity by themselves.
        </p>
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
      <form className="form-stack" onSubmit={create}>
        <label>
          Active template
          <select name="templateId" required defaultValue="">
            <option value="" disabled>
              Choose template
            </option>
            {templates
              .filter((item) => item.state === "ACTIVE")
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · v{item.version}
                </option>
              ))}
          </select>
        </label>
        <label>
          Intended interpretation
          <textarea name="intendedInterpretation" required minLength={20} />
        </label>
        <label>
          Intended population
          <textarea name="intendedPopulation" required minLength={10} />
        </label>
        <label>
          Job analysis reference
          <input name="jobAnalysisReference" required minLength={10} />
        </label>
        <label>
          Content evidence reference
          <input name="contentEvidenceReference" required minLength={10} />
        </label>
        <label>
          Reliability evidence or reason it is unavailable
          <textarea
            name="reliabilityEvidenceOrRationale"
            required
            minLength={20}
          />
        </label>
        <label>
          Criterion evidence or reason it is unavailable
          <textarea
            name="criterionEvidenceOrRationale"
            required
            minLength={20}
          />
        </label>
        <label>
          Construct evidence or reason it is unavailable
          <textarea
            name="constructEvidenceOrRationale"
            required
            minLength={20}
          />
        </label>
        <label>
          Fairness review reference
          <input name="fairnessReviewReference" required minLength={10} />
        </label>
        <label>
          Known limitations
          <textarea name="limitations" required minLength={20} />
        </label>
        <label>
          Revalidate by
          <input name="revalidateOn" type="date" required />
        </label>
        <button disabled={busy}>Create draft dossier</button>
      </form>
      {dossiers.length > 0 && (
        <div className="config-list">
          <h3>Dossier history</h3>
          {dossiers.map((dossier) => (
            <div key={dossier.id}>
              <strong>
                {dossier.job_name} · {dossier.template_name} v
                {dossier.template_version} · dossier v{dossier.version} ·{" "}
                {dossier.state.toLowerCase()}
              </strong>
              <p>
                Revalidate by {dossier.revalidate_on.slice(0, 10)}.{" "}
                {dossier.limitations}
              </p>
              {dossier.state === "DRAFT" && (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    void run(
                      () =>
                        request(`dossiers/${dossier.id}/review`, {
                          reviewNote: value(data, "reviewNote"),
                        }),
                      form,
                    );
                  }}
                >
                  <label>
                    Independent review note
                    <input name="reviewNote" required minLength={20} />
                  </label>
                  <button disabled={busy}>Record review</button>
                </form>
              )}
              {dossier.state === "REVIEWED" && (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    void run(
                      () =>
                        request(`dossiers/${dossier.id}/retire`, {
                          reason: value(data, "reason"),
                        }),
                      form,
                    );
                  }}
                >
                  <label>
                    Reason for retirement
                    <input name="reason" required minLength={20} />
                  </label>
                  <button disabled={busy}>Retire dossier</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
