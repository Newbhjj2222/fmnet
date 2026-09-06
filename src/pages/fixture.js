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
 * Season format expected from database:
 *
 * 2026/27
 * 2027/28
 *
 * The first year is used as seasonYear.
 */

/*
 * League matches:
 * Saturday / Sunday
 */
const LEAGUE_ALLOWED_DAYS = [6, 0];

/*
 * Cup matches:
 * Tuesday / Wednesday
 */
const CUP_ALLOWED_DAYS = [2, 3];

/*
 * Default kickoff.
 */
const DEFAULT_KICKOFF_HOUR = 15;
const DEFAULT_KICKOFF_MINUTE = 0;

/*
 * League:
 * one round every week.
 */
const MATCH_WEEKS_INTERVAL = 1;

/*
 * Cup:
 * group stage one round per week.
 */
const CUP_GROUP_WEEKS_INTERVAL = 1;

/*
 * Cup:
 * knockout one round every week.
 */
const CUP_KNOCKOUT_WEEKS_INTERVAL = 1;

/*
 * Every Cup group contains exactly 4 clubs.
 */
const CUP_GROUP_SIZE = 4;

/* =========================================================
   CUP STAGES
========================================================= */

const CUP_STAGES = {
  GROUP: {
    key: "group_stage",
    name: "Group Stage",
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
  if (!value) {
    return "";
  }

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

  d.setDate(
    d.getDate() + days
  );

  return d;
}

function addWeeks(date, weeks) {
  return addDays(
    date,
    weeks * 7
  );
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
  if (!date) {
    return "";
  }

  const d = cloneDate(date);

  return [
    d.getFullYear(),
    String(
      d.getMonth() + 1
    ).padStart(2, "0"),
    String(
      d.getDate()
    ).padStart(2, "0"),
  ].join("-");
}

/* =========================================================
   SAFE DATE
========================================================= */

function safeDate(value) {
  if (!value) {
    return null;
  }

  try {
    /*
     * Firestore Timestamp
     */
    if (
      value?.toDate &&
      typeof value.toDate === "function"
    ) {
      const date =
        value.toDate();

      return Number.isNaN(
        date.getTime()
      )
        ? null
        : date;
    }

    /*
     * JavaScript Date
     */
    if (
      value instanceof Date
    ) {
      return Number.isNaN(
        value.getTime()
      )
        ? null
        : value;
    }

    /*
     * Firestore timestamp-like
     */
    if (
      typeof value === "object" &&
      typeof value.seconds === "number"
    ) {
      const date = new Date(
        value.seconds * 1000
      );

      return Number.isNaN(
        date.getTime()
      )
        ? null
        : date;
    }

    /*
     * String / number
     */
    const date =
      new Date(value);

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date;
  } catch {
    return null;
  }
}

/* =========================================================
   DATABASE SEASON
========================================================= */

/*
 * Examples:
 *
 * "2026/27" -> 2026
 * "2027/28" -> 2027
 * "2026-27" -> 2026
 * 2026 -> 2026
 */

function parseSeasonYear(
  season
) {
  if (
    season === null ||
    season === undefined
  ) {
    return null;
  }

  const value =
    String(season).trim();

  if (!value) {
    return null;
  }

  const match =
    value.match(
      /^(\d{4})/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  return Number.isInteger(year)
    ? year
    : null;
}

/*
 * Keep exactly the season stored in database
 * whenever possible.
 */
function normalizeSeasonName(
  season
) {
  if (
    season === null ||
    season === undefined
  ) {
    return "";
  }

  const value =
    String(season).trim();

  if (!value) {
    return "";
  }

  const year =
    parseSeasonYear(value);

  if (!year) {
    return value;
  }

  /*
   * If database already contains:
   * 2026/27
   * preserve it.
   */
  if (
    /^\d{4}\/\d{2}$/.test(
      value
    )
  ) {
    return value;
  }

  /*
   * Convert:
   * 2026-27
   * 2026
   */
  return `${year}/${String(
    year + 1
  ).slice(-2)}`;
}

/* =========================================================
   LEAGUE HELPERS
========================================================= */

function getLeagueName(
  league
) {
  return (
    league?.name ||
    league?.leagueName ||
    league?.title ||
    "Unknown Competition"
  );
}

function getLeagueCountry(
  league
) {
  return (
    league?.countryName ||
    league?.country ||
    league?.nation ||
    league?.countryCode ||
    "International"
  );
}

function getLeagueId(
  club
) {
  return (
    club?.leagueId ||
    club?.league ||
    club?.competitionId ||
    null
  );
}

function getClubName(
  club
) {
  return (
    club?.name ||
    club?.clubName ||
    club?.shortName ||
    "Unknown Club"
  );
}

function getClubLogo(
  club
) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.badge ||
    ""
  );
}

function getClubOverall(
  club
) {
  return (
    Number(
      club?.overall
    ) ||
    Number(
      club?.rating
    ) ||
    Number(
      club?.teamOverall
    ) ||
    60
  );
}

/* =========================================================
   GET LEAGUE CLUBS
========================================================= */

