/**
 * The design schema: every editable parameter of a bike design, with its
 * label, group, units, default, limits, and (where known) the .bcad key it
 * is read from and written to.
 *
 * All lengths are millimetres and all angles are degrees.
 */

export type ParamValue = number | string | boolean;
export type Design = Record<string, ParamValue>;

export type ParamKind = 'num' | 'enum' | 'bool' | 'text' | 'color' | 'longtext';

export interface ParamDef {
  id: string;
  label: string;
  group: GroupId;
  kind: ParamKind;
  default: ParamValue;
  unit?: 'mm' | '°' | 'teeth' | 'kg' | 'W' | 'Wh' | '%' | 'count' | '';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
  /** Hide the field unless this returns true. */
  showIf?: (d: Design) => boolean;
  /**
   * .bcad keys this parameter maps to. The first key is used when writing;
   * any of them is accepted when reading.
   */
  bcad?: string[];
  /** Convert a raw .bcad value to the internal value. */
  fromBcad?: (raw: string, all: Map<string, string>) => ParamValue | undefined;
  /** Convert the internal value to the raw .bcad string. */
  toBcad?: (value: ParamValue, d: Design) => string;
}

export type GroupId =
  | 'frontEnd'
  | 'frame'
  | 'tubes'
  | 'curves'
  | 'rear'
  | 'fork'
  | 'wheels'
  | 'drivetrain'
  | 'cockpit'
  | 'saddle'
  | 'accessories'
  | 'rider'
  | 'fit'
  | 'fixture'
  | 'paint'
  | 'drawing'
  | 'display';

export const GROUPS: { id: GroupId; label: string; section: string }[] = [
  { id: 'frontEnd', label: 'Front end', section: 'Geometry' },
  { id: 'frame', label: 'Main triangle', section: 'Geometry' },
  { id: 'rear', label: 'Rear end & dropouts', section: 'Geometry' },
  { id: 'fork', label: 'Fork & headset', section: 'Geometry' },
  { id: 'tubes', label: 'Tube sizes', section: 'Tubes' },
  { id: 'curves', label: 'Curved & shaped tubes', section: 'Tubes' },
  { id: 'wheels', label: 'Wheels & tyres', section: 'Components' },
  { id: 'drivetrain', label: 'Drivetrain', section: 'Components' },
  { id: 'cockpit', label: 'Stem & handlebars', section: 'Components' },
  { id: 'saddle', label: 'Seatpost & saddle', section: 'Components' },
  { id: 'accessories', label: 'Brakes, bosses & accessories', section: 'Components' },
  { id: 'rider', label: 'Rider body', section: 'Fit' },
  { id: 'fit', label: 'Rider position', section: 'Fit' },
  { id: 'fixture', label: 'Mitres & fixture', section: 'Build' },
  { id: 'paint', label: 'Paint & decals', section: 'Drawing' },
  { id: 'drawing', label: 'Title block & notes', section: 'Drawing' },
  { id: 'display', label: 'Display', section: 'Drawing' },
];

const num = (
  id: string,
  label: string,
  group: GroupId,
  def: number,
  extra: Partial<ParamDef> = {},
): ParamDef => ({ id, label, group, kind: 'num', default: def, unit: 'mm', step: 1, ...extra });
const ang = (id: string, label: string, group: GroupId, def: number, extra: Partial<ParamDef> = {}): ParamDef =>
  num(id, label, group, def, { unit: '°', step: 0.1, ...extra });
const en = (
  id: string,
  label: string,
  group: GroupId,
  def: string,
  options: [string, string][],
  extra: Partial<ParamDef> = {},
): ParamDef => ({ id, label, group, kind: 'enum', default: def, options: options.map(([value, l]) => ({ value, label: l })), ...extra });
const bool = (id: string, label: string, group: GroupId, def: boolean, extra: Partial<ParamDef> = {}): ParamDef => ({
  id,
  label,
  group,
  kind: 'bool',
  default: def,
  ...extra,
});
const text = (id: string, label: string, group: GroupId, def: string, extra: Partial<ParamDef> = {}): ParamDef => ({
  id,
  label,
  group,
  kind: 'text',
  default: def,
  ...extra,
});
const color = (id: string, label: string, group: GroupId, def: string, extra: Partial<ParamDef> = {}): ParamDef => ({
  id,
  label,
  group,
  kind: 'color',
  default: def,
  ...extra,
});

const isMode = (m: string) => (d: Design) => d.frontEndMode === m;

