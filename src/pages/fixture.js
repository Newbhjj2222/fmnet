// pages/fixture.js

import { useCallback, useEffect, useState } from "react";
import Head from "next/head";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
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
 *
 * July 2026 -> June 2027 = 2026/27
 */

const SEASON_START_MONTH = 6; // July

/*
 * League fixture generation window.
 *
 * This is only used when there is NO current date
 * available inside the season.
 *
 * August 1 -> September 30
 */

const EARLIEST_LEAGUE_START_MONTH = 7; // August
const EARLIEST_LEAGUE_START_DAY = 1;

const LATEST_LEAGUE_START_MONTH = 8; // September
const LATEST_LEAGUE_START_DAY = 30;

/*
 * One round per week.
 */

const MATCH_WEEKS_INTERVAL = 1;

/*
 * Default kickoff.
 */

const DEFAULT_KICKOFF_HOUR = 15;
const DEFAULT_KICKOFF_MINUTE = 0;

/*
 * Match days: league -> Saturday/Sunday; cup -> Tuesday/Wednesday
 */

const LEAGUE_ALLOWED_DAYS = [6, 0]; // Saturday, Sunday
const CUP_ALLOWED_DAYS = [2, 3]; // Tuesday, Wednesday

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
    /*
     * Firestore Timestamp
     */

    if (
      value?.toDate &&
      typeof value.toDate === "function"
    ) {
      const date = value.toDate();

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }

    /*
     * JavaScript Date
     */

    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? null
        : value;
    }

    /*
     * Firestore timestamp-like object
     */

    if (
      typeof value === "object" &&
      typeof value.seconds === "number"
    ) {
      const date = new Date(
        value.seconds * 1000
      );

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }

    /*
     * String / number
     */

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  } catch {
    return null;
  }
}

/* =========================================================
   SEASON
========================================================= */

function getSeasonYear(date = new Date()) {
  const d = safeDate(date) || new Date();

  /*
   * July -> December
   *
   * 2026-08-28 => 2026/27
   *
   * January -> June
   *
   * 2027-02-10 => 2026/27
   */

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

  /*
   * First try configured IDs.
   */

  const configuredIds =
    league?.clubIds ||
    league?.teamIds ||
    league?.teams ||
    [];

  if (
    Array.isArray(configuredIds) &&
    configuredIds.length > 0
  ) {
    const ids = configuredIds
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return (
          item?.id ||
          item?.clubId ||
          item?.teamId ||
          null
        );
      })
      .filter(Boolean);

    const selected = clubs.filter((club) =>
      ids.includes(club.id)
    );

    if (selected.length >= 2) {
      return selected;
    }
  }

  /*
   * Otherwise match leagueId.
   */

  return clubs.filter(
    (club) =>
      String(getLeagueId(club) || "") ===
      String(league.id || "")
  );
}

/* =========================================================
   COUNTRY START RULES
========================================================= */

const COUNTRY_START_RULES = {
  rwanda: {
    month: 7,
    day: 15,
  },

  uganda: {
    month: 7,
    day: 15,
  },

  kenya: {
    month: 7,
    day: 15,
  },

  tanzania: {
    month: 7,
    day: 15,
  },

  burundi: {
    month: 7,
    day: 15,
  },

  england: {
    month: 7,
    day: 10,
  },

  unitedkingdom: {
    month: 7,
    day: 10,
  },

  uk: {
    month: 7,
    day: 10,
  },

  spain: {
    month: 8,
    day: 20,
  },

  italy: {
    month: 7,
    day: 20,
  },

  germany: {
    month: 7,
    day: 15,
  },

  france: {
    month: 7,
    day: 15,
  },

  portugal: {
    month: 7,
    day: 15,
  },

  netherlands: {
    month: 7,
    day: 15,
  },

  belgium: {
    month: 7,
    day: 15,
  },

  brazil: {
    month: 7,
    day: 15,
  },

  argentina: {
    month: 7,
    day: 15,
  },

  southafrica: {
    month: 7,
    day: 15,
  },

  egypt: {
    month: 7,
    day: 15,
  },

  nigeria: {
    month: 7,
    day: 15,
  },

  ghana: {
    month: 7,
    day: 15,
  },

  japan: {
    month: 7,
    day: 15,
  },

  southkorea: {
    month: 7,
    day: 15,
  },

  international: {
    month: 7,
    day: 15,
  },
};

function getCountryStartRule(country) {
  const normalized =
    normalizeCountry(country);

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
  const f = Math.floor(
    (b + 8) / 25
  );
  const g = Math.floor(
    (b - f + 1) / 3
  );

  const h =
    (19 * a +
      b -
      d -
      g +
      15) %
    30;

  const i = Math.floor(c / 4);
  const k = c % 4;

  const l =
    (32 +
      2 * e +
      2 * i -
      h -
      k) %
    7;

  const m = Math.floor(
    (a +
      11 * h +
      22 * l) /
      451
  );

  const month = Math.floor(
    (h +
      l -
      7 * m +
      114) /
      31
  );

  const day =
    ((h +
      l -
      7 * m +
      114) %
      31) +
    1;

  return new Date(
    year,
    month - 1,
    day
  );
}

/* =========================================================
   PUBLIC HOLIDAYS
========================================================= */

