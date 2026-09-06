// pages/fixture.js

import { useCallback, useState } from "react";
import Head from "next/head";

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../components/firebase";
import { useAuth } from "../context/AuthContext";

import styles from "./fixture.module.css";

/* =========================================================
   CONFIG
========================================================= */

const MAX_LEAGUES = 500;
const MAX_CLUBS = 5000;

const FIRESTORE_BATCH_SIZE = 450;

/*
 * Season:
 * July 2026 -> June 2027 = 2026/27
 */
const SEASON_START_MONTH = 6; // July

/*
 * Default kickoff.
 */
const DEFAULT_KICKOFF_HOUR = 15;
const DEFAULT_KICKOFF_MINUTE = 0;

/*
 * Match days:
 * League -> Saturday / Sunday
 * Cup -> Tuesday / Wednesday
 */
const LEAGUE_ALLOWED_DAYS = [6, 0];
const CUP_ALLOWED_DAYS = [2, 3];

/*
 * Cup group stage: 4 teams per group
 */
const GROUP_SIZE = 4;

/* =========================================================
   COUNTRY NORMALIZATION
========================================================= */

function normalizeCountry(value) {
  if (!value) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[áàäâã]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöôõ]/g, "o")
    .replace(/[úùüû]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "");
}

/* =========================================================
   DATE HELPERS
========================================================= */

function cloneDate(date) {
  return new Date(date.getTime());
}

