// Truth first. One pure module; the geometry, the motion and the readout all
// read it, so none of them can disagree.
//
// World units are 0.1 mm. Everything below is a real Schlage C-keyway
// dimension converted once:
//
//   plug diameter          0.500 in   = 127.0  ->  RADIUS 62 (a 12.4 mm plug)
//   pin diameter           0.115 in   =  29.2  ->  PIN 14 radius
//   pin spacing            0.156 in   =  39.6
//   first cut from shoulder 0.231 in  =  58.7
//   depth increment        0.015 in   =   3.81
//   root depth of a #0 cut 0.335 in   =  85.1   (also the blade's width)
//   driver pin             0.190 in   =  48.3
//   MACS (max adjacent cut difference) is 7.

export const MM = 10; // world units per millimetre

export const RADIUS = 62; // plug
export const ZAX = 126; // plug axis height above the bench
export const SHEAR = ZAX + RADIUS; // 188 - the plug's crown; where the stacks must split
export const PFLOOR = ZAX - RADIUS; // 64 - bottom of the bore

export const KEY_FLOOR = PFLOOR + 8; // 72 - the keyway floor the key's back rides on
export const KEY_HALF = 15; // keyway half-width, = chamber radius
export const BLADE_W = 85.1; // back of the blade to its top edge (a #0 at every cut)
export const KEY_TOP = KEY_FLOOR + BLADE_W + 4; // keyway ceiling, with clearance

export const CHAMBER = 17; // chamber bore radius
export const PIN = 14; // pin radius
export const SPRING = 10; // spring coil radius
export const DRIVER = 48.3; // driver pin length
export const CEILING = SHEAR + DRIVER + 16; // chamber ceiling: driver plus a compressed spring

export const SPACING = 39.6;
export const FIRST_CUT = 58.7; // from the shoulder
export const STEP = 0.381 * MM; // one depth increment
export const ROOT0 = BLADE_W; // a #0 cut takes nothing off
export const CUT_FLAT = 9; // half-width of a cut's flat root
export const DEPTHS = 10;

export const SHOULDER = 282; // the plug's face; the key's shoulder stops here
export const BLADE_LEN = 230;
export const TIP = SHOULDER - BLADE_LEN;

// The block is half-sectioned: everything in front of the pin line is milled
// away, so the near face of the shell is the plane y = 0.
export const SHELL_X = [0, 268];
export const SHELL_Y = [-74, 0];
// The chamber caps are off, so the block's top face is the chamber ceiling and
// you look straight down five half-bores at the springs.
export const SHELL_Z = [44, CEILING];

// Pin 1 is nearest the face.
export const PINS = Array.from({ length: 5 }, (_, index) => SHOULDER - FIRST_CUT - SPACING * index);

export const RIGHT = [3, 7, 1, 5, 8]; // a legal bitting: adjacent differences 4, 6, 4, 3
export const WRONG = [3, 7, 4, 5, 5]; // also legal, but cut 3 too deep and cut 5 too shallow

// Root height of cut n above the bench.
export const rootOf = (n) => KEY_FLOOR + ROOT0 - STEP * n;
// The key pin that puts that root exactly on the shear line.
export const pinLengthOf = (n) => SHEAR - rootOf(n);
export const PIN_LENGTHS = RIGHT.map(pinLengthOf);

// The blade's top edge: a flat at ROOT0 with a 45 degree V at every cut.
export function bladeTop(x, bitting) {
  if (x < TIP || x > SHOULDER) return null;
  let top = KEY_FLOOR + ROOT0;
  bitting.forEach((n, index) => {
    const root = rootOf(n);
    top = Math.min(top, root + Math.max(0, Math.abs(x - PINS[index]) - CUT_FLAT));
  });
  // The tip is bevelled so the pins ride up onto the blade. It has to clear
  // the deepest cut, which on a 5-pin key sits barely 13 units from the tip.
  return Math.min(top, rootOf(DEPTHS - 1) - 8 + (x - TIP) * 2.2);
}

// What each key pin rests on when the key sits `offset` out of the keyway.
export function floorsUnder(offset, bitting) {
  return PINS.map((x) => {
    const top = bladeTop(x - offset, bitting);
    return top === null ? KEY_FLOOR : top;
  });
}

// The whole state of the lock, from one number.
export function stateOf(offset, bitting) {
  const floors = floorsUnder(offset, bitting);
  const stacks = floors.map((floor, index) => {
    const split = floor + PIN_LENGTHS[index];
    return { floor, split, gap: split - SHEAR };
  });
  const free = stacks.every((stack) => Math.abs(stack.gap) < 0.6);
  return { stacks, free };
}
