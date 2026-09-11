// lib/match-engine/formations.js

export const FORMATIONS = {
  "4-4-2": [
    { role: "GK", position: "GK", x: 0.05, y: 0.50 },

    { role: "LB", position: "LB", x: 0.20, y: 0.16 },
    { role: "CB", position: "CB", x: 0.16, y: 0.38 },
    { role: "CB", position: "CB", x: 0.16, y: 0.62 },
    { role: "RB", position: "RB", x: 0.20, y: 0.84 },

    { role: "LM", position: "LM", x: 0.43, y: 0.18 },
    { role: "CM", position: "CM", x: 0.38, y: 0.40 },
    { role: "CM", position: "CM", x: 0.38, y: 0.60 },
    { role: "RM", position: "RM", x: 0.43, y: 0.82 },

    { role: "ST", position: "ST", x: 0.68, y: 0.38 },
    { role: "ST", position: "ST", x: 0.68, y: 0.62 },
  ],

  "4-3-3": [
    { role: "GK", position: "GK", x: 0.05, y: 0.50 },

    { role: "LB", position: "LB", x: 0.20, y: 0.16 },
    { role: "CB", position: "CB", x: 0.16, y: 0.38 },
    { role: "CB", position: "CB", x: 0.16, y: 0.62 },
    { role: "RB", position: "RB", x: 0.20, y: 0.84 },

    { role: "CM", position: "CM", x: 0.38, y: 0.25 },
    { role: "CDM", position: "CDM", x: 0.34, y: 0.50 },
    { role: "CM", position: "CM", x: 0.38, y: 0.75 },

    { role: "LW", position: "LW", x: 0.65, y: 0.18 },
    { role: "ST", position: "ST", x: 0.72, y: 0.50 },
    { role: "RW", position: "RW", x: 0.65, y: 0.82 },
  ],

  "3-5-2": [
    { role: "GK", position: "GK", x: 0.05, y: 0.50 },

    { role: "CB", position: "CB", x: 0.16, y: 0.25 },
    { role: "CB", position: "CB", x: 0.14, y: 0.50 },
    { role: "CB", position: "CB", x: 0.16, y: 0.75 },

    { role: "LM", position: "LM", x: 0.38, y: 0.12 },
    { role: "CM", position: "CM", x: 0.36, y: 0.32 },
    { role: "CDM", position: "CDM", x: 0.34, y: 0.50 },
    { role: "CM", position: "CM", x: 0.36, y: 0.68 },
    { role: "RM", position: "RM", x: 0.38, y: 0.88 },

    { role: "ST", position: "ST", x: 0.70, y: 0.40 },
    { role: "ST", position: "ST", x: 0.70, y: 0.60 },
  ],

  "5-3-2": [
    { role: "GK", position: "GK", x: 0.05, y: 0.50 },

    { role: "LB", position: "LWB", x: 0.18, y: 0.10 },
    { role: "CB", position: "CB", x: 0.15, y: 0.30 },
    { role: "CB", position: "CB", x: 0.13, y: 0.50 },
    { role: "CB", position: "CB", x: 0.15, y: 0.70 },
    { role: "RB", position: "RWB", x: 0.18, y: 0.90 },

    { role: "CM", position: "CM", x: 0.39, y: 0.28 },
    { role: "CDM", position: "CDM", x: 0.35, y: 0.50 },
    { role: "CM", position: "CM", x: 0.39, y: 0.72 },

    { role: "ST", position: "ST", x: 0.70, y: 0.40 },
    { role: "ST", position: "ST", x: 0.70, y: 0.60 },
  ],

  "4-2-3-1": [
    { role: "GK", position: "GK", x: 0.05, y: 0.50 },

    { role: "LB", position: "LB", x: 0.20, y: 0.16 },
    { role: "CB", position: "CB", x: 0.16, y: 0.38 },
    { role: "CB", position: "CB", x: 0.16, y: 0.62 },
    { role: "RB", position: "RB", x: 0.20, y: 0.84 },

    { role: "CDM", position: "CDM", x: 0.34, y: 0.40 },
    { role: "CDM", position: "CDM", x: 0.34, y: 0.60 },

    { role: "LW", position: "LW", x: 0.53, y: 0.16 },
    { role: "CAM", position: "CAM", x: 0.53, y: 0.50 },
    { role: "RW", position: "RW", x: 0.53, y: 0.84 },

    { role: "ST", position: "ST", x: 0.72, y: 0.50 },
  ],
};

export const getFormation = (formation) =>
  FORMATIONS[formation] || FORMATIONS["4-4-2"];

export function mirrorFormationSlots(slots) {
  return slots.map((slot) => ({
    ...slot,
    x: 1 - slot.x,
  }));
}
