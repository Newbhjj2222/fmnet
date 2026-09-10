import {
  FORMATIONS,
  PITCH,
} from "./constants";

export function normalizeFormation(
  formation
) {
  if (
    FORMATIONS[formation]
  ) {
    return formation;
  }

  return "4-4-2";
}

export function getFormation(
  formation
) {
  return (
    FORMATIONS[
      normalizeFormation(
        formation
      )
    ]
  );
}

export function getFormationPosition(
  formation,
  index,
  side
) {
  const points =
    getFormation(
      formation
    );

  const point =
    points[index] ||
    points[0];

  let x =
    point[1] *
    PITCH.width;

  let y =
    point[2] *
    PITCH.height;

  if (side === "away") {
    x =
      PITCH.width -
      x;
  }

  return {
    role: point[0],
    x,
    y,
  };
}
