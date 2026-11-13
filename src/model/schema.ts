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
  unit?: 'mm' | '°' | 'teeth' | 'kg' | '%' | 'count' | '';
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
const notMode = (m: string) => (d: Design) => d.frontEndMode !== m;

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
      ['ett', 'Effective top tube & head tube length'],
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
  num('frontCenter', 'Front centre', 'frontEnd', 590, { showIf: isMode('frontCenter'), bcad: ['FCD textfield'] }),
  num('ettLength', 'Effective top tube', 'frontEnd', 550, {
    help: 'Horizontal distance from the head tube top to the seat tube line (or its extension).',
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
    min: 40,
    max: 400,
    showIf: notMode('stackReach'),
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
  num('seatTubeLength', 'Seat tube length (c-t)', 'frame', 540, {
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
    showIf: (d) => d.topTubeMode === 'angle',
    bcad: ['Top tube angle textfield'],
  }),
  num('seatTubeExtension', 'Seat tube extension', 'frame', 20, {
    help: 'Top of seat tube above the top tube centreline intersection.',
    showIf: (d) => d.topTubeMode === 'extension',
  }),
  num('ttHeadOffset', 'Top tube junction below HT top', 'frame', 20, {
    help: 'Distance along the head tube from its top to the top tube centreline.',
  }),
  num('dtHeadOffset', 'Down tube junction above HT bottom', 'frame', 25, {
    help: 'Distance along the head tube from its bottom to the down tube centreline.',
  }),
  num('bbOffset', 'BB offset (seat tube forward of BB)', 'frame', 0, {
    help: 'Moves the seat tube axis forward (+) or back (−) of the BB centre.',
  }),
  num('htExtTop', 'Head tube extension above lug', 'frame', 0),
  num('htExtBottom', 'Head tube extension below lug', 'frame', 0),
  en('frameStyle', 'Frame style', 'frame', 'diamond', [
    ['diamond', 'Diamond'],
    ['mixte', 'Mixte'],
    ['stepThrough', 'Step-through'],
    ['beam', 'Beam (no seat tube)'],
  ]),
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
  num('fenderClearance', 'Fender clearance', 'accessories', 12, { showIf: (d) => d.fenders === true }),
  bool('rearRack', 'Rear rack', 'accessories', false),
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
  num('cleatSetback', 'Cleat: ball of foot to pedal axle', 'rider', 0),

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
  num('paperThicknessComp', 'Paper thickness allowance', 'fixture', 0.2, { step: 0.05, help: 'Added to tube OD so the wrapped template matches the tube surface.' }),
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