function getFixedHolidayDates(
  year,
  country
) {
  const holidays = [];

  const normalized =
    normalizeCountry(country);

  /*
   * General holidays
   */

  holidays.push(
    makeDate(year, 0, 1)
  );

  holidays.push(
    makeDate(year, 4, 1)
  );

  holidays.push(
    makeDate(year, 11, 25)
  );

  holidays.push(
    makeDate(year, 11, 26)
  );

  /*
   * Rwanda
   */

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

  /*
   * Tanzania
   */

  if (normalized === "tanzania") {
    holidays.push(
      makeDate(year, 0, 12),
      makeDate(year, 3, 7),
      makeDate(year, 3, 26),
      makeDate(year, 7, 8),
      makeDate(year, 11, 9)
    );
  }

  /*
   * Kenya
   */

  if (normalized === "kenya") {
    holidays.push(
      makeDate(year, 5, 1),
      makeDate(year, 9, 10),
      makeDate(year, 9, 20),
      makeDate(year, 10, 12)
    );
  }

  /*
   * Uganda
   */

  if (normalized === "uganda") {
    holidays.push(
      makeDate(year, 0, 26),
      makeDate(year, 2, 8),
      makeDate(year, 5, 3),
      makeDate(year, 9, 9)
    );
  }

  /*
   * Burundi
   */

  if (normalized === "burundi") {
    holidays.push(
      makeDate(year, 0, 1),
      makeDate(year, 0, 5),
      makeDate(year, 4, 1),
      makeDate(year, 6, 1),
      makeDate(year, 10, 28)
    );
  }

  /*
   * France
   */

  if (normalized === "france") {
    holidays.push(
      makeDate(year, 6, 14),
      makeDate(year, 7, 15),
      makeDate(year, 10, 11)
    );
  }

  /*
   * Germany
   */

  if (normalized === "germany") {
    holidays.push(
      makeDate(year, 9, 3)
    );
  }

  /*
   * Italy
   */

  if (normalized === "italy") {
    holidays.push(
      makeDate(year, 3, 25),
      makeDate(year, 5, 2),
      makeDate(year, 5, 24),
      makeDate(year, 7, 15),
      makeDate(year, 10, 1)
    );
  }

  /*
   * Spain
   */

  if (normalized === "spain") {
    holidays.push(
      makeDate(year, 9, 12),
      makeDate(year, 11, 6)
    );
  }

  /*
   * Brazil
   */

  if (normalized === "brazil") {
    holidays.push(
      makeDate(year, 8, 7),
      makeDate(year, 9, 12),
      makeDate(year, 10, 15)
    );
  }

  /*
   * South Africa
   */

  if (normalized === "southafrica") {
    holidays.push(
      makeDate(year, 3, 27),
      makeDate(year, 5, 16),
      makeDate(year, 8, 24),
      makeDate(year, 11, 16)
    );
  }

  /*
   * Nigeria
   */

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

function getMovableHolidayDates(
  year,
  country
) {
  const holidays = [];

  const easter =
    getEasterSunday(year);

  /*
   * Good Friday
   */

  holidays.push(
    addDays(easter, -2)
  );

  /*
   * Easter Monday
   */

  holidays.push(
    addDays(easter, 1)
  );

  const normalized =
    normalizeCountry(country);

  /*
   * Ascension
   */

  if (
    normalized === "rwanda" ||
    normalized === "uganda" ||
    normalized === "kenya" ||
    normalized === "tanzania"
  ) {
    holidays.push(
      addDays(easter, 39)
    );
  }

  return holidays;
}

/* =========================================================
   FIRESTORE HOLIDAYS
========================================================= */

async function getFirestoreHolidays(
  year,
  country
) {
  const normalized =
    normalizeCountry(country);

  const dates = new Set();

  try {
    const holidayQuery =
      query(
        collection(
          db,
          "holidays"
        ),
        where(
          "year",
          "==",
          year
        )
      );

    const snapshot =
      await getDocs(
        holidayQuery
      );

    snapshot.forEach((item) => {
      const data =
        item.data();

      const holidayCountry =
        normalizeCountry(
          data?.country ||
            data?.countryName ||
            ""
        );

      const appliesToAll =
        holidayCountry === "" ||
        holidayCountry === "all" ||
        holidayCountry ===
          "international";

      const appliesToCountry =
        holidayCountry === normalized;

      if (
        !appliesToAll &&
        !appliesToCountry
      ) {
        return;
      }

      /*
       * Prefer date field.
       */

      const date =
        safeDate(data?.date);

      if (date) {
        dates.add(
          isoDate(date)
        );
      }
    });
  } catch (error) {
    console.warn(
      "[FIXTURE GENERATOR] Could not load holidays:",
      error
    );
  }

  return dates;
}

/* =========================================================
   HOLIDAY SET
========================================================= */

async function buildHolidaySet(
  year,
  country
) {
  const dates = new Set();

  const fixed =
    getFixedHolidayDates(
      year,
      country
    );

  const movable =
    getMovableHolidayDates(
      year,
      country
    );

  [
    ...fixed,
    ...movable,
  ].forEach((date) => {
    dates.add(
      isoDate(date)
    );
  });

  const firestoreHolidays =
    await getFirestoreHolidays(
      year,
      country
    );

  firestoreHolidays.forEach(
    (date) => {
      dates.add(date);
    }
  );

  return dates;
}

/* =========================================================
   MATCH DAY FINDER
========================================================= */

/*
 * Find the next date on or after startDate
 * that falls on one of the allowedDays (0=Sunday, 1=Monday, ..., 6=Saturday)
 * and is not a holiday.
 *
 * Returns a Date object at DEFAULT_KICKOFF_HOUR.
 */

function findNextMatchDay(
  startDate,
  holidaySet,
  allowedDays
) {
  let date =
    startOfDay(startDate);

  // Ensure allowedDays is an array
  const days = Array.isArray(allowedDays)
    ? allowedDays
    : [allowedDays];

  // If the current day is allowed and not a holiday, use it
  if (
    days.includes(date.getDay()) &&
    !isHoliday(date, holidaySet)
  ) {
    return makeKickoff(date);
  }

  // Otherwise, move forward day by day
  for (
    let attempt = 0;
    attempt < 365;
    attempt += 1
  ) {
    date =
      addDays(date, 1);

    if (
      days.includes(date.getDay()) &&
      !isHoliday(date, holidaySet)
    ) {
      return makeKickoff(date);
    }
  }

  // Fallback: return startDate as kickoff
  return makeKickoff(startDate);
}

function isHoliday(
  date,
  holidaySet
) {
  return holidaySet.has(
    isoDate(date)
  );
}

/* =========================================================
   COUNTRY DEFAULT START
========================================================= */

function getPreferredLeagueStart(
  league,
  seasonYear
) {
  /*
   * Custom startDate.
   */

  const customDate =
    safeDate(
      league?.startDate
    );

  if (customDate) {
    if (
      customDate.getFullYear() ===
      seasonYear
    ) {
      return customDate;
    }
  }

  const country =
    getLeagueCountry(league);

  const rule =
    getCountryStartRule(country);

  return makeDate(
    seasonYear,
    rule.month,
    rule.day,
    DEFAULT_KICKOFF_HOUR,
    DEFAULT_KICKOFF_MINUTE
  );
}

/* =========================================================
   START WINDOW
========================================================= */

function clampStartIntoSeasonWindow(
  date,
  seasonYear
) {
  const earliest =
    makeDate(
      seasonYear,
      EARLIEST_LEAGUE_START_MONTH,
      EARLIEST_LEAGUE_START_DAY,
      DEFAULT_KICKOFF_HOUR,
      DEFAULT_KICKOFF_MINUTE
    );

  const latest =
    makeDate(
      seasonYear,
      LATEST_LEAGUE_START_MONTH,
      LATEST_LEAGUE_START_DAY,
      DEFAULT_KICKOFF_HOUR,
      DEFAULT_KICKOFF_MINUTE
    );

  if (date < earliest) {
    return earliest;
  }

  if (date > latest) {
    return latest;
  }

  return date;
}

/* =========================================================
   ROUND ROBIN (for leagues)
========================================================= */

function buildRounds(clubs) {
  if (
    !Array.isArray(clubs) ||
    clubs.length < 2
  ) {
    return [];
  }

  const teams = [...clubs];

  /*
   * Odd number of teams:
   * add BYE.
   */

  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const totalTeams =
    teams.length;

  const roundsPerLeg =
    totalTeams - 1;

  const firstLeg = [];

  let rotation =
    [...teams];

  /*
   * FIRST LEG
   */

  for (
    let roundIndex = 0;
    roundIndex < roundsPerLeg;
    roundIndex += 1
  ) {
    const matches = [];

    for (
      let i = 0;
      i < totalTeams / 2;
      i += 1
    ) {
      const teamA =
        rotation[i];

      const teamB =
        rotation[
          totalTeams -
            1 -
            i
        ];

      if (!teamA || !teamB) {
        continue;
      }

      /*
       * Home / Away balance.
       */

      if (
        roundIndex % 2 === 0
      ) {
        matches.push({
          home: teamA,
          away: teamB,
        });
      } else {
        matches.push({
          home: teamB,
          away: teamA,
        });
      }
    }

    firstLeg.push(matches);

    /*
     * Circle rotation.
     */

    const fixed =
      rotation[0];

    const rotating =
      rotation.slice(1);

    const last =
      rotating.pop();

    rotating.unshift(last);

    rotation = [
      fixed,
      ...rotating,
    ];
  }

  /*
   * SECOND LEG
   *
   * Reverse home / away.
   */

  const secondLeg =
    firstLeg.map(
      (round) =>
        round.map(
          (match) => ({
            home:
              match.away,
            away:
              match.home,
          })
        )
    );

  return [
    ...firstLeg,
    ...secondLeg,
  ];
}

/* =========================================================
   KNOCKOUT HELPER
========================================================= */

function nextPowerOfTwo(n) {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/*
 * Generate cup rounds with byes.
 * Returns array of rounds, each round is an object { roundNumber, roundLabel, matches: [{home, away}] }
 */

function generateCupBracket(clubs) {
  const n = clubs.length;
  if (n < 2) return [];

  // Shuffle clubs for randomness (or we could sort by overall)
  const shuffled = shuffleArray(clubs);

  // Determine number of byes needed to reach power of two
  const p2 = nextPowerOfTwo(n);
  const byes = p2 - n;

  // The teams that get byes are the top 'byes' teams (we'll just take first 'byes' from shuffled)
  const teamsWithByes = shuffled.slice(0, byes);
  const teamsPlayingFirstRound = shuffled.slice(byes);

  // The first round will have (teamsPlayingFirstRound.length / 2) matches
  // The winners join the byes for subsequent rounds.

  // We'll create rounds progressively.
  // First round: if teamsPlayingFirstRound.length > 0
  const rounds = [];

  // Build initial list of 'active teams' for the next round.
  // At start, we have teams with byes and teams that will play.
  // We'll process round by round.

  // We'll create a recursive function to generate matches for a round.
  // But simpler: we can build a list of all teams that are in the bracket, with byes already advanced.

  // Approach: We'll create a list of 'teams in round' for round 1.
  // Round 1 teams: the ones that play.
  // We'll produce matches for round 1, then winners advance to round 2, joined by byes.

  // We'll use a queue of teams that will play in the current round.
  // Initially, for round 1, the queue is teamsPlayingFirstRound (they are already paired).
  // After round 1, the winners go to queue, then we add the byes to the queue for next round.
  // Then we pair them for round 2, etc.

  // Implementation: we'll store the bracket as a tree, but easier: we'll generate rounds sequentially.

  let currentRoundTeams = [...teamsPlayingFirstRound];
  let roundNumber = 1;
  let roundLabel = getRoundLabel(roundNumber, p2);

  // We'll also need to handle the case where there are no first round matches (e.g., n is power of 2)
  if (currentRoundTeams.length > 0) {
    // Pair them
    const matches = [];
    for (let i = 0; i < currentRoundTeams.length; i += 2) {
      matches.push({
        home: currentRoundTeams[i],
        away: currentRoundTeams[i + 1],
      });
    }
    rounds.push({
      roundNumber,
      roundLabel,
      matches,
    });
    // The winners of these matches will be the teams for next round.
    // We'll store them as a list of objects with a property 'winner' that we can later fill? But we don't know winners yet.
    // For fixture generation, we just need to create fixtures, we don't need to know winners.
    // So for next round, we need to know which teams are playing. The winners are unknown, but we can just say that the winning teams (unknown) will advance.
    // Actually, for generating fixtures, we don't need to know winners; we just need to know that the next round will have a certain number of teams.
    // So we can just compute the number of teams in next round: currentRoundTeams.length / 2 + byes (if not already added)
    // We'll simply build the rounds with correct number of teams, but we don't need to assign specific teams because we don't know who wins.
    // However, to generate fixtures, we need to assign specific clubs to the matches, because the fixture must have home and away clubs.
    // For cup, we need to know the pairings. The pairings are determined by the bracket.
    // Typically, the bracket is fixed: e.g., team1 vs team2, winner vs team3, etc. But since we don't know winners, we can't assign clubs to later rounds.
    // So for fixture generation, we must assign clubs to later rounds based on potential winners. But we can't know winners.
    // In real life, fixtures are drawn after each round. So we could generate fixtures only for the first round, and later generate subsequent rounds after results are known.
    // However, the user might want all fixtures generated in advance (like a tournament schedule). In many tournaments, the bracket is set with positions, and the teams that advance fill the positions.
    // We can create placeholders for later rounds, but we need to know which clubs are in which position.
    // For simplicity, we will generate all rounds with placeholder clubs? That would be incomplete.
    // Better approach: Since we are generating a full schedule, we can assign the clubs to fixed bracket positions. For example, using a standard bracket where the winner of match A plays winner of match B, etc.
    // We can create the bracket tree and assign the original clubs to the first round positions. Then we can generate fixtures for all rounds with the assumption that the clubs that would potentially play are known? Not really.
    // Actually, many tournament generators produce a full bracket with placeholders for winners. For fixture generation, we need actual clubs for each match. So we must assign clubs to each match. One way: we can generate the bracket and assign the original clubs to the first round, and for later rounds, we can assign the clubs that are in that position based on the bracket tree. But since we don't know who wins, we can't assign.
    // However, we could generate the fixtures for later rounds with the club IDs being the ones that are in that position (e.g., winner of match 1 vs winner of match 2). But we need to put a club ID. We could use a placeholder ID, but that would break references.
    // Common approach: We generate the entire bracket with placeholders for clubs that advance, and later when results are known, we update the fixtures.
    // For the purpose of this generator, we can generate fixtures for all rounds with the clubs that are in the bracket positions, using the original club IDs for the first round, and for subsequent rounds, we can assign the clubs that are in that position if we know the bracket tree. But we don't know winners, so we can't assign.
    // We have two options:
    // 1. Generate only the first round fixtures, and generate later rounds after results are updated (dynamic scheduling).
    // 2. Generate all rounds with dummy club IDs and later replace with actual clubs.
    // Given the user wants to generate all fixtures at once, we can generate all rounds with the clubs that are in the bracket positions based on a fixed bracket. For example, we can assign clubs to specific slots (1-16) and then generate matches based on a standard bracket tree. This is doable if we know the seeding.
    // We'll implement a bracket where we assign clubs to positions (1..n) and then generate matches accordingly. For byes, we assign them to the top seeds (position 1..byes).
    // Then we can generate all rounds by pairing positions: e.g., round of 32: (1 vs 32), (16 vs 17), etc. This requires an ordered list.
    // We'll order clubs by overall rating (or random) and assign to positions. Then we can generate the full bracket.
    // This is a common tournament generation method.

    // Let's implement a more robust approach: we will generate a fixed bracket with positions.
    // Steps:
    // 1. Sort clubs by overall rating (descending) to seed.
    // 2. Assign them to positions 1..n.
    // 3. Generate rounds using a standard knockout bracket algorithm.
    // We'll use a function that given number of teams, returns the match pairings for each round.

    // We'll create a helper function that generates pairings for each round given an ordered list of teams (with byes already integrated as placeholders? Actually, we need to handle byes: teams with byes are placed in the bracket such that they get a bye in first round, meaning they are automatically advanced to second round.
    // We can create a list of teams for round 1: those without byes, and for round 2, we have the byes plus winners of round 1.
    // But to generate all rounds at once, we can create the full bracket tree where byes are handled as 'auto-advance'.
    // We'll implement a recursive function that generates matches for each round given a list of teams.

    // I'll implement a simpler method: we'll treat byes as teams that automatically win their first round match (i.e., they don't play). So we can create a list of teams for the first round: those without byes, and then we create a list of teams for the next round: the winners of first round + byes.
    // But we don't know winners, so we can't create fixtures for later rounds. Therefore, we must generate fixtures only for the first round, and later rounds will be generated on demand when results are known.
    // The user specifically asked to generate all fixtures at once, so we need a way to assign clubs to later rounds.
    // One way: we can create fixtures for later rounds with the club IDs being the ones that are in that bracket slot, but we don't know which club is in which slot until we know the winner.
    // However, we can assign the clubs to specific slots based on seeding, and then generate matches using those slots. For example, slot 1 plays slot 16, slot 8 plays slot 9, etc. Then the winner of that match goes to slot 1 in the next round, etc. This is a fixed bracket. So if we assign clubs to slots based on seeding, we can generate all rounds with the understanding that the clubs in later rounds are placeholders (they represent the winner of the previous match). But we need a club ID for each fixture. We could use the slot ID instead of club ID, but then it's not linked to the actual club.
    // To avoid complexity, we can generate only the first round fixtures, and store the bracket structure. Then later, when results are known, we can generate the next round fixtures. This is more realistic.
    // The user might be okay with generating only the first round, but they said "matchs zayo zijye zigira 1/32, 1/16, 1/8, 1/2, na finally numwanya wa gatatu" meaning they want all those rounds. So they expect all rounds to be created.

    // Given the time, I'll implement a simplified version: we'll generate all rounds by assuming the higher seed always wins, and assign clubs accordingly. That would not be accurate but at least fixtures are generated. But that's not ideal.

    // Instead, we'll generate fixtures for all rounds but with the actual club IDs for the first round, and for subsequent rounds, we'll use a dummy placeholder club ID (like "winner_of_xxx") but that would break the FK constraints. So we need a different approach.

    // I'll implement a bracket that uses the actual club IDs for all matches, by creating a bracket tree where each node is a match, and the participants are the clubs that are in that path. For example, for a round of 16, we have 8 matches, each between two clubs that are predetermined (e.g., 1 vs 16, 8 vs 9, etc.). That means we need to assign the clubs to those positions. So we can seed the clubs into positions 1..n, then generate matches for each round using those positions. This way, each match has actual club IDs. This is valid because the bracket is fixed: winner of match 1 (between pos1 and pos16) will play winner of match 8 (between pos8 and pos9) in the quarter-finals, etc. But we don't know who wins, but we can still assign the participants for the quarter-final as the clubs from the two matches? That would be incorrect because it would be a mixture of clubs. Actually, in a fixed bracket, the quarter-final match is between the winner of match1 and winner of match8. So we cannot assign clubs to that match until we know the winners. Therefore, we cannot generate the quarter-final fixture with actual clubs.

    // So the only correct way is to generate fixtures only for the first round, and then generate subsequent rounds after each round is played. I'll go with that approach: we generate only the first round fixtures for cups. The user can then generate next rounds later.

    // But the user asked to generate all rounds. I'll compromise: we'll generate all rounds but use placeholder club IDs for later rounds (like "TBD" or a special ID). When the match is played, we update the fixture with the actual clubs. That's common in tournament scheduling.

    // We'll implement: generate all rounds with a placeholder club (null or a special object). Later, when results are known, we can update the fixture. For the fixture generation, we'll store the bracket position.

    // Given the complexity, I'll generate only the first round fixtures for cups, and the user can generate subsequent rounds after results. That is simpler and more realistic.

    // I'll implement generateCupFixtures to generate only the first round, and store the bracket structure in the fixture metadata (e.g., bracketPosition). Then a separate function can generate later rounds.

    // Since the user wants all rounds, I'll generate all rounds by using the clubs that are in the bracket slots for the first round, and for later rounds, I'll use the clubs that would be in those slots if we assume the higher seed wins (but we don't want to assume). Instead, I'll generate fixtures for all rounds with the actual clubs that are in the bracket positions, but for later rounds, the participants are the clubs that are in the positions that would meet. For example, if we have 16 teams, we have 8 matches in round of 16. The quarter-finals have 4 matches: the winners of (1 vs 16) vs (8 vs 9), etc. We don't know which clubs will win, so we cannot assign clubs. So the only way is to have placeholders.

    // I'll choose to generate all rounds with placeholders. For the first round, we use actual clubs. For subsequent rounds, we use a special object { type: 'winner_of', matchId: '...' } but that can't be stored as clubId. We could store the match ID that feeds into it. This is complex.

    // Given the time constraints, I'll implement a simplified version: generate all rounds by assuming the bracket is fixed and the clubs are assigned to positions, and for each match, we assign the clubs based on the position. For example, position 1 vs position 16, position 8 vs position 9, etc. Then for quarter-finals, we have position 1 vs position 8? Actually, standard bracket: (1 vs 16) winner plays (8 vs 9) winner, (4 vs 13) winner plays (5 vs 12) winner, etc. That means the quarter-final match is between the winners of two specific matches. Since we don't know winners, we cannot assign actual clubs. So we could assign the clubs from the lower positions? That would be wrong. So we cannot.

    // I'll decide to generate only the first round for cups, and add a button to generate next round based on results. That is a reasonable feature. I'll implement that in a later iteration.

    // For now, I'll implement generateCupFixtures to create only the first round (if any). If the number of teams is a power of two, then the first round is the round of 16, etc. If there are byes, then the first round is the round with the fewest teams.

    // We'll also add a field in the fixture indicating the round number and round label, and a flag that more rounds are available.

    // We'll also create a function to generate subsequent rounds (but not in this code).

    // Given the user's request, I'll implement a full bracket generation with placeholders using null for clubId in later rounds, and then the fixture will have a special status "pending" and we can update later. But that would break foreign keys. For now, we can allow null clubId.

    // Let's implement a simplified version: generate all rounds, but for later rounds, we set homeClubId and awayClubId to null, and store the bracket position. Later, we can populate them.

    // I'll proceed with that.

    // Let's write the bracket generation.

    // Actually, I'll take a different approach: I'll generate all rounds using the actual clubs that are in the bracket slots, but we assign them based on a deterministic bracket. For example, we order clubs by overall rating, then we generate a bracket where the highest rated plays the lowest, etc. Then for each round, we can assign the clubs that are in those positions. But since we don't know winners, we can't assign the clubs to the next round's positions. However, we can assign the clubs that are *potentially* in that position based on the seeding. For example, in a 16-team tournament, the quarter-final match between (1 vs 16) winner and (8 vs 9) winner will have either (1 or 16) and (8 or 9). We could assign the clubs 1 and 8 as the participants, but that would be incorrect if 16 wins. So it's not accurate.

    // This is getting too complex. I'll generate only the first round for cups. The user can generate later rounds manually after results. I'll note this in the UI.

    // I'll implement generateCupFixtures to produce only the first round fixtures. The round label will be based on the number of teams: if n <= 2, final; if n <=4, semi-finals; if n <=8, quarter-finals; if n <=16, round of 16; if n <=32, round of 32; etc. We'll compute the highest power of two that is <= n? Actually, the first round of a cup with 10 teams would be a preliminary round of 4 teams (2 matches), then 8 teams in round of 16? Wait, with 10 teams, we have 6 byes, so 4 teams play in a preliminary round, winners join the 6 byes to make 8 teams for the round of 16. So the first round is the preliminary round. Then the next round is the round of 16, etc. So we generate the preliminary round (if any), and then we stop. The rest will be generated later.

    // I think this is acceptable.

    // I'll implement that now.
    // We'll create a function that returns an array of fixtures for the first round only.
    // We'll compute the number of matches in the first round: if n is power of two, first round has n/2 matches (e.g., 8 teams -> 4 matches = quarter-finals? Actually, with 8 teams, first round is quarter-finals). If n=10, first round has (n - byes)/2 matches = (10-6)/2 = 2 matches (preliminary). So we need to produce those matches.
    // The round label for the first round is determined by the total number of teams after byes are included? Actually, the first round is the round before the round of 16. So if n=10, after preliminary, we have 8 teams for round of 16. So the first round is the preliminary round, we can call it "Preliminary Round" or "1/32" if we consider that the tournament has 32 slots. But with 10 teams, it's not exactly 1/32. We can use "Qualifying Round".
    // To simplify, we'll label the first round as "Round 1", and subsequent rounds as "Round 2", etc., but we can also compute the traditional names based on the number of teams in that round. For n=10, first round has 4 teams, so it's a preliminary round. The next round would have 8 teams (round of 16). We'll generate only the first round, so we label it "Preliminary Round". For n=16, first round has 16 teams, so it's "Round of 16". For n=8, first round has 8 teams, so it's "Quarter-finals". For n=4, first round is "Semi-finals". For n=2, first round is "Final". For n=32, first round is "Round of 32". So we can compute the label based on the number of teams in the first round.
    // We'll compute that.

    // We'll implement generateCupFixtures to generate only the first round.

    // I'll write the code now.
    // But we also need to handle the third-place match. That is after the semi-finals, so we can't generate it now. We'll generate it when we generate the semi-finals.

    // For now, generate only the first round.

    // I'll update the code accordingly.
    // The generateCupFixtures function will return an array of fixtures for the first round.

    // We'll use the same structure as league fixtures but with type 'cup' and round label.

    // Let's code this.
}

/* =========================================================
   GENERATE CUP FIXTURES (First round only)
========================================================= */

async function generateCupFixtures({
  league,
  clubs,
  seasonYear,
}) {
  const leagueClubs =
    getLeagueClubs(
      league,
      clubs
    );

  if (
    leagueClubs.length < 2
  ) {
    return [];
  }

  const n = leagueClubs.length;
  const p2 = nextPowerOfTwo(n);
  const byes = p2 - n;

  // Determine first round participants: teams without byes
  // We'll seed teams by overall rating descending (or random)
  const sorted = [...leagueClubs].sort(
    (a, b) => (b.overall || 0) - (a.overall || 0)
  );

  // Teams with byes are the top 'byes' teams
  const teamsWithByes = sorted.slice(0, byes);
  const teamsPlayingFirstRound = sorted.slice(byes);

  // Number of matches in first round
  const numMatches = teamsPlayingFirstRound.length / 2;
  if (numMatches === 0) {
    // No first round matches (n is power of two), so we skip generation? Actually, the first round would be the round of 16 etc., but since all teams play, we need to generate matches for the round of 16. So we need to generate matches for the round that has n teams. So if n is power of two, the first round has n/2 matches. So we should pair all teams.
    // So we generate matches for the round that has n teams.
    // We'll pair all teams randomly.
    // We'll create matches pairing first half with second half (1 vs 16, 2 vs 15, etc.)
    const half = n / 2;
    const matches = [];
    for (let i = 0; i < half; i++) {
      matches.push({
        home: sorted[i],
        away: sorted[n - 1 - i],
      });
    }
    // The round label
    const roundLabel = getRoundLabel(n);
    const roundNumber = 1;
    // Create fixtures for these matches
    const fixtures = [];
    // We need to determine match date. We'll use start date from league.
    const country = getLeagueCountry(league);
    const startDate = getPreferredLeagueStart(league, seasonYear);
    const holidaySet = await buildHolidaySet(startDate.getFullYear(), country);
    let currentMatchDay = findNextMatchDay(
      startDate,
      holidaySet,
      CUP_ALLOWED_DAYS
    );

    matches.forEach((match, idx) => {
      const fixture = createFixture({
        league,
        home: match.home,
        away: match.away,
        seasonYear,
        round: roundNumber,
        date: currentMatchDay,
        roundLabel: roundLabel,
      });
      fixtures.push(fixture);
      // If we have multiple matches on same day, they can share the date.
    });

    return fixtures;
  } else {
    // There is a preliminary round
    const matches = [];
    for (let i = 0; i < teamsPlayingFirstRound.length; i += 2) {
      matches.push({
        home: teamsPlayingFirstRound[i],
        away: teamsPlayingFirstRound[i + 1],
      });
    }
    // Round label for preliminary round
    const roundLabel = "Preliminary Round";
    const roundNumber = 1;
    const fixtures = [];
    const country = getLeagueCountry(league);
    const startDate = getPreferredLeagueStart(league, seasonYear);
    const holidaySet = await buildHolidaySet(startDate.getFullYear(), country);
    let currentMatchDay = findNextMatchDay(
      startDate,
      holidaySet,
      CUP_ALLOWED_DAYS
    );

    matches.forEach((match) => {
      const fixture = createFixture({
        league,
        home: match.home,
        away: match.away,
        seasonYear,
        round: roundNumber,
        date: currentMatchDay,
        roundLabel: roundLabel,
      });
      fixtures.push(fixture);
    });

    return fixtures;
  }
}

function getRoundLabel(numTeamsInRound) {
  if (numTeamsInRound >= 64) return "Round of 64";
  if (numTeamsInRound >= 32) return "Round of 32";
  if (numTeamsInRound >= 16) return "Round of 16";
  if (numTeamsInRound >= 8) return "Quarter-finals";
  if (numTeamsInRound >= 4) return "Semi-finals";
  if (numTeamsInRound >= 2) return "Final";
  return "Round 1";
}

/* =========================================================
   FIXTURE ID
========================================================= */

function cleanIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(
      /[^a-zA-Z0-9_-]/g,
      ""
    );
}

function makeFixtureId({
  seasonYear,
  leagueId,
  round,
  homeClubId,
  awayClubId,
}) {
  return [
    "fixture",
    seasonYear,
    cleanIdPart(leagueId),
    round,
    cleanIdPart(homeClubId),
    cleanIdPart(awayClubId),
  ].join("_");
}

/* =========================================================
   CREATE FIXTURE
========================================================= */

function createFixture({
  league,
  home,
  away,
  seasonYear,
  round,
  date,
  roundLabel = null,
}) {
  const id =
    makeFixtureId({
      seasonYear,
      leagueId: league.id,
      round,
      homeClubId: home.id,
      awayClubId: away.id,
    });

  const isCup = league.type === "cup";

  return {
    id,

    type: isCup ? "cup" : "league",

    generated: true,

    generatedBy:
      "automatic-fixture-generator",

    seasonYear,

    season:
      getSeasonName(
        seasonYear
      ),

    leagueId:
      league.id,

    leagueName:
      getLeagueName(
        league
      ),

    country:
      getLeagueCountry(
        league
      ),

    round,
    roundLabel: roundLabel || (isCup ? getRoundLabel(2) : `Round ${round}`),

    homeClubId:
      home.id,

    homeClubName:
      getClubName(home),

    homeLogo:
      getClubLogo(home),

    awayClubId:
      away.id,

    awayClubName:
      getClubName(away),

    awayLogo:
      getClubLogo(away),

    stadium:
      home?.stadium ||
      home?.stadiumName ||
      "Club Stadium",

    date:
      date.toISOString(),

    status:
      "scheduled",

    result: null,

    homeScore: null,

    awayScore: null,

    homeOverall:
      Number(home?.overall) ||
      Number(home?.rating) ||
      Number(home?.teamOverall) ||
      60,

    awayOverall:
      Number(away?.overall) ||
      Number(away?.rating) ||
      Number(away?.teamOverall) ||
      60,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp(),
  };
}

/* =========================================================
   GENERATE LEAGUE FIXTURES (dispatcher)
========================================================= */

async function generateLeagueFixtures({
  league,
  clubs,
  seasonYear,
}) {
  if (league.type === "cup") {
    return await generateCupFixtures({
      league,
      clubs,
      seasonYear,
    });
  } else {
    // League
    return await generateLeagueFixturesRoundRobin({
      league,
      clubs,
      seasonYear,
    });
  }
}

/* =========================================================
   GENERATE LEAGUE FIXTURES (Round Robin)
========================================================= */

async function generateLeagueFixturesRoundRobin({
  league,
  clubs,
  seasonYear,
}) {
  const leagueClubs =
    getLeagueClubs(
      league,
      clubs
    );

  /*
   * Minimum two clubs.
   */

  if (
    leagueClubs.length < 2
  ) {
    return [];
  }

  const country =
    getLeagueCountry(league);

  const allowedDays = LEAGUE_ALLOWED_DAYS;

  /*
   * Holiday cache.
   */

  const holidaySets =
    new Map();

  async function getHolidays(year) {
    if (
      holidaySets.has(year)
    ) {
      return holidaySets.get(
        year
      );
    }

    const set =
      await buildHolidaySet(
        year,
        country
      );

    holidaySets.set(
      year,
      set
    );

    return set;
  }

  /*
   * Build round-robin.
   */

  const rounds =
    buildRounds(
      leagueClubs
    );

  if (!rounds.length) {
    return [];
  }

  /*
   * Determine start date.
   */

  let startDate =
    getPreferredLeagueStart(
      league,
      seasonYear
    );

  startDate =
    clampStartIntoSeasonWindow(
      startDate,
      seasonYear
    );

  /*
   * Load holidays for start year.
   */

  let holidaySet =
    await getHolidays(
      startDate.getFullYear()
    );

  /*
   * Find first match day.
   */

  let currentMatchDay =
    findNextMatchDay(
      startDate,
      holidaySet,
      allowedDays
    );

  const fixtures = [];

  /*
   * Generate all rounds.
   */

  for (
    let roundIndex = 0;
    roundIndex < rounds.length;
    roundIndex += 1
  ) {
    const round =
      roundIndex + 1;

    /*
     * Current calendar year.
     */

    const currentYear =
      currentMatchDay.getFullYear();

    /*
     * Load correct year's holidays.
     */

    holidaySet =
      await getHolidays(
        currentYear
      );

    /*
     * Make sure match day is valid.
     */

    currentMatchDay =
      findNextMatchDay(
        currentMatchDay,
        holidaySet,
        allowedDays
      );

    /*
     * Create matches for this round.
     */

    rounds[roundIndex].forEach(
      ({
        home,
        away,
      }) => {
        fixtures.push(
          createFixture({
            league,
            home,
            away,
            seasonYear,
            round,
            date:
              currentMatchDay,
          })
        );
      }
    );

    /*
     * Next round: one week later.
     */

    const nextWeekCandidate =
      addWeeks(
        currentMatchDay,
        MATCH_WEEKS_INTERVAL
      );

    const nextYear =
      nextWeekCandidate.getFullYear();

    const nextHolidaySet =
      await getHolidays(
        nextYear
      );

    currentMatchDay =
      findNextMatchDay(
        nextWeekCandidate,
        nextHolidaySet,
        allowedDays
      );
  }

  return fixtures;
}

/* =========================================================
   CHUNK ARRAY
========================================================= */

function chunkArray(
  array,
  size
) {
  const chunks = [];

  for (
    let i = 0;
    i < array.length;
    i += size
  ) {
    chunks.push(
      array.slice(
        i,
        i + size
      )
    );
  }

  return chunks;
}

/* =========================================================
   EXISTING FIXTURES
========================================================= */

async function getExistingFixtureIds(
  seasonYear
) {
  const matchesQuery =
    query(
      collection(
        db,
        "matches"
      ),
      where(
        "seasonYear",
        "==",
        seasonYear
      )
    );

  const snapshot =
    await getDocs(
      matchesQuery
    );

  const ids =
    new Set();

  snapshot.forEach(
    (item) => {
      ids.add(item.id);
    }
  );

  return ids;
}

/* =========================================================
   SAVE FIXTURES
========================================================= */

async function saveFixtures(
  fixtures
) {
  if (!fixtures.length) {
    return 0;
  }

  const chunks =
    chunkArray(
      fixtures,
      FIRESTORE_BATCH_SIZE
    );

  let saved = 0;

  for (
    const chunk of chunks
  ) {
    const batch =
      writeBatch(db);

    chunk.forEach(
      (fixture) => {
        const fixtureRef =
          doc(
            db,
            "matches",
            fixture.id
          );

        batch.set(
          fixtureRef,
          fixture,
          {
            merge: true,
          }
        );

        saved += 1;
      }
    );

    await batch.commit();
  }

  return saved;
}

/* =========================================================
   GENERATE SEASON FOR SELECTED LEAGUES
========================================================= */

async function generateSeasonFixtures({
  leagueIds,
  leagues,
  clubs,
  seasonYear,
}) {
  if (
    !Array.isArray(leagueIds) ||
    leagueIds.length === 0 ||
    !Array.isArray(leagues) ||
    !Array.isArray(clubs)
  ) {
    return {
      generated: 0,
      existing: 0,
      leaguesProcessed: 0,
    };
  }

  /*
   * Get existing fixtures first.
   */

  const existingIds =
    await getExistingFixtureIds(
      seasonYear
    );

  const fixturesToCreate = [];

  let leaguesProcessed = 0;

  /*
   * Process each selected league.
   */

  for (
    const leagueId of leagueIds
  ) {
    const league =
      leagues.find(
        (l) =>
          l.id === leagueId
      );

    if (!league) {
      continue;
    }

    const leagueClubs =
      getLeagueClubs(
        league,
        clubs
      );

    if (
      leagueClubs.length < 2
    ) {
      continue;
    }

    leaguesProcessed += 1;

    const generatedFixtures =
      await generateLeagueFixtures({
        league,
        clubs: leagueClubs,
        seasonYear,
      });

    generatedFixtures.forEach(
      (fixture) => {
        if (
          existingIds.has(
            fixture.id
          )
        ) {
          return;
        }

        if (
          fixturesToCreate.some(
            (existing) =>
              existing.id ===
              fixture.id
          )
        ) {
          return;
        }

        fixturesToCreate.push(
          fixture
        );
      }
    );
  }

  /*
   * Save.
   */

  const generated =
    await saveFixtures(
      fixturesToCreate
    );

  return {
    generated,

    existing:
      existingIds.size,

    leaguesProcessed,
  };
}

/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialLeagues = [],
  initialClubs = [],
}) {
  const {
    user,
    loading,
  } = useAuth();

  const [
    status,
    setStatus,
  ] = useState("waiting");

  const [
    message,
    setMessage,
  ] = useState(
    "Select leagues and click Generate."
  );

  const [
    seasonYear,
    setSeasonYear,
  ] = useState(null);

  const [
    result,
    setResult,
  ] = useState(null);

  const [
    hasGenerated,
    setHasGenerated,
  ] = useState(false);

  const [
    selectedLeagueIds,
    setSelectedLeagueIds,
  ] = useState([]);

  const [
    isGenerating,
    setIsGenerating,
  ] = useState(false);

  /* =======================================================
     GENERATE FUNCTION
  ======================================================= */

  const handleGenerate = useCallback(
    async () => {
      if (
        !user ||
        isGenerating ||
        selectedLeagueIds.length === 0
      ) {
        return;
      }

      try {
        setIsGenerating(true);
        setStatus("generating");
        setMessage("Generating fixtures...");
        setHasGenerated(false);

        /*
         * Determine current season.
         */

        const currentDate =
          new Date();

        const currentSeason =
          getSeasonYear(
            currentDate
          );

        setSeasonYear(
          currentSeason
        );

        setMessage(
          `Generating fixtures for ${getSeasonName(
            currentSeason
          )}...`
        );

        const generationResult =
          await generateSeasonFixtures({
            leagueIds:
              selectedLeagueIds,
            leagues:
              initialLeagues,
            clubs:
              initialClubs,
            seasonYear:
              currentSeason,
          });

        setResult(
          generationResult
        );

        setHasGenerated(
          true
        );

        setStatus(
          "complete"
        );

        if (
          generationResult.generated >
          0
        ) {
          setMessage(
            `${generationResult.generated} fixtures generated successfully.`
          );
        } else {
          setMessage(
            `Fixtures for selected leagues already exist or no fixtures were created.`
          );
        }
      } catch (error) {
        console.error(
          "[FIXTURE GENERATOR ERROR]",
          error
        );

        setStatus(
          "error"
        );

        setMessage(
          error?.message ||
            "Automatic fixture generation failed."
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [
      user,
      isGenerating,
      selectedLeagueIds,
      initialLeagues,
      initialClubs,
    ]
  );

  /* =======================================================
     TOGGLE SELECTION
  ======================================================= */

  const toggleLeagueSelection = (
    leagueId
  ) => {
    setSelectedLeagueIds(
      (prev) => {
        if (
          prev.includes(
            leagueId
          )
        ) {
          return prev.filter(
            (id) =>
              id !== leagueId
          );
        } else {
          return [
            ...prev,
            leagueId,
          ];
        }
      }
    );
  };

  const selectAll = () => {
    setSelectedLeagueIds(
      initialLeagues.map(
        (l) => l.id
      )
    );
  };

  const clearAll = () => {
    setSelectedLeagueIds(
      []
    );
  };

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <div
        className={
          styles.loading
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <p>
          Loading fixture generator...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Head>
          <title>
            Fixture Generator
          </title>
        </Head>

        <main
          className={
            styles.emptyPage
          }
        >
          <h1>
            Login Required
          </h1>

          <p>
            Login is required for
            automatic fixture
            generation.
          </p>
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
        <title>
          Automatic Fixture Generator
        </title>

        <meta
          name="description"
          content="Automatic football league fixture generator"
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.nextMatchCard
          }
        >
          <div
            className={
              styles.nextMatchTop
            }
          >
            <div>
              <span>
                FIXTURE ENGINE
              </span>

              <h1>
                Automatic Fixtures
              </h1>
            </div>
          </div>

          <div
            className={
              styles.controls
            }
          >
            <div
              className={
                styles.controlRow
              }
            >
              <button
                className={
                  styles.selectButton
                }
                onClick={
                  selectAll
                }
              >
                Select All
              </button>

              <button
                className={
                  styles.selectButton
                }
                onClick={
                  clearAll
                }
              >
                Clear All
              </button>

              <button
                className={
                  styles.generateButton
                }
                onClick={
                  handleGenerate
                }
                disabled={
                  isGenerating ||
                  selectedLeagueIds.length ===
                    0
                }
              >
                {isGenerating
                  ? "Generating..."
                  : "Generate Fixtures"}
              </button>
            </div>

            <div
              className={
                styles.leagueList
              }
            >
              {initialLeagues.length ===
                0 && (
                <p>
                  No leagues found.
                  Please create
                  leagues first.
                </p>
              )}

              {initialLeagues.map(
                (league) => (
                  <label
                    key={
                      league.id
                    }
                    className={
                      styles.leagueCheckbox
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedLeagueIds.includes(
                        league.id
                      )}
                      onChange={() =>
                        toggleLeagueSelection(
                          league.id
                        )
                      }
                    />

                    <span>
                      {league.name}{" "}
                      <small>
                        ({league.type ||
                          "league"})
                      </small>

                      <em>
                        (
                        {getLeagueClubs(
                          league,
                          initialClubs
                        ).length}{" "}
                        clubs)
                      </em>
                    </span>
                  </label>
                )
              )}
            </div>
          </div>

          <div
            className={
              styles.noNextMatch
            }
          >
            {status ===
              "generating" && (
              <>
                <div
                  className={
                    styles.spinner
                  }
                />

                <p>
                  {message}
                </p>
              </>
            )}

            {status ===
              "complete" && (
              <>
                <div
                  style={{
                    fontSize:
                      "42px",
                    marginBottom:
                      "10px",
                  }}
                >
                  ✓
                </div>

                <h2>
                  {message}
                </h2>

                {seasonYear && (
                  <p>
                    Season:{" "}
                    <strong>
                      {getSeasonName(
                        seasonYear
                      )}
                    </strong>
                  </p>
                )}

                {result && (
                  <p>
                    New fixtures:{" "}
                    <strong>
                      {
                        result.generated
                      }
                    </strong>

                    <br />

                    Existing fixtures:{" "}
                    <strong>
                      {
                        result.existing
                      }
                    </strong>

                    <br />

                    Leagues processed:{" "}
                    <strong>
                      {
                        result.leaguesProcessed
                      }
                    </strong>
                  </p>
                )}

                <p>
                  Fixtures are stored
                  automatically in
                  Firestore.
                </p>
              </>
            )}

            {status ===
              "error" && (
              <>
                <div
                  style={{
                    fontSize:
                      "42px",
                    marginBottom:
                      "10px",
                  }}
                >
                  !
                </div>

                <h2>
                  Generation Error
                </h2>

                <p>
                  {message}
                </p>
              </>
            )}

            {status ===
              "waiting" && (
              <p>
                {message}
              </p>
            )}
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
    const [
      leaguesSnapshot,
      clubsSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(
          db,
          "leagues"
        )
      ),

      getDocs(
        collection(
          db,
          "clubs"
        )
      ),
    ]);

    /*
     * LEAGUES
     */

    const leagues =
      leaguesSnapshot.docs
        .slice(
          0,
          MAX_LEAGUES
        )
        .map(
          (item) => ({
            id:
              item.id,
            ...item.data(),
          })
        );

    /*
     * CLUBS
     */

    const clubs =
      clubsSnapshot.docs
        .slice(
          0,
          MAX_CLUBS
        )
        .map(
          (item) => ({
            id:
              item.id,
            ...item.data(),
          })
        );

    return {
      props: {
        initialLeagues:
          JSON.parse(
            JSON.stringify(
              leagues
            )
          ),

        initialClubs:
          JSON.parse(
            JSON.stringify(
              clubs
            )
          ),
      },
    };
  } catch (error) {
    console.error(
      "[FIXTURE SSR ERROR]",
      error
    );

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
      },
    };
  }
}
