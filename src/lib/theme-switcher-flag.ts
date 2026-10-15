/**
 * Whether the design switcher UI is shown anywhere: the floating admin chip
 * (ThemeLauncher), the console header switcher, and the "Homepage design" card
 * on /console/pages.
 *
 * Off since 14 Oct: grid is the only design in play. Nothing behind the UI is
 * removed — the forge views, the smi-theme cookie and settings.site_variant all
 * still work — so flipping this back to true restores every control as it was.
 *
 * A plain module on purpose, neither "use client" nor server-only: both sides
 * import it, and a constant exported from a "use client" file reaches a server
 * component as a client reference, not as the value.
 */
export const THEME_SWITCHER_ENABLED: boolean = false;
