/**
 * Upgrades for designs saved by older versions of the app.
 */
import { Design, numOf } from './schema';
import { switchFrontEndMode, round } from '../geometry/solve';

/** Parameters older versions had and this one no longer does. */
export const LEGACY_PARAMS = ['htExtTop', 'htExtBottom'];

/**
 * Head tube extensions beyond the lugs (`htExtTop` / `htExtBottom`).
 *
 * They used to lengthen the drawn and cut head tube past "head tube length" while the headset
 * cups, fork and stem stayed at the old ends. BikeCAD has no such thing: its head tube length is
 * the whole tube, the headset sits at its ends, and its head tube "extensions" are only where the
 * top and down tubes join (our ttHeadOffset / dtHeadOffset). So the old extensions are folded in
 * the BikeCAD way:
 *   - the head tube keeps its old end-to-end length (head tube length + both extensions);
 *   - the top and down tube junctions keep their distances from the tube's ends;
 *   - the fork and front wheel stay where they were, with the lower headset cup now at the
 *     tube's bottom, so the tube (and the headset, stem and bars on top of it) rise along the
 *     steering axis by the extensions. Stack and reach change accordingly.
 * Whatever the front end mode, the same physical change is made (via a front-centre and
 * head-tube-length front end, which keeps the front axle fixed), then the design is put back in
 * its own mode.
 */
export function migrateHeadTubeExtensions(d: Design): Design {
  if (!('htExtTop' in d) && !('htExtBottom' in d)) return d;
  const top = numOf(d, 'htExtTop') || 0;
  const bot = numOf(d, 'htExtBottom') || 0;
  const out: Design = { ...d };
  delete out.htExtTop;
  delete out.htExtBottom;
  if (top === 0 && bot === 0) return out;
  const mode = String(out.frontEndMode);
  const fc = switchFrontEndMode(out, 'frontCenter');
  fc.headTubeLength = round(numOf(fc, 'headTubeLength') + top + bot);
  fc.ttHeadOffset = round(numOf(out, 'ttHeadOffset') + top);
  fc.dtHeadOffset = round(numOf(out, 'dtHeadOffset') + bot);
  return mode === 'frontCenter' ? fc : switchFrontEndMode(fc, mode);
}

/** Bring a stored design up to date (before missing parameters are filled with defaults). */
export function migrateDesign(d: Design): Design {
  return migrateHeadTubeExtensions(d);
}
