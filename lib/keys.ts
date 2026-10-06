const OWN_KEYS = new Set(["TEXTAREA", "INPUT", "SELECT", "BUTTON", "A", "SUMMARY"]);

/** True when the focused element handles Space and Enter itself, so a global shortcut must not take them. */
export function handlesOwnKeys(tag: string, role: string | null, editable: boolean): boolean {
  return editable || OWN_KEYS.has(tag.toUpperCase()) || role === "button" || role === "tab" || role === "link";
}
