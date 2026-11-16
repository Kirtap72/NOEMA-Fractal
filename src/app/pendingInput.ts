/**
 * Settles a half-typed value before something replaces the whole scene (File > Open).
 *
 * Number fields commit on `change`, which a browser fires when the field loses focus. If another scene arrives while such a
 * field still has focus, that later blur would write the typed value into the NEW scene. Taking the focus away first makes the
 * browser fire `change` now, while the field's own scene is still the current one; the new scene then replaces it untouched.
 */
export function settlePendingInput(doc: Pick<Document, "activeElement"> = document): void {
  const active = doc.activeElement as (Element & { blur?: () => void }) | null;
  if (active && typeof active.blur === "function") active.blur();
}
