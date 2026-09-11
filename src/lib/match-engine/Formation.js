import { FORMATIONS } from "./constants";

const positions = {
  "4-4-2": {
    GK: [0.06, 0.50],

    LB: [0.19, 0.18],
    CB1: [0.16, 0.40],
    CB2: [0.16, 0.60],
    RB: [0.19, 0.82],

    LM: [0.39, 0.16],
    CM1: [0.37, 0.40],
    CM2: [0.37, 0.60],
    RM: [0.39, 0.84],

    ST1: [0.57, 0.43],
    ST2: [0.57, 0.57],
  },

  "4-3-3": {
    GK: [0.06, 0.50],

    LB: [0.19, 0.18],
    CB1: [0.16, 0.40],
    CB2: [0.16, 0.60],
    RB: [0.19, 0.82],

    CM1: [0.35, 0.30],
    CM2: [0.38, 0.50],
    CM3: [0.35, 0.70],

    LW: [0.57, 0.17],
    ST: [0.60, 0.50],
    RW: [0.57, 0.83],
  },

  "3-5-2": {
    GK: [0.06, 0.50],

    CB1: [0.16, 0.28],
    CB2: [0.14, 0.50],
    CB3: [0.16, 0.72],

    LWB: [0.32, 0.12],
    CM1: [0.34, 0.38],
    CDM: [0.31, 0.50],
    CM2: [0.34, 0.62],
    RWB: [0.32, 0.88],

    ST1: [0.58, 0.43],
    ST2: [0.58, 0.57],
  },

  "5-3-2": {
    GK: [0.06, 0.50],

    LWB: [0.18, 0.12],
    CB1: [0.15, 0.33],
    CB2: [0.14, 0.50],
    CB3: [0.15, 0.67],
    RWB: [0.18, 0.88],

    CM1: [0.34, 0.34],
    CM2: [0.32, 0.50],
    CM3: [0.34, 0.66],

    ST1: [0.57, 0.43],
    ST2: [0.57, 0.57],
  },

  "4-2-3-1": {
    GK: [0.06, 0.50],

    LB: [0.19, 0.18],
    CB1: [0.16, 0.40],
    CB2: [0.16, 0.60],
    RB: [0.19, 0.82],

    CDM1: [0.31, 0.40],
    CDM2: [0.31, 0.60],

    LW: [0.43, 0.18],
    CAM: [0.46, 0.50],
    RW: [0.43, 0.82],

    ST: [0.60, 0.50],
  },
};

function roleKey(role, used) {
  const count = used[role] || 0;
  used[role] = count + 1;

  if (role === "CB" && count === 0) return "CB1";
  if (role === "CB" && count === 1) return "CB2";
  if (role === "CB" && count === 2) return "CB3";

  if (role === "CM" && count === 0) return "CM1";
  if (role === "CM" && count === 1) return "CM2";
  if (role === "CM" && count === 2) return "CM3";

  if (role === "ST" && count === 0) return "ST1";
  if (role === "ST" && count === 1) return "ST2";

  if (role === "CDM" && count === 0) return "CDM1";
  if (role === "CDM" && count === 1) return "CDM2";

  return role;
}

export function getFormationPositions(
  formation = "4-4-2",
  team = "home"
) {
  const formationData = positions[formation] || positions["4-4-2"];

  const roles = FORMATIONS[formation] || FORMATIONS["4-4-2"];

  const used = {};

  return roles.map((role) => {
    const key = roleKey(role, used);

    const source =
      formationData[key] ||
      formationData[role] ||
      [0.3, 0.5];

    let x = source[0] * 1050;
    let y = source[1] * 680;

    if (team === "away") {
      x = 1050 - x;
    }

    return {
      role,
      x,
      y,
    };
  });
}

export function getRoleGroup(position = "") {
  const p = String(position).toUpperCase();

  if (p.includes("GK") || p.includes("KEEPER")) {
    return "GK";
  }

  if (
    ["LB", "RB", "CB", "LWB", "RWB", "DF", "DC"].includes(p)
  ) {
    return "DEF";
  }

  if (
    [
      "CDM",
      "DM",
      "CM",
      "CAM",
      "AM",
      "LM",
      "RM",
      "MF",
    ].includes(p)
  ) {
    return "MID";
  }

  return "ATT";
}

export function normalizePosition(position) {
  const p = String(position || "").toUpperCase();

  if (
    p.includes("GK") ||
    p.includes("KEEPER") ||
    p === "G"
  ) {
    return "GK";
  }

  if (["LB", "LWB"].includes(p)) return p;
  if (["RB", "RWB"].includes(p)) return p;

  if (
    ["CB", "DC", "DF", "DEF"].includes(p)
  ) {
    return "CB";
  }

  if (["CDM", "DM"].includes(p)) return "CDM";

  if (["CAM", "AM"].includes(p)) return "CAM";

  if (["LM"].includes(p)) return "LM";
  if (["RM"].includes(p)) return "RM";

  if (["LW", "LF"].includes(p)) return "LW";
  if (["RW", "RF"].includes(p)) return "RW";

  if (["ST", "CF", "FW"].includes(p)) return "ST";

  return "CM";
}
