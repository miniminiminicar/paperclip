import { createHash } from "node:crypto";
import { parseIssueExecutionState } from "./issue-execution-policy.js";

type StableIssueCommentLane = "done" | "in_review" | "blocked";

type BlockerSummaryLike = {
  id: string;
  status: string;
};

export type StableIssueCommentGateSnapshot = {
  lane: StableIssueCommentLane;
  fingerprint: string;
};

export type StableIssueCommentPolicyMetadata = {
  version: 1;
  lane: StableIssueCommentLane;
  fingerprint: string;
  normalizedBody: string;
  authoritativeCommentId: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function principalKey(value: unknown) {
  const record = parseObject(value);
  if (!record) return "none";
  const type = record.type === "user" ? "user" : record.type === "agent" ? "agent" : "unknown";
  const id =
    type === "user"
      ? normalizeText(typeof record.userId === "string" ? record.userId : "")
      : normalizeText(typeof record.agentId === "string" ? record.agentId : "");
  return `${type}:${id || "none"}`;
}

export function normalizeIssueCommentBodyForPolicy(body: string) {
  return normalizeText(body);
}

export function buildStableIssueCommentGateSnapshot(input: {
  issueStatus: string | null | undefined;
  executionState?: unknown;
  blockers?: BlockerSummaryLike[];
}): StableIssueCommentGateSnapshot | null {
  const issueStatus = normalizeText(input.issueStatus ?? "");
  if (issueStatus === "done") {
    return {
      lane: "done",
      fingerprint: "done",
    };
  }

  if (issueStatus === "in_review") {
    const executionState = parseIssueExecutionState(input.executionState);
    const reviewRequest = normalizeText(executionState?.reviewRequest?.instructions ?? "");
    const fingerprintPayload = JSON.stringify({
      lane: "in_review",
      currentStageId: executionState?.currentStageId ?? null,
      currentStageType: executionState?.currentStageType ?? null,
      currentParticipant: principalKey(executionState?.currentParticipant ?? null),
      returnAssignee: principalKey(executionState?.returnAssignee ?? null),
      lastDecisionOutcome: executionState?.lastDecisionOutcome ?? null,
      completedStageIds: [...(executionState?.completedStageIds ?? [])].sort(),
      reviewRequestHash: reviewRequest ? shortHash(reviewRequest) : null,
    });
    return {
      lane: "in_review",
      fingerprint: `in_review:${shortHash(fingerprintPayload)}`,
    };
  }

  if (issueStatus === "blocked") {
    const blockerKey = [...(input.blockers ?? [])]
      .map((blocker) => `${blocker.id}:${normalizeText(blocker.status) || "unknown"}`)
      .sort()
      .join("|");
    return {
      lane: "blocked",
      fingerprint: `blocked:${shortHash(blockerKey || "no_blockers")}`,
    };
  }

  return null;
}

export function readStableIssueCommentPolicyMetadata(
  resultJson: unknown,
): StableIssueCommentPolicyMetadata | null {
  const resultRecord = parseObject(resultJson);
  const record = parseObject(resultRecord?.issueCommentPolicy);
  if (!record) return null;
  const version = record.version;
  const lane = record.lane;
  const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint : null;
  const normalizedBody = typeof record.normalizedBody === "string" ? record.normalizedBody : null;
  const authoritativeCommentId =
    typeof record.authoritativeCommentId === "string" && record.authoritativeCommentId.trim().length > 0
      ? record.authoritativeCommentId.trim()
      : null;
  const suppressed = record.suppressed === true;
  const suppressionReason =
    typeof record.suppressionReason === "string" && record.suppressionReason.trim().length > 0
      ? record.suppressionReason.trim()
      : null;

  if (
    version !== 1 ||
    (lane !== "done" && lane !== "in_review" && lane !== "blocked") ||
    !fingerprint ||
    !normalizedBody
  ) {
    return null;
  }

  return {
    version: 1,
    lane,
    fingerprint,
    normalizedBody,
    authoritativeCommentId,
    suppressed,
    suppressionReason,
  };
}

export function writeStableIssueCommentPolicyMetadata(
  resultJson: Record<string, unknown> | null | undefined,
  metadata: StableIssueCommentPolicyMetadata,
) {
  return {
    ...(resultJson ?? {}),
    issueCommentPolicy: metadata,
  };
}

export function shouldSuppressStableIssueComment(input: {
  candidateBody: string;
  currentGate: StableIssueCommentGateSnapshot | null;
  previousResultJson: unknown;
}) {
  const normalizedBody = normalizeIssueCommentBodyForPolicy(input.candidateBody);
  const previous = readStableIssueCommentPolicyMetadata(input.previousResultJson);
  if (!input.currentGate || !previous || !normalizedBody) {
    return null;
  }
  if (
    previous.fingerprint !== input.currentGate.fingerprint ||
    previous.normalizedBody !== normalizedBody ||
    !previous.authoritativeCommentId
  ) {
    return null;
  }

  return {
    authoritativeCommentId: previous.authoritativeCommentId,
    metadata: {
      version: 1 as const,
      lane: input.currentGate.lane,
      fingerprint: input.currentGate.fingerprint,
      normalizedBody,
      authoritativeCommentId: previous.authoritativeCommentId,
      suppressed: true,
      suppressionReason: `stable_${input.currentGate.lane}_no_op`,
    },
  };
}
