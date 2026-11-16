# How to add a gradient (colour scale)

A gradient is a text file in this folder. All `.yaml` files here appear automatically in the "Gradient" list of the program. You do not need to change any program code.

## Try it

1. Copy `ember.yaml` to a new name, for example `my-scale.yaml`.
2. Change `id` (unique, lower-case letters, digits, hyphens), `name`, `author` and the colours.
3. Reload the page. Your gradient is in the list.
4. Run `npm test` and all gradient files are checked.

## The fields

| Field | Requirement | Explanation |
|---|---|---|
| `format` | `1` | Version of the format. |
| `id` | lower-case letters, digits, hyphens | Unique. |
| `name` | text | The name that is shown. |
| `author` | text | Who made the colour scale. **Required.** |
| `description` | optional | Short explanation. |
| `stops` | 2 to 16 | Colour stops: `position` (0 to 1) and `color` (`#rrggbb`). The positions must not decrease down the list. |

Two stops with the **same position** give a sharp edge between the colours (see `neon.yaml`).

## The gradient is saved in the scene file

When you save a scene, the colour stops of the gradient are copied into the scene file. The file therefore works even if the gradient file is changed or missing later. If you open a scene whose gradient is not in the library, it is shown as "(from scene)".

## Colour by: what do the measures mean?

The program gives every point on the surface a number and looks up the colour in the gradient:

| Measure | What it measures |
|---|---|
| Iteration count | How many rounds the calculation managed before the point "escaped". Gives bands along the levels of detail of the surface. |
| Orbit trap | How close to the centre the orbit of the point came during the calculation. Gives organic patterns that follow the shape. |
| Slope | How much the surface points upwards. Bright tops, dark undersides. |
| Cavities | How deep into a crevice the point lies. |
| Distance from the centre | How far from the centre the point is. |

- **Repeats:** how many times the gradient repeats over the values of the measure. A higher number gives tighter bands.
- **Offset:** moves the colours along the gradient.
- **Edges:** "Mirror" goes back and forth (no sharp seams), "Repeat" starts over from the beginning (a sharp seam if the first and last colours differ).

## Copyright

The colour scales that come with the program are our own, newly written for the project. Write your own colours. Do not copy colour scales from other programs or works without checking the license and naming the author.