function getLeagueClubs(
  league,
  clubs
) {
  if (
    !league ||
    !Array.isArray(clubs)
  ) {
    return [];
  }

  /*
   * Database structure:
   *
   * league.clubIds = [
   *   "club1",
   *   "club2"
   * ]
   */

  const configuredIds =
    league?.clubIds ||
    league?.teamIds ||
    [];

  if (
    Array.isArray(
      configuredIds
    ) &&
    configuredIds.length > 0
  ) {
    const ids =
      configuredIds
        .map((item) => {
          if (
            typeof item ===
            "string"
          ) {
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

    const selected =
      clubs.filter((club) =>
        ids.includes(
          club.id
        )
      );

    if (
      selected.length >= 2
    ) {
      return selected;
    }
  }

  /*
   * Fallback:
   * club.leagueId === league.id
   */

  return clubs.filter(
    (club) =>
      String(
        getLeagueId(club) ||
          ""
      ) ===
      String(
        league.id || ""
      )
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

function getCountryStartRule(
  country
) {
  const normalized =
    normalizeCountry(
      country
    );

  return (
    COUNTRY_START_RULES[
      normalized
    ] ||
    COUNTRY_START_RULES
      .international
  );
}

/* =========================================================
   EASTER
========================================================= */

function getEasterSunday(
  year
) {
  const a =
    year % 19;

  const b =
    Math.floor(
      year / 100
    );

  const c =
    year % 100;

  const d =
    Math.floor(
      b / 4
    );

  const e =
    b % 4;

  const f =
    Math.floor(
      (b + 8) / 25
    );

  const g =
    Math.floor(
      (b - f + 1) / 3
    );

  const h =
    (19 * a +
      b -
      d -
      g +
      15) %
    30;

  const i =
    Math.floor(
      c / 4
    );

  const k =
    c % 4;

  const l =
    (32 +
      2 * e +
      2 * i -
      h -
      k) %
    7;

  const m =
    Math.floor(
      (a +
        11 * h +
        22 * l) /
        451
    );

  const month =
    Math.floor(
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
    normalizeCountry(
      country
    );

  /*
   * General
   */

  holidays.push(
    makeDate(year, 0, 1)
  );

  holidays.push(
    makeDate(year, 4, 1)
  );

  holidays.push(
    makeDate(
      year,
      11,
      25
    )
  );

  holidays.push(
    makeDate(
      year,
      11,
      26
    )
  );

  /*
   * Rwanda
   */

  if (
    normalized === "rwanda"
  ) {
    holidays.push(
      makeDate(
        year,
        1,
        1
      ),
      makeDate(
        year,
        3,
        7
      ),
      makeDate(
        year,
        4,
        1
      ),
      makeDate(
        year,
        6,
        1
      ),
      makeDate(
        year,
        6,
        4
      ),
      makeDate(
        year,
        11,
        31
      )
    );
  }

  /*
   * Tanzania
   */

  if (
    normalized === "tanzania"
  ) {
    holidays.push(
      makeDate(
        year,
        0,
        12
      ),
      makeDate(
        year,
        3,
        7
      ),
      makeDate(
        year,
        3,
        26
      ),
      makeDate(
        year,
        7,
        8
      ),
      makeDate(
        year,
        11,
        9
      )
    );
  }

  /*
   * Kenya
   */

  if (
    normalized === "kenya"
  ) {
    holidays.push(
      makeDate(
        year,
        5,
        1
      ),
      makeDate(
        year,
        9,
        10
      ),
      makeDate(
        year,
        9,
        20
      ),
      makeDate(
        year,
        10,
        12
      )
    );
  }

  /*
   * Uganda
   */

  if (
    normalized === "uganda"
  ) {
    holidays.push(
      makeDate(
        year,
        0,
        26
      ),
      makeDate(
        year,
        2,
        8
      ),
      makeDate(
        year,
        5,
        3
      ),
      makeDate(
        year,
        9,
        9
      )
    );
  }

  /*
   * Burundi
   */

  if (
    normalized === "burundi"
  ) {
    holidays.push(
      makeDate(
        year,
        0,
        5
      ),
      makeDate(
        year,
        4,
        1
      ),
      makeDate(
        year,
        6,
        1
      ),
      makeDate(
        year,
        10,
        28
      )
    );
  }

  /*
   * France
   */

  if (
    normalized === "france"
  ) {
    holidays.push(
      makeDate(
        year,
        6,
        14
      ),
      makeDate(
        year,
        7,
        15
      ),
      makeDate(
        year,
        10,
        11
      )
    );
  }

  /*
   * Germany
   */

  if (
    normalized === "germany"
  ) {
    holidays.push(
      makeDate(
        year,
        9,
        3
      )
    );
  }

  /*
   * Italy
   */

  if (
    normalized === "italy"
  ) {
    holidays.push(
      makeDate(
        year,
        3,
        25
      ),
      makeDate(
        year,
        5,
        2
      ),
      makeDate(
        year,
        5,
        24
      ),
      makeDate(
        year,
        7,
        15
      ),
      makeDate(
        year,
        10,
        1
      )
    );
  }

  /*
   * Spain
   */

  if (
    normalized === "spain"
  ) {
    holidays.push(
      makeDate(
        year,
        9,
        12
      ),
      makeDate(
        year,
        11,
        6
      )
    );
  }

  /*
   * Brazil
   */

  if (
    normalized === "brazil"
  ) {
    holidays.push(
      makeDate(
        year,
        8,
        7
      ),
      makeDate(
        year,
        9,
        12
      ),
      makeDate(
        year,
        10,
        15
      )
    );
  }

  /*
   * South Africa
   */

  if (
    normalized ===
    "southafrica"
  ) {
    holidays.push(
      makeDate(
        year,
        3,
        27
      ),
      makeDate(
        year,
        5,
        16
      ),
      makeDate(
        year,
        8,
        24
      ),
      makeDate(
        year,
        11,
        16
      )
    );
  }

  /*
   * Nigeria
   */

  if (
    normalized === "nigeria"
  ) {
    holidays.push(
      makeDate(
        year,
        4,
        29
      ),
      makeDate(
        year,
        9,
        1
      )
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
    getEasterSunday(
      year
    );

  holidays.push(
    addDays(
      easter,
      -2
    )
  );

  holidays.push(
    addDays(
      easter,
      1
    )
  );

  const normalized =
    normalizeCountry(
      country
    );

  if (
    normalized ===
      "rwanda" ||
    normalized ===
      "uganda" ||
    normalized ===
      "kenya" ||
    normalized ===
      "tanzania"
  ) {
    holidays.push(
      addDays(
        easter,
        39
      )
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
    normalizeCountry(
      country
    );

  const dates =
    new Set();

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

    snapshot.forEach(
      (item) => {
        const data =
          item.data();

        const holidayCountry =
          normalizeCountry(
            data?.country ||
              data?.countryName ||
              ""
          );

        const appliesToAll =
          holidayCountry ===
            "" ||
          holidayCountry ===
            "all" ||
          holidayCountry ===
            "international";

        const appliesToCountry =
          holidayCountry ===
          normalized;

        if (
          !appliesToAll &&
          !appliesToCountry
        ) {
          return;
        }

        const date =
          safeDate(
            data?.date
          );

        if (date) {
          dates.add(
            isoDate(date)
          );
        }
      }
    );
  } catch (error) {
    console.warn(
      "[FIXTURE GENERATOR] Holiday load failed:",
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
  const dates =
    new Set();

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
  ].forEach(
    (date) => {
      dates.add(
        isoDate(date)
      );
    }
  );

  const firestore =
    await getFirestoreHolidays(
      year,
      country
    );

  firestore.forEach(
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
    startOfDay(
      startDate
    );

  const days =
    Array.isArray(
      allowedDays
    )
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
    return makeKickoff(
      date
    );
  }

  for (
    let attempt = 0;
    attempt < 365;
    attempt += 1
  ) {
    date =
      addDays(
        date,
        1
      );

    if (
      days.includes(
        date.getDay()
      ) &&
      !isHoliday(
        date,
        holidaySet
      )
    ) {
      return makeKickoff(
        date
      );
    }
  }

  return makeKickoff(
    startDate
  );
}

/* =========================================================
   GET DATABASE START DATE
========================================================= */

function getCompetitionStartDate(
  competition,
  seasonYear
) {
  /*
   * FIRST PRIORITY:
   *
   * league.startDate
   */

  const databaseStart =
    safeDate(
      competition?.startDate
    );

  if (
    databaseStart
  ) {
    /*
     * Use the exact database date.
     *
     * If database date has the season's
     * year, keep it.
     */

    if (
      databaseStart.getFullYear() ===
      seasonYear
    ) {
      return databaseStart;
    }

    /*
     * If the stored date has another year,
     * preserve month/day but put it into
     * the database season's first year.
     */

    return makeDate(
      seasonYear,
      databaseStart.getMonth(),
      databaseStart.getDate(),
      databaseStart.getHours(),
      databaseStart.getMinutes()
    );
  }

  /*
   * Fallback only if startDate is missing.
   */

  const country =
    getLeagueCountry(
      competition
    );

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
   ROUND ROBIN
========================================================= */

function buildRounds(
  clubs
) {
  if (
    !Array.isArray(
      clubs
    ) ||
    clubs.length < 2
  ) {
    return [];
  }

  const teams =
    [...clubs];

  /*
   * BYE for odd number.
   */

  if (
    teams.length % 2 !==
    0
  ) {
    teams.push(null);
  }

  const totalTeams =
    teams.length;

  const roundsPerLeg =
    totalTeams - 1;

  const firstLeg = [];

  let rotation =
    [...teams];

  for (
    let roundIndex = 0;
    roundIndex <
      roundsPerLeg;
    roundIndex += 1
  ) {
    const matches = [];

    for (
      let i = 0;
      i <
        totalTeams / 2;
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

      if (
        !teamA ||
        !teamB
      ) {
        continue;
      }

      if (
        roundIndex % 2 ===
        0
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

    const fixed =
      rotation[0];

    const rotating =
      rotation.slice(1);

    const last =
      rotating.pop();

    rotating.unshift(
      last
    );

    rotation = [
      fixed,
      ...rotating,
    ];
  }

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

function cleanIdPart(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      "-"
    )
    .replace(
      /[^a-zA-Z0-9_-]/g,
      ""
    );
}

function makeFixtureId({
  seasonYear,
  competitionId,
  type,
  round,
  position,
}) {
  return [
    "fixture",
    seasonYear,
    cleanIdPart(
      competitionId
    ),
    cleanIdPart(
      type
    ),
    cleanIdPart(
      round
    ),
    cleanIdPart(
      position
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
  season,
  round,
  date,
}) {
  const id =
    makeFixtureId({
      seasonYear,
      competitionId:
        league.id,
      type: "league",
      round,
      position:
        `${home.id}_${away.id}`,
    });

  return {
    id,

    type: "league",

    generated: true,

    generatedBy:
      "automatic-fixture-generator",

    seasonYear,

    season,

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
      getClubName(
        home
      ),

    homeLogo:
      getClubLogo(
        home
      ),

    awayClubId:
      away.id,

    awayClubName:
      getClubName(
        away
      ),

    awayLogo:
      getClubLogo(
        away
      ),

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
      getClubOverall(
        home
      ),

    awayOverall:
      getClubOverall(
        away
      ),

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
  season,
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

  const holidaySets =
    new Map();

  async function getHolidays(
    year
  ) {
    if (
      holidaySets.has(
        year
      )
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

  if (
    !rounds.length
  ) {
    return [];
  }

  /*
   * IMPORTANT:
   *
   * Start from database startDate.
   */

  let currentMatchDay =
    getCompetitionStartDate(
      league,
      seasonYear
    );

  let holidaySet =
    await getHolidays(
      currentMatchDay.getFullYear()
    );

  currentMatchDay =
    findNextMatchDay(
      currentMatchDay,
      holidaySet,
      LEAGUE_ALLOWED_DAYS
    );

  const fixtures = [];

  for (
    let roundIndex = 0;
    roundIndex <
      rounds.length;
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
        LEAGUE_ALLOWED_DAYS
      );

    rounds[
      roundIndex
    ].forEach(
      ({
        home,
        away,
      }) => {
        fixtures.push(
          createLeagueFixture({
            league,
            home,
            away,
            seasonYear,
            season,
            round,
            date:
              currentMatchDay,
          })
        );
      }
    );

    const nextCandidate =
      addWeeks(
        currentMatchDay,
        MATCH_WEEKS_INTERVAL
      );

    const nextHolidaySet =
      await getHolidays(
        nextCandidate.getFullYear()
      );

    currentMatchDay =
      findNextMatchDay(
        nextCandidate,
        nextHolidaySet,
        LEAGUE_ALLOWED_DAYS
      );
  }

  return fixtures;
}

/* =========================================================
   CUP GROUP CREATION
========================================================= */

function createCupGroups(
  clubs
) {
  if (
    !Array.isArray(clubs) ||
    clubs.length <
      CUP_GROUP_SIZE
  ) {
    return [];
  }

  /*
   * Only complete groups of 4.
   *
   * Example:
   *
   * 64 clubs
   * = 16 groups
   *
   * 48 clubs
   * = 12 groups
   *
   * 32 clubs
   * = 8 groups
   */

  const completeClubCount =
    Math.floor(
      clubs.length /
        CUP_GROUP_SIZE
    ) *
    CUP_GROUP_SIZE;

  const usableClubs =
    clubs.slice(
      0,
      completeClubCount
    );

  const groups = [];

  for (
    let i = 0;
    i <
      usableClubs.length;
    i += CUP_GROUP_SIZE
  ) {
    const groupIndex =
      groups.length;

    const letter =
      String.fromCharCode(
        65 + groupIndex
      );

    groups.push({
      key: `group_${letter.toLowerCase()}`,

      name: `Group ${letter}`,

      letter,

      clubs:
        usableClubs.slice(
          i,
          i +
            CUP_GROUP_SIZE
        ),
    });
  }

  return groups;
}

/* =========================================================
   CREATE CUP GROUP FIXTURE
========================================================= */

function createCupGroupFixture({
  league,
  seasonYear,
  season,
  group,
  round,
  position,
  home,
  away,
  date,
}) {
  const id =
    makeFixtureId({
      seasonYear,
      competitionId:
        league.id,
      type: "cup",
      round:
        `group_${group.letter}`,
      position:
        `${round}_${position}`,
    });

  return {
    id,

    type: "cup",

    generated: true,

    generatedBy:
      "automatic-cup-fixture-generator",

    seasonYear,

    season,

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

    stage:
      CUP_STAGES.GROUP.key,

    stageName:
      CUP_STAGES.GROUP.name,

    round,

    roundName:
      `Group ${group.letter} - Round ${round}`,

    groupKey:
      group.key,

    groupName:
      group.name,

    groupLetter:
      group.letter,

    bracketPosition:
      position,

    homeClubId:
      home.id,

    homeClubName:
      getClubName(
        home
      ),

    homeLogo:
      getClubLogo(
        home
      ),

    awayClubId:
      away.id,

    awayClubName:
      getClubName(
        away
      ),

    awayLogo:
      getClubLogo(
        away
      ),

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
      getClubOverall(
        home
      ),

    awayOverall:
      getClubOverall(
        away
      ),

    /*
     * Used later to calculate group standings.
     */

    countsForGroupStandings:
      true,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp(),
  };
}

/* =========================================================
   CREATE KNOCKOUT FIXTURE
========================================================= */

function createCupKnockoutFixture({
  league,
  seasonYear,
  season,
  stage,
  round,
  position,
  date,
  homeSource,
  awaySource,
}) {
  const id =
    makeFixtureId({
      seasonYear,
      competitionId:
        league.id,
      type: "cup",
      round: stage,
      position,
    });

  return {
    id,

    type: "cup",

    generated: true,

    generatedBy:
      "automatic-cup-fixture-generator",

    seasonYear,

    season,

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

    stage,

    stageName:
      stage ===
      CUP_STAGES.ROUND_OF_32.key
        ? CUP_STAGES.ROUND_OF_32.name
        : stage ===
          CUP_STAGES.ROUND_OF_16.key
        ? CUP_STAGES.ROUND_OF_16.name
        : stage ===
          CUP_STAGES.QUARTER_FINAL.key
        ? CUP_STAGES.QUARTER_FINAL.name
        : stage ===
          CUP_STAGES.SEMI_FINAL.key
        ? CUP_STAGES.SEMI_FINAL.name
        : CUP_STAGES.FINAL.name,

    round,

    bracketPosition:
      position,

    /*
     * Teams are initially TBD because
     * group standings are not known yet.
     */

    homeClubId: null,

    homeClubName:
      homeSource?.label ||
      "TBD",

    homeLogo: "",

    awayClubId: null,

    awayClubName:
      awaySource?.label ||
      "TBD",

    awayLogo: "",

    /*
     * Source information.
     *
     * Example:
     *
     * Group A 1st
     * Group B 2nd
     */

    homeQualification:
      homeSource || null,

    awayQualification:
      awaySource || null,

    homeSlot:
      "group_position",

    awaySlot:
      "group_position",

    stadium:
      "Club Stadium",

    date:
      date.toISOString(),

    /*
     * Pending until qualified clubs
     * are known.
     */

    status:
      "pending",

    result: null,

    homeScore: null,

    awayScore: null,

    homeOverall: null,

    awayOverall: null,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp(),
  };
}

/* =========================================================
   CUP GROUP MATCHES
========================================================= */

/*
 * Four teams in one group.
 *
 * Group A:
 *
 * A vs B
 * A vs C
 * A vs D
 * B vs C
 * B vs D
 * C vs D
 *
 * = 6 matches
 */

function buildGroupMatches(
  group
) {
  const matches = [];

  const teams =
    group.clubs;

  for (
    let i = 0;
    i < teams.length;
    i += 1
  ) {
    for (
      let j = i + 1;
      j < teams.length;
      j += 1
    ) {
      matches.push({
        home:
          teams[i],
        away:
          teams[j],
      });
    }
  }

  return matches;
}

/* =========================================================
   CUP GROUP FIXTURES GENERATOR
========================================================= */

async function generateCupGroupStage({
  league,
  groups,
  seasonYear,
  season,
  getHolidays,
}) {
  const fixtures = [];

  /*
   * Start exactly from database startDate.
   */

  let currentMatchDay =
    getCompetitionStartDate(
      league,
      seasonYear
    );

  let holidaySet =
    await getHolidays(
      currentMatchDay.getFullYear()
    );

  currentMatchDay =
    findNextMatchDay(
      currentMatchDay,
      holidaySet,
      CUP_ALLOWED_DAYS
    );

  /*
   * Generate 6 matches per group.
   *
   * We schedule each round on a separate
   * cup matchday.
   */

  const groupRounds =
    groups.map(
      (group) => ({
        group,
        matches:
          buildGroupMatches(
            group
          ),
      })
    );

  /*
   * Each group has 6 matches.
   *
   * We organize them in 3 rounds:
   *
   * Round 1: A-B, C-D
   * Round 2: A-C, B-D
   * Round 3: A-D, B-C
   */

  for (
    const groupData of groupRounds
  ) {
    const {
      group,
      matches,
    } = groupData;

    const roundPairs = [
      [
        matches[0],
        matches[5],
      ],
      [
        matches[1],
        matches[4],
      ],
      [
        matches[2],
        matches[3],
      ],
    ];

    for (
      let roundIndex = 0;
      roundIndex <
        roundPairs.length;
      roundIndex += 1
    ) {
      const pair =
        roundPairs[
          roundIndex
        ];

      const round =
        roundIndex + 1;

      const year =
        currentMatchDay.getFullYear();

      holidaySet =
        await getHolidays(
          year
        );

      currentMatchDay =
        findNextMatchDay(
          currentMatchDay,
          holidaySet,
          CUP_ALLOWED_DAYS
        );

      pair.forEach(
        (match, index) => {
          if (
            !match?.home ||
            !match?.away
          ) {
            return;
          }

          fixtures.push(
            createCupGroupFixture({
              league,
              seasonYear,
              season,
              group,
              round,
              position:
                index + 1,
              home:
                match.home,
              away:
                match.away,
              date:
                currentMatchDay,
            })
          );
        }
      );

      const nextCandidate =
        addWeeks(
          currentMatchDay,
          CUP_GROUP_WEEKS_INTERVAL
        );

      const nextHolidaySet =
        await getHolidays(
          nextCandidate.getFullYear()
        );

      currentMatchDay =
        findNextMatchDay(
          nextCandidate,
          nextHolidaySet,
          CUP_ALLOWED_DAYS
        );
    }
  }

  return {
    fixtures,
    lastMatchDay:
      currentMatchDay,
  };
}

/* =========================================================
   CUP KNOCKOUT PAIRINGS
========================================================= */

/*
 * If groups are:
 *
 * A B C D E F ...
 *
 * Top 2 qualify.
 *
 * Round of 32:
 *
 * A1 vs B2
 * B1 vs A2
 * C1 vs D2
 * D1 vs C2
 *
 * E1 vs F2
 * F1 vs E2
 *
 * etc.
 */

function buildInitialKnockoutSources(
  groups
) {
  const sources = [];

  /*
   * Groups must be paired.
   */

  for (
    let i = 0;
    i + 1 <
      groups.length;
    i += 2
  ) {
    const groupA =
      groups[i];

    const groupB =
      groups[i + 1];

    sources.push({
      home: {
        type:
          "group_position",

        groupKey:
          groupA.key,

        groupName:
          groupA.name,

        position: 1,

        label:
          `${groupA.name} 1st`,
      },

      away: {
        type:
          "group_position",

        groupKey:
          groupB.key,

        groupName:
          groupB.name,

        position: 2,

        label:
          `${groupB.name} 2nd`,
      },
    });

    sources.push({
      home: {
        type:
          "group_position",

        groupKey:
          groupB.key,

        groupName:
          groupB.name,

        position: 1,

        label:
          `${groupB.name} 1st`,
      },

      away: {
        type:
          "group_position",

        groupKey:
          groupA.key,

        groupName:
          groupA.name,

        position: 2,

        label:
          `${groupA.name} 2nd`,
      },
    });
  }

  return sources;
}

/* =========================================================
   CUP KNOCKOUT
========================================================= */

async function generateCupKnockout({
  league,
  groups,
  seasonYear,
  season,
  getHolidays,
  initialLastMatchDay,
}) {
  const fixtures = [];

  /*
   * Number of qualified teams:
   *
   * 16 groups x 2 = 32
   */

  const qualifiedTeams =
    groups.length * 2;

  if (
    qualifiedTeams <
    2
  ) {
    return {
      fixtures,
      lastMatchDay:
        initialLastMatchDay,
    };
  }

  /*
   * Current date starts after
   * group stage.
   */

  let currentMatchDay =
    initialLastMatchDay;

  /*
   * Initial Round of 32.
   */

  let stageSources =
    buildInitialKnockoutSources(
      groups
    );

  /*
   * If we have 32 teams:
   *
   * 16 matches
   */

  let stage =
    CUP_STAGES.ROUND_OF_32;

  let roundNumber = 1;

  while (
    stageSources.length >=
    1
  ) {
    const candidate =
      addWeeks(
        currentMatchDay,
        CUP_KNOCKOUT_WEEKS_INTERVAL
      );

    const holidaySet =
      await getHolidays(
        candidate.getFullYear()
      );

    currentMatchDay =
      findNextMatchDay(
        candidate,
        holidaySet,
        CUP_ALLOWED_DAYS
      );

    const currentFixtures = [];

    for (
      let i = 0;
      i <
        stageSources.length;
      i += 1
    ) {
      const source =
        stageSources[i];

      const fixture =
        createCupKnockoutFixture({
          league,
          seasonYear,
          season,
          stage:
            stage.key,
          round:
            roundNumber,
          position:
            i + 1,
          date:
            currentMatchDay,
          homeSource:
            source.home,
          awaySource:
            source.away,
        });

      currentFixtures.push(
        fixture
      );

      fixtures.push(
        fixture
      );
    }

    /*
     * Final stage.
     */

    if (
      stage.key ===
      CUP_STAGES.FINAL.key
    ) {
      break;
    }

    /*
     * The next stage has half
     * the number of matches.
     *
     * We do not know actual winners yet.
     *
     * Therefore create winner source
     * references.
     */

    const nextSources =
      [];

    for (
      let i = 0;
      i <
        currentFixtures.length;
      i += 2
    ) {
      const first =
        currentFixtures[i];

      const second =
        currentFixtures[
          i + 1
        ];

      if (!second) {
        break;
      }

      nextSources.push({
        home: {
          type: "winner",

          sourceFixtureId:
            first.id,

          label:
            `Winner of ${first.id}`,
        },

        away: {
          type: "winner",

          sourceFixtureId:
            second.id,

          label:
            `Winner of ${second.id}`,
        },
      });
    }

    stageSources =
      nextSources;

    /*
     * Move stage.
     */

    if (
      stage.key ===
      CUP_STAGES.ROUND_OF_32.key
    ) {
      stage =
        CUP_STAGES.ROUND_OF_16;
    } else if (
      stage.key ===
      CUP_STAGES.ROUND_OF_16.key
    ) {
      stage =
        CUP_STAGES.QUARTER_FINAL;
    } else if (
      stage.key ===
      CUP_STAGES.QUARTER_FINAL.key
    ) {
      stage =
        CUP_STAGES.SEMI_FINAL;
    } else if (
      stage.key ===
      CUP_STAGES.SEMI_FINAL.key
    ) {
      stage =
        CUP_STAGES.FINAL;
    } else {
      break;
    }

    roundNumber += 1;
  }

  /*
   * Connect knockout fixtures
   * to their next fixtures.
   */

  const knockoutFixtures =
    fixtures.filter(
      (fixture) =>
        fixture.stage !==
        CUP_STAGES.GROUP.key
    );

  for (
    let i = 0;
    i <
      knockoutFixtures.length;
    i += 1
  ) {
    const current =
      knockoutFixtures[i];

    const next =
      knockoutFixtures.find(
        (fixture) => {
          if (
            fixture.stage ===
            current.stage
          ) {
            return false;
          }

          const home =
            fixture.homeQualification;

          const away =
            fixture.awayQualification;

          return (
            home?.sourceFixtureId ===
              current.id ||
            away?.sourceFixtureId ===
              current.id
          );
        }
      );

    if (next) {
      current.nextFixtureId =
        next.id;
    }
  }

  return {
    fixtures,
    lastMatchDay:
      currentMatchDay,
  };
}

/* =========================================================
   GENERATE COMPLETE CUP
========================================================= */

async function generateCupFixtures({
  league,
  clubs,
  seasonYear,
  season,
}) {
  const cupClubs =
    getLeagueClubs(
      league,
      clubs
    );

  /*
   * At least 4 teams required
   * for one group.
   */

  if (
    cupClubs.length <
    CUP_GROUP_SIZE
  ) {
    return [];
  }

  /*
   * Create groups.
   */

  const groups =
    createCupGroups(
      cupClubs
    );

  if (
    groups.length < 1
  ) {
    return [];
  }

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
      holidaySets.has(
        year
      )
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
   * GROUP STAGE
   */

  const groupResult =
    await generateCupGroupStage({
      league,
      groups,
      seasonYear,
      season,
      getHolidays,
    });

  /*
   * KNOCKOUT
   */

  const knockoutResult =
    await generateCupKnockout({
      league,
      groups,
      seasonYear,
      season,
      getHolidays,
      initialLastMatchDay:
        groupResult.lastMatchDay,
    });

  return [
    ...groupResult.fixtures,
    ...knockoutResult.fixtures,
  ];
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
   DELETE EXISTING FIXTURES
========================================================= */

/*
 * IMPORTANT:
 *
 * The user requested that existing fixtures
 * be replaced by new fixtures.
 *
 * Therefore:
 *
 * 1. Find matches belonging to this league
 * 2. Match season
 * 3. Delete them
 * 4. Generate fresh fixtures
 */

async function deleteExistingFixturesForCompetition({
  leagueId,
  seasonYear,
}) {
  const matchesQuery =
    query(
      collection(
        db,
        "matches"
      ),
      where(
        "leagueId",
        "==",
        leagueId
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

  if (
    snapshot.empty
  ) {
    return 0;
  }

  const refs =
    snapshot.docs.map(
      (item) =>
        item.ref
    );

  let deleted = 0;

  const chunks =
    chunkArray(
      refs,
      FIRESTORE_BATCH_SIZE
    );

  for (
    const chunk of chunks
  ) {
    const batch =
      writeBatch(db);

    chunk.forEach(
      (ref) => {
        batch.delete(
          ref
        );

        deleted += 1;
      }
    );

    await batch.commit();
  }

  return deleted;
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
   GENERATE ONE COMPETITION
========================================================= */

async function generateCompetition({
  league,
  clubs,
}) {
  /*
   * READ SEASON FROM DATABASE
   */

  const databaseSeason =
    league?.season;

  const season =
    normalizeSeasonName(
      databaseSeason
    );

  if (!season) {
    return {
      skipped: true,

      reason:
        "Season is missing",

      generated: 0,

      deleted: 0,
    };
  }

  const seasonYear =
    parseSeasonYear(
      season
    );

  if (!seasonYear) {
    return {
      skipped: true,

      reason:
        `Invalid season: ${databaseSeason}`,

      generated: 0,

      deleted: 0,
    };
  }

  /*
   * READ CLUBS
   */

  const leagueClubs =
    getLeagueClubs(
      league,
      clubs
    );

  if (
    leagueClubs.length < 2
  ) {
    return {
      skipped: true,

      reason:
        "Competition has fewer than 2 clubs",

      generated: 0,

      deleted: 0,
    };
  }

  /*
   * DELETE OLD FIXTURES
   *
   * This is the replacement mechanism.
   */

  const deleted =
    await deleteExistingFixturesForCompetition({
      leagueId:
        league.id,

      seasonYear,
    });

  /*
   * GENERATE NEW FIXTURES
   */

  let fixtures = [];

  if (
    league.type ===
    "cup"
  ) {
    fixtures =
      await generateCupFixtures({
        league,
        clubs,
        seasonYear,
        season,
      });
  } else {
    fixtures =
      await generateLeagueFixtures({
        league,
        clubs,
        seasonYear,
        season,
      });
  }

  /*
   * SAVE NEW FIXTURES
   */

  const generated =
    await saveFixtures(
      fixtures
    );

  /*
   * Count cup group fixtures.
   */

  const cupGroupFixtures =
    fixtures.filter(
      (fixture) =>
        fixture.type ===
          "cup" &&
        fixture.stage ===
          "group_stage"
    ).length;

  const cupKnockoutFixtures =
    fixtures.filter(
      (fixture) =>
        fixture.type ===
          "cup" &&
        fixture.stage !==
          "group_stage"
    ).length;

  return {
    skipped: false,

    leagueId:
      league.id,

    leagueName:
      getLeagueName(
        league
      ),

    type:
      league.type ||
      "league",

    season,

    seasonYear,

    startDate:
      league.startDate ||
      null,

    clubs:
      leagueClubs.length,

    deleted,

    generated,

    leagueFixtures:
      league.type ===
      "cup"
        ? 0
        : generated,

    cupFixtures:
      league.type ===
      "cup"
        ? generated
        : 0,

    cupGroupFixtures,

    cupKnockoutFixtures,
  };
}

/* =========================================================
   GENERATE SELECTED COMPETITIONS
========================================================= */

async function generateSeasonFixtures({
  leagueIds,
  leagues,
  clubs,
}) {
  if (
    !Array.isArray(
      leagueIds
    ) ||
    leagueIds.length ===
      0 ||
    !Array.isArray(
      leagues
    ) ||
    !Array.isArray(
      clubs
    )
  ) {
    return {
      generated: 0,

      deleted: 0,

      competitionsProcessed: 0,

      leagueFixtures: 0,

      cupFixtures: 0,

      cupGroupFixtures: 0,

      cupKnockoutFixtures: 0,

      competitions: [],
    };
  }

  let generated = 0;
  let deleted = 0;

  let competitionsProcessed = 0;

  let leagueFixtures = 0;
  let cupFixtures = 0;

  let cupGroupFixtures = 0;
  let cupKnockoutFixtures = 0;

  const competitions = [];

  /*
   * Each competition gets its own
   * database season.
   */

  for (
    const leagueId of
      leagueIds
  ) {
    const league =
      leagues.find(
        (item) =>
          item.id ===
          leagueId
      );

    if (!league) {
      continue;
    }

    try {
      const result =
        await generateCompetition({
          league,
          clubs,
        });

      if (
        result.skipped
      ) {
        competitions.push(
          result
        );

        continue;
      }

      competitionsProcessed +=
        1;

      generated +=
        result.generated;

      deleted +=
        result.deleted;

      leagueFixtures +=
        result.leagueFixtures;

      cupFixtures +=
        result.cupFixtures;

      cupGroupFixtures +=
        result.cupGroupFixtures;

      cupKnockoutFixtures +=
        result.cupKnockoutFixtures;

      competitions.push(
        result
      );
    } catch (error) {
      console.error(
        "[COMPETITION GENERATION ERROR]",
        league?.name,
        error
      );

      competitions.push({
        skipped: true,

        leagueId:
          league.id,

        leagueName:
          getLeagueName(
            league
          ),

        reason:
          error?.message ||
          "Generation failed",
      });
    }
  }

  return {
    generated,

    deleted,

    competitionsProcessed,

    leagueFixtures,

    cupFixtures,

    cupGroupFixtures,

    cupKnockoutFixtures,

    competitions,
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
  ] = useState(
    "waiting"
  );

  const [
    message,
    setMessage,
  ] = useState(
    "Select competitions and click Generate."
  );

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
            "Reading seasons and start dates from database..."
          );

          const generationResult =
            await generateSeasonFixtures({
              leagueIds:
                selectedLeagueIds,

              leagues:
                initialLeagues,

              clubs:
                initialClubs,
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
              `${generationResult.generated} new fixtures generated successfully.`
            );
          } else {
            setMessage(
              "No fixtures were generated."
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

  const selectAll =
    () => {
      setSelectedLeagueIds(
        initialLeagues.map(
          (league) =>
            league.id
        )
      );
    };

  const clearAll =
    () => {
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

              <p>
                Seasons and start dates
                are read directly from
                Firestore.
              </p>
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
                COMPETITION LIST
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
                  competitions first.
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

                  const season =
                    normalizeSeasonName(
                      league.season
                    );

                  const startDate =
                    safeDate(
                      league.startDate
                    );

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
                        <strong>
                          {
                            league.name
                          }
                        </strong>

                        {" "}

                        <small>
                          (
                          {isCup
                            ? "cup"
                            : "league"}
                          )
                        </small>

                        {" "}

                        <em>
                          ({clubCount}{" "}
                          clubs)
                        </em>

                        <small
                          style={{
                            display:
                              "block",
                            marginTop:
                              "5px",
                          }}
                        >
                          Season:{" "}
                          {season ||
                            "Not set"}
                        </small>

                        <small
                          style={{
                            display:
                              "block",
                            marginTop:
                              "3px",
                          }}
                        >
                          Start:{" "}
                          {startDate
                            ? isoDate(
                                startDate
                              )
                            : "Not set"}
                        </small>

                        {isCup && (
                          <small
                            style={{
                              display:
                                "block",
                              marginTop:
                                "5px",
                            }}
                          >
                            Groups →
                            Top 2 →
                            1/16 →
                            1/8 →
                            1/4 →
                            1/2 →
                            Final
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

                {result && (
                  <p>
                    Old fixtures
                    replaced:{" "}
                    <strong>
                      {
                        result.deleted
                      }
                    </strong>

                    <br />

                    New fixtures:{" "}
                    <strong>
                      {
                        result.generated
                      }
                    </strong>

                    <br />

                    Competitions
                    processed:{" "}
                    <strong>
                      {
                        result.competitionsProcessed
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

                    <br />

                    Cup group
                    fixtures:{" "}
                    <strong>
                      {
                        result.cupGroupFixtures
                      }
                    </strong>

                    <br />

                    Cup knockout
                    fixtures:{" "}
                    <strong>
                      {
                        result.cupKnockoutFixtures
                      }
                    </strong>
                  </p>
                )}

                {result?.competitions?.map(
                  (
                    competition,
                    index
                  ) => (
                    <div
                      key={
                        competition.leagueId ||
                        index
                      }
                      style={{
                        marginTop:
                          "15px",
                      }}
                    >
                      {competition.skipped ? (
                        <p>
                          <strong>
                            {
                              competition.leagueName
                            }
                          </strong>
                          <br />
                          {
                            competition.reason
                          }
                        </p>
                      ) : (
                        <p>
                          <strong>
                            {
                              competition.leagueName
                            }
                          </strong>

                          <br />

                          Season:{" "}
                          {
                            competition.season
                          }

                          <br />

                          Start date:{" "}
                          {competition.startDate
                            ? isoDate(
                                safeDate(
                                  competition.startDate
                                )
                              )
                            : "Fallback"}

                          <br />

                          Replaced:{" "}
                          {
                            competition.deleted
                          }

                          <br />

                          Generated:{" "}
                          {
                            competition.generated
                          }

                          {competition.type ===
                            "cup" && (
                            <>
                              <br />
                              Groups:{" "}
                              {
                                competition.cupGroupFixtures
                              }

                              <br />
                              Knockout:{" "}
                              {
                                competition.cupKnockoutFixtures
                              }
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  )
                )}

                <p>
                  Fixtures are stored
                  automatically in the
                  <strong>
                    {" "}
                    matches
                  </strong>{" "}
                  collection.
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
