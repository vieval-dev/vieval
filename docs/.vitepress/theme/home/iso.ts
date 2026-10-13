/**
 * The three visible faces of an axis-aligned box, as SVG `points` strings.
 */
export interface BoxFaces {
  /** Face facing +y, drawn on the lower left. */
  left: string
  /** Face facing +x, drawn on the lower right. */
  right: string
  /** Face facing +z. */
  top: string
}

/**
 * A point in grid space: `x` runs to the lower right, `y` to the lower left, and `z` up.
 */
export type GridPoint = readonly [x: number, y: number, z: number]

/**
 * Projection settings shared by every shape in one scene.
 */
export interface IsoProjection {
  /** Screen position of grid point `[0, 0, 0]`. */
  origin: readonly [x: number, y: number]
  /** Screen length of one grid unit along an axis before foreshortening. */
  unit: number
}

// NOTICE: cos(30°). Isometric projection draws the x and y axes 30° below the horizon,
// so a grid unit covers `unit * cos(30°)` horizontally and `unit * sin(30°)` (0.5) vertically.
const COS_30 = Math.sqrt(3) / 2

/**
 * Builds the three visible faces of an axis-aligned box.
 *
 * Use when:
 * - drawing cubes, blocks, and prisms in a scene
 *
 * Expects:
 * - callers to draw boxes back to front (ascending `x + y + z`) when boxes overlap
 *
 * Returns:
 * - {@link BoxFaces} whose `top`, `left`, and `right` faces share edges without gaps
 */
export function box([x, y, z]: GridPoint, [w, d, h]: GridPoint, projection: IsoProjection): BoxFaces {
  return {
    left: polygon([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], projection),
    right: polygon([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], projection),
    top: polygon([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], projection),
  }
}

/**
 * Projects a closed grid-space polygon to an SVG `points` attribute.
 *
 * Use when:
 * - drawing faces, tiles, and floor planes that are not whole boxes
 *
 * Returns:
 * - a `points` string with two decimals per coordinate
 */
export function polygon(points: readonly GridPoint[], projection: IsoProjection): string {
  return points
    .map(point => project(point, projection).map(value => value.toFixed(2)).join(','))
    .join(' ')
}

/**
 * Projects a grid point to SVG screen coordinates with a 30° isometric projection.
 *
 * Use when:
 * - placing labels, motion paths, or transforms at a grid position
 *
 * Expects:
 * - all shapes of a scene to share one {@link IsoProjection}
 *
 * Returns:
 * - `[x, y]` in the SVG user space of the scene
 */
export function project([x, y, z]: GridPoint, { origin, unit }: IsoProjection): [number, number] {
  return [
    origin[0] + (x - y) * COS_30 * unit,
    origin[1] + (x + y) * 0.5 * unit - z * unit,
  ]
}
