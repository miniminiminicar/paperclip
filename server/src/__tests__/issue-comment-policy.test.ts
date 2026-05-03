import { describe, expect, it } from "vitest";
import {
  buildStableIssueCommentGateSnapshot,
  normalizeIssueCommentBodyForPolicy,
  shouldSuppressStableIssueComment,
  writeStableIssueCommentPolicyMetadata,
} from "../services/issue-comment-policy.ts";

describe("issue comment policy", () => {
  it("normalizes issue comment bodies before dedupe comparisons", () => {
    expect(normalizeIssueCommentBodyForPolicy("  PASS\n\n- waiting on review  ")).toBe("PASS - waiting on review");
  });

  it("changes the in_review gate fingerprint when the current participant changes", () => {
    const stageId = "11111111-1111-4111-8111-111111111111";
    const firstAgentId = "22222222-2222-4222-8222-222222222222";
    const secondAgentId = "33333333-3333-4333-8333-333333333333";
    const first = buildStableIssueCommentGateSnapshot({
      issueStatus: "in_review",
      executionState: {
        status: "pending",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: firstAgentId, userId: null },
        returnAssignee: { type: "agent", agentId: firstAgentId, userId: null },
        reviewRequest: { instructions: "Review the latest fix." },
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    });
    const second = buildStableIssueCommentGateSnapshot({
      issueStatus: "in_review",
      executionState: {
        status: "pending",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: secondAgentId, userId: null },
        returnAssignee: { type: "agent", agentId: firstAgentId, userId: null },
        reviewRequest: { instructions: "Review the latest fix." },
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    });

    expect(first?.lane).toBe("in_review");
    expect(second?.lane).toBe("in_review");
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  it("changes the blocked gate fingerprint when the unresolved blocker set changes", () => {
    const first = buildStableIssueCommentGateSnapshot({
      issueStatus: "blocked",
      blockers: [{ id: "blocker-a", status: "in_progress" }],
    });
    const second = buildStableIssueCommentGateSnapshot({
      issueStatus: "blocked",
      blockers: [
        { id: "blocker-a", status: "in_progress" },
        { id: "blocker-b", status: "todo" },
      ],
    });

    expect(first?.lane).toBe("blocked");
    expect(second?.lane).toBe("blocked");
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });

  it("suppresses a stable no-op comment only when the prior stable gate and body match", () => {
    const currentGate = buildStableIssueCommentGateSnapshot({
      issueStatus: "done",
    });
    const previousResultJson = writeStableIssueCommentPolicyMetadata(
      { summary: "当前结论：DONE" },
      {
        version: 1,
        lane: "done",
        fingerprint: "done",
        normalizedBody: "当前结论：DONE",
        authoritativeCommentId: "comment-1",
        suppressed: false,
        suppressionReason: null,
      },
    );

    const suppressed = shouldSuppressStableIssueComment({
      candidateBody: "当前结论：DONE",
      currentGate,
      previousResultJson,
    });
    const notSuppressed = shouldSuppressStableIssueComment({
      candidateBody: "当前结论：FAIL",
      currentGate,
      previousResultJson,
    });

    expect(suppressed).toMatchObject({
      authoritativeCommentId: "comment-1",
      metadata: {
        suppressed: true,
        suppressionReason: "stable_done_no_op",
      },
    });
    expect(notSuppressed).toBeNull();
  });
});
