/**
 * A surface pick describes the picture as a film of whole pixels. The window hands over its CSS size, which is fractional at many
 * window sizes and display scalings (for example 918.67 px); the renderer's film check then refused the pick ("the size must be whole
 * numbers") and clicking on the fractal to place an object failed. The film is rounded to whole pixels and the pointer position is
 * scaled by the same factor, so the pick still hits the surface under the pointer.
 */
export function wholePickFilm(width: number, height: number, x: number, y: number): { width: number; height: number; x: number; y: number } {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  return { width: w, height: h, x: Math.min(w, x * (w / width)), y: Math.min(h, y * (h / height)) };
}
