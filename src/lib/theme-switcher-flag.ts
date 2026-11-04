/**
 * Whether the design switcher UI is shown anywhere: the floating admin chip
 * (ThemeLauncher), the console header switcher, and the "Homepage design" card
 * on /console/pages.
 *
 * Off since 14 Oct: grid is the only design in play. While off, siteVariant()
 * also ignores the smi-theme cookie and settings.site_variant and serves grid
 * (#33), so a leftover preview cookie can't keep anyone on forge. Nothing is
 * removed — the forge views, the cookie and the setting are only inert — so
 * flipping this back to true restores every control and both overrides.
 *
 * A plain module on purpose, neither "use client" nor server-only: both sides
 * import it, and a constant exported from a "use client" file reaches a server
 * component as a client reference, not as the value.
 */
export const THEME_SWITCHER_ENABLED: boolean = false;