export const PARAMS: ParamDef[] = [
  // ---------------------------------------------------------------- front end
  en(
    'frontEndMode',
    'Front end defined by',
    'frontEnd',
    'stackReach',
    [
      ['stackReach', 'Stack & reach'],
      ['reachHtl', 'Reach & head tube length'],
      ['frontCenter', 'Front centre & head tube length'],
      ['ett', 'Effective top tube & top tube angle'],
      ['ttLength', 'Top tube length (c-c) & head tube length'],
      ['bars', 'Handlebar position'],
    ],
    {
      help: 'Choose which dimensions you set directly. The others are calculated.',
    },
  ),
  num('stack', 'Stack', 'frontEnd', 560, {
    help: 'Vertical distance from BB centre to the top of the head tube.',
    showIf: (d) => d.frontEndMode === 'stackReach',
  }),
  num('reach', 'Reach', 'frontEnd', 385, {
    help: 'Horizontal distance from BB centre to the top of the head tube.',
    showIf: (d) => d.frontEndMode === 'stackReach' || d.frontEndMode === 'reachHtl',
  }),
  num('frontCenter', 'Front centre', 'frontEnd', 590, { showIf: isMode('frontCenter') }),
  num('ettLength', 'Effective top tube', 'frontEnd', 550, {
    help: 'Horizontal distance from the seat tube line to where the top tube centreline meets the head tube. With the top tube angle and seat tube junction it places the head tube; head tube length is calculated.',
    showIf: isMode('ett'),
  }),
  num('ttLengthCC', 'Top tube length c-c', 'frontEnd', 540, { showIf: isMode('ttLength') }),
  num('barReachTarget', 'Bar reach from BB', 'frontEnd', 470, {
    help: 'Horizontal distance from BB to the handlebar clamp centre.',
    showIf: isMode('bars'),
  }),
  num('barStackTarget', 'Bar height above BB', 'frontEnd', 620, { showIf: isMode('bars') }),
  ang('headAngle', 'Head angle', 'frontEnd', 72.5, { min: 45, max: 89, bcad: ['Head angle'] }),
  num('headTubeLength', 'Head tube length', 'frontEnd', 150, {
    help: 'The whole head tube, end to end. As in BikeCAD, the headset cups sit at its ends, so the fork, stack and stem all follow it. Where the top and down tubes join is set by the head tube extensions.',
    min: 40,
    max: 400,
    showIf: (d) => !['stackReach', 'ett', 'bars'].includes(String(d.frontEndMode)),
    bcad: ['Head tube length textfield'],
  }),

  // ---------------------------------------------------------- main triangle
  ang('seatAngle', 'Seat angle', 'frame', 73.5, { min: 55, max: 89, bcad: ['Seat angle'] }),
  num('bbDrop', 'BB drop', 'frame', 70, {
    help: 'How far the BB centre sits below the rear axle. Negative means BB above axle.',
    min: -200,
    max: 200,
    bcad: ['BB textfield'],
  }),
  num('seatTubeLength', 'Seat tube length (c-t)', 'frame', 580, {
    help: 'From BB centre to the top of the seat tube, along the seat tube.',
    min: 200,
    max: 800,
    bcad: ['Seat tube length'],
  }),
  en(
    'topTubeMode',
    'Top tube defined by',
    'frame',
    'angle',
    [
      ['angle', 'Top tube angle'],
      ['extension', 'Seat tube extension above top tube'],
    ],
  ),
  ang('topTubeAngle', 'Top tube angle (from horizontal)', 'frame', 0, {
    help: 'Positive slopes down towards the seat tube.',
    min: -30,
    max: 45,
    showIf: (d) => d.topTubeMode === 'angle' || d.frontEndMode === 'ett',
    bcad: ['Top tube angle textfield'],
  }),
  num('seatTubeExtension', 'Seat tube extension', 'frame', 20, {
    help: 'Top of seat tube above the top tube centreline intersection.',
    showIf: (d) => d.topTubeMode === 'extension' || d.frontEndMode === 'ett',
  }),
  num('ttHeadOffset', 'Head tube extension above top tube', 'frame', 20, {
    help: 'How far the head tube extends above the top tube: along the head tube, from its top to the top tube centreline (BikeCAD "Head tube upper extension", centreline measure). It moves only the top tube junction; the head tube length and headset stay put.',
  }),
  num('dtHeadOffset', 'Head tube extension below down tube', 'frame', 25, {
    help: 'How far the head tube extends below the down tube: along the head tube, from its bottom to the down tube centreline (BikeCAD "Head tube lower extension", centreline measure). It moves only the down tube junction.',
  }),
  num('bbOffset', 'BB offset (seat tube forward of BB)', 'frame', 0, {
    help: 'Moves the seat tube axis forward (+) or back (−) of the BB centre.',
  }),
  en('frameStyle', 'Frame style', 'frame', 'diamond', [
    ['diamond', 'Diamond'],
    ['mixte', 'Mixte'],
    ['stepThrough', 'Step-through'],
    ['beam', 'Beam (discontinuous seat tube)'],
  ], {
    help: 'Beam is BikeCAD\'s "Discontinuous" seat tube: only a section J at the top of the seat tube and a section K at the BB are kept, with a gap between. With both at 0 there is no seat tube at all. Mixte and step-through are this app\'s own styles (BikeCAD builds them from removed and extra tubes).',
    bcad: ['DISCONTINUOUS'],
    fromBcad: (raw) => (raw === 'true' ? 'beam' : undefined),
    toBcad: (v) => (v === 'beam' ? 'true' : 'false'),
  }),
  num('stTopSection', 'Seat tube section at top (J)', 'frame', 0, {
    help: 'Beam frames: length of seat tube kept below the top of the seat tube, along the seat tube (BikeCAD "J"). 0 leaves none.',
    min: 0,
    showIf: (d) => d.frameStyle === 'beam',
    bcad: ['ST_TOP_LENGTH'],
  }),
  num('stBottomSection', 'Seat tube section at BB (K)', 'frame', 0, {
    help: 'Beam frames: length of seat tube kept above the BB shell, from where its edge meets the shell, along the seat tube (BikeCAD "K"). 0 leaves none.',
    min: 0,
    showIf: (d) => d.frameStyle === 'beam',
    bcad: ['ST_BOTTOM_LENGTH'],
  }),
  num('mixteRearOffset', 'Mixte stay length past seat tube', 'frame', 0, { showIf: (d) => d.frameStyle === 'mixte' }),

  // ------------------------------------------------------------- rear end
  num('chainstayLength', 'Chainstay length', 'rear', 420, {
    help: 'Centre-to-centre from BB to rear axle.',
    min: 250,
    max: 800,
    bcad: ['CS textfield'],
  }),
  num('ssSeatOffset', 'Seatstay junction below top tube', 'rear', 15, {
    help: 'Distance down the seat tube from the top tube junction to the seatstay centreline intersection.',
  }),
  en('seatstayStyle', 'Seatstay style', 'rear', 'standard', [
    ['standard', 'Standard'],
    ['wishbone', 'Wishbone / mono stay'],
    ['fastback', 'Fastback (wraps seat tube)'],
    ['dropped', 'Dropped (to seat tube below TT)'],
  ]),
  num('wishboneLength', 'Wishbone mono-stay length', 'rear', 120, { showIf: (d) => d.seatstayStyle === 'wishbone' }),
  num('ssMonoOD', 'Wishbone mono stay OD', 'rear', 25.4, { step: 0.1, showIf: (d) => d.seatstayStyle === 'wishbone' }),
  num('ssMonoWall', 'Wishbone mono stay wall', 'rear', 1.6, { step: 0.05, showIf: (d) => d.seatstayStyle === 'wishbone' }),
  num('wishboneSpread', 'Wishbone stay spread at the yoke (c-c)', 'rear', 100, { help: 'Centre-to-centre width of the two seatstays where they meet the yoke. Wide enough to clear the tyre, fender and frame lock.', showIf: (d) => d.seatstayStyle === 'wishbone' }),
  num('rearSpacing', 'Rear hub spacing (O.L.D.)', 'rear', 135),
  num('frontSpacing', 'Front hub spacing', 'rear', 100),
  en('dropoutStyle', 'Dropout style', 'rear', 'vertical', [
    ['vertical', 'Vertical'],
    ['horizontal', 'Horizontal / road'],
    ['track', 'Track (rear-facing)'],
    ['sliding', 'Sliding'],
    ['thru', 'Thru-axle'],
    ['hooded', 'Hooded'],
  ]),
  ang('dropoutSlotAngle', 'Slot angle', 'rear', 0, { showIf: (d) => d.dropoutStyle === 'horizontal' || d.dropoutStyle === 'track' || d.dropoutStyle === 'sliding' }),
  num('dropoutSlotLength', 'Slot length', 'rear', 25, { showIf: (d) => d.dropoutStyle === 'horizontal' || d.dropoutStyle === 'track' || d.dropoutStyle === 'sliding' }),
  num('dropoutSize', 'Dropout plate size', 'rear', 45),
  num('csDropoutOffset', 'Chainstay end before axle', 'rear', 35, { help: 'Length of dropout between axle and chainstay end.' }),
  num('ssDropoutOffset', 'Seatstay end before axle', 'rear', 35),
  num('bbShellWidth', 'BB shell width', 'rear', 68),
  num('bbShellOD', 'BB shell diameter', 'rear', 40),
  num('csWidthAtBB', 'Chainstay spread at BB', 'rear', 70),
  bool('csYoke', 'Chainstay yoke', 'rear', false),
  num('csDimple', 'Chainstay dimple depth', 'rear', 0, { step: 0.5, min: 0, max: 12, help: 'How far each chainstay is pressed in where it passes the tyre and (drive side) the chainring. Used in the clearance checks.' }),
  num('csBridgePos', 'Chainstay bridge from BB', 'rear', 70),
  num('ssBridgePos', 'Seatstay bridge from seat tube', 'rear', 130),

  // ------------------------------------------------------------------ fork
  en('forkType', 'Fork type', 'fork', 'rigid', [
    ['rigid', 'Rigid, curved blades'],
    ['straight', 'Rigid, straight blades'],
    ['suspension', 'Suspension'],
    ['lefty', 'Single-sided'],
    ['dualCrown', 'Dual crown'],
  ]),
  num('forkLength', 'Fork length (axle to crown)', 'fork', 375, { min: 200, max: 700 }),
  num('forkRake', 'Fork rake (offset)', 'fork', 45, { min: -50, max: 120 }),
  num('forkBladeBendLength', 'Blade bend length', 'fork', 120, { showIf: (d) => d.forkType === 'rigid' }),
  num('forkCrownHeight', 'Crown height', 'fork', 30),
  num('forkCrownWidth', 'Crown width (side view)', 'fork', 40),
  num('forkBladeDia', 'Blade diameter', 'fork', 24),
  num('forkStanchionDia', 'Stanchion diameter', 'fork', 34, { showIf: (d) => d.forkType === 'suspension' || d.forkType === 'dualCrown' || d.forkType === 'lefty' }),
  num('forkTravel', 'Travel', 'fork', 100, { showIf: (d) => d.forkType === 'suspension' || d.forkType === 'dualCrown' || d.forkType === 'lefty' }),
  num('forkSag', 'Sag', 'fork', 20, { showIf: (d) => d.forkType === 'suspension' || d.forkType === 'dualCrown' || d.forkType === 'lefty', help: 'Shortens the fork in the "sagged" view.' }),
  num('forkDropoutPlate', 'Fork dropout plate thickness', 'fork', 5, { step: 0.5, showIf: (d) => d.forkType === 'rigid' || d.forkType === 'straight' }),
  num('forkDropoutSlotWidth', 'Fork dropout slot width', 'fork', 9.5, { step: 0.5, help: '9.5 suits a 9 mm QR or nutted hub; 10 mm also takes a hub motor axle with 10 mm flats (and still clamps a 9 mm hub).', showIf: (d) => d.forkType === 'rigid' || d.forkType === 'straight' }),
  bool('forkTorqueArm', 'Torque arm (right) and torque-washer faces', 'fork', false, { help: 'Flat faces on both dropouts for anti-rotation washers, plus a clamp-on torque arm on the right side: needed for a front hub motor.', showIf: (d) => d.forkType === 'rigid' || d.forkType === 'straight' }),
  num('forkCableGuides', 'Cable guides on right blade', 'fork', 0, { step: 1, min: 0, max: 6, help: 'Small brazed guides on the back of the right blade, e.g. for a hub motor or dynamo cable.', showIf: (d) => d.forkType === 'rigid' || d.forkType === 'straight' }),
  num('lowerStack', 'Headset lower stack', 'fork', 12, { min: 0, max: 60, bcad: ['Lower stack height'] }),
  num('upperStack', 'Headset upper stack', 'fork', 15, { min: 0, max: 60, bcad: ['Upper stack height'] }),
  num('steererDia', 'Steerer diameter', 'fork', 28.6),

  // ----------------------------------------------------------------- tubes
  num('htOD', 'Head tube OD', 'tubes', 36, { step: 0.1, bcad: ['Head tube diameter'] }),
  num('htWall', 'Head tube wall', 'tubes', 1.2, { step: 0.05 }),
  en('htProfile', 'Head tube profile', 'tubes', 'straight', [
    ['straight', 'Straight'],
    ['tapered', 'Tapered'],
    ['hourglass', 'Hourglass'],
  ]),
  num('htODBottom', 'Head tube OD at bottom', 'tubes', 44, { step: 0.1, showIf: (d) => d.htProfile !== 'straight' }),
  num('ttOD', 'Top tube OD', 'tubes', 28.6, { step: 0.1 }),
  num('ttWall', 'Top tube wall', 'tubes', 0.8, { step: 0.05 }),
  en('ttProfile', 'Top tube profile', 'tubes', 'round', [
    ['round', 'Round'],
    ['oval', 'Ovalised'],
    ['rect', 'Rectangular'],
  ]),
  num('ttODMinor', 'Top tube height (oval/rect)', 'tubes', 24, { step: 0.1, showIf: (d) => d.ttProfile !== 'round' }),
  num('dtOD', 'Down tube OD', 'tubes', 31.8, { step: 0.1 }),
  num('dtWall', 'Down tube wall', 'tubes', 0.9, { step: 0.05 }),
  en('dtProfile', 'Down tube profile', 'tubes', 'round', [
    ['round', 'Round'],
    ['oval', 'Ovalised'],
    ['rect', 'Rectangular'],
  ]),
  num('dtODMinor', 'Down tube width (oval/rect)', 'tubes', 28, { step: 0.1, showIf: (d) => d.dtProfile !== 'round' }),
  num('stOD', 'Seat tube OD', 'tubes', 28.6, { step: 0.1, bcad: ['Seat tube diameter textfield'] }),
  num('stODBottom', 'Seat tube OD at BB', 'tubes', 28.6, { step: 0.1, bcad: ['Seat tube bottom diameter textfield'] }),
  num('stWall', 'Seat tube wall', 'tubes', 0.9, { step: 0.05 }),
  num('seatpostDia', 'Seatpost diameter', 'tubes', 27.2, { step: 0.1, bcad: ['Seatpost diameter'] }),
  num('csOD', 'Chainstay OD at BB', 'tubes', 22.2, { step: 0.1 }),
  num('csODTip', 'Chainstay OD at dropout', 'tubes', 12.7, { step: 0.1 }),
  num('csWall', 'Chainstay wall', 'tubes', 0.8, { step: 0.05 }),
  num('ssOD', 'Seatstay OD at top', 'tubes', 16, { step: 0.1 }),
  num('ssODTip', 'Seatstay OD at dropout', 'tubes', 13, { step: 0.1 }),
  num('ssWall', 'Seatstay wall', 'tubes', 0.8, { step: 0.05 }),
  en('jointStyle', 'Joint style', 'tubes', 'tig', [
    ['tig', 'TIG / fillet (no lugs)'],
    ['lugged', 'Lugged'],
    ['fillet', 'Fillet brazed (shown)'],
  ]),
  num('lugPointLength', 'Lug point length', 'tubes', 30, { showIf: (d) => d.jointStyle === 'lugged' }),
  num('filletRadius', 'Fillet radius', 'tubes', 8, { showIf: (d) => d.jointStyle === 'fillet' }),

  // ---------------------------------------------------------------- curves
  num('ttBend', 'Top tube bend (sagitta)', 'curves', 0, { help: 'Positive bows upward.', min: -150, max: 150 }),
  num('dtBend', 'Down tube bend (sagitta)', 'curves', 0, { help: 'Positive bows upward/forward.', min: -150, max: 150 }),
  num('stBend', 'Seat tube bend (sagitta)', 'curves', 0, { help: 'Positive bows forward.', min: -150, max: 150 }),
  num('csBend', 'Chainstay bend (sagitta)', 'curves', 0, { min: -80, max: 80 }),
  num('ssBend', 'Seatstay bend (sagitta)', 'curves', 0, { min: -80, max: 80 }),
  bool('loopedStays', 'Looped seatstays (one piece over seat tube)', 'curves', false),

  // ---------------------------------------------------------------- wheels
  num('rearBSD', 'Rear rim BSD', 'wheels', 622, { bcad: ['BSD rear'] }),
  num('frontBSD', 'Front rim BSD', 'wheels', 622, { bcad: ['BSD front'] }),
  num('rearTyre', 'Rear tyre height', 'wheels', 28, { help: 'Tyre section height (≈ width for most tyres).' }),
  num('frontTyre', 'Front tyre height', 'wheels', 28),
  num('rimDepth', 'Rim depth', 'wheels', 22, { step: 0.5 }),
  num('rimERDRear', 'Rear rim ERD', 'wheels', 602, { bcad: ['ERD rear'] }),
  num('rimERDFront', 'Front rim ERD', 'wheels', 602, { bcad: ['ERD front'] }),
  num('spokesRear', 'Rear spokes', 'wheels', 32, { unit: 'count' }),
  num('spokesFront', 'Front spokes', 'wheels', 32, { unit: 'count' }),
  num('crossRear', 'Rear spoke crosses', 'wheels', 3, { unit: 'count' }),
  num('crossFront', 'Front spoke crosses', 'wheels', 3, { unit: 'count' }),
  num('hubFlangeRear', 'Rear hub flange diameter', 'wheels', 45),
  num('hubFlangeFront', 'Front hub flange diameter', 'wheels', 38),
  en('wheelDetail', 'Wheel detail', 'wheels', 'spokes', [
    ['outline', 'Outline only'],
    ['rims', 'Tyre & rim'],
    ['spokes', 'Tyre, rim & spokes'],
    ['disc', 'Disc wheels'],
  ]),

  // ------------------------------------------------------------ drivetrain
  en('driveType', 'Drive', 'drivetrain', 'chain', [
    ['chain', 'Chain'],
    ['belt', 'Belt'],
    ['gearbox', 'Gearbox'],
    ['midDrive', 'Mid-drive motor'],
  ]),
  num('crankLength', 'Crank length', 'drivetrain', 172.5, { step: 0.5 }),
  text('chainrings', 'Chainrings (teeth)', 'drivetrain', '50,34', { help: 'Comma-separated.' }),
  text('cogs', 'Cassette (teeth)', 'drivetrain', '11,12,13,14,15,17,19,21,24,28,32', { help: 'Comma-separated.' }),
  num('cadence', 'Cadence for speed table', 'drivetrain', 90, { unit: '' }),
  num('chainline', 'Chainline', 'drivetrain', 43.5, { step: 0.5 }),
  num('pedalStack', 'Pedal stack height', 'drivetrain', 12),
  ang('crankAngle', 'Crank angle shown', 'drivetrain', 0, { help: '0 = drive crank forward horizontal.' }),
  bool('showFrontDerailleur', 'Front derailleur', 'drivetrain', true),
  bool('showRearDerailleur', 'Rear derailleur', 'drivetrain', true),
  num('motorLength', 'Motor/gearbox length', 'drivetrain', 200, { showIf: (d) => d.driveType === 'gearbox' || d.driveType === 'midDrive' }),
  num('motorHeight', 'Motor/gearbox height', 'drivetrain', 160, { showIf: (d) => d.driveType === 'gearbox' || d.driveType === 'midDrive' }),

  // --------------------------------------------------------------- cockpit
  num('spacers', 'Spacer stack', 'cockpit', 20, { bcad: ['Headset spacers'] }),
  num('stemLength', 'Stem length', 'cockpit', 100, { bcad: ['Stem length'] }),
  ang('stemAngle', 'Stem angle', 'cockpit', -6, { help: 'Relative to perpendicular of the steerer. Negative points down.', bcad: ['Stem angle'] }),
  num('stemClampHeight', 'Stem steerer clamp height', 'cockpit', 40),
  en('stemKind', 'Stem kind', 'cockpit', 'threadless', [
    ['threadless', 'Threadless'],
    ['quill', 'Quill'],
    ['integrated', 'One-piece bar & stem'],
  ]),
  num('quillHeight', 'Quill extension', 'cockpit', 60, { showIf: (d) => d.stemKind === 'quill' }),
  en('barType', 'Handlebar', 'cockpit', 'drop', [
    ['drop', 'Drop'],
    ['flat', 'Flat'],
    ['riser', 'Riser'],
    ['bullhorn', 'Bullhorn'],
    ['sweptBack', 'Swept-back / North Road'],
    ['aero', 'Aero extensions'],
  ]),
  num('barReach', 'Bar reach', 'cockpit', 80, { bcad: ['Road bar reach'] }),
  num('barDrop', 'Bar drop', 'cockpit', 125, { bcad: ['Road bar drop'],  showIf: (d) => d.barType === 'drop' }),
  num('barRise', 'Bar rise', 'cockpit', 20, { showIf: (d) => d.barType === 'riser' || d.barType === 'sweptBack' }),
  num('barWidth', 'Bar width', 'cockpit', 420),
  ang('barRoll', 'Bar roll angle', 'cockpit', 0, { help: 'Rotation of the bar about its clamp.' }),
  num('barDia', 'Bar clamp diameter', 'cockpit', 31.8, { bcad: ['HBARDIA'] }),
  en('leverStyle', 'Brake/shift lever', 'cockpit', 'brifter', [
    ['brifter', 'Road combined lever'],
    ['flat', 'Flat-bar lever'],
    ['none', 'None'],
  ]),
  en('shifter', 'Gear shifter', 'cockpit', 'none', [
    ['none', 'None / integrated in lever'],
    ['trigger', 'Trigger, under the bar'],
    ['twist', 'Twist grip'],
  ], { showIf: (d) => d.barType !== 'drop' }),
  num('gripLength', 'Grip length', 'cockpit', 130, { showIf: (d) => d.barType !== 'drop' }),

  // ---------------------------------------------------------------- saddle
  num('saddleHeight', 'Saddle height (BB to top, along ST)', 'saddle', 720, { bcad: ['Saddle height'] }),
  num('seatpostSetback', 'Seatpost setback', 'saddle', 20, { bcad: ['Seatpost setback'] }),
  num('saddleSetback', 'Saddle rail position fore/aft', 'saddle', 0, { help: 'Saddle slides forward (+) or back (−) on its rails.' }),
  num('saddleLength', 'Saddle length', 'saddle', 270, { bcad: ['Saddle length'] }),
  ang('saddleAngle', 'Saddle tilt', 'saddle', 0, { help: 'Positive tips the nose up.', bcad: ['Saddle angle'] }),
  num('saddleHeightAbove', 'Saddle thickness above rails', 'saddle', 50),
  en('seatpostType', 'Seatpost', 'saddle', 'standard', [
    ['standard', 'Standard'],
    ['dropper', 'Dropper'],
    ['integrated', 'Integrated seat mast'],
  ]),
  num('dropperTravel', 'Dropper travel', 'saddle', 125, { showIf: (d) => d.seatpostType === 'dropper' }),
  bool('dropperDown', 'Show dropper lowered', 'saddle', false, { showIf: (d) => d.seatpostType === 'dropper' }),
  num('minPostInsertion', 'Minimum seatpost insertion', 'saddle', 80),

  // ----------------------------------------------------------- accessories
  en('brakeType', 'Brakes', 'accessories', 'disc', [
    ['disc', 'Disc'],
    ['caliper', 'Rim caliper'],
    ['cantilever', 'Cantilever'],
    ['vbrake', 'V-brake'],
    ['none', 'None / coaster'],
  ]),
  num('rotorFront', 'Front rotor', 'accessories', 160, { showIf: (d) => d.brakeType === 'disc' }),
  num('rotorRear', 'Rear rotor', 'accessories', 140, { showIf: (d) => d.brakeType === 'disc' }),
  num('dtBottles', 'Down tube bottle cages', 'accessories', 1, { unit: 'count', min: 0, max: 3 }),
  num('stBottles', 'Seat tube bottle cages', 'accessories', 1, { unit: 'count', min: 0, max: 2 }),
  num('dtBossFromBB', 'Down tube lower boss from BB', 'accessories', 160),
  num('stBossFromBB', 'Seat tube lower boss from BB', 'accessories', 160),
  num('bossSpacing', 'Boss spacing', 'accessories', 64),
  bool('fenders', 'Fenders', 'accessories', false),
  num('fenderWidthExtra', 'Fender width over tyre width', 'accessories', 18, { help: 'Fender width minus tyre width. About 8-12 mm keeps the fork blades close enough for V-brakes on wide tyres.', showIf: (d) => d.fenders === true }),
  en('rearHubBrake', 'Rear hub brake', 'accessories', 'none', [
    ['none', 'None (rim/disc brake as set above)'],
    ['roller', 'Roller brake (e.g. Shimano Nexus)'],
    ['coaster', 'Coaster (back-pedal)'],
  ], { help: 'A hub brake replaces the rear rim brake: no rear bosses; a reaction arm clamps to the left chainstay.' }),
  num('fenderClearance', 'Fender clearance', 'accessories', 12, { showIf: (d) => d.fenders === true }),
  ang('fenderRearStart', 'Rear fender front end', 'accessories', 5, { help: 'Angle around the rear axle where the fender starts, in degrees: 0 = straight forward, 90 = straight up, 180 = straight back.', showIf: (d) => d.fenders === true }),
  ang('fenderRearEnd', 'Rear fender back end', 'accessories', 200, { help: 'Angle around the rear axle where the fender ends (0 forward, 90 up, 180 back).', showIf: (d) => d.fenders === true }),
  ang('fenderFrontStart', 'Front fender front end', 'accessories', 40, { help: 'Angle around the front axle where the fender starts (0 forward, 90 up, 180 back). Larger keeps the fender from sticking out ahead of the wheel.', showIf: (d) => d.fenders === true }),
  ang('fenderFrontEnd', 'Front fender back end', 'accessories', 195, { help: 'Angle around the front axle where the fender ends (0 forward, 90 up, 180 back).', showIf: (d) => d.fenders === true }),
  bool('rearRack', 'Rear rack', 'accessories', false),
  num('rackTubeOD', 'Rear rack tube / rod OD', 'accessories', 12, { step: 0.5, showIf: (d) => d.rearRack === true }),
  num('rackHeightAboveTyre', 'Rack platform above tyre', 'accessories', 40, { help: 'Height of the rack platform centreline above the top of the rear tyre.', showIf: (d) => d.rearRack === true }),
  num('rackLoad', 'Rack load rating', 'accessories', 25, { unit: 'kg', showIf: (d) => d.rearRack === true }),
  bool('chainguard', 'Chainguard', 'accessories', false),
  num('rackRearOverhang', 'Rack platform behind rear axle', 'accessories', 120, { help: 'How far the back of the rack platform reaches behind the rear axle.', showIf: (d) => d.rearRack === true }),
  bool('ringLock', 'Frame (ring) lock on seatstays', 'accessories', false),
  bool('carrierBlock', 'Front carrier block on head tube', 'accessories', false, { help: 'Brompton-style: a brazed-on mounting block with two M5 holes 26 mm apart on the front of the head tube, and a bolt-on carrier block that a luggage frame clips onto. The load does not steer.' }),
  en('carrierBlockPosition', 'Carrier block mounting position', 'accessories', 'standard', [['standard', 'Standard (45% down the head tube)'], ['low', 'Low (near the bottom of the head tube)']], {
    help: 'Where the mounting block is brazed. Low puts the block, and so a bag hanging on it, further below the handlebar, which leaves room for a taller bag. Best on long head tubes (small wheels).',
    showIf: (d) => d.carrierBlock === true,
  }),
  num('carrierBlockLowPos', 'Low mount: block centre above head tube bottom', 'accessories', 60, { help: 'Measured along the head tube from its bottom face to the centre of the brazed mounting block (40 mm long). Leave room for the lower headset cup and the down tube fillet.', showIf: (d) => d.carrierBlock === true && d.carrierBlockPosition === 'low' }),
  bool('frontBag', 'Show a front bag on the carrier block', 'accessories', false, { help: 'A luggage-frame bag hanging on the carrier block with its back vertical. Checked against the front tyre/fender at full steering lock and against the handlebar and stem (with room for hands); the tallest bag that fits is reported.', showIf: (d) => d.carrierBlock === true }),
  num('frontBagHeight', 'Front bag height', 'accessories', 300, { showIf: (d) => d.frontBag === true }),
  num('frontBagDepth', 'Front bag depth (forward)', 'accessories', 180, { showIf: (d) => d.frontBag === true }),
  num('frontBagWidth', 'Front bag width', 'accessories', 330, { showIf: (d) => d.frontBag === true }),
  num('frontBagBelowBlock', 'Front bag bottom below block centre', 'accessories', 60, { help: 'Set by where the luggage frame\'s receiver sits on the bag.', showIf: (d) => d.frontBag === true }),
  bool('blockBattery', 'E-assist battery cradle on carrier block', 'accessories', false, {
    help: 'A steel cradle bolted to the front of the carrier block holds a slide-in e-bike battery base (key lock, built-in contacts). The battery lifts out upward for charging. The motor controller sits in the cradle below the pack. Checked against the front tyre/fender at full steering lock and against the handlebar.',
    showIf: (d) => d.carrierBlock === true,
  }),
  num('blockBatteryHeight', 'Battery pack height (along head tube)', 'accessories', 151, { showIf: (d) => d.blockBattery === true }),
  num('blockBatteryDepth', 'Battery pack depth (forward)', 'accessories', 111, { showIf: (d) => d.blockBattery === true }),
  num('blockBatteryWidth', 'Battery pack width', 'accessories', 85, { showIf: (d) => d.blockBattery === true }),
  num('blockBatteryLift', 'Battery pack raised above block centre', 'accessories', 30, { help: 'Moves the pack up the head tube from the carrier block centre. Higher clears the front fender at full lock; lower clears the handlebar and cables.', showIf: (d) => d.blockBattery === true }),
  num('blockBatteryWh', 'Battery capacity', 'accessories', 360, { unit: 'Wh', step: 10, showIf: (d) => d.blockBattery === true }),
  num('blockBatteryKg', 'Battery mass', 'accessories', 2.2, { unit: 'kg', step: 0.1, showIf: (d) => d.blockBattery === true }),
  text('blockBatteryLayout', 'Battery pack build-up', 'accessories', '10S2P of 21700 cells (5.0 Ah, 21.7 x 70.8 mm, ~69 g). Cells lie across the bike (axis = y) in a 4 deep x 5 high grid on 22.2 mm holder pitch: core 88.8 deep x 111 high x 74.5 wide incl. holders and nickel. Adds: kapton/fish-paper wrap 1 mm a side; 10S 20 A BMS (~60 x 45 x 8 mm) plus leads on the back face, 12 mm; EVA foam 1.5 mm a side; ABS/alu case wall 2.5 mm a side; slide-in lock and contact block under the cells 18 mm; carry handle and charge port in the top cap 12 mm. Pack 111 deep x 151 high x 85 wide, ~2.2 kg (cells 1.38 kg). Controller is not in the pack.', { showIf: (d) => d.blockBattery === true }),
  bool('frontHubMotor', 'Front hub motor (e-assist)', 'accessories', false, { help: 'Geared front hub motor, 100 mm OLD, 10 mm axle with flats. Fork dropouts need 10 mm slots, 6 mm plate and anti-rotation (torque) washers on both sides.' }),
  num('motorShellDia', 'Hub motor shell diameter', 'accessories', 130, { showIf: (d) => d.frontHubMotor === true }),
  num('motorShellWidth', 'Hub motor shell width', 'accessories', 80, { showIf: (d) => d.frontHubMotor === true }),
  num('motorPower', 'Motor rated power', 'accessories', 250, { unit: 'W', step: 10, showIf: (d) => d.frontHubMotor === true }),
  en('pasSensor', 'Pedal assist sensor', 'accessories', 'cadence', [['cadence', 'Cadence (magnet disc at BB)'], ['torque', 'Torque-sensing BB cartridge']], { showIf: (d) => d.frontHubMotor === true }),
  bool('frontRack', 'Front rack', 'accessories', false),
  bool('pump', 'Frame pump', 'accessories', false),
  bool('cableGuides', 'Cable guides / ports', 'accessories', true),
  bool('kickstand', 'Kickstand plate', 'accessories', false),
  bool('battery', 'Battery on down tube', 'accessories', false),
  num('batteryLength', 'Battery length', 'accessories', 380, { showIf: (d) => d.battery === true }),

  // ----------------------------------------------------------------- rider
  bool('showRider', 'Show rider', 'rider', false),
  num('riderHeight', 'Height', 'rider', 1780),
  num('inseam', 'Inseam (floor to crotch)', 'rider', 840),
  num('torso', 'Torso (crotch to sternal notch)', 'rider', 640),
  num('arm', 'Arm length (shoulder to fist)', 'rider', 650),
  num('upperArmRatio', 'Upper arm share of arm', 'rider', 48, { unit: '%' }),
  num('femurRatio', 'Thigh share of inseam', 'rider', 48, { unit: '%' }),
  num('footLength', 'Foot / shoe length', 'rider', 280),
  num('shoulderWidth', 'Shoulder width', 'rider', 400),
  num('riderMass', 'Rider mass', 'rider', 75, { unit: 'kg' }),
  num('cleatSetback', 'Cleat: ball of foot to pedal axle', 'rider', 0, { help: 'Positive = cleat further back on the shoe, so the ball of the foot (and the toe) sit this far forward of the pedal axle.' }),

  // ------------------------------------------------------------------- fit
  en('fitScheme', 'Fit scheme', 'fit', 'road', [
    ['road', 'Road'],
    ['racing', 'Road racing'],
    ['touring', 'Touring'],
    ['mtb', 'MTB'],
    ['tt', 'Time trial / triathlon'],
    ['city', 'City / upright'],
  ]),
  en('handPosition', 'Hand position', 'fit', 'hoods', [
    ['hoods', 'Hoods / grips'],
    ['tops', 'Tops'],
    ['drops', 'Drops'],
  ]),
  bool('showHelmet', 'Helmet', 'fit', true),

  // --------------------------------------------------------------- fixture
  en('paperSize', 'Template paper size', 'fixture', 'A4', [
    ['A4', 'A4'],
    ['A3', 'A3'],
    ['letter', 'Letter 8.5×11"'],
    ['tabloid', 'Tabloid 11×17"'],
  ]),
  num('paperThicknessComp', 'Paper thickness allowance', 'fixture', 0.2, { step: 0.05, help: 'Paper thickness. Added to tube OD for the template wrap only (circumference π·(OD + t)); the cope shape and cut lengths do not change.' }),
  num('fixtureHTExtension', 'Fixture head tube cone extension', 'fixture', 0),
  num('fixtureRefHeight', 'Fixture BB reference height', 'fixture', 0),
  num('faceAllowance', 'Tube cut allowance (each end)', 'fixture', 2, { step: 0.5 }),

  // ----------------------------------------------------------------- paint
  color('paintMain', 'Main tubes', 'paint', '#2f6fde'),
  color('paintStays', 'Stays', 'paint', '#2f6fde'),
  color('paintFork', 'Fork', 'paint', '#2f6fde'),
  color('paintHeadTube', 'Head tube', 'paint', '#1b2a44'),
  color('paintAccent', 'Accent / lugs', 'paint', '#d8dde6'),
  color('componentColor', 'Components', 'paint', '#3a3f47'),
  color('tyreColor', 'Tyres', 'paint', '#26282c'),
  text('decalText', 'Down tube decal', 'paint', 'OPEN BIKE'),
  color('decalColor', 'Decal colour', 'paint', '#ffffff'),
  text('decalFont', 'Decal font', 'paint', 'Arial Black, Helvetica, sans-serif'),
  text('headBadge', 'Head badge text', 'paint', ''),
  text('ttDecal', 'Top tube decal', 'paint', ''),

  // --------------------------------------------------------------- drawing
  text('title', 'Model name', 'drawing', 'Untitled frame'),
  text('customer', 'Customer', 'drawing', ''),
  text('designer', 'Designer / builder', 'drawing', ''),
  text('size', 'Size', 'drawing', ''),
  text('material', 'Material', 'drawing', 'Steel'),
  text('drawingDate', 'Date', 'drawing', ''),
  { id: 'notes', label: 'Notes', group: 'drawing', kind: 'longtext', default: '' },
  en('sheetSize', 'Drawing sheet', 'drawing', 'A3', [
    ['A4', 'A4 landscape'],
    ['A3', 'A3 landscape'],
    ['A2', 'A2 landscape'],
    ['letter', 'Letter landscape'],
    ['tabloid', 'Tabloid landscape'],
  ]),
  color('titleBlockColor', 'Title block accent', 'drawing', '#2f6fde'),

  // --------------------------------------------------------------- display
  bool('showDims', 'Dimensions', 'display', true),
  bool('showComponents', 'Components', 'display', true),
  bool('showWheels', 'Wheels', 'display', true),
  bool('showCentrelines', 'Tube centrelines', 'display', true),
  bool('showGround', 'Ground line', 'display', true),
  bool('showToeOverlap', 'Toe overlap check', 'display', true),
  bool('showPaint', 'Paint colours', 'display', true),
  bool('showDecals', 'Decals', 'display', true),
  num('outlineThickness', 'Outline thickness', 'display', 1.2, { step: 0.1, unit: '' }),
  num('dimTextSize', 'Dimension text size', 'display', 14, { unit: '' }),
  color('dimColor', 'Dimension colour', 'display', '#c2410c'),
  text('dimSet', 'Dimensions shown', 'display', 'stack,reach,ha,sa,ett,htl,cs,bbdrop,wb,fc,trail,st,tt,standover', {
    help: 'Comma-separated: stack, reach, ha, sa, ett, htl, cs, bbdrop, bbh, wb, fc, trail, st, stcc, tt, dt, ss, standover, fork, rake, saddle, setback, toe.',
  }),
];

export const PARAM_BY_ID: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

export function defaultDesign(): Design {
  const d: Design = {};
  for (const p of PARAMS) d[p.id] = p.default;
  return d;
}

export function numOf(d: Design, id: string): number {
  const v = d[id];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  const def = PARAM_BY_ID[id]?.default;
  return typeof def === 'number' ? def : 0;
}

export function parseTeeth(s: ParamValue): number[] {
  return String(s)
    .split(/[,;\s]+/)
    .map((t) => parseInt(t, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}
