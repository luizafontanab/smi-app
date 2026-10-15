/**
 * Inline-image layout in rich text (Jas 13/10 item 19: "position the image on
 * the page and force the wording around the image"). An image carries at most
 * two attributes, each from a closed list: `data-align` (left/right float with
 * the text wrapping round it, or full width) and `data-size` (how much of the
 * column a floated image takes). Closed lists because the sanitiser admits
 * exactly these values and nothing else — no free-form style or class.
 *
 * Client-safe: the editor, the sanitiser and the tests all read from here.
 */
export const IMAGE_ALIGNS = ["left", "right", "full"] as const;
export const IMAGE_SIZES = ["small", "medium", "large"] as const;

export type ImageAlign = (typeof IMAGE_ALIGNS)[number];
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const isImageAlign = (v: unknown): v is ImageAlign => IMAGE_ALIGNS.includes(v as ImageAlign);
export const isImageSize = (v: unknown): v is ImageSize => IMAGE_SIZES.includes(v as ImageSize);

/** A floated image needs a width; medium is the one that reads well on most layouts. */
export const DEFAULT_FLOAT_SIZE: ImageSize = "medium";
