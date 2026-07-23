import { describe, expect, it } from "vitest";

import { buildSearchFilter } from "./list-sets";

describe("buildSearchFilter", () => {
  it("builds an ilike filter across name and code", () => {
    expect(buildSearchFilter("arabian")).toBe("name.ilike.%arabian%,code.ilike.%arabian%");
  });

  it("strips PostgREST filter syntax characters instead of breaking the query", () => {
    expect(buildSearchFilter("arabian,(nights)")).toBe(
      "name.ilike.%arabiannights%,code.ilike.%arabiannights%",
    );
  });

  it("escapes LIKE wildcard characters so they're matched literally", () => {
    expect(buildSearchFilter("50%_off")).toBe("name.ilike.%50\\%\\_off%,code.ilike.%50\\%\\_off%");
  });

  it("trims surrounding whitespace", () => {
    expect(buildSearchFilter("  arn  ")).toBe("name.ilike.%arn%,code.ilike.%arn%");
  });
});