function startOfDay(date) {
  const d = cloneDate(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = cloneDate(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function makeDate(
  year,
  month,
  day,
  hour = 0,
  minute = 0
) {
  return new Date(
    year,
    month,
    day,
    hour,
    minute,
    0,
    0
  );
}

function makeKickoff(date) {
  const d = cloneDate(date);
  d.setHours(
    DEFAULT_KICKOFF_HOUR,
    DEFAULT_KICKOFF_MINUTE,
    0,
    0
  );
  return d;
}

function isoDate(date) {
  if (!date) return "";
  const d = cloneDate(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function safeDate(value) {
  if (!value) return null;
  try {
    if (value?.toDate && typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "object" && typeof value.seconds === "number") {
      const date = new Date(value.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/* =========================================================
   SEASON
========================================================= */

function getSeasonYearFromDate(date) {
  const d = safeDate(date) || new Date();
  return d.getMonth() >= SEASON_START_MONTH
    ? d.getFullYear()
    : d.getFullYear() - 1;
}

function getSeasonName(seasonYear) {
  return `${seasonYear}/${String(
    seasonYear + 1
  ).slice(-2)}`;
}

/* =========================================================
   LEAGUE HELPERS
========================================================= */

function getLeagueName(league) {
  return (
    league?.name ||
    league?.leagueName ||
    league?.title ||
    "Unknown League"
  );
}

function getLeagueCountry(league) {
  return (
    league?.country ||
    league?.countryName ||
    league?.nation ||
    league?.countryCode ||
    "International"
  );
}

function getLeagueId(club) {
  return (
    club?.leagueId ||
    club?.league ||
    club?.competitionId ||
    null
  );
}

function getClubName(club) {
  return (
    club?.name ||
    club?.clubName ||
    club?.shortName ||
    "Unknown Club"
  );
}

function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.badge ||
    ""
  );
}

/* =========================================================
   GET LEAGUE CLUBS
========================================================= */

function getLeagueClubs(league, clubs) {
  if (!league || !Array.isArray(clubs)) {
    return [];
  }
  const configuredIds = league?.clubIds || league?.teamIds || league?.teams || [];
  if (Array.isArray(configuredIds) && configuredIds.length > 0) {
    const ids = configuredIds
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.id || item?.clubId || item?.teamId || null;
      })
      .filter(Boolean);
    const selected = clubs.filter((club) => ids.includes(club.id));
    if (selected.length >= 2) return selected;
  }
  return clubs.filter(
    (club) =>
      String(getLeagueId(club) || "") === String(league.id || "")
  );
}

/* =========================================================
   COUNTRY START RULES
========================================================= */

const COUNTRY_START_RULES = {
  rwanda: { month: 7, day: 15 },
  uganda: { month: 7, day: 15 },
  kenya: { month: 7, day: 15 },
  tanzania: { month: 7, day: 15 },
  burundi: { month: 7, day: 15 },
  england: { month: 7, day: 10 },
  unitedkingdom: { month: 7, day: 10 },
  uk: { month: 7, day: 10 },
  spain: { month: 8, day: 20 },
  italy: { month: 7, day: 20 },
  germany: { month: 7, day: 15 },
  france: { month: 7, day: 15 },
  portugal: { month: 7, day: 15 },
  netherlands: { month: 7, day: 15 },
  belgium: { month: 7, day: 15 },
  brazil: { month: 7, day: 15 },
  argentina: { month: 7, day: 15 },
  southafrica: { month: 7, day: 15 },
  egypt: { month: 7, day: 15 },
  nigeria: { month: 7, day: 15 },
  ghana: { month: 7, day: 15 },
  japan: { month: 7, day: 15 },
  southkorea: { month: 7, day: 15 },
  international: { month: 7, day: 15 },
};

function getCountryStartRule(country) {
  const normalized = normalizeCountry(country);
  return (
    COUNTRY_START_RULES[normalized] ||
    COUNTRY_START_RULES.international
  );
}

/* =========================================================
   EASTER
========================================================= */

function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/* =========================================================
   PUBLIC HOLIDAYS
========================================================= */

function getFixedHolidayDates(year, country) {
  const holidays = [];
  const normalized = normalizeCountry(country);
  holidays.push(
    makeDate(year, 0, 1),
    makeDate(year, 4, 1),
    makeDate(year, 11, 25),
    makeDate(year, 11, 26)
  );
  if (normalized === "rwanda") {
    holidays.push(
      makeDate(year, 1, 1),
      makeDate(year, 3, 7),
      makeDate(year, 4, 1),
      makeDate(year, 6, 1),
      makeDate(year, 6, 4),
      makeDate(year, 12, 31)
    );
  }
  if (normalized === "tanzania") {
    holidays.push(
      makeDate(year, 0, 12),
      makeDate(year, 3, 7),
      makeDate(year, 3, 26),
      makeDate(year, 7, 8),
      makeDate(year, 11, 9)
    );
  }
  if (normalized === "kenya") {
    holidays.push(
      makeDate(year, 5, 1),
      makeDate(year, 9, 10),
      makeDate(year, 9, 20),
      makeDate(year, 10, 12)
    );
  }
  if (normalized === "uganda") {
    holidays.push(
      makeDate(year, 0, 26),
      makeDate(year, 2, 8),
      makeDate(year, 5, 3),
      makeDate(year, 9, 9)
    );
  }
  if (normalized === "burundi") {
    holidays.push(
      makeDate(year, 0, 1),
      makeDate(year, 0, 5),
      makeDate(year, 4, 1),
      makeDate(year, 6, 1),
      makeDate(year, 10, 28)
    );
  }
  if (normalized === "france") {
    holidays.push(
      makeDate(year, 6, 14),
      makeDate(year, 7, 15),
      makeDate(year, 10, 11)
    );
  }
  if (normalized === "germany") {
    holidays.push(
      makeDate(year, 9, 3)
    );
  }
  if (normalized === "italy") {
    holidays.push(
      makeDate(year, 3, 25),
      makeDate(year, 5, 2),
      makeDate(year, 5, 24),
      makeDate(year, 7, 15),
      makeDate(year, 10, 1)
    );
  }
  if (normalized === "spain") {
    holidays.push(
      makeDate(year, 9, 12),
      makeDate(year, 11, 6)
    );
  }
  if (normalized === "brazil") {
    holidays.push(
      makeDate(year, 8, 7),
      makeDate(year, 9, 12),
      makeDate(year, 10, 15)
    );
  }
  if (normalized === "southafrica") {
    holidays.push(
      makeDate(year, 3, 27),
      makeDate(year, 5, 16),
      makeDate(year, 8, 24),
      makeDate(year, 11, 16)
    );
  }
  if (normalized === "nigeria") {
    holidays.push(
      makeDate(year, 4, 29),
      makeDate(year, 9, 1)
    );
  }
  return holidays;
}

/* =========================================================
   MOVABLE HOLIDAYS
========================================================= */

function getMovableHolidayDates(year, country) {
  const holidays = [];
  const easter = getEasterSunday(year);
  holidays.push(
    addDays(easter, -2),
    addDays(easter, 1)
  );
  const normalized = normalizeCountry(country);
  if (
    normalized === "rwanda" ||
    normalized === "uganda" ||
    normalized === "kenya" ||
    normalized === "tanzania"
  ) {
    holidays.push(addDays(easter, 39));
  }
  return holidays;
}

/* =========================================================
   FIRESTORE HOLIDAYS
========================================================= */

async function getFirestoreHolidays(year, country) {
  const normalized = normalizeCountry(country);
  const dates = new Set();
  try {
    const holidayQuery = query(
      collection(db, "holidays"),
      where("year", "==", year)
    );
    const snapshot = await getDocs(holidayQuery);
    snapshot.forEach((item) => {
      const data = item.data();
      const holidayCountry = normalizeCountry(
        data?.country || data?.countryName || ""
      );
      const appliesToAll =
        holidayCountry === "" ||
        holidayCountry === "all" ||
        holidayCountry === "international";
      const appliesToCountry = holidayCountry === normalized;
      if (!appliesToAll && !appliesToCountry) return;
      const date = safeDate(data?.date);
      if (date) {
        dates.add(isoDate(date));
      }
    });
  } catch (error) {
    console.warn("[FIXTURE GENERATOR] Could not load holidays:", error);
  }
  return dates;
}

/* =========================================================
   HOLIDAY SET
========================================================= */

async function buildHolidaySet(year, country) {
  const dates = new Set();
  const fixed = getFixedHolidayDates(year, country);
  const movable = getMovableHolidayDates(year, country);
  [...fixed, ...movable].forEach((date) => {
    dates.add(isoDate(date));
  });
  const firestoreHolidays = await getFirestoreHolidays(year, country);
  firestoreHolidays.forEach((date) => {
    dates.add(date);
  });
  return dates;
}

/* =========================================================
   MATCH DAY FINDER
========================================================= */

function isHoliday(date, holidaySet) {
  return holidaySet.has(isoDate(date));
}

function findNextMatchDay(
  startDate,
  holidaySet,
  allowedDays
) {
  let date = startOfDay(startDate);
  const days = Array.isArray(allowedDays) ? allowedDays : [allowedDays];
  if (days.includes(date.getDay()) && !isHoliday(date, holidaySet)) {
    return makeKickoff(date);
  }
  for (let attempt = 0; attempt < 365; attempt += 1) {
    date = addDays(date, 1);
    if (days.includes(date.getDay()) && !isHoliday(date, holidaySet)) {
      return makeKickoff(date);
    }
  }
  return makeKickoff(startDate);
}

/* =========================================================
   COUNTRY DEFAULT START
========================================================= */

function getPreferredLeagueStart(league, seasonYear) {
  const customDate = safeDate(league?.startDate);
  if (customDate) {
    if (customDate.getFullYear() === seasonYear) {
      return customDate;
    }
  }
  const country = getLeagueCountry(league);
  const rule = getCountryStartRule(country);
  return makeDate(
    seasonYear,
    rule.month,
    rule.day,
    DEFAULT_KICKOFF_HOUR,
    DEFAULT_KICKOFF_MINUTE
  );
}

/* =========================================================
   SINGLE ROUND-ROBIN (for groups)
========================================================= */

function buildSingleRoundRobin(clubs) {
  if (!Array.isArray(clubs) || clubs.length < 2) return [];
  const teams = [...clubs];
  if (teams.length % 2 !== 0) {
    teams.push(null); // bye
  }
  const totalTeams = teams.length;
  const rounds = [];
  let rotation = [...teams];
  const numRounds = totalTeams - 1;
  for (let roundIndex = 0; roundIndex < numRounds; roundIndex += 1) {
    const matches = [];
    for (let i = 0; i < totalTeams / 2; i += 1) {
      const teamA = rotation[i];
      const teamB = rotation[totalTeams - 1 - i];
      if (teamA && teamB) {
        // Home/away balance
        if (roundIndex % 2 === 0) {
          matches.push({ home: teamA, away: teamB });
        } else {
          matches.push({ home: teamB, away: teamA });
        }
      }
    }
    rounds.push(matches);
    // Circle rotation (fixed first)
    const fixed = rotation[0];
    const rotating = rotation.slice(1);
    const last = rotating.pop();
    rotating.unshift(last);
    rotation = [fixed, ...rotating];
  }
  return rounds;
}

/* =========================================================
   FIXTURE ID
========================================================= */

function cleanIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function makeFixtureId({
  seasonYear,
  leagueId,
  round,
  homeClubId,
  awayClubId,
  stage = "league",
}) {
  return [
    "fixture",
    seasonYear,
    cleanIdPart(leagueId),
    stage,
    round,
    cleanIdPart(homeClubId),
    cleanIdPart(awayClubId),
  ].join("_");
}

/* =========================================================
   CREATE LEAGUE FIXTURE
========================================================= */

function createLeagueFixture({
  league,
  home,
  away,
  seasonYear,
  round,
  date,
}) {
  const id = makeFixtureId({
    seasonYear,
    leagueId: league.id,
    round,
    homeClubId: home.id,
    awayClubId: away.id,
    stage: "league",
  });
  return {
    id,
    type: "league",
    generated: true,
    generatedBy: "automatic-fixture-generator",
    seasonYear,
    season: getSeasonName(seasonYear),
    leagueId: league.id,
    leagueName: getLeagueName(league),
    country: getLeagueCountry(league),
    round,
    stage: "league",
    roundName: `Round ${round}`,
    homeClubId: home.id,
    homeClubName: getClubName(home),
    homeLogo: getClubLogo(home),
    awayClubId: away.id,
    awayClubName: getClubName(away),
    awayLogo: getClubLogo(away),
    stadium: home?.stadium || home?.stadiumName || "Club Stadium",
    date: date.toISOString(),
    status: "scheduled",
    result: null,
    homeScore: null,
    awayScore: null,
    homeOverall:
      Number(home?.overall) || Number(home?.rating) || Number(home?.teamOverall) || 60,
    awayOverall:
      Number(away?.overall) || Number(away?.rating) || Number(away?.teamOverall) || 60,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/* =========================================================
   CREATE CUP FIXTURE (group stage or knockout)
========================================================= */

function createCupFixture({
  league,
  seasonYear,
  round,
  stage, // "group" or "knockout"
  roundName,
  bracketPosition,
  date,
  home,
  away,
  homeSourceFixtureId = null,
  awaySourceFixtureId = null,
  homeGroup = null,
  awayGroup = null,
  homePosition = null, // "winner" or "runner-up"
  awayPosition = null,
}) {
  const isGroup = stage === "group";
  const id = isGroup
    ? makeFixtureId({
        seasonYear,
        leagueId: league.id,
        round,
        homeClubId: home?.id || "TBD",
        awayClubId: away?.id || "TBD",
        stage: "cup_group",
      })
    : [
        "fixture",
        seasonYear,
        cleanIdPart(league.id),
        "cup_knockout",
        roundName.replace(/\s+/g, "_"),
        bracketPosition,
      ].join("_");

  return {
    id,
    type: "cup",
    generated: true,
    generatedBy: "automatic-cup-fixture-generator",
    seasonYear,
    season: getSeasonName(seasonYear),
    leagueId: league.id,
    leagueName: getLeagueName(league),
    country: getLeagueCountry(league),
    round,
    stage,
    roundName,
    bracketPosition: bracketPosition || null,
    homeClubId: home?.id || null,
    homeClubName: home ? getClubName(home) : (homeGroup ? `Winner of Group ${homeGroup}` : "TBD"),
    homeLogo: home ? getClubLogo(home) : "",
    awayClubId: away?.id || null,
    awayClubName: away ? getClubName(away) : (awayGroup ? `Runner-up of Group ${awayGroup}` : "TBD"),
    awayLogo: away ? getClubLogo(away) : "",
    homeSourceFixtureId,
    awaySourceFixtureId,
    homeGroup,
    awayGroup,
    homePosition,
    awayPosition,
    homeSlot: home ? "club" : homeSourceFixtureId ? "winner" : "tbd",
    awaySlot: away ? "club" : awaySourceFixtureId ? "winner" : "tbd",
    stadium: home?.stadium || home?.stadiumName || "Club Stadium",
    date: date.toISOString(),
    status: home && away ? "scheduled" : "pending",
    result: null,
    homeScore: null,
    awayScore: null,
    homeOverall:
      Number(home?.overall) || Number(home?.rating) || Number(home?.teamOverall) || null,
    awayOverall:
      Number(away?.overall) || Number(away?.rating) || Number(away?.teamOverall) || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/* =========================================================
   GENERATE LEAGUE FIXTURES
========================================================= */

async function generateLeagueFixtures({
  league,
  clubs,
  seasonYear,
}) {
  const leagueClubs = getLeagueClubs(league, clubs);
  if (leagueClubs.length < 2) return [];

  const country = getLeagueCountry(league);
  const allowedDays = LEAGUE_ALLOWED_DAYS;
  const holidaySets = new Map();

  async function getHolidays(year) {
    if (holidaySets.has(year)) return holidaySets.get(year);
    const set = await buildHolidaySet(year, country);
    holidaySets.set(year, set);
    return set;
  }

  const rounds = buildRounds(leagueClubs);
  if (!rounds.length) return [];

  let startDate = getPreferredLeagueStart(league, seasonYear);
  let holidaySet = await getHolidays(startDate.getFullYear());
  let currentMatchDay = findNextMatchDay(
    startDate,
    holidaySet,
    allowedDays
  );

  const fixtures = [];

  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    const round = roundIndex + 1;
    const currentYear = currentMatchDay.getFullYear();
    holidaySet = await getHolidays(currentYear);
    currentMatchDay = findNextMatchDay(
      currentMatchDay,
      holidaySet,
      allowedDays
    );

    rounds[roundIndex].forEach(({ home, away }) => {
      fixtures.push(
        createLeagueFixture({
          league,
          home,
          away,
          seasonYear,
          round,
          date: currentMatchDay,
        })
      );
    });

    const nextWeekCandidate = addWeeks(currentMatchDay, 1);
    const nextYear = nextWeekCandidate.getFullYear();
    const nextHolidaySet = await getHolidays(nextYear);
    currentMatchDay = findNextMatchDay(
      nextWeekCandidate,
      nextHolidaySet,
      allowedDays
    );
  }

  return fixtures;
}

/* =========================================================
   GENERATE CUP FIXTURES (with group stage)
========================================================= */

async function generateCupFixtures({
  league,
  clubs,
  seasonYear,
}) {
  const cupClubs = getLeagueClubs(league, clubs);
  if (cupClubs.length < 4) return [];

  const country = getLeagueCountry(league);
  const holidaySets = new Map();

  async function getHolidays(year) {
    if (holidaySets.has(year)) return holidaySets.get(year);
    const set = await buildHolidaySet(year, country);
    holidaySets.set(year, set);
    return set;
  }

  // Determine number of groups (4 teams per group)
  const numGroups = Math.floor(cupClubs.length / GROUP_SIZE);
  if (numGroups < 1) return [];

  // Distribute teams into groups
  const shuffled = [...cupClubs].sort(() => Math.random() - 0.5);
  const groups = [];
  for (let g = 0; g < numGroups; g++) {
    groups.push(shuffled.slice(g * GROUP_SIZE, g * GROUP_SIZE + GROUP_SIZE));
  }
  // Add remaining teams to last groups if any (but we already floor, so we may have leftover; we can add to first groups)
  const leftover = cupClubs.length - numGroups * GROUP_SIZE;
  for (let i = 0; i < leftover; i++) {
    groups[i % numGroups].push(shuffled[numGroups * GROUP_SIZE + i]);
  }

  const groupLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const groupNames = groupLabels.slice(0, numGroups);

  // Start date
  let startDate = getPreferredLeagueStart(league, seasonYear);
  let holidaySet = await getHolidays(startDate.getFullYear());
  let currentMatchDay = findNextMatchDay(
    startDate,
    holidaySet,
    CUP_ALLOWED_DAYS
  );

  const fixtures = [];

  // ----- GROUP STAGE -----
  const groupMatches = []; // store all group fixtures for later reference
  const groupFixturesByGroup = {};

  // For each group, generate single round-robin
  for (let g = 0; g < numGroups; g++) {
    const groupLabel = groupNames[g];
    const groupTeams = groups[g];
    if (groupTeams.length < 2) continue;

    const rounds = buildSingleRoundRobin(groupTeams);
    const groupFixtures = [];

    for (let r = 0; r < rounds.length; r++) {
      // Each round we need to schedule matches on cup days
      const currentYear = currentMatchDay.getFullYear();
      holidaySet = await getHolidays(currentYear);
      currentMatchDay = findNextMatchDay(
        currentMatchDay,
        holidaySet,
        CUP_ALLOWED_DAYS
      );

      const roundMatches = rounds[r];
      for (const match of roundMatches) {
        const fixture = createCupFixture({
          league,
          seasonYear,
          round: r + 1,
          stage: "group",
          roundName: `Group ${groupLabel} - Round ${r+1}`,
          bracketPosition: null,
          date: currentMatchDay,
          home: match.home,
          away: match.away,
          homeGroup: groupLabel,
          awayGroup: groupLabel,
        });
        fixtures.push(fixture);
        groupFixtures.push(fixture);
        groupMatches.push(fixture);
      }
      // Move to next week for next round
      const nextWeekCandidate = addWeeks(currentMatchDay, 1);
      const nextYear = nextWeekCandidate.getFullYear();
      const nextHolidaySet = await getHolidays(nextYear);
      currentMatchDay = findNextMatchDay(
        nextWeekCandidate,
        nextHolidaySet,
        CUP_ALLOWED_DAYS
      );
    }
    groupFixturesByGroup[groupLabel] = groupFixtures;
  }

  // ----- KNOCKOUT STAGE -----
  // Number of advancing teams = 2 * numGroups
  const advancingTeams = 2 * numGroups;
  if (advancingTeams < 2) return fixtures;

  // We need to generate a knockout bracket with 'advancingTeams' teams.
  // We'll create slots: for each group, winner (position 1) and runner-up (position 2).
  // Pairings: typically A1 vs B2, B1 vs A2, C1 vs D2, D1 vs C2, etc.
  // We'll generate all knockout rounds.

  // Create list of advancing slots
  const slots = [];
  for (let g = 0; g < numGroups; g++) {
    const label = groupNames[g];
    slots.push({
      group: label,
      position: "winner",
      groupLabel: label,
    });
    slots.push({
      group: label,
      position: "runner-up",
      groupLabel: label,
    });
  }

  // Pair them according to standard format:
  // We'll reorder to have winners vs runners-up from different groups
  // Simple method: pair winners with runners-up from the next group
  const pairedSlots = [];
  for (let i = 0; i < numGroups; i++) {
    const winner = slots[i * 2];
    const runner = slots[(i * 2 + 1) % slots.length];
    pairedSlots.push({ home: winner, away: runner });
  }
  // Now we have an array of pairs for the first knockout round.
  // The number of pairs = numGroups, which should equal advancingTeams/2.

  // Schedule knockout rounds
  let knockoutRound = 1;
  let currentKnockoutMatches = pairedSlots.map((pair, idx) => ({
    homeSlot: pair.home,
    awaySlot: pair.away,
    bracketPosition: idx + 1,
  }));

  // We'll generate rounds until only one match remains (final)
  while (currentKnockoutMatches.length > 0) {
    const roundMatches = currentKnockoutMatches;
    const roundLabel = getKnockoutRoundLabel(roundMatches.length);

    // Schedule this round on cup days
    const currentYear = currentMatchDay.getFullYear();
    holidaySet = await getHolidays(currentYear);
    currentMatchDay = findNextMatchDay(
      currentMatchDay,
      holidaySet,
      CUP_ALLOWED_DAYS
    );

    // Create fixtures for this round
    const roundFixtures = [];
    for (const match of roundMatches) {
      const homeSlot = match.homeSlot;
      const awaySlot = match.awaySlot;
      const fixture = createCupFixture({
        league,
        seasonYear,
        round: knockoutRound,
        stage: "knockout",
        roundName: roundLabel,
        bracketPosition: match.bracketPosition,
        date: currentMatchDay,
        home: null, // no direct club
        away: null,
        homeGroup: homeSlot.group,
        awayGroup: awaySlot.group,
        homePosition: homeSlot.position,
        awayPosition: awaySlot.position,
        // We can also link to specific group fixtures if needed, but we'll store the group/position
      });
      fixtures.push(fixture);
      roundFixtures.push(fixture);
    }

    // Prepare next round: winners of these matches will advance
    // We'll create a new list of matches for the next round, pairing consecutive matches
    const nextRoundMatches = [];
    for (let i = 0; i < roundFixtures.length; i += 2) {
      if (i + 1 < roundFixtures.length) {
        nextRoundMatches.push({
          homeSlot: { fixtureId: roundFixtures[i].id, slot: "winner" },
          awaySlot: { fixtureId: roundFixtures[i + 1].id, slot: "winner" },
          bracketPosition: Math.floor(i / 2) + 1,
        });
      }
    }

    // If this round is the final (only one match), we don't need next round
    if (roundFixtures.length === 1) {
      // This is the final
      break;
    }

    // Move to next round
    currentKnockoutMatches = nextRoundMatches;
    knockoutRound += 1;

    // Advance date by one week for next knockout round
    const nextWeekCandidate = addWeeks(currentMatchDay, 1);
    const nextYear2 = nextWeekCandidate.getFullYear();
    const nextHolidaySet2 = await getHolidays(nextYear2);
    currentMatchDay = findNextMatchDay(
      nextWeekCandidate,
      nextHolidaySet2,
      CUP_ALLOWED_DAYS
    );
  }

  // After final, we need to generate third place match if we had at least 4 teams?
  // Actually, third place is between losers of semi-finals. We can add it as a separate fixture.
  // But we don't have a straightforward way to link losers. We can create a placeholder fixture for third place.
  // We'll generate it after the semi-finals, but we need to know the semi-final fixtures.
  // Since we generated knockout rounds sequentially, we can identify the semi-final round (when number of matches = 2).
  // However, we don't store the rounds separately. We can add third place fixture after the final.
  // For simplicity, we can always add third place if the tournament had at least 4 teams in knockout.
  if (advancingTeams >= 4) {
    // Add third place match
    const thirdPlaceDate = addWeeks(currentMatchDay, 1);
    const thirdPlaceFixture = createCupFixture({
      league,
      seasonYear,
      round: knockoutRound + 1,
      stage: "knockout",
      roundName: "Third Place",
      bracketPosition: 1,
      date: thirdPlaceDate,
      home: null,
      away: null,
      homeGroup: null,
      awayGroup: null,
      homePosition: "loser_semi1",
      awayPosition: "loser_semi2",
    });
    fixtures.push(thirdPlaceFixture);
  }

  return fixtures;
}

/* =========================================================
   HELPER: get knockout round label
========================================================= */

function getKnockoutRoundLabel(numMatches) {
  if (numMatches >= 16) return "1/32";
  if (numMatches >= 8) return "1/16";
  if (numMatches >= 4) return "1/8";
  if (numMatches >= 2) return "1/4";
  if (numMatches === 1) return "Final";
  return "Unknown";
}

/* =========================================================
   ROUND ROBIN (for league)
========================================================= */

function buildRounds(clubs) {
  if (!Array.isArray(clubs) || clubs.length < 2) return [];
  const teams = [...clubs];
  if (teams.length % 2 !== 0) {
    teams.push(null);
  }
  const totalTeams = teams.length;
  const roundsPerLeg = totalTeams - 1;
  const firstLeg = [];
  let rotation = [...teams];
  for (let roundIndex = 0; roundIndex < roundsPerLeg; roundIndex += 1) {
    const matches = [];
    for (let i = 0; i < totalTeams / 2; i += 1) {
      const teamA = rotation[i];
      const teamB = rotation[totalTeams - 1 - i];
      if (teamA && teamB) {
        if (roundIndex % 2 === 0) {
          matches.push({ home: teamA, away: teamB });
        } else {
          matches.push({ home: teamB, away: teamA });
        }
      }
    }
    firstLeg.push(matches);
    const fixed = rotation[0];
    const rotating = rotation.slice(1);
    const last = rotating.pop();
    rotating.unshift(last);
    rotation = [fixed, ...rotating];
  }
  const secondLeg = firstLeg.map((round) =>
    round.map((match) => ({
      home: match.away,
      away: match.home,
    }))
  );
  return [...firstLeg, ...secondLeg];
}

/* =========================================================
   DELETE EXISTING FIXTURES FOR LEAGUE & SEASON
========================================================= */

async function deleteFixturesForLeagueAndSeason(leagueId, seasonYear) {
  const matchesQuery = query(
    collection(db, "matches"),
    where("leagueId", "==", leagueId),
    where("seasonYear", "==", seasonYear)
  );
  const snapshot = await getDocs(matchesQuery);
  if (snapshot.empty) return 0;
  const batch = writeBatch(db);
  snapshot.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

/* =========================================================
   GENERATE SEASON FIXTURES (updated)
========================================================= */

async function generateSeasonFixtures({
  leagueIds,
  leagues,
  clubs,
}) {
  if (!Array.isArray(leagueIds) || leagueIds.length === 0 || !Array.isArray(leagues) || !Array.isArray(clubs)) {
    return {
      generated: 0,
      existing: 0,
      deleted: 0,
      leaguesProcessed: 0,
      cupFixtures: 0,
      leagueFixtures: 0,
    };
  }

  let totalGenerated = 0;
  let totalDeleted = 0;
  let leaguesProcessed = 0;
  let cupFixtures = 0;
  let leagueFixtures = 0;

  for (const leagueId of leagueIds) {
    const league = leagues.find((l) => l.id === leagueId);
    if (!league) continue;

    const leagueClubs = getLeagueClubs(league, clubs);
    if (leagueClubs.length < 2) continue;

    // Determine season year from league's startDate
    const startDate = safeDate(league?.startDate);
    if (!startDate) continue;
    const seasonYear = getSeasonYearFromDate(startDate);

    // Delete existing fixtures for this league and season
    const deleted = await deleteFixturesForLeagueAndSeason(leagueId, seasonYear);
    totalDeleted += deleted;

    leaguesProcessed += 1;

    let generatedFixtures = [];
    if (league.type === "cup") {
      generatedFixtures = await generateCupFixtures({
        league,
        clubs: leagueClubs,
        seasonYear,
      });
      cupFixtures += generatedFixtures.length;
    } else {
      generatedFixtures = await generateLeagueFixtures({
        league,
        clubs: leagueClubs,
        seasonYear,
      });
      leagueFixtures += generatedFixtures.length;
    }

    // Save fixtures
    if (generatedFixtures.length > 0) {
      const saved = await saveFixtures(generatedFixtures);
      totalGenerated += saved;
    }
  }

  return {
    generated: totalGenerated,
    deleted: totalDeleted,
    leaguesProcessed,
    cupFixtures,
    leagueFixtures,
  };
}

/* =========================================================
   CHUNK ARRAY
========================================================= */

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/* =========================================================
   SAVE FIXTURES
========================================================= */

async function saveFixtures(fixtures) {
  if (!fixtures.length) return 0;
  const chunks = chunkArray(fixtures, FIRESTORE_BATCH_SIZE);
  let saved = 0;
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((fixture) => {
      const fixtureRef = doc(db, "matches", fixture.id);
      batch.set(fixtureRef, fixture, { merge: true });
      saved += 1;
    });
    await batch.commit();
  }
  return saved;
}

/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialLeagues = [],
  initialClubs = [],
}) {
  const { user, loading } = useAuth();

  const [status, setStatus] = useState("waiting");
  const [message, setMessage] = useState(
    "Select leagues and click Generate."
  );
  const [result, setResult] = useState(null);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  /* =======================================================
     GENERATE
  ======================================================= */

  const handleGenerate = useCallback(async () => {
    if (!user || isGenerating || selectedLeagueIds.length === 0) return;

    try {
      setIsGenerating(true);
      setStatus("generating");
      setMessage("Generating fixtures...");

      const generationResult = await generateSeasonFixtures({
        leagueIds: selectedLeagueIds,
        leagues: initialLeagues,
        clubs: initialClubs,
      });

      setResult(generationResult);
      setStatus("complete");

      if (generationResult.generated > 0) {
        setMessage(
          `${generationResult.generated} fixtures generated successfully.`
        );
      } else {
        setMessage(
          `No new fixtures created. ${generationResult.deleted} existing fixtures deleted.`
        );
      }
    } catch (error) {
      console.error("[FIXTURE GENERATOR ERROR]", error);
      setStatus("error");
      setMessage(error?.message || "Automatic fixture generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    user,
    isGenerating,
    selectedLeagueIds,
    initialLeagues,
    initialClubs,
  ]);

  /* =======================================================
     TOGGLE
  ======================================================= */

  const toggleLeagueSelection = (leagueId) => {
    setSelectedLeagueIds((prev) => {
      if (prev.includes(leagueId)) {
        return prev.filter((id) => id !== leagueId);
      }
      return [...prev, leagueId];
    });
  };

  const selectAll = () => {
    setSelectedLeagueIds(initialLeagues.map((league) => league.id));
  };

  const clearAll = () => {
    setSelectedLeagueIds([]);
  };

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading fixture generator...</p>
      </div>
    );
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (!user) {
    return (
      <>
        <Head>
          <title>Fixture Generator</title>
          <meta name="description" content="Automatic football fixture generator" />
        </Head>
        <main className={styles.emptyPage}>
          <h1>Login Required</h1>
          <p>Login is required for automatic fixture generation.</p>
        </main>
      </>
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>Automatic Fixture Generator</title>
        <meta name="description" content="Automatic football league and cup fixture generator" />
      </Head>

      <main className={styles.page}>
        <section className={styles.nextMatchCard}>
          <div className={styles.nextMatchTop}>
            <div>
              <span>FIXTURE ENGINE</span>
              <h1>Automatic Fixtures</h1>
            </div>
          </div>

          {/* =================================================
              CONTROLS
          ================================================= */}

          <div className={styles.controls}>
            <div className={styles.controlRow}>
              <button
                className={styles.selectButton}
                onClick={selectAll}
                disabled={isGenerating}
              >
                Select All
              </button>
              <button
                className={styles.selectButton}
                onClick={clearAll}
                disabled={isGenerating}
              >
                Clear All
              </button>
              <button
                className={styles.generateButton}
                onClick={handleGenerate}
                disabled={isGenerating || selectedLeagueIds.length === 0}
              >
                {isGenerating ? "Generating..." : "Generate Fixtures"}
              </button>
            </div>

            {/* =================================================
                LEAGUE LIST
            ================================================= */}

            <div className={styles.leagueList}>
              {initialLeagues.length === 0 && (
                <p>No leagues found. Please create leagues first.</p>
              )}

              {initialLeagues.map((league) => {
                const clubCount = getLeagueClubs(league, initialClubs).length;
                const isCup = league.type === "cup";

                return (
                  <label key={league.id} className={styles.leagueCheckbox}>
                    <input
                      type="checkbox"
                      checked={selectedLeagueIds.includes(league.id)}
                      onChange={() => toggleLeagueSelection(league.id)}
                      disabled={isGenerating}
                    />
                    <span>
                      {league.name}{" "}
                      <small>({isCup ? "cup" : league.type || "league"})</small>{" "}
                      <em>({clubCount} clubs)</em>
                      {isCup && (
                        <small style={{ display: "block", marginTop: "4px" }}>
                          Group stage → Knockout (1/32 → Final)
                        </small>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* =================================================
              STATUS
          ================================================= */}

          <div className={styles.noNextMatch}>
            {status === "generating" && (
              <>
                <div className={styles.spinner} />
                <p>{message}</p>
              </>
            )}

            {status === "complete" && (
              <>
                <div style={{ fontSize: "42px", marginBottom: "10px" }}>✓</div>
                <h2>{message}</h2>
                {result && (
                  <p>
                    New fixtures: <strong>{result.generated}</strong>
                    <br />
                    Deleted (old) fixtures: <strong>{result.deleted}</strong>
                    <br />
                    Competitions processed: <strong>{result.leaguesProcessed}</strong>
                    <br />
                    League fixtures: <strong>{result.leagueFixtures}</strong>
                    <br />
                    Cup fixtures: <strong>{result.cupFixtures}</strong>
                    {result.cupFixtures > 0 && (
                      <>
                        <br />
                        Cup format: Group stage (4 teams per group) + Knockout
                      </>
                    )}
                  </p>
                )}
                <p>Fixtures are stored automatically in Firestore.</p>
              </>
            )}

            {status === "error" && (
              <>
                <div style={{ fontSize: "42px", marginBottom: "10px" }}>!</div>
                <h2>Generation Error</h2>
                <p>{message}</p>
              </>
            )}

            {status === "waiting" && <p>{message}</p>}
          </div>
        </section>
      </main>
    </>
  );
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [leaguesSnapshot, clubsSnapshot] = await Promise.all([
      getDocs(collection(db, "leagues")),
      getDocs(collection(db, "clubs")),
    ]);

    const leagues = leaguesSnapshot.docs
      .slice(0, MAX_LEAGUES)
      .map((item) => ({ id: item.id, ...item.data() }));

    const clubs = clubsSnapshot.docs
      .slice(0, MAX_CLUBS)
      .map((item) => ({ id: item.id, ...item.data() }));

    return {
      props: {
        initialLeagues: JSON.parse(JSON.stringify(leagues)),
        initialClubs: JSON.parse(JSON.stringify(clubs)),
      },
    };
  } catch (error) {
    console.error("[FIXTURE SSR ERROR]", error);
    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
      },
    };
  }
}
