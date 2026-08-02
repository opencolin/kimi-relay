import { describe, expect, test } from "vitest";
import { toOpenAIMessages } from "../../cli/src/lib/claude/translate-request.js";
import type { ModelDefinition } from "@kimirelay/models";

const KIMI_K3 = { id: "moonshotai/Kimi-K3", name: "Kimi K3" } as ModelDefinition;

function systemContent(messages: ReturnType<typeof toOpenAIMessages>): string {
  const first = messages[0];
  if (first?.role !== "system" || typeof first.content !== "string") {
    throw new Error("expected a leading system message");
  }
  return first.content;
}

describe("claude model-identity prompt", () => {
  test("names the backend model and says how to answer identity questions", () => {
    const content = systemContent(
      toOpenAIMessages({ messages: [{ role: "user", content: "what model are you?" }] }, KIMI_K3),
    );
    expect(content).toContain("you are Kimi K3 (moonshotai/Kimi-K3)");
    expect(content).toContain('answer "Kimi K3"');
    expect(content).toContain("never claim to be another vendor's model");
  });

  test("falls back to a generic affirmative identity without a target model", () => {
    const content = systemContent(
      toOpenAIMessages({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(content).toContain("Model identity:");
    expect(content).toContain("name your backend model");
  });

  test("keeps the harness system prompt after the identity line", () => {
    const content = systemContent(
      toOpenAIMessages(
        {
          system: "You are Claude Code, Anthropic's official CLI.",
          messages: [{ role: "user", content: "hi" }],
        },
        KIMI_K3,
      ),
    );
    expect(content.indexOf("Model identity:")).toBe(0);
    expect(content).toContain("You are Claude Code");
  });
});
