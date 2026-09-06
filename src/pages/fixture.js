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
   ROUND ROBIN
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
   GENERATE LEAGUE FIXTURES
========================================================= */

async function generateLeagueFixtures({
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

  /*
   * Determine allowed match days based on type.
   */

  const isCup = league.type === "cup";
  const allowedDays = isCup
    ? CUP_ALLOWED_DAYS
    : LEAGUE_ALLOWED_DAYS;

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
