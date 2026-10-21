/**
 * The issue editor's story/video checklist.
 *
 * Saving an issue replaces all of its items with whatever is ticked
 * (`updateIssue`), so every item already in the issue must have a checkbox.
 * The editor used to list only the latest 20 published items, so an older
 * pick had no checkbox and was silently dropped on the next save.
 *
 * Picked items come first, in issue order and whatever their status, then
 * the recent published ones that aren't already picked.
 */
export type PickerItem = { id: string; title: string; published_at: string | null; status: string };
export type PickerOption = PickerItem & { picked: boolean };

export function pickerOptions(picked: PickerItem[], recent: PickerItem[]): PickerOption[] {
  const pickedIds = new Set(picked.map((item) => item.id));
  return [
    ...picked.map((item) => ({ ...item, picked: true })),
    ...recent.filter((item) => !pickedIds.has(item.id)).map((item) => ({ ...item, picked: false })),
  ];
}
