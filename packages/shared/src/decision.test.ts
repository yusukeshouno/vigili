import { describe, expect, it } from "vitest";
import { AskResolutionSchema, DecisionSchema, FinalDecisionSchema } from "./decision.js";

describe("DecisionSchema", () => {
  it("parses allow", () => {
    expect(DecisionSchema.parse({ decision: "allow" }).decision).toBe("allow");
  });

  it("parses deny with reason", () => {
    const d = DecisionSchema.parse({ decision: "deny", reason: "blocked" });
    expect(d.decision).toBe("deny");
    if (d.decision === "deny") {
      expect(d.reason).toBe("blocked");
    }
  });

  it("parses ask with request_id", () => {
    const d = DecisionSchema.parse({
      decision: "ask",
      request_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(d.decision).toBe("ask");
  });

  it("rejects ask without request_id", () => {
    expect(() => DecisionSchema.parse({ decision: "ask" })).toThrow();
  });

  it("rejects unknown decision", () => {
    expect(() => DecisionSchema.parse({ decision: "maybe" })).toThrow();
  });
});

describe("AskResolutionSchema", () => {
  it("accepts allow", () => {
    const r = AskResolutionSchema.parse({
      request_id: "00000000-0000-4000-8000-000000000000",
      decision: "allow",
    });
    expect(r.decision).toBe("allow");
  });

  it("rejects 'ask' as resolution", () => {
    expect(() =>
      AskResolutionSchema.parse({
        request_id: "00000000-0000-4000-8000-000000000000",
        decision: "ask",
      }),
    ).toThrow();
  });
});

describe("FinalDecisionSchema", () => {
  it("only allows allow or deny", () => {
    expect(FinalDecisionSchema.parse("allow")).toBe("allow");
    expect(FinalDecisionSchema.parse("deny")).toBe("deny");
    expect(() => FinalDecisionSchema.parse("ask")).toThrow();
  });
});
