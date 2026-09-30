import { z } from "zod";

export const nonEmpty = z.string().trim().min(1).max(500);
export const id = z.string().uuid();
export const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const utcDate = z.iso.datetime();

export const role = z.enum([
  "TENANT_ADMIN",
  "HR_ADMIN",
  "MANAGER",
  "EMPLOYEE",
  "CALIBRATOR",
  "AUDITOR",
]);
export type Role = z.infer<typeof role>;
export const evidenceState = z.enum(["VERIFIED", "PENDING", "REJECTED"]);
export const dataState = z.enum([
  "OBSERVED",
  "ZERO",
  "NOT_APPLICABLE",
  "NOT_MEASURED",
  "MISSING",
  "INVALID",
  "INSUFFICIENT_SAMPLE",
  "SUPPRESSED",
  "UNAVAILABLE_DUE_TO_DISRUPTION",
]);
export const metricDirection = z.enum([
  "HIGHER",
  "LOWER",
  "RANGE",
  "BINARY",
  "MILESTONE",
  "RUBRIC",
]);
export const measurementKind = z.enum(["CONTINUOUS", "BINOMIAL_PROPORTION"]);
export const loginInput = z.object({
  tenant: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(1),
});
export const personInput = z.object({
  email: z.email(),
  name: nonEmpty,
  password: z.string().min(12).max(200),
  role,
  managerId: id.optional(),
  jobId: id.optional(),
});
export const jobInput = z.object({
  name: nonEmpty,
  family: nonEmpty,
  purpose: nonEmpty,
  version: z.int().positive().default(1),
  approved: z.boolean().default(false),
});
export const metricInput = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: nonEmpty,
    construct: nonEmpty,
    unit: nonEmpty,
    measurementKind: measurementKind.default("CONTINUOUS"),
    direction: metricDirection,
    rationale: nonEmpty,
    limitations: nonEmpty,
    controllability: z.enum(["INDIVIDUAL", "PARTIAL", "SHARED", "EXTERNAL"]),
    minimumSample: z.int().nonnegative().default(0),
    guardrailMetricId: id.optional(),
  })
  .superRefine((value, context) => {
    if (value.measurementKind === "BINOMIAL_PROPORTION" && value.unit !== "%")
      context.addIssue({
        code: "custom",
        path: ["unit"],
        message: "A binary proportion must use % as its unit",
      });
  });
export const anchors = z
  .array(z.object({ actual: decimal, score: decimal }))
  .min(2)
  .max(20);
