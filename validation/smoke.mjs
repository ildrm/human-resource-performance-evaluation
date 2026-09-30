import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";
const password = process.env.SMOKE_PASSWORD;
if (!password) throw new Error("SMOKE_PASSWORD is required");
const suffix = process.env.SMOKE_SUFFIX ?? randomUUID().slice(0, 8);

async function request(path, { cookie, body } = {}) {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { origin, "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, data };
}

async function must(path, options) {
  const result = await request(path, options);
  if (!result.response.ok)
    throw new Error(
      `${path}: ${result.response.status} ${JSON.stringify(result.data)}`,
    );
  return result.data;
}

async function login(tenant, email, loginPassword) {
  const { response, data } = await request("auth/login", {
    body: { tenant, email, password: loginPassword },
  });
  assert.equal(response.status, 201, JSON.stringify(data));
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(
    cookie?.startsWith("hpi_session="),
    "session cookie was not forwarded",
  );
  return cookie;
}

let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`${origin}/login`, { cache: "no-store" });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The web container may still be starting after Compose reports Started.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.equal(
  ready,
  true,
  "Web application did not become ready within 30 seconds",
);
const denied = await request("overview");
assert.equal(denied.response.status, 401);
const telemetryResponse = await fetch(`${origin}/api/v1/overview`, {
  headers: {
    "x-correlation-id": "person@example.test",
    traceparent: "00-123e4567e89b42d3a456426614174000-123e4567e89b42d3-01",
  },
});
assert.equal(telemetryResponse.status, 401);
assert.match(
  telemetryResponse.headers.get("x-correlation-id") ?? "",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
assert.notEqual(
  telemetryResponse.headers.get("x-correlation-id"),
  "person@example.test",
);
assert.match(
  telemetryResponse.headers.get("traceparent") ?? "",
  /^00-123e4567e89b42d3a456426614174000-[0-9a-f]{16}-01$/,
);
const admin = await login("smoke-a", "admin-a@example.test", password);
const foreign = await login("smoke-b", "admin-b@example.test", password);
for (let attempt = 0; attempt < 10; attempt += 1) {
  assert.equal(
    (
      await request("auth/login", {
        body: {
          tenant: "smoke-a",
          email: `throttle-${suffix}@example.test`,
          password: "invalid-password",
        },
      })
    ).response.status,
    401,
  );
}
assert.equal(
  (
    await request("auth/login", {
      body: {
        tenant: "smoke-a",
        email: `throttle-${suffix}@example.test`,
        password: "invalid-password",
      },
    })
  ).response.status,
  429,
);
assert.equal(
  (
    await request("auth/login", {
      body: {
        tenant: "smoke-a",
        email: `other-throttle-${suffix}@example.test`,
        password: "invalid-password",
      },
    })
  ).response.status,
  401,
);
const job = await must("jobs", {
  cookie: admin,
  body: {
    name: `Technician ${suffix}`,
    family: "Manufacturing",
    purpose: "Produce conforming batches",
    approved: true,
  },
});
const metric = await must("metrics", {
  cookie: admin,
  body: {
    code: `quality_${suffix}`,
    name: "Accepted batches",
    construct: "Output quality",
    unit: "batches",
    direction: "HIGHER",
    rationale: "Verified role output",
    limitations: "Does not capture all job contributions",
    controllability: "PARTIAL",
  },
});
const person = await must("people", {
  cookie: admin,
  body: {
    name: `Synthetic Employee ${suffix}`,
    email: `employee-${suffix}@example.test`,
    password,
    role: "EMPLOYEE",
    jobId: job.id,
  },
});
await must("people", {
  cookie: admin,
  body: {
    name: `Synthetic Calibrator ${suffix}`,
    email: `calibrator-${suffix}@example.test`,
    password,
    role: "CALIBRATOR",
  },
});
const publisherPerson = await must("people", {
  cookie: admin,
  body: {
    name: `Synthetic Publisher ${suffix}`,
    email: `publisher-${suffix}@example.test`,
    password,
    role: "HR_ADMIN",
  },
});
await must("people", {
  cookie: admin,
  body: {
    name: `Synthetic Appeal Reviewer ${suffix}`,
    email: `appeal-reviewer-${suffix}@example.test`,
    password,
    role: "HR_ADMIN",
  },
});
await must("people", {
  cookie: admin,
  body: {
    name: `Synthetic Conflict Resolver ${suffix}`,
    email: `conflict-resolver-${suffix}@example.test`,
    password,
    role: "HR_ADMIN",
  },
});
const calibrator = await login(
  "smoke-a",
  `calibrator-${suffix}@example.test`,
  password,
);
const publisher = await login(
  "smoke-a",
  `publisher-${suffix}@example.test`,
  password,
);
const appealReviewer = await login(
  "smoke-a",
  `appeal-reviewer-${suffix}@example.test`,
  password,
);
const conflictResolver = await login(
  "smoke-a",
  `conflict-resolver-${suffix}@example.test`,
  password,
);
const template = await must("templates", {
  cookie: admin,
  body: {
    jobId: job.id,
    name: `Technician review ${suffix}`,
    version: 1,
    effectiveFrom: "2026-01-01",
    scientificRationale:
      "Accepted batches represent the analyzed quality technician output task.",
    limitations:
      "Synthetic demonstration observations do not establish empirical validity.",
    dimensions: [
      {
        name: "Quality",
        weight: "1",
        metrics: [{ metricId: metric.id, weight: "1", required: true }],
      },
    ],
  },
});
await must(`templates/${template.id}/review`, { cookie: admin, body: {} });
await must(`templates/${template.id}/validate`, {
  cookie: calibrator,
  body: {
    validationNote:
      "Independent synthetic review of role alignment and arithmetic fixtures.",
    fixtureEvidenceReference:
      "Synthetic quality technician calculation fixture",
  },
});
await must(`templates/${template.id}/approve`, { cookie: publisher, body: {} });
await must(`templates/${template.id}/activate`, { cookie: admin, body: {} });
await must("targets", {
  cookie: admin,
  body: {
    metricId: metric.id,
    effectiveFrom: "2026-01-01",
    critical: "0",
    threshold: "2",
    target: "10",
    stretch: "20",
    anchors: [
      { actual: "0", score: "0" },
      { actual: "10", score: "100" },
      { actual: "20", score: "120" },
    ],
    reason: "Synthetic test target",
  },
});
const cycle = await must("cycles", {
  cookie: admin,
  body: {
    name: `January ${suffix}`,
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
    purpose: "DEVELOPMENT",
  },
});
const goalCycle = await must("cycles", {
  cookie: admin,
  body: {
    name: `Goal cycle ${suffix}`,
    startsOn: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    endsOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    purpose: "DEVELOPMENT",
  },
});
const goalFields = {
  description: "Complete documented technician safety training",
  baseline: "Training not yet completed",
  threshold: "Attend the initial safety session",
  target: "Pass the documented safety assessment",
  stretch: "Lead a documented peer walkthrough",
  dueDate: new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10),
  priority: "HIGH",
  reviewCadence: "MONTHLY",
  dependencies: [],
  status: "ACTIVE",
  reason: "Synthetic learning objective agreed for the cycle",
};
const goal = await must("goals", {
  cookie: admin,
  body: {
    ...goalFields,
    employeeId: person.id,
    cycleId: goalCycle.id,
    kind: "LEARNING",
  },
});
assert.equal(goal.purpose, "DEVELOPMENT");
assert.equal(
  (
    await request("development-actions", {
      cookie: admin,
      body: {
        employeeId: person.id,
        cycleId: cycle.id,
        competencyGap: "Needs documented safety procedure capability",
        currentLevel: "Can describe the procedure",
        targetLevel: "Can demonstrate the procedure",
        activity: "Practice the safety procedure with a supervisor",
        dueDate: goalFields.dueDate,
      },
    })
  ).response.status,
  400,
);
const developmentAction = await must("development-actions", {
  cookie: admin,
  body: {
    employeeId: person.id,
    cycleId: goalCycle.id,
    goalId: goal.id,
    competencyGap: "Needs documented safety procedure capability",
    currentLevel: "Can describe the procedure",
    targetLevel: "Can demonstrate the procedure",
    activity: "Practice the safety procedure with a supervisor",
    training: "Synthetic technician safety training",
    dueDate: goalFields.dueDate,
  },
});
await must(`goals/${goal.id}/revisions`, {
  cookie: admin,
  body: {
    ...goalFields,
    target: "Pass the revised documented assessment",
    reason: "Synthetic prospective training-provider change",
    expectedVersion: 1,
    effectiveAt: new Date(Date.now() + 3600000).toISOString(),
  },
});
const existingPolicies = await must("evidence-quality/policies", {
  cookie: admin,
});
const qualityVersion =
  Math.max(0, ...existingPolicies.policies.map((item) => item.version)) + 1;
