import { PITCH } from "./constants";

const formations = {
  "4-3-3": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.18, y: 0.18 },
    { role: "CB", x: 0.18, y: 0.39 },
    { role: "CB", x: 0.18, y: 0.61 },
    { role: "RB", x: 0.18, y: 0.82 },

    { role: "CM", x: 0.38, y: 0.30 },
    { role: "CM", x: 0.38, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.70 },

    { role: "LW", x: 0.63, y: 0.20 },
    { role: "ST", x: 0.70, y: 0.50 },
    { role: "RW", x: 0.63, y: 0.80 },
  ],

  "4-4-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.18, y: 0.18 },
    { role: "CB", x: 0.18, y: 0.39 },
    { role: "CB", x: 0.18, y: 0.61 },
    { role: "RB", x: 0.18, y: 0.82 },

    { role: "LM", x: 0.39, y: 0.20 },
    { role: "CM", x: 0.39, y: 0.40 },
    { role: "CM", x: 0.39, y: 0.60 },
    { role: "RM", x: 0.39, y: 0.80 },

    { role: "ST", x: 0.66, y: 0.40 },
    { role: "ST", x: 0.66, y: 0.60 },
  ],

  "3-5-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "CB", x: 0.18, y: 0.28 },
    { role: "CB", x: 0.18, y: 0.50 },
    { role: "CB", x: 0.18, y: 0.72 },

    { role: "LM", x: 0.37, y: 0.12 },
    { role: "CM", x: 0.38, y: 0.35 },
    { role: "CM", x: 0.38, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.65 },
    { role: "RM", x: 0.37, y: 0.88 },

    { role: "ST", x: 0.68, y: 0.40 },
    { role: "ST", x: 0.68, y: 0.60 },
  ],

  "5-3-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LWB", x: 0.17, y: 0.10 },
    { role: "CB", x: 0.18, y: 0.30 },
    { role: "CB", x: 0.18, y: 0.50 },
    { role: "CB", x: 0.18, y: 0.70 },
    { role: "RWB", x: 0.17, y: 0.90 },

    { role: "CM", x: 0.40, y: 0.32 },
    { role: "CM", x: 0.40, y: 0.50 },
    { role: "CM", x: 0.40, y: 0.68 },

    { role: "ST", x: 0.68, y: 0.40 },
    { role: "ST", x: 0.68, y: 0.60 },
  ],

  "4-2-3-1": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.18, y: 0.18 },
    { role: "CB", x: 0.18, y: 0.39 },
    { role: "CB", x: 0.18, y: 0.61 },
    { role: "RB", x: 0.18, y: 0.82 },

    { role: "DM", x: 0.34, y: 0.40 },
    { role: "DM", x: 0.34, y: 0.60 },

    { role: "LW", x: 0.50, y: 0.20 },
    { role: "AM", x: 0.52, y: 0.50 },
    { role: "RW", x: 0.50, y: 0.80 },

    { role: "ST", x: 0.68, y: 0.50 },
  ],
};

export function getFormation(name = "4-3-3") {
  return formations[name] || formations["4-3-3"];
}

export function getFormationPosition(
  formation,
  index,
  side
) {
  const positions = getFormation(formation);

  const item = positions[index];

  if (!item) {
    return {
      x: side === "home"
        ? PITCH.width * 0.25
        : PITCH.width * 0.75,

      y: PITCH.height * 0.5,
    };
  }

  let x = item.x * PITCH.width;
  let y = item.y * PITCH.height;

  if (side === "away") {
    x = PITCH.width - x;
  }

  return {
    x,
    y,
    role: item.role,
  };
}
