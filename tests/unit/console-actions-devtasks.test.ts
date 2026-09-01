import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevTask, deleteDevTask, moveDevTask, saveDevTask, setDevTaskStatus } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));

afterEach(() => {
  resetDbServerMocks();
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("createDevTask", () => {
  it("does nothing for a blank title", async () => {
    const from = db({});
    await createDevTask(form({ title: "  " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to not_started and an unassigned card for unrecognised values", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ dev_tasks: () => builder });

    await createDevTask(form({ title: "Fix the thing", status: "bogus", assignee: "Nobody" }));

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "not_started", assignee: null }));
  });

  it("appends to the end of the target column", async () => {
    const builder = queryBuilder(dbOk({ sort_order: 4 }));
    db({ dev_tasks: () => builder });

    await createDevTask(form({ title: "Fix the thing", status: "in_progress" }));

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ sort_order: 5, status: "in_progress" }));
  });
});

describe("saveDevTask", () => {
  it("redirects with the validation error rather than writing anything", async () => {
    const from = db({});
    await expect(saveDevTask(form({ title: "" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/dev\/new\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("updates an existing task", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ dev_tasks: () => builder });

    await expect(saveDevTask(form({ id: "t1", title: "Fix the thing", description: "steps" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/dev?saved=1");

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix the thing" }));
  });

  it("creates a new task appended to its column, and honours a valid return_to", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ dev_tasks: () => builder });

    await expect(saveDevTask(form({ title: "Fix the thing", description: "steps", return_to: "/console/dev?view=list" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/dev?view=list&saved=1");

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ created_by: "admin1" }));
  });
});

describe("setDevTaskStatus", () => {
  it("ignores a missing id or an unrecognised status", async () => {
    const from = db({});
    await setDevTaskStatus(form({ id: "t1", status: "bogus" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("moves the card to the end of its new column", async () => {
    const builder = queryBuilder(dbOk({ sort_order: 2 }));
    db({ dev_tasks: () => builder });

    await setDevTaskStatus(form({ id: "t1", status: "done" }));

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "done", sort_order: 3 }));
  });
});

describe("deleteDevTask", () => {
  it("requires the confirm checkbox", async () => {
    await expect(deleteDevTask(form({ id: "t1" }))).rejects.toThrow(/Tick%20the%20confirm%20box/);
  });

  it("deletes and redirects with deleted=1 appended to the return path", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ dev_tasks: () => builder });

    await expect(deleteDevTask(form({ id: "t1", confirm: "1", return_to: "/console/dev?status=done" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/dev?status=done&deleted=1");

    expect(builder.delete).toHaveBeenCalled();
  });
});

describe("moveDevTask", () => {
  it("ignores an unrecognised status", async () => {
    const from = db({});
    await moveDevTask({ id: "t1", status: "bogus", orderedIds: ["t1"] });
    expect(from).not.toHaveBeenCalled();
  });

  it("bails without writing anything if the moved card isn't among the existing rows", async () => {
    const builder = queryBuilder(dbOk([{ id: "t1" }, { id: "t2" }])); // t3 doesn't exist
    db({ dev_tasks: () => builder });

    await moveDevTask({ id: "t3", status: "in_progress", orderedIds: ["t1", "t3", "t2"] });

    expect(builder.update).not.toHaveBeenCalled();
  });

  it("drops any id that doesn't exist, and writes dense sort_order for the rest in order", async () => {
    const builder = queryBuilder(dbOk([{ id: "t1" }, { id: "t2" }, { id: "t3" }])); // t4 doesn't exist
    db({ dev_tasks: () => builder });

    await moveDevTask({ id: "t2", status: "in_progress", orderedIds: ["t1", "t4", "t2", "t3"] });

    expect(builder.update).toHaveBeenCalledTimes(3);
    expect(builder.update).toHaveBeenCalledWith({ status: "in_progress", sort_order: 0 });
    expect(builder.update).toHaveBeenCalledWith({ status: "in_progress", sort_order: 1 });
    expect(builder.update).toHaveBeenCalledWith({ status: "in_progress", sort_order: 2 });
  });
});
