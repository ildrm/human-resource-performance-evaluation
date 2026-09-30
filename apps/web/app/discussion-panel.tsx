"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Message = {
  id: string;
  channel: "SHARED" | "INTERNAL";
  topic: "REVIEW" | "CALIBRATION" | "APPEAL";
  body: string;
  author_name: string;
  created_at: string;
};

export default function DiscussionPanel({
  evaluationId,
  evaluationStatus,
  employeeId,
  person,
}: {
  evaluationId: string;
  evaluationStatus: string;
  employeeId: string;
  person: { id: string; role: string };
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"SHARED" | "INTERNAL">(
    person.id === employeeId ? "SHARED" : "INTERNAL",
  );
  const published = ["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(
    evaluationStatus,
  );
  const canWriteShared =
    published &&
    ["TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"].includes(person.role);
  const canWriteInternal =
    !["INCOMPLETE", "CALCULATED"].includes(evaluationStatus) &&
    ["TENANT_ADMIN", "HR_ADMIN", "MANAGER", "CALIBRATOR"].includes(person.role);
  const availableChannels = [
    ...(canWriteInternal ? (["INTERNAL"] as const) : []),
    ...(canWriteShared ? (["SHARED"] as const) : []),
  ];
  const effectiveChannel = availableChannels.includes(channel)
    ? channel
    : availableChannels[0];
  const topics =
    effectiveChannel === "INTERNAL"
      ? [
          "REVIEW",
          "CALIBRATION",
          ...(evaluationStatus === "APPEALED" ? ["APPEAL"] : []),
        ]
      : ["REVIEW", ...(evaluationStatus === "APPEALED" ? ["APPEAL"] : [])];

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/v1/evaluations/${evaluationId}/messages`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Could not load review discussion");
    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
  }, [evaluationId]);
  useEffect(() => {
    void load().catch((error) => setNotice(String(error)));
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/v1/evaluations/${evaluationId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel: effectiveChannel,
            topic: String(fields.get("topic") ?? ""),
            body: String(fields.get("body") ?? "").trim(),
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data.message ?? "Could not post review message");
      }
      form.reset();
      await load();
      setNotice("Message posted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-heading">
        <h2>Review discussion</h2>
        <p>
          Shared messages are visible to the employee. Internal messages are
          limited to authorized review staff. Messages are permanent records.
        </p>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {messages.length === 0 ? (
        <p>No discussion messages recorded.</p>
      ) : (
        <div className="stack">
          {messages.map((message) => (
            <div key={message.id} className="dimension">
              <p>
                <strong>{message.author_name}</strong> ·{" "}
                {message.channel.toLowerCase()} · {message.topic.toLowerCase()}{" "}
                ·{" "}
                <time dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleString()}
                </time>
              </p>
              <p>{message.body}</p>
            </div>
          ))}
        </div>
      )}
      {effectiveChannel && (
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          {availableChannels.length > 1 && (
            <label>
              Visibility
              <select
                value={effectiveChannel}
                onChange={(event) =>
                  setChannel(event.target.value as "SHARED" | "INTERNAL")
                }
              >
                {availableChannels.map((item) => (
                  <option key={item} value={item}>
                    {item === "SHARED"
                      ? "Shared with employee"
                      : "Internal review staff"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Topic
            <select name="topic" key={effectiveChannel}>
              {topics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Message
            <textarea name="body" required minLength={10} maxLength={3000} />
          </label>
          <button disabled={busy}>Post message</button>
        </form>
      )}
    </section>
  );
}
