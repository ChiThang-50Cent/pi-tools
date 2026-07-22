// ─── subagent-schemas.test.ts ──── Public parameter validation tests ────
import { describe, expect, it, vi } from "vitest";

vi.mock("typebox", () => {
  const schema = (type: string, options: Record<string, unknown> = {}) => ({ type, ...options });
  return {
    Type: {
      Array: (items: unknown, options?: Record<string, unknown>) => schema("array", { items, ...options }),
      Boolean: (options?: Record<string, unknown>) => schema("boolean", options),
      Integer: (options?: Record<string, unknown>) => schema("integer", options),
      Number: (options?: Record<string, unknown>) => schema("number", options),
      Object: (properties: Record<string, unknown>) => schema("object", { properties }),
      Optional: (inner: unknown) => inner,
      String: (options?: Record<string, unknown>) => schema("string", options),
    },
  };
});

vi.mock("@earendil-works/pi-ai", () => ({
  StringEnum: (values: string[], options?: Record<string, unknown>) => ({
    type: "string",
    enum: values,
    ...options,
  }),
}));

import { ChainItem, SubagentParams, TaskItem } from "../tools/subagent/schemas.js";

type Schema = Record<string, any>;

const params = SubagentParams as Schema;
function property(schema: Schema, name: string): Schema {
  return schema.properties[name] as Schema;
}

describe("subagent public parameter schemas", () => {
  it("accepts existing single, parallel, and chain call shapes", () => {
    expect(property(params, "agent").minLength).toBe(1);
    expect(property(params, "task").minLength).toBe(1);
    expect(property(params, "tasks").minItems).toBe(1);
    expect(property(params, "chain").minItems).toBe(1);
    expect(property(params, "tasks").maxItems).toBe(8);

    // Existing defaults remain inside the accepted ranges.
    for (const name of ["contextMaxChars", "summaryMaxChars", "artifactThresholdChars", "chainHandoffMaxChars"]) {
      expect(property(params, name).minimum).toBe(1);
      expect(property(params, name).maximum).toBe(1_000_000);
    }
    expect(property(params, "context").maxLength).toBe(1_000_000);
    expect(property(params, "timeoutMs").minimum).toBe(1_000);
    expect(property(params, "timeoutMs").maximum).toBe(21_600_000);
  });

  it("requires non-empty agent and task strings in every mode", () => {
    expect((property(params, "agent") as Schema).minLength).toBe(1);
    expect((property(params, "task") as Schema).minLength).toBe(1);
    expect((property(TaskItem, "agent") as Schema).minLength).toBe(1);
    expect((property(TaskItem, "task") as Schema).minLength).toBe(1);
    expect((property(ChainItem, "agent") as Schema).minLength).toBe(1);
    expect((property(ChainItem, "task") as Schema).minLength).toBe(1);
  });

  it("uses the runner's 1 second–6 hour timeout clamp as schema bounds", () => {
    const timeoutSchemas = [
      property(params, "timeoutMs"),
      property(TaskItem, "timeoutMs"),
      property(ChainItem, "timeoutMs"),
    ];
    for (const schema of timeoutSchemas) {
      expect(schema.type).toBe("number");
      expect(schema.minimum).toBe(1_000);
      expect(schema.maximum).toBe(21_600_000);
    }
  });

  it("bounds character budgets and parallel task-list length", () => {
    for (const name of ["contextMaxChars", "summaryMaxChars", "artifactThresholdChars", "chainHandoffMaxChars"]) {
      const schema = property(params, name);
      expect(schema.type).toBe("number");
      expect(schema.minimum).toBe(1);
      expect(schema.maximum).toBe(1_000_000);
    }

    expect(property(params, "tasks").minItems).toBe(1);
    expect(property(params, "tasks").maxItems).toBe(8);
    expect(property(params, "chain").minItems).toBe(1);
    expect(property(params, "chain").maxItems).toBeUndefined();
    expect(property(TaskItem, "context").maxLength).toBe(1_000_000);
    expect(property(ChainItem, "context").maxLength).toBe(1_000_000);
  });
});