const qualityPolicy = await must("evidence-quality/policies", {
  cookie: admin,
  body: {
    version: qualityVersion,
    freshnessDays: 90,
    unreferencedEvidenceFactor: "0.5",
    weights: {
      completeness: "0.25",
      freshness: "0.25",
      sampleAdequacy: "0.25",
      traceability: "0.25",
    },
    rationale: "Synthetic disclosed evidence quality policy for testing",
  },
});
assert.equal(
  (
    await request(`evidence-quality/policies/${qualityPolicy.id}/activate`, {
      cookie: admin,
      body: { reviewReference: "Synthetic independent policy review" },
    })
  ).response.status,
  403,
);
await must(`evidence-quality/policies/${qualityPolicy.id}/activate`, {
  cookie: publisher,
  body: { reviewReference: "Synthetic independent policy review" },
});
const scale = await must("feedback/scales", {
  cookie: admin,
  body: {
    jobId: job.id,
    name: `Coordination ${suffix}`,
    version: 1,
    jobAnalysisReference: "Synthetic technician job analysis interview",
    developmentMethod: "Synthetic observed behaviors across five levels",
    limitations: "Test fixture, not a validated psychometric scale",
    anchors: [1, 2, 3, 4, 5].map((level) => ({
      level,
      behavior: `Observable batch handoff behavior at level ${level}`,
    })),
  },
});
assert.equal(
  (
    await request(`feedback/scales/${scale.id}/activate`, {
      cookie: admin,
      body: { approvalReference: "Synthetic independent review case" },
    })
  ).response.status,
  403,
);
await must(`feedback/scales/${scale.id}/activate`, {
  cookie: publisher,
  body: { approvalReference: "Synthetic independent review case" },
});
const peerIds = [];
const peerCookies = [];
for (let index = 0; index < 3; index += 1) {
  const email = `peer-${index}-${suffix}@example.test`;
  const peer = await must("people", {
    cookie: admin,
    body: {
      name: `Synthetic Peer ${index} ${suffix}`,
      email,
      password,
      role: "EMPLOYEE",
      jobId: job.id,
    },
  });
  peerIds.push(peer.id);
  peerCookies.push(await login("smoke-a", email, password));
}
const campaign = await must("feedback/campaigns", {
  cookie: admin,
  body: {
    employeeId: person.id,
    cycleId: cycle.id,
    scaleId: scale.id,
    minimumRespondents: 3,
    weights: [{ relationship: "PEER", weight: "1" }],
    invitations: peerIds.map((respondentId) => ({
      respondentId,
      relationship: "PEER",
    })),
  },
});
const assignment = await must("feedback/assignments", {
  cookie: peerCookies[0],
});
assert.ok(
  assignment.assignments.some((item) => item.campaign_id === campaign.id),
);
for (let index = 0; index < peerCookies.length; index += 1) {
  await must(`feedback/campaigns/${campaign.id}/ratings`, {
    cookie: peerCookies[index],
    body: {
      level: index + 3,
      observedExample: `Synthetic observed peer handoff ${index + 1}`,
    },
  });
}
assert.equal(
  (await must(`feedback/campaigns/${campaign.id}/summary`, { cookie: admin }))
    .status,
  "NOT_RELEASED",
);
assert.equal(
  (
    await request(`feedback/campaigns/${campaign.id}/close`, {
      cookie: admin,
      body: {},
    })
  ).response.status,
  403,
);
await must(`feedback/campaigns/${campaign.id}/close`, {
  cookie: publisher,
  body: {},
});
const item = await must("evidence", {
  cookie: admin,
  body: {
    employeeId: person.id,
    metricId: metric.id,
    observedAt: "2026-01-12T12:00:00.000Z",
    value: "8",
    dataState: "OBSERVED",
    source: "Synthetic batch register",
    externalRef: `batch-${suffix}`,
  },
});
await must(`evidence/${item.id}/verify`, { cookie: admin, body: {} });
const evaluation = await must(
  `people/${person.id}/cycles/${cycle.id}/calculate`,
  { cookie: admin, body: {} },
);
assert.equal(evaluation.score, "80.0000");
assert.equal(evaluation.quality_result_snapshot.policyVersion, qualityVersion);
assert.ok(Number(evaluation.quality_result_snapshot.index) > 0);
await must(`evaluations/${evaluation.id}/submit`, {
  cookie: admin,
  body: { managerNote: "Verified synthetic work completed consistently." },
});
const internalReviewMessage = await must(
  `evaluations/${evaluation.id}/messages`,
  {
    cookie: calibrator,
    body: {
      channel: "INTERNAL",
      topic: "CALIBRATION",
      body: "Synthetic calibration discussion for authorized review staff.",
    },
  },
);
const decision = {
  proposedScore: "82",
  reason: "Additional documented role contribution",
  evidenceReference: "synthetic-case-1",
  policyBasis: "synthetic calibration policy",
};
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/calibrate`, {
      cookie: admin,
      body: decision,
    })
  ).response.status,
  403,
);
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
await must(`evaluations/${evaluation.id}/calibrate`, {
  cookie: calibrator,
  body: decision,
});
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/publish`, {
      cookie: admin,
      body: {},
    })
  ).response.status,
  403,
);
const reviewConflict = await must(`evaluations/${evaluation.id}/conflicts`, {
  cookie: appealReviewer,
  body: {
    stage: "PUBLICATION",
    category: "PRIOR_INVOLVEMENT",
    reason: "I participated in an earlier synthetic review decision.",
  },
});
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
assert.equal(
  (
    await request(`conflicts/${reviewConflict.id}/resolve`, {
      cookie: appealReviewer,
      body: {
        replacementActorId: publisherPerson.id,
        resolutionNote: "Independent reassignment following disclosure.",
      },
    })
  ).response.status,
  403,
);
await must(`conflicts/${reviewConflict.id}/resolve`, {
  cookie: conflictResolver,
  body: {
    replacementActorId: publisherPerson.id,
    resolutionNote: "Independent reassignment following disclosure.",
  },
});
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/publish`, {
      cookie: appealReviewer,
      body: {},
    })
  ).response.status,
  403,
);
await must(`evaluations/${evaluation.id}/publish`, {
  cookie: publisher,
  body: {},
});
const employee = await login(
  "smoke-a",
  `employee-${suffix}@example.test`,
  password,
);
const sharedReviewMessage = await must(
  `evaluations/${evaluation.id}/messages`,
  {
    cookie: publisher,
    body: {
      channel: "SHARED",
      topic: "REVIEW",
      body: "Please review the published evaluation and discuss any concerns.",
    },
  },
);
const employeeDiscussion = await must(`evaluations/${evaluation.id}/messages`, {
  cookie: employee,
});
assert.deepEqual(
  employeeDiscussion.messages.map((message) => message.id),
  [sharedReviewMessage.id],
);
const reviewerDiscussion = await must(`evaluations/${evaluation.id}/messages`, {
  cookie: calibrator,
});
assert.equal(
  reviewerDiscussion.messages.some(
    (message) => message.id === internalReviewMessage.id,
  ),
  true,
);
assert.equal(
  (
    await request(`evaluations/${evaluation.id}/messages`, {
      cookie: employee,
      body: {
        channel: "INTERNAL",
        topic: "REVIEW",
        body: "Attempted internal comment from the employee.",
      },
    })
  ).response.status,
  403,
);
assert.equal(
  (await request(`evaluations/${evaluation.id}/messages`, { cookie: foreign }))
    .response.status,
  404,
);
assert.equal(
  (
    await request(`development-actions/${developmentAction.id}/events`, {
      cookie: employee,
      body: {
        kind: "COMPLETED",
        note: "I completed the documented development action",
        evidenceReference: "Synthetic record 12",
      },
    })
  ).response.status,
  403,
);
await must(`development-actions/${developmentAction.id}/events`, {
  cookie: employee,
  body: {
    kind: "PROGRESS",
    note: "I attended the first safety training session",
  },
});
await must(`development-actions/${developmentAction.id}/events`, {
  cookie: admin,
  body: {
    kind: "REVIEW",
    note: "Supervisor observed a successful practice session",
  },
});
await must(`development-actions/${developmentAction.id}/events`, {
  cookie: admin,
  body: {
    kind: "COMPLETED",
    note: "Supervisor confirmed the target capability",
    evidenceReference: "Synthetic record 12",
  },
});
const developmentDetail = await must(
  `development-actions/${developmentAction.id}`,
  { cookie: employee },
);
assert.equal(developmentDetail.status, "COMPLETED");
assert.deepEqual(
  developmentDetail.events.map((event) => event.kind),
  ["PROGRESS", "REVIEW", "COMPLETED"],
);
const employeeGoals = await must(`people/${person.id}/goals`, {
  cookie: employee,
});
assert.equal(
  employeeGoals.goals.find((item) => item.id === goal.id).version,
  1,
);
await must(`goals/${goal.id}/check-ins`, {
  cookie: employee,
  body: {
    progress: "I attended the initial safety training session",
    nextAction: "Complete the documented assessment",
  },
});
const goalDetail = await must(`goals/${goal.id}`, { cookie: employee });
assert.equal(goalDetail.revisions.length, 2);
assert.equal(goalDetail.checkins.length, 1);
const selfCopy = await must("privacy/me/export", { cookie: employee });
assert.equal(selfCopy.profile.id, person.id);
assert.equal(selfCopy.goals.find((item) => item.id === goal.id).id, goal.id);
assert.equal(
  selfCopy.developmentActions.find((item) => item.id === developmentAction.id)
    .id,
  developmentAction.id,
);
assert.equal(selfCopy.developmentEvents.length, 3);
assert.deepEqual(
  selfCopy.reviewMessages.map((message) => message.id),
  [sharedReviewMessage.id],
);
assert.equal("password_hash" in selfCopy.profile, false);
assert.equal(
  (await request(`goals/${goal.id}`, { cookie: foreign })).response.status,
  404,
);
assert.equal(
  (await request("audit/integrity", { cookie: employee })).response.status,
  403,
);
const employeeView = await must(`evaluations/${evaluation.id}`, {
  cookie: employee,
});
assert.equal(employeeView.final_score, "82.0000");
const feedbackSummary = await must(
  `feedback/campaigns/${campaign.id}/summary`,
  {
    cookie: employee,
  },
);
assert.equal(feedbackSummary.status, "RELEASED");
assert.equal(feedbackSummary.weightedScore, "4.00");
await must(`evaluations/${evaluation.id}/acknowledge`, {
  cookie: employee,
  body: {},
});
const appeal = await must(`evaluations/${evaluation.id}/appeal`, {
  cookie: employee,
  body: {
    reason: "CONTEXT",
    statement: "Please review a documented disruption.",
  },
});
await must(`appeals/${appeal.id}/resolve`, {
  cookie: appealReviewer,
  body: {
    outcome: "DENIED",
    resolution: "Reviewed the synthetic record and explained the decision.",
    remedy: "The published score remains in effect after independent review.",
  },
});
await must("targets", {
  cookie: admin,
  body: {
    metricId: metric.id,
    effectiveFrom: "2026-02-01",
    critical: "0",
    threshold: "5",
    target: "20",
    stretch: "30",
    anchors: [
      { actual: "0", score: "0" },
      { actual: "20", score: "100" },
      { actual: "30", score: "120" },
    ],
    reason: "Prospective synthetic revision",
  },
});
const replay = await must(`evaluations/${evaluation.id}/replay`, {
  cookie: employee,
});
assert.equal(replay.matches, true);
assert.equal(replay.qualityMatches, true);
const report = await must("reports/evaluations", { cookie: admin });
const csv = await must("reports/evaluations.csv", { cookie: admin });
assert.ok(
  csv.includes(`"${report.rows[0].score}","${report.rows[0].final_score}"`),
);
const administrativeCycle = await must("cycles", {
  cookie: admin,
  body: {
    name: `Administrative January ${suffix}`,
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
    purpose: "ADMINISTRATIVE",
  },
});
const administrativeEvaluation = await must(
  `people/${person.id}/cycles/${administrativeCycle.id}/calculate`,
  { cookie: admin, body: {} },
);
await must(`evaluations/${administrativeEvaluation.id}/submit`, {
  cookie: admin,
  body: { managerNote: "Synthetic administrative test assessment." },
});
await must(`evaluations/${administrativeEvaluation.id}/calibrate`, {
  cookie: calibrator,
  body: decision,
});
assert.equal(
  (
    await request(`evaluations/${administrativeEvaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
const dossier = await must("validation/dossiers", {
  cookie: admin,
  body: {
    templateId: template.id,
    intendedInterpretation:
      "Role-specific evidence summary for a documented administrative review",
    intendedPopulation: "Synthetic quality technicians in smoke tenant A",
    jobAnalysisReference: "Synthetic technician task analysis record",
    contentEvidenceReference: "Synthetic metric-to-task content mapping",
    reliabilityEvidenceOrRationale:
      "Reliability evidence is unavailable in this fixture; a real study is required before use.",
    criterionEvidenceOrRationale:
      "Criterion evidence is unavailable in this fixture; a real study is required before use.",
    constructEvidenceOrRationale:
      "Construct evidence is unavailable in this fixture; a real study is required before use.",
    fairnessReviewReference:
      "Synthetic fairness review case without protected data",
    limitations:
      "Synthetic governance fixture; does not demonstrate scientific validity or legal fitness.",
    revalidateOn: "2027-12-31",
  },
});
assert.equal(
  (
    await request(`validation/dossiers/${dossier.id}/review`, {
      cookie: admin,
      body: { reviewNote: "Synthetic independent content review reference" },
    })
  ).response.status,
  403,
);
await must(`validation/dossiers/${dossier.id}/review`, {
  cookie: publisher,
  body: { reviewNote: "Synthetic independent content review reference" },
});
const governanceCase = await must("governance-cases", {
  cookie: admin,
  body: {
    employeeId: person.id,
    eventType: "SAFETY",
    occurredOn: new Date().toISOString().slice(0, 10),
    description: "Synthetic severe safety event needing independent review",
    evidenceReference: "Synthetic safety record 12",
  },
});
assert.equal(
  (
    await request(`governance-cases/${governanceCase.id}`, {
      cookie: employee,
    })
  ).response.status,
  403,
);
await must(`governance-cases/${governanceCase.id}/events`, {
  cookie: publisher,
  body: {
    kind: "TRIAGE",
    note: "Independent HR reviewer opened the safety investigation",
  },
});
assert.equal(
  (
    await request(`evaluations/${administrativeEvaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
await must(`governance-cases/${governanceCase.id}/events`, {
  cookie: employee,
  body: {
    kind: "EMPLOYEE_RESPONSE",
    note: "I reviewed the case and provided my account of the event",
  },
});
await must(`governance-cases/${governanceCase.id}/events`, {
  cookie: appealReviewer,
  body: {
    kind: "CONFIRM",
    note: "Independent investigator confirmed the event after review",
    evidenceReference: "Synthetic safety record 12",
    policyBasis: "Synthetic local safety policy",
  },
});
assert.equal(
  (
    await request(`evaluations/${administrativeEvaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
await must(`governance-cases/${governanceCase.id}/events`, {
  cookie: publisher,
  body: {
    kind: "RESOLVE",
    note: "Independent reviewer confirmed documented remediation",
    evidenceReference: "Synthetic remediation record 13",
    policyBasis: "Synthetic local safety policy",
  },
});
const contextRecord = await must("context", {
  cookie: employee,
  body: {
    employeeId: person.id,
    cycleId: administrativeCycle.id,
    kind: "OPPORTUNITY",
    description:
      "Machine availability reduced eligible production opportunities",
    impact: "Fewer eligible production opportunities occurred",
    evidenceReference: "Synthetic machine availability log",
    expectedExposure: "100",
    actualExposure: "75",
    exposureUnit: "machine-hours",
  },
});
assert.equal(
  (
    await request(`evaluations/${administrativeEvaluation.id}/publish`, {
      cookie: publisher,
      body: {},
    })
  ).response.status,
  400,
);
await must(`context/${contextRecord.id}/review`, {
  cookie: publisher,
  body: {
    decision: "VERIFIED",
    note: "Independent reviewer checked the machine availability record",
    evidenceReference: "Synthetic machine availability log",
  },
});
const publishedAdministrative = await must(
  `evaluations/${administrativeEvaluation.id}/publish`,
  { cookie: publisher, body: {} },
);
assert.equal(publishedAdministrative.validation_dossier_id, dossier.id);
const administrativeView = await must(
  `evaluations/${administrativeEvaluation.id}`,
  { cookie: employee },
);
assert.equal(administrativeView.context[0].status, "VERIFIED");
assert.equal(administrativeView.context[0].actual_exposure, "75.00000000");
const trends = await must(`people/${person.id}/trends`, {
  cookie: employee,
});
assert.deepEqual(trends.series.map((item) => item.purpose).sort(), [
  "ADMINISTRATIVE",
  "DEVELOPMENT",
]);
assert.equal(
  trends.series.every((item) => item.analysis.status === "INSUFFICIENT"),
  true,
);
const improvementFields = {
  employeeId: person.id,
  sourceEvaluationId: administrativeEvaluation.id,
  gap: "Documented shortfall in a role-specific task",
  expectedStandard: "Complete the documented task to the role standard",
  supportingEvidence: "Published administrative evaluation and task log",
  requiredImprovement: "Demonstrate the documented task without errors",
  supportProvided: "Protected practice time and supervisor coaching",
  measurementCriteria: "Two observed demonstrations meeting the standard",
  startsOn: new Date().toISOString().slice(0, 10),
  endsOn: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
};
assert.equal(
  (
    await request("improvement-plans", {
      cookie: admin,
      body: { ...improvementFields, sourceEvaluationId: evaluation.id },
    })
  ).response.status,
  400,
);
const improvementPlan = await must("improvement-plans", {
  cookie: admin,
  body: improvementFields,
});
assert.equal(
  (
    await request(`improvement-plans/${improvementPlan.id}`, {
      cookie: employee,
    })
  ).response.status,
  403,
);
assert.equal(
  (
    await request(`improvement-plans/${improvementPlan.id}/events`, {
      cookie: admin,
      body: {
        kind: "ACTIVATED",
        note: "Creator attempted to approve their own plan",
      },
    })
  ).response.status,
  403,
);
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: publisher,
  body: {
    kind: "ACTIVATED",
    note: "Independent HR review approved the documented plan",
  },
});
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: employee,
  body: {
    kind: "EMPLOYEE_RESPONSE",
    note: "I understand the standard and request practice time",
  },
});
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: admin,
  body: {
    kind: "REVIEW_MEETING",
    note: "Supervisor reviewed the documented task demonstration",
    occurredOn: new Date().toISOString().slice(0, 10),
    evidenceReference: "Synthetic task log 12",
  },
});
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: publisher,
  body: {
    kind: "DECISION",
    note: "HR reviewed the response, meeting, and task evidence",
    outcome: "NOT_MET",
    evidenceReference: "Synthetic task log 12",
  },
});
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: employee,
  body: {
    kind: "APPEAL",
    note: "Please consider the additional task context and record",
  },
});
assert.equal(
  (
    await request(`improvement-plans/${improvementPlan.id}/events`, {
      cookie: publisher,
      body: {
        kind: "APPEAL_RESOLUTION",
        note: "Deciding actor attempted to resolve the appeal",
        outcome: "MET",
        evidenceReference: "Synthetic task log 13",
      },
    })
  ).response.status,
  403,
);
await must(`improvement-plans/${improvementPlan.id}/events`, {
  cookie: appealReviewer,
  body: {
    kind: "APPEAL_RESOLUTION",
    note: "Independent review accepted the additional record",
    outcome: "MET",
    evidenceReference: "Synthetic task log 13",
  },
});
const improvementDetail = await must(
  `improvement-plans/${improvementPlan.id}`,
  { cookie: employee },
);
assert.equal(improvementDetail.status, "CLOSED");
assert.equal(improvementDetail.final_decision, "MET");
assert.equal(improvementDetail.events.length, 6);
const laterSelfCopy = await must("privacy/me/export", { cookie: employee });
assert.equal(laterSelfCopy.improvementPlans[0].id, improvementPlan.id);
assert.equal(laterSelfCopy.improvementEvents.length, 6);
assert.equal(laterSelfCopy.governanceCases[0].id, governanceCase.id);
assert.equal(laterSelfCopy.governanceEvents.length, 4);
assert.equal(laterSelfCopy.contextRecords[0].id, contextRecord.id);
assert.equal(laterSelfCopy.contextReviews[0].context_id, contextRecord.id);
assert.equal(
  (
    await request(`improvement-plans/${improvementPlan.id}`, {
      cookie: foreign,
    })
  ).response.status,
  404,
);
assert.equal(
  (await request(`evaluations/${evaluation.id}`, { cookie: foreign })).response
    .status,
  404,
);
const auditIntegrity = await must("audit/integrity", { cookie: admin });
assert.equal(auditIntegrity.headMatches, true, JSON.stringify(auditIntegrity));
assert.equal(auditIntegrity.firstMismatchId, null);
assert.ok(["VERIFIED", "PARTIAL"].includes(auditIntegrity.status));
const otherSession = await login("smoke-a", "admin-a@example.test", password);
await must("auth/logout-all", { cookie: admin, body: {} });
assert.equal(
  (await request("overview", { cookie: admin })).response.status,
  401,
);
assert.equal(
  (await request("overview", { cookie: otherSession })).response.status,
  401,
);
const finalSession = await login("smoke-a", "admin-a@example.test", password);
await must("auth/logout", { cookie: finalSession, body: {} });
assert.equal(
  (await request("overview", { cookie: finalSession })).response.status,
  401,
);
console.log(
  JSON.stringify({
    status: "passed",
    evaluationId: evaluation.id,
    score: evaluation.score,
    finalScore: employeeView.final_score,
    replay: replay.matches,
    csvMatchesReport: true,
    crossTenantDenied: true,
    independentApproval: true,
    conflictReassignment: true,
    reviewDiscussion: true,
    auditIntegrity: auditIntegrity.status,
    anonymousFeedback: feedbackSummary.status,
    sessionRevocation: true,
    evidenceQuality: evaluation.quality_result_snapshot.index,
    goalHistory: goalDetail.revisions.length,
    developmentHistory: developmentDetail.events.length,
    improvementHistory: improvementDetail.events.length,
    governanceHistory: laterSelfCopy.governanceEvents.length,
    verifiedContext: laterSelfCopy.contextRecords[0].status,
    longitudinalSeparation: trends.series.length,
    selfDataExport: true,
    administrativeDossierGate: true,
    distributedLoginThrottle: true,
  }),
);
