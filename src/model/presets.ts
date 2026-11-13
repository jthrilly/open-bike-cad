/** Starting-point designs for File → New. Values are typical, not copied from any product. */
import { Design, defaultDesign } from './schema';

const make = (patch: Partial<Design>) => (): Design => ({ ...defaultDesign(), ...patch }) as Design;

export const PRESETS: { id: string; label: string; make: () => Design }[] = [
  {
    id: 'road',
    label: 'road bike',
    make: make({ title: 'Road', frontEndMode: 'stackReach', stack: 565, reach: 385, headAngle: 73, seatAngle: 73.5, bbDrop: 72, chainstayLength: 410, seatTubeLength: 540, topTubeAngle: 6, forkLength: 370, forkRake: 45, rearTyre: 28, frontTyre: 28, barType: 'drop', stemLength: 100, spacers: 20, saddleHeight: 730, fitScheme: 'road' }),
  },
  {
    id: 'gravel',
    label: 'gravel bike',
    make: make({ title: 'Gravel', frontEndMode: 'stackReach', stack: 590, reach: 380, headAngle: 71.5, seatAngle: 73.5, bbDrop: 72, chainstayLength: 430, seatTubeLength: 530, topTubeAngle: 8, forkLength: 395, forkRake: 50, rearTyre: 42, frontTyre: 42, rearBSD: 622, frontBSD: 622, dropoutStyle: 'thru', rearSpacing: 142, frontSpacing: 100, stemLength: 90, spacers: 25, saddleHeight: 720, fitScheme: 'road', chainrings: '40', cogs: '10,11,13,15,17,19,21,24,28,32,37,44' }),
  },
  {
    id: 'touring',
    label: 'touring bike',
    make: make({ title: 'Touring', frontEndMode: 'reachHtl', reach: 375, headTubeLength: 175, headAngle: 71.5, seatAngle: 73, bbDrop: 75, chainstayLength: 460, seatTubeLength: 610, topTubeAngle: 2, forkLength: 395, forkRake: 50, rearTyre: 38, frontTyre: 38, brakeType: 'cantilever', jointStyle: 'lugged', fenders: true, rearRack: true, dtBottles: 1, stBottles: 1, saddleHeight: 720, fitScheme: 'touring', chainrings: '48,36,26', cogs: '11,13,15,17,20,23,26,30,34', dropoutStyle: 'horizontal', paintMain: '#14532d', paintStays: '#14532d', paintFork: '#14532d', paintAccent: '#e5d9b6' }),
  },
  {
    id: 'track',
    label: 'track bike',
    make: make({ title: 'Track', frontEndMode: 'reachHtl', reach: 395, headTubeLength: 130, headAngle: 74, seatAngle: 75, bbDrop: 55, chainstayLength: 390, seatTubeLength: 545, topTubeAngle: 0, forkLength: 365, forkRake: 30, forkType: 'straight', rearTyre: 23, frontTyre: 23, brakeType: 'none', dropoutStyle: 'track', chainrings: '49', cogs: '15', showFrontDerailleur: false, showRearDerailleur: false, dtBottles: 0, stBottles: 0, cableGuides: false, saddleHeight: 735, fitScheme: 'racing', rearSpacing: 120 }),
  },
  {
    id: 'mtb',
    label: 'hardtail MTB',
    make: make({ title: 'Hardtail', frontEndMode: 'stackReach', stack: 625, reach: 440, headAngle: 65.5, seatAngle: 75, bbDrop: 55, chainstayLength: 430, seatTubeLength: 495, topTubeAngle: 14, forkType: 'suspension', forkLength: 541, forkRake: 44, forkTravel: 130, rearBSD: 622, frontBSD: 622, rearTyre: 58, frontTyre: 60, barType: 'riser', barRise: 20, barWidth: 780, stemLength: 45, stemAngle: 0, spacers: 15, leverStyle: 'flat', seatpostType: 'dropper', dropperTravel: 170, chainrings: '32', cogs: '10,12,14,16,18,21,24,28,33,39,45,52', showFrontDerailleur: false, dropoutStyle: 'thru', rearSpacing: 148, frontSpacing: 110, ttOD: 31.8, dtOD: 38.1, stOD: 34.9, stODBottom: 34.9, htOD: 44, htProfile: 'tapered', htODBottom: 56, saddleHeight: 700, fitScheme: 'mtb', rotorFront: 200, rotorRear: 180 }),
  },
  {
    id: 'city',
    label: 'step-through city bike',
    make: make({ title: 'City', frameStyle: 'stepThrough', frontEndMode: 'reachHtl', reach: 360, headTubeLength: 190, headAngle: 70, seatAngle: 71, bbDrop: 70, chainstayLength: 455, seatTubeLength: 480, forkLength: 400, forkRake: 50, rearTyre: 40, frontTyre: 40, barType: 'sweptBack', barRise: 60, stemLength: 70, stemAngle: 20, spacers: 30, leverStyle: 'flat', fenders: true, rearRack: true, saddleHeight: 690, fitScheme: 'city', chainrings: '38', cogs: '18', showFrontDerailleur: false, showRearDerailleur: false, brakeType: 'vbrake' }),
  },
];
