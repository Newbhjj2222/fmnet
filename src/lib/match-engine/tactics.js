// lib/match-engine/tactics.js

import {
  clamp,
} from "./constants";

export function mentalityModifier(
  mentality
) {
  if (mentality === "attacking") {
    return {
      attack: 1.25,
      defense: 0.85,
      risk: 1.25,
    };
  }

  if (mentality === "defensive") {
    return {
      attack: 0.78,
      defense: 1.25,
      risk: 0.65,
    };
  }

  return {
    attack: 1,
    defense: 1,
    risk: 1,
  };
}

export function pressingDistance(
  pressing
) {
  if (pressing === "high") {
    return 155;
  }

  if (pressing === "low") {
    return 65;
  }

  return 105;
}

export function defensiveDepth(
  line
) {
  if (line === "high") {
    return 0.09;
  }

  if (line === "low") {
    return -0.07;
  }

  return 0;
}

export function widthModifier(
  width
) {
  if (width === "wide") {
    return 1.22;
  }

  if (width === "narrow") {
    return 0.78;
  }

  return 1;
}

export function tempoModifier(
  tempo
) {
  if (tempo === "fast") {
    return 1.2;
  }

  if (tempo === "slow") {
    return 0.8;
  }

  return 1;
}

export function passRisk(
  tactics
) {
  let risk = 0.5;

  if (
    tactics.passingStyle ===
    "short"
  ) {
    risk -= 0.12;
  }

  if (
    tactics.passingStyle ===
    "direct"
  ) {
    risk += 0.16;
  }

  if (
    tactics.tempo === "fast"
  ) {
    risk += 0.08;
  }

  if (
    tactics.mentality ===
    "attacking"
  ) {
    risk += 0.08;
  }

  return clamp(
    risk,
    0.15,
    0.9
  );
}
