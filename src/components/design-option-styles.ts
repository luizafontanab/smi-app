/**
 * The design option's stylesheet hook (GLOSSARY "Design option"; spec #68).
 *
 * Current has no option stylesheet, so on `staging` this module is empty.
 * `classic` imports its sheet here, e.g.
 *   import "./classic/classic.css";
 *
 * It is kept apart from the hook-point module (design-option.ts) so the public
 * surfaces outside the public layout — login, reset, reset/new, unsubscribe and
 * the root 404 — can load the sheet without pulling in the seven swappable
 * pieces and their client components (the home carousels, the site header).
 * design-option.ts imports this module, so the public layout gets it too.
 * Not the root layout: that would put the sheet on the console and dashboard
 * routes as well, though every rule in it is scoped to [data-site="public"].
 */
export {};
