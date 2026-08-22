// src/utils/matchConstants.js

export const MATCH_DURATION = 90;
export const FIRST_HALF_END = 45;
export const MAX_SUBSTITUTIONS = 5;
export const PLAYERS_ON_PITCH = 11;

export const FORMATIONS = {
  '4-4-2': {
    name: '4-4-2',
    positions: [
      { x: 8, y: 50 },   // GK
      { x: 23, y: 18 },  // LB
      { x: 23, y: 39 },  // CB
      { x: 23, y: 61 },  // CB
      { x: 23, y: 82 },  // RB
      { x: 42, y: 20 },  // LM
      { x: 42, y: 42 },  // CM
      { x: 42, y: 58 },  // CM
      { x: 42, y: 80 },  // RM
      { x: 62, y: 36 },  // ST
      { x: 62, y: 64 },  // ST
    ],
  },
  '4-3-3': {
    name: '4-3-3',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 18 },
      { x: 23, y: 39 },
      { x: 23, y: 61 },
      { x: 23, y: 82 },
      { x: 42, y: 30 },
      { x: 42, y: 50 },
      { x: 42, y: 70 },
      { x: 64, y: 20 },
      { x: 64, y: 50 },
      { x: 64, y: 80 },
    ],
  },
  '3-5-2': {
    name: '3-5-2',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 30 },
      { x: 23, y: 50 },
      { x: 23, y: 70 },
      { x: 42, y: 20 },
      { x: 42, y: 39 },
      { x: 42, y: 50 },
      { x: 42, y: 61 },
      { x: 42, y: 80 },
      { x: 64, y: 36 },
      { x: 64, y: 64 },
    ],
  },
  '5-3-2': {
    name: '5-3-2',
    positions: [
      { x: 8, y: 50 },
      { x: 20, y: 15 },
      { x: 20, y: 32 },
      { x: 20, y: 50 },
      { x: 20, y: 68 },
      { x: 20, y: 85 },
      { x: 42, y: 30 },
      { x: 42, y: 50 },
      { x: 42, y: 70 },
      { x: 64, y: 36 },
      { x: 64, y: 64 },
    ],
  },
  '4-2-3-1': {
    name: '4-2-3-1',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 18 },
      { x: 23, y: 39 },
      { x: 23, y: 61 },
      { x: 23, y: 82 },
      { x: 38, y: 35 },
      { x: 38, y: 65 },
      { x: 52, y: 20 },
      { x: 52, y: 50 },
      { x: 52, y: 80 },
      { x: 68, y: 50 },
    ],
  },
};

export const TACTICS = {
  'Tiki-Taka': {
    name: 'Tiki-Taka',
    passChance: 0.62,
    dribbleChance: 0.18,
    shootChance: 0.20,
    pressIntensity: 0.70,
    attackModifier: 1.00,
    defenceModifier: 1.00,
  },
  'Counter Attack': {
    name: 'Counter Attack',
    passChance: 0.32,
    dribbleChance: 0.38,
    shootChance: 0.30,
    pressIntensity: 0.40,
    attackModifier: 1.08,
    defenceModifier: 0.96,
  },
  'High Press': {
    name: 'High Press',
    passChance: 0.42,
    dribbleChance: 0.28,
    shootChance: 0.30,
    pressIntensity: 0.90,
    attackModifier: 1.04,
    defenceModifier: 1.05,
  },
  'Park the Bus': {
    name: 'Park the Bus',
    passChance: 0.54,
    dribbleChance: 0.16,
    shootChance: 0.30,
    pressIntensity: 0.20,
    attackModifier: 0.88,
    defenceModifier: 1.15,
  },
  'Wing Play': {
    name: 'Wing Play',
    passChance: 0.43,
    dribbleChance: 0.35,
    shootChance: 0.22,
    pressIntensity: 0.50,
    attackModifier: 1.03,
    defenceModifier: 0.98,
  },
};

export const EVENT_TYPES = {
  GOAL: 'goal',
  YELLOW: 'yellow',
  RED: 'red',
  FOUL: 'foul',
  CORNER: 'corner',
  OFFSIDE: 'offside',
  SAVE: 'save',
  SHOT: 'shot',
  SUBSTITUTION: 'substitution',
  INJURY: 'injury',
};