export const templateInput = z.object({
  jobId: id,
  name: nonEmpty,
  version: z.int().positive(),
  effectiveFrom: z.iso.date(),
  scientificRationale: z.string().trim().min(20).max(3000),
  limitations: z.string().trim().min(20).max(3000),
  dimensions: z
    .array(
      z.object({
        name: nonEmpty,
        weight: decimal,
        missingWeightPolicy: z
          .object({
            version: z.int().positive(),
            mode: z.enum(["BLOCK", "REDISTRIBUTE"]),
          })
          .default({ version: 1, mode: "BLOCK" }),
        metrics: z
          .array(
            z.object({
              metricId: id,
              weight: decimal,
              required: z.boolean(),
              periodAggregation: z
                .enum(["LATEST", "MEAN_SCORE"])
                .default("LATEST"),
              minimumObservations: z.int().positive().max(10000).default(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export const templateValidationInput = z.object({
  validationNote: z.string().trim().min(20).max(3000),
  fixtureEvidenceReference: z.string().trim().min(10).max(1000),
});
export const templateRetirementInput = z.object({
  reason: z.string().trim().min(20).max(3000),
});
export const targetInput = z.object({
  metricId: id,
  employeeId: id.optional(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
  critical: decimal,
  threshold: decimal,
  target: decimal,
  stretch: decimal,
  anchors,
  reason: nonEmpty,
});
export const evidenceInput = z.object({
  employeeId: id,
  metricId: id,
  observedAt: utcDate,
  value: decimal.optional(),
  dataState,
  source: nonEmpty,
  externalRef: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  numerator: decimal.optional(),
  denominator: decimal.optional(),
});
export const organizationUnitInput = z.object({
  code: z.string().trim().min(1).max(60),
  name: nonEmpty,
  kind: z.enum([
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
  ]),
  parentId: id.optional(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
});
export const organizationAssignmentInput = z.object({
  employeeId: id,
  unitId: id,
  assignmentRole: z.enum(["PRIMARY", "MATRIX"]),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
  reason: z.string().trim().min(10).max(2000),
});
export const endOrganizationAssignmentInput = z.object({
  effectiveTo: z.iso.date(),
  reason: z.string().trim().min(10).max(2000),
});
export const reviewConflictInput = z.object({
  stage: z.enum(["SUBMISSION", "CALIBRATION", "PUBLICATION"]),
  category: z.enum([
    "PERSONAL_RELATIONSHIP",
    "REPORTING_CONFLICT",
    "FINANCIAL_INTEREST",
    "PRIOR_INVOLVEMENT",
    "OTHER",
  ]),
  reason: z.string().trim().min(20).max(3000),
});
export const reviewConflictResolutionInput = z.object({
  replacementActorId: id,
  resolutionNote: z.string().trim().min(20).max(3000),
});
export const reviewMessageInput = z.object({
  channel: z.enum(["SHARED", "INTERNAL"]),
  topic: z.enum(["REVIEW", "CALIBRATION", "APPEAL"]),
  body: z.string().trim().min(10).max(3000),
});
export const cycleInput = z.object({
  name: nonEmpty,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  purpose: z.enum(["DEVELOPMENT", "ADMINISTRATIVE"]),
});
export const goalKind = z.enum([
  "PERFORMANCE",
  "LEARNING",
  "PROJECT",
  "TEAM",
  "STRATEGIC",
  "COMPLIANCE",
  "IMPROVEMENT",
  "RECOVERY",
]);
export const goalRevisionFields = z.object({
  description: z.string().trim().min(10).max(3000),
  baseline: z.string().trim().min(1).max(1000),
  threshold: z.string().trim().min(1).max(1000),
  target: z.string().trim().min(1).max(1000),
  stretch: z.string().trim().min(1).max(1000),
  dueDate: z.iso.date(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]),
  weight: decimal.optional(),
  reviewCadence: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]),
  dependencies: z.array(id).max(20).default([]),
  status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]),
  reason: z.string().trim().min(10).max(2000),
});
export const goalInput = goalRevisionFields.extend({
  employeeId: id,
  cycleId: id,
  kind: goalKind,
});
export const goalRevisionInput = goalRevisionFields.extend({
  expectedVersion: z.int().positive(),
  effectiveAt: utcDate,
});
export const goalCheckinInput = z.object({
  progress: z.string().trim().min(10).max(3000),
  obstacle: z.string().trim().max(2000).optional(),
  supportNeeded: z.string().trim().max(2000).optional(),
  evidenceReference: z.string().trim().max(1000).optional(),
  nextAction: z.string().trim().min(5).max(2000),
});
export const developmentActionInput = z.object({
  employeeId: id,
  cycleId: id,
  goalId: id.optional(),
  competencyGap: z.string().trim().min(10).max(2000),
  currentLevel: z.string().trim().min(1).max(1000),
  targetLevel: z.string().trim().min(1).max(1000),
  activity: z.string().trim().min(10).max(3000),
  training: z.string().trim().max(2000).optional(),
  mentorId: id.optional(),
  stretchAssignment: z.string().trim().max(2000).optional(),
  dueDate: z.iso.date(),
});
export const developmentActionEventInput = z.object({
  kind: z.enum(["PROGRESS", "REVIEW", "COMPLETED", "CANCELLED"]),
  note: z.string().trim().min(10).max(3000),
  evidenceReference: z.string().trim().max(1000).optional(),
});
export const improvementPlanInput = z.object({
  employeeId: id,
  sourceEvaluationId: id,
  gap: z.string().trim().min(10).max(3000),
  expectedStandard: z.string().trim().min(10).max(3000),
  supportingEvidence: z.string().trim().min(10).max(3000),
  requiredImprovement: z.string().trim().min(10).max(3000),
  supportProvided: z.string().trim().min(10).max(3000),
  measurementCriteria: z.string().trim().min(10).max(3000),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});
export const improvementEventInput = z.object({
  kind: z.enum([
    "ACTIVATED",
    "EMPLOYEE_RESPONSE",
    "REVIEW_MEETING",
    "SUPPORT_UPDATE",
    "DECISION",
    "APPEAL",
    "APPEAL_RESOLUTION",
    "CLOSED",
  ]),
  note: z.string().trim().min(10).max(3000),
  occurredOn: z.iso.date().optional(),
  outcome: z.enum(["MET", "NOT_MET"]).optional(),
  evidenceReference: z.string().trim().min(5).max(1000).optional(),
  policyReference: z.string().trim().min(10).max(1000).optional(),
});
export const governanceCaseInput = z.object({
  employeeId: id,
  eventType: z.enum(["ETHICS", "FRAUD", "REGULATORY", "SAFETY", "SECURITY"]),
  occurredOn: z.iso.date(),
  description: z.string().trim().min(20).max(5000),
  evidenceReference: z.string().trim().min(5).max(1000),
});
export const governanceCaseEventInput = z.object({
  kind: z.enum(["TRIAGE", "EMPLOYEE_RESPONSE", "CONFIRM", "REJECT", "RESOLVE"]),
  note: z.string().trim().min(20).max(5000),
  evidenceReference: z.string().trim().min(5).max(1000).optional(),
  policyBasis: z.string().trim().min(10).max(1000).optional(),
});
export const contextRecordInput = z.object({
  employeeId: id,
  cycleId: id,
  kind: z.enum([
    "OPPORTUNITY",
    "COMPLEXITY",
    "RESOURCE",
    "DISRUPTION",
    "OTHER",
  ]),
  description: z.string().trim().min(20).max(5000),
  impact: z.string().trim().min(10).max(3000),
  evidenceReference: z.string().trim().min(5).max(1000),
  expectedExposure: decimal.optional(),
  actualExposure: decimal.optional(),
  exposureUnit: z.string().trim().min(1).max(100).optional(),
});
export const contextReviewInput = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  note: z.string().trim().min(20).max(3000),
  evidenceReference: z.string().trim().min(5).max(1000).optional(),
});
export const appealInput = z.object({
  reason: z.enum([
    "WRONG_EVIDENCE",
    "MISSING_EVIDENCE",
    "WRONG_ROLE",
    "INCORRECT_TARGET",
    "CALCULATION_ERROR",
    "CONTEXT",
    "RATING_DISAGREEMENT",
    "CONFLICT_OF_INTEREST",
  ]),
  statement: z.string().trim().min(5).max(5000),
});

export const feedbackRelationship = z.enum([
  "MANAGER",
  "PEER",
  "DIRECT_REPORT",
  "PROJECT_LEADER",
  "MATRIX_MANAGER",
  "INTERNAL_CUSTOMER",
  "EXTERNAL_STAKEHOLDER",
  "SELF",
]);
export const weightedFeedbackRelationship = feedbackRelationship.exclude([
  "SELF",
]);
export const behaviorScaleInput = z.object({
  jobId: id,
  name: nonEmpty,
  version: z.int().positive(),
  jobAnalysisReference: z.string().trim().min(10).max(1000),
  developmentMethod: z.string().trim().min(10).max(2000),
  limitations: z.string().trim().min(10).max(2000),
  anchors: z
    .array(
      z.object({
        level: z.int().min(1).max(5),
        behavior: z.string().trim().min(15).max(1000),
      }),
    )
    .length(5)
    .refine(
      (items) => items.every((item, index) => item.level === index + 1),
      "Behavioral anchors must cover ordered levels 1 through 5",
    ),
});
export const feedbackCampaignInput = z.object({
  employeeId: id,
  cycleId: id,
  scaleId: id,
  minimumRespondents: z.int().min(3).max(20),
  weights: z
    .array(
      z.object({ relationship: weightedFeedbackRelationship, weight: decimal }),
    )
    .min(1)
    .max(7),
  invitations: z
    .array(z.object({ respondentId: id, relationship: feedbackRelationship }))
    .min(1)
    .max(200),
});
export const feedbackRatingInput = z.object({
  level: z.int().min(1).max(5),
  observedExample: z.string().trim().min(10).max(3000),
});

export const evidenceQualityPolicyInput = z.object({
  version: z.int().positive(),
  freshnessDays: z.int().min(1).max(3650),
  unreferencedEvidenceFactor: decimal,
  weights: z.object({
    completeness: decimal,
    freshness: decimal,
    sampleAdequacy: decimal,
    traceability: decimal,
  }),
  rationale: z.string().trim().min(20).max(3000),
});
export const validationDossierInput = z.object({
  templateId: id,
  intendedInterpretation: z.string().trim().min(20).max(3000),
  intendedPopulation: z.string().trim().min(10).max(2000),
  jobAnalysisReference: z.string().trim().min(10).max(2000),
  contentEvidenceReference: z.string().trim().min(10).max(2000),
  reliabilityEvidenceOrRationale: z.string().trim().min(20).max(3000),
  criterionEvidenceOrRationale: z.string().trim().min(20).max(3000),
  constructEvidenceOrRationale: z.string().trim().min(20).max(3000),
  fairnessReviewReference: z.string().trim().min(10).max(2000),
  limitations: z.string().trim().min(20).max(3000),
  revalidateOn: z.iso.date(),
});
export const validationReviewInput = z.object({
  reviewNote: z.string().trim().min(20).max(3000),
});
