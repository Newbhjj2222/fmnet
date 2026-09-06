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
 * League fixture generation window.
 */
const EARLIEST_LEAGUE_START_MONTH = 7; // August
const EARLIEST_LEAGUE_START_DAY = 1;

const LATEST_LEAGUE_START_MONTH = 8; // September
const LATEST_LEAGUE_START_DAY = 30;

/*
 * League:
 * One round per week.
 */
const MATCH_WEEKS_INTERVAL = 1;

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
 * =========================================================
 * CUP CONFIG
 * =========================================================
 *
 * 1/32 requires 64 teams.
 *
 * Cup bracket:
 *
 * 1/32 -> 32 matches
 * 1/16 -> 16 matches
 * 1/8  -> 8 matches
 * 1/4  -> 4 matches
 * 1/2  -> 2 matches
 * 3rd  -> 1 match
 * Final -> 1 match
 *
 * Total = 64 fixtures
 */

const CUP_FIRST_ROUND_TEAMS = 64;

const CUP_STAGES = {
  ROUND_OF_64: {
    key: "round_of_64",
    name: "1/32",
    matches: 32,
  },

  ROUND_OF_32: {
    key: "round_of_32",
    name: "1/16",
    matches: 16,
  },

  ROUND_OF_16: {
    key: "round_of_16",
    name: "1/8",
    matches: 8,
  },

  QUARTER_FINAL: {
    key: "quarter_final",
    name: "1/4",
    matches: 4,
  },

  SEMI_FINAL: {
    key: "semi_final",
    name: "1/2",
    matches: 2,
  },

  THIRD_PLACE: {
    key: "third_place",
    name: "Third Place",
    matches: 1,
  },

  FINAL: {
    key: "final",
    name: "Final",
    matches: 1,
  },
};

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
   * 2026-08-28 => 2026/27
   *
   * January -> June
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
  if (
    !league ||
    !Array.isArray(clubs)
  ) {
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
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor(
    (b - f + 1) / 3
  );

  const h =
    (19 * a + b - d - g + 15) % 30;

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
    (a + 11 * h + 22 * l) / 451
  );

  const month = Math.floor(
    (h + l - 7 * m + 114) / 31
  );

  const day =
    ((h + l - 7 * m + 114) % 31) + 1;

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
    const holidayQuery = query(
      collection(db, "holidays"),
      where("year", "==", year)
    );

    const snapshot =
      await getDocs(holidayQuery);

    snapshot.forEach((item) => {
      const data = item.data();

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

function isHoliday(
  date,
  holidaySet
) {
  return holidaySet.has(
    isoDate(date)
  );
}

function findNextMatchDay(
  startDate,
  holidaySet,
  allowedDays
) {
  let date =
    startOfDay(startDate);

  const days =
    Array.isArray(allowedDays)
      ? allowedDays
      : [allowedDays];

  if (
    days.includes(
      date.getDay()
    ) &&
    !isHoliday(
      date,
      holidaySet
    )
  ) {
    return makeKickoff(date);
  }

  for (
    let attempt = 0;
    attempt < 365;
    attempt += 1
  ) {
    date = addDays(date, 1);

    if (
      days.includes(
        date.getDay()
      ) &&
      !isHoliday(
        date,
        holidaySet
      )
    ) {
      return makeKickoff(date);
    }
  }

  return makeKickoff(startDate);
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
    getCountryStartRule(
      country
    );

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
  const earliest = makeDate(
    seasonYear,
    EARLIEST_LEAGUE_START_MONTH,
    EARLIEST_LEAGUE_START_DAY,
    DEFAULT_KICKOFF_HOUR,
    DEFAULT_KICKOFF_MINUTE
  );

  const latest = makeDate(
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
          totalTeams - 1 - i
        ];

      if (
        !teamA ||
        !teamB
      ) {
        continue;
      }

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

    firstLeg.push(
      matches
    );

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
   * Reverse home / away.
   */

  const secondLeg =
    firstLeg.map(
      (round) =>
        round.map(
          (match) => ({
            home: match.away,
            away: match.home,
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
    cleanIdPart(
      leagueId
    ),
    round,
    cleanIdPart(
      homeClubId
    ),
    cleanIdPart(
      awayClubId
    ),
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
  const id =
    makeFixtureId({
      seasonYear,
      leagueId:
        league.id,
      round,
      homeClubId:
        home.id,
      awayClubId:
        away.id,
    });

  return {
    id,

    type: "league",

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

    stage: "league",

    roundName:
      `Round ${round}`,

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

    status: "scheduled",

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
   CREATE CUP FIXTURE
========================================================= */

function createCupFixture({
  league,
  seasonYear,
  round,
  stage,
  roundName,
  bracketPosition,
  date,
  home,
  away,
  homeSourceFixtureId = null,
  awaySourceFixtureId = null,
}) {
  const homeId =
    home?.id ||
    `TBD_HOME_${bracketPosition}`;

  const awayId =
    away?.id ||
    `TBD_AWAY_${bracketPosition}`;

  const id = [
    "fixture",
    seasonYear,
    cleanIdPart(
      league.id
    ),
    "cup",
    stage,
    bracketPosition,
  ].join("_");

  return {
    id,

    type: "cup",

    generated: true,

    generatedBy:
      "automatic-cup-fixture-generator",

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

    /*
     * Cup information
     */

    round,

    stage,

    roundName,

    bracketPosition,

    /*
     * Home team
     */

    homeClubId:
      home?.id || null,

    homeClubName:
      home
        ? getClubName(home)
        : "TBD",

    homeLogo:
      home
        ? getClubLogo(home)
        : "",

    /*
     * Away team
     */

    awayClubId:
      away?.id || null,

    awayClubName:
      away
        ? getClubName(away)
        : "TBD",

    awayLogo:
      away
        ? getClubLogo(away)
        : "",

    /*
     * Where the team comes from.
     *
     * This is important for future automatic
     * winner advancement.
     */

    homeSourceFixtureId,

    awaySourceFixtureId,

    homeSlot:
      home
        ? "club"
        : homeSourceFixtureId
        ? "winner"
        : "tbd",

    awaySlot:
      away
        ? "club"
        : awaySourceFixtureId
        ? "winner"
        : "tbd",

    stadium:
      home?.stadium ||
      home?.stadiumName ||
      "Club Stadium",

    date:
      date.toISOString(),

    status:
      home && away
        ? "scheduled"
        : "pending",

    result: null,

    homeScore: null,

    awayScore: null,

    homeOverall:
      Number(home?.overall) ||
      Number(home?.rating) ||
      Number(home?.teamOverall) ||
      null,

    awayOverall:
      Number(away?.overall) ||
      Number(away?.rating) ||
      Number(away?.teamOverall) ||
      null,

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

  if (
    leagueClubs.length < 2
  ) {
    return [];
  }

  const country =
    getLeagueCountry(
      league
    );

  const allowedDays =
    LEAGUE_ALLOWED_DAYS;

  const holidaySets =
    new Map();

  async function getHolidays(
    year
  ) {
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

  const rounds =
    buildRounds(
      leagueClubs
    );

  if (!rounds.length) {
    return [];
  }

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

  let holidaySet =
    await getHolidays(
      startDate.getFullYear()
    );

  let currentMatchDay =
    findNextMatchDay(
      startDate,
      holidaySet,
      allowedDays
    );

  const fixtures = [];

  for (
    let roundIndex = 0;
    roundIndex < rounds.length;
    roundIndex += 1
  ) {
    const round =
      roundIndex + 1;

    const currentYear =
      currentMatchDay.getFullYear();

    holidaySet =
      await getHolidays(
        currentYear
      );

    currentMatchDay =
      findNextMatchDay(
        currentMatchDay,
        holidaySet,
        allowedDays
      );

    rounds[
      roundIndex
    ].forEach(
      ({ home, away }) => {
        fixtures.push(
          createLeagueFixture({
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
   GENERATE CUP FIXTURES
========================================================= */

async function generateCupFixtures({
  league,
  clubs,
  seasonYear,
}) {
  const cupClubs =
    getLeagueClubs(
      league,
      clubs
    );

  if (
    cupClubs.length < 2
  ) {
    return [];
  }

  /*
   * We need 64 slots for a complete 1/32 bracket.
   *
   * If the cup has more than 64 clubs,
   * only the first 64 are used.
   *
   * If fewer than 64 clubs exist,
   * the remaining slots become TBD.
   */

  const participants =
    [...cupClubs].slice(
      0,
      CUP_FIRST_ROUND_TEAMS
    );

  const country =
    getLeagueCountry(
      league
    );

  const holidaySets =
    new Map();

  async function getHolidays(
    year
  ) {
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
   * IMPORTANT:
   *
   * Cup fixtures start from the league's startDate.
   * The startDate is obtained from league.startDate
   * if available, otherwise from country rules.
   *
   * This ensures the cup schedule respects the
   * user-defined starting date stored in the database.
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

  let holidaySet =
    await getHolidays(
      startDate.getFullYear()
    );

  let currentMatchDay =
    findNextMatchDay(
      startDate,
      holidaySet,
      CUP_ALLOWED_DAYS
    );

  const fixtures = [];

  /*
   * ---------------------------------------------------------
   * 1/32
   * 32 matches
   * ---------------------------------------------------------
   */

  const roundOf64Fixtures = [];

  for (
    let i = 0;
    i < 32;
    i += 1
  ) {
    const home =
      participants[i * 2] ||
      null;

    const away =
      participants[i * 2 + 1] ||
      null;

    const fixture =
      createCupFixture({
        league,
        seasonYear,

        round: 1,

        stage:
          CUP_STAGES.ROUND_OF_64.key,

        roundName:
          CUP_STAGES.ROUND_OF_64.name,

        bracketPosition:
          i + 1,

        date:
          currentMatchDay,

        home,
        away,
      });

    roundOf64Fixtures.push(
      fixture
    );

    fixtures.push(
      fixture
    );
  }

  /*
   * ---------------------------------------------------------
   * 1/16
   * 16 matches
   * ---------------------------------------------------------
   */

  currentMatchDay =
    await getNextCupMatchDay(
      currentMatchDay,
      getHolidays,
      1
    );

  const roundOf32Fixtures = [];

  for (
    let i = 0;
    i < 16;
    i += 1
  ) {
    const homeSource =
      roundOf64Fixtures[
        i * 2
      ];

    const awaySource =
      roundOf64Fixtures[
        i * 2 + 1
      ];

    const fixture =
      createCupFixture({
        league,
        seasonYear,

        round: 2,

        stage:
          CUP_STAGES.ROUND_OF_32.key,

        roundName:
          CUP_STAGES.ROUND_OF_32.name,

        bracketPosition:
          i + 1,

        date:
          currentMatchDay,

        home: null,
        away: null,

        homeSourceFixtureId:
          homeSource.id,

        awaySourceFixtureId:
          awaySource.id,
      });

    roundOf32Fixtures.push(
      fixture
    );

    fixtures.push(
      fixture
    );
  }

  /*
   * ---------------------------------------------------------
   * 1/8
   * 8 matches
   * ---------------------------------------------------------
   */

  currentMatchDay =
    await getNextCupMatchDay(
      currentMatchDay,
      getHolidays,
      1
    );

  const roundOf16Fixtures = [];

  for (
    let i = 0;
    i < 8;
    i += 1
  ) {
    const homeSource =
      roundOf32Fixtures[
        i * 2
      ];

    const awaySource =
      roundOf32Fixtures[
        i * 2 + 1
      ];

    const fixture =
      createCupFixture({
        league,
        seasonYear,

        round: 3,

        stage:
          CUP_STAGES.ROUND_OF_16.key,

        roundName:
          CUP_STAGES.ROUND_OF_16.name,

        bracketPosition:
          i + 1,

        date:
          currentMatchDay,

        home: null,
        away: null,

        homeSourceFixtureId:
          homeSource.id,

        awaySourceFixtureId:
          awaySource.id,
      });

    roundOf16Fixtures.push(
      fixture
    );

    fixtures.push(
      fixture
    );
  }

  /*
   * ---------------------------------------------------------
   * 1/4
   * 4 matches
   * ---------------------------------------------------------
   */

  currentMatchDay =
    await getNextCupMatchDay(
      currentMatchDay,
      getHolidays,
      1
    );

  const quarterFinalFixtures = [];

  for (
    let i = 0;
    i < 4;
    i += 1
  ) {
    const homeSource =
      roundOf16Fixtures[
        i * 2
      ];

    const awaySource =
      roundOf16Fixtures[
        i * 2 + 1
      ];

    const fixture =
      createCupFixture({
        league,
        seasonYear,

        round: 4,

        stage:
          CUP_STAGES.QUARTER_FINAL.key,

        roundName:
          CUP_STAGES.QUARTER_FINAL.name,

        bracketPosition:
          i + 1,

        date:
          currentMatchDay,

        home: null,
        away: null,

        homeSourceFixtureId:
          homeSource.id,

        awaySourceFixtureId:
          awaySource.id,
      });

    quarterFinalFixtures.push(
      fixture
    );

    fixtures.push(
      fixture
    );
  }

  /*
   * ---------------------------------------------------------
   * 1/2
   * 2 matches
   * ---------------------------------------------------------
   */

  currentMatchDay =
    await getNextCupMatchDay(
      currentMatchDay,
      getHolidays,
      1
    );

  const semiFinalFixtures = [];

  for (
    let i = 0;
    i < 2;
    i += 1
  ) {
    const homeSource =
      quarterFinalFixtures[
        i * 2
      ];

    const awaySource =
      quarterFinalFixtures[
        i * 2 + 1
      ];

    const fixture =
      createCupFixture({
        league,
        seasonYear,

        round: 5,

        stage:
          CUP_STAGES.SEMI_FINAL.key,

        roundName:
          CUP_STAGES.SEMI_FINAL.name,

        bracketPosition:
          i + 1,

        date:
          currentMatchDay,

        home: null,
        away: null,

        homeSourceFixtureId:
          homeSource.id,

        awaySourceFixtureId:
          awaySource.id,
      });

    semiFinalFixtures.push(
      fixture
    );

    fixtures.push(
      fixture
    );
  }

  /*
   * ---------------------------------------------------------
   * THIRD PLACE
   * ---------------------------------------------------------
   *
   * Loser of Semi 1
   * vs
   * Loser of Semi 2
   */

  const thirdPlaceDate =
    await getNextCupMatchDay(
      currentMatchDay,
      getHolidays,
      1
    );

  const thirdPlace =
    createCupFixture({
      league,
      seasonYear,

      round: 6,

      stage:
        CUP_STAGES.THIRD_PLACE.key,

      roundName:
        CUP_STAGES.THIRD_PLACE.name,

      bracketPosition: 1,

      date:
        thirdPlaceDate,

      home: null,
      away: null,

      homeSourceFixtureId:
        semiFinalFixtures[0].id,

      awaySourceFixtureId:
        semiFinalFixtures[1].id,
    });

  /*
   * Tell system that these are LOSERS.
   */

  thirdPlace.homeSlot =
    "loser";

  thirdPlace.awaySlot =
    "loser";

  fixtures.push(
    thirdPlace
  );

  /*
   * ---------------------------------------------------------
   * FINAL
   * ---------------------------------------------------------
   *
   * Winner of Semi 1
   * vs
   * Winner of Semi 2
   */

  const finalDate =
    await getNextCupMatchDay(
      thirdPlaceDate,
      getHolidays,
      1
    );

  const final =
    createCupFixture({
      league,
      seasonYear,

      round: 7,

      stage:
        CUP_STAGES.FINAL.key,

      roundName:
        CUP_STAGES.FINAL.name,

      bracketPosition: 1,

      date:
        finalDate,

      home: null,
      away: null,

      homeSourceFixtureId:
        semiFinalFixtures[0].id,

      awaySourceFixtureId:
        semiFinalFixtures[1].id,
    });

  /*
   * Final receives WINNERS.
   */

  final.homeSlot =
    "winner";

  final.awaySlot =
    "winner";

  fixtures.push(
    final
  );

  /*
   * ---------------------------------------------------------
   * CONNECT BRACKET
   * ---------------------------------------------------------
   *
   * Each previous fixture knows where its winner goes.
   */

  function setNextFixture(
    sourceFixture,
    nextFixture,
    slot
  ) {
    if (!sourceFixture) {
      return;
    }

    sourceFixture.nextFixtureId =
      nextFixture.id;

    sourceFixture.nextFixtureSlot =
      slot;
  }

  /*
   * 1/32 -> 1/16
   */

  roundOf64Fixtures.forEach(
    (fixture, index) => {
      const next =
        roundOf32Fixtures[
          Math.floor(index / 2)
        ];

      const slot =
        index % 2 === 0
          ? "home"
          : "away";

      setNextFixture(
        fixture,
        next,
        slot
      );
    }
  );

  /*
   * 1/16 -> 1/8
   */

  roundOf32Fixtures.forEach(
    (fixture, index) => {
      const next =
        roundOf16Fixtures[
          Math.floor(index / 2)
        ];

      const slot =
        index % 2 === 0
          ? "home"
          : "away";

      setNextFixture(
        fixture,
        next,
        slot
      );
    }
  );

  /*
   * 1/8 -> 1/4
   */

  roundOf16Fixtures.forEach(
    (fixture, index) => {
      const next =
        quarterFinalFixtures[
          Math.floor(index / 2)
        ];

      const slot =
        index % 2 === 0
          ? "home"
          : "away";

      setNextFixture(
        fixture,
        next,
        slot
      );
    }
  );

  /*
   * 1/4 -> 1/2
   */

  quarterFinalFixtures.forEach(
    (fixture, index) => {
      const next =
        semiFinalFixtures[
          Math.floor(index / 2)
        ];

      const slot =
        index % 2 === 0
          ? "home"
          : "away";

      setNextFixture(
        fixture,
        next,
        slot
      );
    }
  );

  /*
   * Semi -> Final / Third Place
   */

  semiFinalFixtures.forEach(
    (fixture) => {
      fixture.nextFinalFixtureId =
        final.id;

      fixture.nextThirdPlaceFixtureId =
        thirdPlace.id;
    }
  );

  return fixtures;
}

/* =========================================================
   CUP NEXT MATCH DAY
========================================================= */

async function getNextCupMatchDay(
  currentDate,
  getHolidays,
  weeks
) {
  const candidate =
    addWeeks(
      currentDate,
      weeks
    );

  const holidaySet =
    await getHolidays(
      candidate.getFullYear()
    );

  return findNextMatchDay(
    candidate,
    holidaySet,
    CUP_ALLOWED_DAYS
  );
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
      ids.add(
        item.id
      );
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
  if (
    !fixtures.length
  ) {
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
   GENERATE SEASON FIXTURES
========================================================= */

async function generateSeasonFixtures({
  leagueIds,
  leagues,
  clubs,
  seasonYear,
}) {
  if (
    !Array.isArray(
      leagueIds
    ) ||
    leagueIds.length === 0 ||
    !Array.isArray(
      leagues
    ) ||
    !Array.isArray(
      clubs
    )
  ) {
    return {
      generated: 0,
      existing: 0,
      leaguesProcessed: 0,
      cupFixtures: 0,
      leagueFixtures: 0,
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

  let cupFixtures = 0;
  let leagueFixtures = 0;

  /*
   * Process each selected league.
   */

  for (
    const leagueId of leagueIds
  ) {
    const league =
      leagues.find(
        (l) =>
          l.id ===
          leagueId
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

    /*
     * =====================================================
     * CUP
     * =====================================================
     */

    if (
      league.type === "cup"
    ) {
      const generatedCup =
        await generateCupFixtures({
          league,
          clubs,
          seasonYear,
        });

      generatedCup.forEach(
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

          cupFixtures += 1;
        }
      );

      continue;
    }

    /*
     * =====================================================
     * LEAGUE
     * =====================================================
     */

    const generatedLeague =
      await generateLeagueFixtures({
        league,
        clubs,
        seasonYear,
      });

    generatedLeague.forEach(
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

        leagueFixtures += 1;
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

    cupFixtures,

    leagueFixtures,
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
    selectedLeagueIds,
    setSelectedLeagueIds,
  ] = useState([]);

  const [
    isGenerating,
    setIsGenerating,
  ] = useState(false);

  /* =======================================================
     GENERATE
  ======================================================= */

  const handleGenerate =
    useCallback(
      async () => {
        if (
          !user ||
          isGenerating ||
          selectedLeagueIds.length ===
            0
        ) {
          return;
        }

        try {
          setIsGenerating(
            true
          );

          setStatus(
            "generating"
          );

          setMessage(
            "Generating fixtures..."
          );

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
              "Fixtures for selected competitions already exist or no fixtures were created."
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
          setIsGenerating(
            false
          );
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
     TOGGLE
  ======================================================= */

  const toggleLeagueSelection =
    (leagueId) => {
      setSelectedLeagueIds(
        (prev) => {
          if (
            prev.includes(
              leagueId
            )
          ) {
            return prev.filter(
              (id) =>
                id !==
                leagueId
            );
          }

          return [
            ...prev,
            leagueId,
          ];
        }
      );
    };

  const selectAll = () => {
    setSelectedLeagueIds(
      initialLeagues.map(
        (league) =>
          league.id
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
          Loading fixture
          generator...
        </p>
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
          <title>
            Fixture Generator
          </title>

          <meta
            name="description"
            content="Automatic football fixture generator"
          />
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
            Login is required
            for automatic
            fixture generation.
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
          content="Automatic football league and cup fixture generator"
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

          {/* =================================================
              CONTROLS
          ================================================= */}

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
                disabled={
                  isGenerating
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
                disabled={
                  isGenerating
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

            {/* =================================================
                LEAGUE LIST
            ================================================= */}

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
                (league) => {
                  const clubCount =
                    getLeagueClubs(
                      league,
                      initialClubs
                    ).length;

                  const isCup =
                    league.type ===
                    "cup";

                  return (
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
                        disabled={
                          isGenerating
                        }
                      />

                      <span>
                        {league.name}

                        {" "}

                        <small>
                          (
                          {isCup
                            ? "cup"
                            : league.type ||
                              "league"}
                          )
                        </small>

                        {" "}

                        <em>
                          ({clubCount}{" "}
                          clubs)
                        </em>

                        {isCup && (
                          <small
                            style={{
                              display:
                                "block",
                              marginTop:
                                "4px",
                            }}
                          >
                            1/32 → 1/16
                            → 1/8 →
                            1/4 → 1/2
                            → 3rd Place
                            → Final
                          </small>
                        )}
                      </span>
                    </label>
                  );
                }
              )}
            </div>
          </div>

          {/* =================================================
              STATUS
          ================================================= */}

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

                    Competitions processed:{" "}
                    <strong>
                      {
                        result.leaguesProcessed
                      }
                    </strong>

                    <br />

                    League fixtures:{" "}
                    <strong>
                      {
                        result.leagueFixtures
                      }
                    </strong>

                    <br />

                    Cup fixtures:{" "}
                    <strong>
                      {
                        result.cupFixtures
                      }
                    </strong>
                  </p>
                )}

                <p>
                  Fixtures are
                  stored
                  automatically
                  in Firestore.
                </p>

                {result?.cupFixtures >
                  0 && (
                  <p>
                    Cup bracket:
                    <br />
                    <strong>
                      1/32 → 1/16 →
                      1/8 → 1/4 →
                      1/2 → Third
                      Place → Final
                    </strong>
                  </p>
                )}
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
            id: item.id,
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
            id: item.id,
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
