"use client";

import { useCallback, useEffect, useState } from "react";

type Person = { id: string; name: string; role: string };
type Catalog = { users: Person[] };
type Point = {
  evaluationId: string;
  startsOn: string;
  endsOn: string;
  score: string;
};
type Series = {
  templateId: string;
  templateName: string;
  templateVersion: number;
  purpose: string;
  analysis: {
    status: "AVAILABLE" | "INSUFFICIENT";
    reason: string | null;
    points: Point[];
    mean: string | null;
    sampleVolatility: string | null;
    slopePerYear: string | null;
    firstToLastChange: string | null;
  };
};

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { cache: "no-store" });
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

function Chart({ points, name }: { points: Point[]; name: string }) {
  const timestamps = points.map((point) =>
    new Date(`${point.endsOn}T00:00:00Z`).getTime(),
  );
  const scores = points.map((point) => Number(point.score));
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const lower = Math.max(0, minScore - 5);
  const upper = maxScore + 5;
  const coordinates = points.map((point, index) => ({
    x: 45 + ((timestamps[index]! - minTime) / (maxTime - minTime)) * 510,
    y: 145 - ((scores[index]! - lower) / (upper - lower)) * 115,
    point,
  }));
  return (
    <svg
      viewBox="0 0 600 180"
      width="100%"
      role="img"
      aria-label={`${name}: calculated score across ${points.length} published periods`}
    >
      <title>{name} descriptive score history</title>
      <desc>
        Saved calculated scores for one template and review purpose. The line is
        descriptive, not a forecast.
      </desc>
      <line x1="45" y1="145" x2="555" y2="145" stroke="#8daaa6" />
      <line x1="45" y1="30" x2="45" y2="145" stroke="#8daaa6" />
      <text x="40" y="28" textAnchor="end" fontSize="11" fill="#365d5a">
        {upper.toFixed(0)}
      </text>
      <text x="40" y="149" textAnchor="end" fontSize="11" fill="#365d5a">
        {lower.toFixed(0)}
      </text>
      <polyline
        fill="none"
        stroke="#0f766e"
        strokeWidth="3"
        points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
      />
      {coordinates.map(({ x, y, point }) => (
        <circle key={point.evaluationId} cx={x} cy={y} r="5" fill="#0f766e">
          <title>
            {point.endsOn}: {point.score}
          </title>
        </circle>
      ))}
      <text x="45" y="166" fontSize="11" fill="#365d5a">
        {points[0]!.endsOn}
      </text>
      <text x="555" y="166" textAnchor="end" fontSize="11" fill="#365d5a">
        {points.at(-1)!.endsOn}
      </text>
    </svg>
  );
}

export default function TrendWorkspace({
  person,
  catalog,
}: {
  person: Person;
  catalog: Catalog | null;
}) {
  const [employeeId, setEmployeeId] = useState(person.id);
  const [series, setSeries] = useState<Series[]>([]);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (id: string) => {
    const result = await api<{ series: Series[] }>(`people/${id}/trends`);
    setSeries(result.series);
    setNotice("");
  }, []);
  useEffect(() => {
    void load(employeeId).catch((error) => setNotice(String(error)));
  }, [employeeId, load]);
  return (
    <div className="stack">
      <div className="intro compact">
        <div>
          <p className="eyebrow">Across review periods</p>
          <h2>Longitudinal scores</h2>
          <p>
            Each series uses one role template and one review purpose. At least
            three nonoverlapping periods of comparable length are needed before
            a trend is calculated.
          </p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {catalog && (
        <label className="filter-label">
          Employee
          <select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            {catalog.users.map((user) => (
              <option value={user.id} key={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {series.length === 0 && (
        <section className="card">
          <h2>No published score history</h2>
          <p>
            A trend will appear after enough comparable reviews have been
            published.
          </p>
        </section>
      )}
      {series.map((item) => (
        <section className="card" key={`${item.templateId}-${item.purpose}`}>
          <div className="card-heading">
            <h2>
              {item.templateName} v{item.templateVersion} ·{" "}
              {item.purpose.toLowerCase()}
            </h2>
            <p>
              Saved calculated scores only. Calibration outcomes are separate,
              and this chart is not a forecast or comparison with other jobs.
            </p>
          </div>
          {item.analysis.status === "AVAILABLE" ? (
            <>
              <Chart points={item.analysis.points} name={item.templateName} />
              <div className="config-list">
                <p>
                  <strong>Mean:</strong> {item.analysis.mean}
                </p>
                <p>
                  <strong>Sample volatility:</strong>{" "}
                  {item.analysis.sampleVolatility} score points
                </p>
                <p>
                  <strong>Descriptive slope:</strong>{" "}
                  {item.analysis.slopePerYear} score points per year
                </p>
                <p>
                  <strong>First-to-last change:</strong>{" "}
                  {item.analysis.firstToLastChange} points
                </p>
              </div>
            </>
          ) : (
            <div className="warning">
              <strong>Insufficient comparable history</strong>
              <p>{item.analysis.reason}</p>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cycle end</th>
                  <th>Calculated score</th>
                  <th>Review ID</th>
                </tr>
              </thead>
              <tbody>
                {item.analysis.points.map((point) => (
                  <tr key={point.evaluationId}>
                    <td>{point.endsOn}</td>
                    <td>{point.score}</td>
                    <td>{point.evaluationId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
