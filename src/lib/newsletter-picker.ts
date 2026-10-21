/**
 * The issue editor's story/video picker (components/console/IssueItemsPicker).
 *
 * Saving an issue replaces all of its items with whatever is posted
 * (`updateIssue`), so every item already in the issue must be posted. The
 * editor used to list only the latest 20 published items, so an older pick
 * was silently dropped on the next save; the picker now lists every pick,
 * whatever its age or status, and searches for anything older to add.
 */
import { UUID_RE } from "./validate";

export type PickerItem = { id: string; title: string; published_at: string | null; status: string };

export type IssueItemRef = { kind: "story" | "video"; id: string };
/** A story or video the editor can add, as the picker lists it. */
export type IssueContentResult = PickerItem & { kind: IssueItemRef["kind"] };

/**
 * Gap review area 5: the composer posts one ordered `items` list of
 * `story:<id>` / `video:<id>`, so stories and videos can be mixed and the
 * first one is the lead. Anything malformed is dropped, and a repeat keeps
 * its first place (the table's unique indexes would reject it anyway).
 */
export function parseIssueItems(values: string[]): IssueItemRef[] {
  const seen = new Set<string>();
  return values.flatMap((value): IssueItemRef[] => {
    const [kind, id] = value.split(":");
    if ((kind !== "story" && kind !== "video") || !id || !UUID_RE.test(id) || seen.has(value)) return [];
    seen.add(value);
    return [{ kind, id }];
  });
}
