import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => [
    "domain,url",
    'a.test,"https://a.test/news"',
    'b.test,"https://b.test/blog"',
  ].join("\n")),
}));

import { importContentSources } from "../../scripts/lib/content-sources";

type Call = { op: string; args: unknown[] };

/** A chainable query stub that records every call and resolves to `result`. */
function query(calls: Call[], result: unknown) {
  const q: Record<string, unknown> = {};
  for (const op of ["upsert", "select", "update", "eq", "in", "order", "range"]) {
    q[op] = (...args: unknown[]) => { calls.push({ op, args }); return q; };
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

function fakeDb(biginOnly: { id: string; url: string }[]) {
  const writes: Call[][] = [];
  const results = [
    { data: [], error: null }, // upsert: nothing new
    { data: biginOnly, error: null }, // bigin_only read
  ];
  const db = {
    from: () => {
      const calls: Call[] = [];
      writes.push(calls);
      return query(calls, results.shift() ?? { data: null, error: null });
    },
  };
  return { db, writes };
}

describe("importContentSources", () => {
  it("clears bigin_only by id, only for Bigin rows that are also on the spreadsheet", async () => {
    const { db, writes } = fakeDb([
      { id: "s1", url: "https://a.test/news" },
      { id: "s2", url: "https://only-in-bigin.test/" },
    ]);
    await importContentSources(db as never, "unused.csv");
    const update = writes[2];
    expect(update.find((c) => c.op === "update")?.args[0]).toEqual({ bigin_only: false });
    // Filtered by id, never by the full URL list (which overflowed the request URL).
    expect(update.find((c) => c.op === "in")?.args).toEqual(["id", ["s1"]]);
    expect(writes).toHaveLength(3);
  });

  it("makes no update when no Bigin-only row is on the spreadsheet", async () => {
    const { db, writes } = fakeDb([]);
    await importContentSources(db as never, "unused.csv");
    expect(writes).toHaveLength(2);
  });
});
