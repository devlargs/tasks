import { describe, expect, it } from "vitest";
import {
  decodeConfig,
  encodeConfig,
  parseConfig,
  sanitizeApiKey,
} from "../src/lib/server/connection";

const ID = "0123456789abcdef0123456789abcdef";

describe("parseConfig", () => {
  it("accepts a secret with a database ID, dashed ID, or Notion link", () => {
    expect(parseConfig("ntn_abc", ID)).toEqual({ apiKey: "ntn_abc", databaseId: ID });
    expect(parseConfig(" ntn_abc ", "01234567-89AB-cdef-0123-456789abcdef")).toEqual({
      apiKey: "ntn_abc",
      databaseId: ID,
    });
    expect(parseConfig("ntn_abc", `https://www.notion.so/me/${ID}?v=1`)?.databaseId).toBe(ID);
  });

  it("rejects a missing secret or database", () => {
    expect(parseConfig("", ID)).toBeNull();
    expect(parseConfig("ntn_abc", "not a database")).toBeNull();
    expect(parseConfig(undefined, ID)).toBeNull();
    expect(parseConfig("ntn_abc", 5)).toBeNull();
  });
});

describe("sanitizeApiKey", () => {
  it("rejects whitespace inside and absurd lengths", () => {
    expect(sanitizeApiKey("ntn abc")).toBeNull();
    expect(sanitizeApiKey("x".repeat(201))).toBeNull();
    expect(sanitizeApiKey("ntn_abc")).toBe("ntn_abc");
  });
});

describe("connection cookie", () => {
  it("round-trips", () => {
    const config = { apiKey: "ntn_abc", databaseId: ID };
    expect(decodeConfig(encodeConfig(config))).toEqual(config);
  });

  it("reads anything unusable as not connected", () => {
    expect(decodeConfig(undefined)).toBeNull();
    expect(decodeConfig("")).toBeNull();
    expect(decodeConfig("garbage!!")).toBeNull();
    expect(decodeConfig(Buffer.from('{"k":"ntn_abc"}').toString("base64url"))).toBeNull();
    expect(decodeConfig(Buffer.from("[]").toString("base64url"))).toBeNull();
  });
});
