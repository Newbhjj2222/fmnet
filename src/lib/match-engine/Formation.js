import { PITCH } from "./constants";

const FORMATIONS = {
  "4-4-2": [
    ["GK", 0.07, 0.50],

    ["DEF", 0.23, 0.18],
    ["DEF", 0.23, 0.40],
    ["DEF", 0.23, 0.60],
    ["DEF", 0.23, 0.82],

    ["MID", 0.46, 0.16],
    ["MID", 0.46, 0.39],
    ["MID", 0.46, 0.61],
    ["MID", 0.46, 0.84],

    ["FWD", 0.70, 0.38],
    ["FWD", 0.70, 0.62],
  ],

  "4-3-3": [
    ["GK", 0.07, 0.50],

    ["DEF", 0.23, 0.18],
    ["DEF", 0.23, 0.40],
    ["DEF", 0.23, 0.60],
    ["DEF", 0.23, 0.82],

    ["MID", 0.47, 0.25],
    ["MID", 0.48, 0.50],
    ["MID", 0.47, 0.75],

    ["FWD", 0.70, 0.18],
    ["FWD", 0.75, 0.50],
    ["FWD", 0.70, 0.82],
  ],

  "3-5-2": [
    ["GK", 0.07, 0.50],

    ["DEF", 0.23, 0.25],
    ["DEF", 0.22, 0.50],
    ["DEF", 0.23, 0.75],

    ["MID", 0.43, 0.12],
    ["MID", 0.45, 0.34],
    ["MID", 0.47, 0.50],
    ["MID", 0.45, 0.66],
    ["MID", 0.43, 0.88],

    ["FWD", 0.70, 0.38],
    ["FWD", 0.70, 0.62],
  ],

  "5-3-2": [
    ["GK", 0.07, 0.50],

    ["DEF", 0.21, 0.10],
    ["DEF", 0.22, 0.30],
    ["DEF", 0.22, 0.50],
    ["DEF", 0.22, 0.70],
    ["DEF", 0.21, 0.90],

    ["MID", 0.47, 0.28],
    ["MID", 0.48, 0.50],
    ["MID", 0.47, 0.72],

    ["FWD", 0.70, 0.40],
    ["FWD", 0.70, 0.60],
  ],

  "4-2-3-1": [
    ["GK", 0.07, 0.50],

    ["DEF", 0.23, 0.18],
    ["DEF", 0.23, 0.40],
    ["DEF", 0.23, 0.60],
    ["DEF", 0.23, 0.82],

    ["MID", 0.43, 0.37],
    ["MID", 0.43, 0.63],

    ["MID", 0.57, 0.18],
    ["MID", 0.59, 0.50],
    ["MID", 0.57, 0.82],

    ["FWD", 0.74, 0.50],
  ],
};

export const normalizeFormation = (
  formation
) => {
  const value =
    String(formation || "")
      .trim();

  return FORMATIONS[value]
    ? value
    : "4-4-2";
};

export const getFormationPosition = (
  formation,
  index,
  side = "home"
) => {
  const formationData =
    FORMATIONS[
      normalizeFormation(formation)
    ];

  const point =
    formationData[index] ||
    formationData[
      formationData.length - 1
    ];

  let x =
    point[1] * PITCH.width;

  const y =
    point[2] * PITCH.height;

  if (side === "away") {
    x =
      PITCH.width - x;
  }

  return {
    role: point[0],
    x,
    y,
  };
};

export const getFormationRequirements = (
  formation
) => {
  return FORMATIONS[
    normalizeFormation(formation)
  ].map(
    ([role]) => role
  );
};

export const getAvailableFormations = () => {
  return Object.keys(FORMATIONS);
};
