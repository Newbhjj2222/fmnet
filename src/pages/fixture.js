// pages/fixture.js

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import styles from './fixture.module.css';

/* =========================================================
   CONFIG
========================================================= */

const MAX_LEAGUES = 500;
const MAX_CLUBS = 5000;

const FIRESTORE_BATCH_SIZE = 450;

/*
 * Football season:
 * 2026/27 = starts in 2026
 * 2027/28 = starts in 2027
 */

const SEASON_START_MONTH = 6; // July

/*
 * League must start between:
 *
 * August 1
 * and
 * September 30
 */

const EARLIEST_LEAGUE_START_MONTH = 7; // August
const EARLIEST_LEAGUE_START_DAY = 1;

const LATEST_LEAGUE_START_MONTH = 8; // September
const LATEST_LEAGUE_START_DAY = 30;

/*
 * One league round per weekend.
 */

const MATCH_WEEKS_INTERVAL = 1;

/*
 * Default kickoff.
 */

const DEFAULT_KICKOFF_HOUR = 15;
const DEFAULT_KICKOFF_MINUTE = 0;

/* =========================================================
   COUNTRY NORMALIZATION
========================================================= */

function normalizeCountry(value) {
  if (!value) return '';

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[áàäâã]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöôõ]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '');
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
  if (!date) return '';

  const d = cloneDate(date);

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function safeDate(value) {
  if (!value) return null;

  try {
    if (
      value?.toDate &&
      typeof value.toDate === 'function'
    ) {
      const date = value.toDate();

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }

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

function getSeasonYear(date) {
  if (!date) {
    date = new Date();
  }

  return date.getMonth() >= SEASON_START_MONTH
    ? date.getFullYear()
    : date.getFullYear() - 1;
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
    'Unknown League'
  );
}

function getLeagueCountry(league) {
  return (
    league?.country ||
    league?.countryName ||
    league?.nation ||
    league?.countryCode ||
    'International'
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
    'Unknown Club'
  );
}

function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.badge ||
    ''
  );
}

/* =========================================================
   GET CLUBS OF LEAGUE
========================================================= */

function getLeagueClubs(
  league,
  clubs
) {
  if (!league || !Array.isArray(clubs)) {
    return [];
  }

  /*
   * First try explicit club IDs
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
        if (typeof item === 'string') {
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
        ids.includes(club.id)
      );

    if (selected.length >= 2) {
      return selected;
    }
  }

  /*
   * Otherwise use club.leagueId
   */

  return clubs.filter(
    (club) =>
      getLeagueId(club) === league.id
  );
}

/* =========================================================
   COUNTRY START DATE
========================================================= */

/*
 * League start window:
 *
 * August -> September
 *
 * Different countries receive different
 * preferred starting dates.
 *
 * These are DEFAULTS.
 *
 * If a league document has:
 *
 * startDate
 *
 * then that date takes priority.
 */

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
    normalizeCountry(country);

  return (
    COUNTRY_START_RULES[
      normalized
    ] ||
    COUNTRY_START_RULES
      .international
  );
}

/* =========================================================
   EASTER CALCULATION
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
    ((h + l - 7 * m + 114) % 31) +
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

/*
 * Izi ni holidays rusange tuzi.
 *
 * Kandi system iracyakira holidays
 * zibitswe muri Firestore.
 */

function getFixedHolidayDates(
  year,
  country
) {
  const holidays = [];

  const normalized =
    normalizeCountry(country);

  /*
   * New Year
   */

  holidays.push(
    makeDate(year, 0, 1)
  );

  /*
   * Labour Day
   */

  holidays.push(
    makeDate(year, 4, 1)
  );

  /*
   * Christmas
   */

  holidays.push(
    makeDate(year, 11, 25)
  );

  /*
   * Boxing Day.
   */

  holidays.push(
    makeDate(year, 11, 26)
  );

  /*
   * Rwanda
   */

  if (
    normalized === 'rwanda'
  ) {
    holidays.push(
      makeDate(year, 1, 1), // Heroes Day
      makeDate(year, 6, 4), // Liberation Day
      makeDate(year, 6, 1), // Independence Day
      makeDate(year, 4, 17), // Genocide Memorial Day
      makeDate(year, 12, 31) // Last day
    );
  }

  /*
   * Tanzania
   */

  if (
    normalized === 'tanzania'
  ) {
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

  if (
    normalized === 'kenya'
  ) {
    holidays.push(
      makeDate(year, 5, 1),
      makeDate(year, 9, 20),
      makeDate(year, 9, 10),
      makeDate(year, 10, 12)
    );
  }

  /*
   * Uganda
   */

  if (
    normalized === 'uganda'
  ) {
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

  if (
    normalized === 'burundi'
  ) {
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

  if (
    normalized === 'france'
  ) {
    holidays.push(
      makeDate(year, 6, 14),
      makeDate(year, 7, 15),
      makeDate(year, 10, 11)
    );
  }

  /*
   * Germany
   */

  if (
    normalized === 'germany'
  ) {
    holidays.push(
      makeDate(year, 9, 3)
    );
  }

  /*
   * Italy
   */

  if (
    normalized === 'italy'
  ) {
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

  if (
    normalized === 'spain'
  ) {
    holidays.push(
      makeDate(year, 9, 12),
      makeDate(year, 11, 6)
    );
  }

  /*
   * Brazil
   */

  if (
    normalized === 'brazil'
  ) {
    holidays.push(
      makeDate(year, 8, 7),
      makeDate(year, 9, 12),
      makeDate(year, 10, 15)
    );
  }

  /*
   * South Africa
   */

  if (
    normalized === 'southafrica'
  ) {
    holidays.push(
      makeDate(year, 3, 27),
      makeDate(year, 5, 16),
      makeDate(year, 8, 24),
      makeDate(year, 12, 16)
    );
  }

  /*
   * Nigeria
   */

  if (
    normalized === 'nigeria'
  ) {
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
    normalized === 'rwanda' ||
    normalized === 'uganda' ||
    normalized === 'kenya' ||
    normalized === 'tanzania'
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

/*
 * Expected structure:
 *
 * holidays/{id}
 *
 * {
 *   date: "2026-08-15",
 *   country: "Rwanda",
 *   name: "Holiday",
 *   year: 2026
 * }
 *
 * country can also be:
 * "all"
 * "international"
 */

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
          'holidays'
        ),
        where(
          'year',
          '==',
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
              ''
          );

        const appliesToAll =
          holidayCountry === '' ||
          holidayCountry === 'all' ||
          holidayCountry ===
            'international';

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
      '[FIXTURE GENERATOR] Holiday collection could not be loaded:',
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

  /*
   * Add Firestore custom holidays.
   */

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
   WEEKEND HELPERS
========================================================= */

function isSaturday(date) {
  return date.getDay() === 6;
}

function isSunday(date) {
  return date.getDay() === 0;
}

function isWeekend(date) {
  return (
    isSaturday(date) ||
    isSunday(date)
  );
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
   FIND VALID WEEKEND
========================================================= */

/*
 * Match ntabwo ijya:
 *
 * Monday
 * Tuesday
 * Wednesday
 * Thursday
 * Friday
 *
 * kandi ntabwo ijya kuri holiday.
 *
 * Iyo Saturday ari holiday,
 * igerageza Sunday.
 *
 * Iyo Saturday na Sunday ari holiday,
 * ijya weekend ikurikira.
 */

function findNextValidWeekendDate(
  startDate,
  holidaySet
) {
  let date =
    startOfDay(startDate);

  /*
   * Move forward until Saturday.
   */

  while (!isWeekend(date)) {
    date = addDays(date, 1);
  }

  /*
   * Search maximum 100 weekends.
   */

  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    const saturday =
      startOfDay(date);

    const sunday =
      addDays(saturday, 1);

    /*
     * Saturday available
     */

    if (
      !isHoliday(
        saturday,
        holidaySet
      )
    ) {
      return makeKickoff(
        saturday
      );
    }

    /*
     * Sunday available
     */

    if (
      !isHoliday(
        sunday,
        holidaySet
      )
    ) {
      return makeKickoff(
        sunday
      );
    }

    /*
     * Entire weekend blocked.
     */

    date = addDays(
      saturday,
      7
    );
  }

  /*
   * Safety fallback.
   */

  return makeKickoff(
    date
  );
}

/* =========================================================
   COUNTRY START DATE
========================================================= */

function getPreferredLeagueStart(
  league,
  seasonYear
) {
  /*
   * If admin explicitly set startDate
   * on league, use it.
   */

  const customDate =
    safeDate(
      league?.startDate
    );

  if (customDate) {
    const customYear =
      customDate.getFullYear();

    /*
     * Make sure the date belongs to
     * the requested season.
     */

    if (
      customYear === seasonYear
    ) {
      return customDate;
    }
  }

  const country =
    getLeagueCountry(
      league
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
   VALIDATE START WINDOW
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

function buildRounds(
  clubs
) {
  if (
    !Array.isArray(clubs) ||
    clubs.length < 2
  ) {
    return [];
  }

  const teams = [...clubs];

  /*
   * Odd number of clubs:
   * add BYE.
   */

  if (
    teams.length % 2 !== 0
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

      if (
        !teamA ||
        !teamB
      ) {
        continue;
      }

      /*
       * Home/Away balancing.
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

    rotating.unshift(
      last
    );

    rotation = [
      fixed,
      ...rotating,
    ];
  }

  /*
   * SECOND LEG
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
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(
      /[^a-zA-Z0-9_-]/g,
      ''
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
    'fixture',
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
  ].join('_');
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

    type: 'league',

    generated: true,
    generatedBy:
      'automatic-fixture-generator',

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
      'Club Stadium',

    date:
      date.toISOString(),

    status:
      'scheduled',

    result:
      null,

    homeScore:
      null,

    awayScore:
      null,

    homeOverall:
      Number(
        home?.overall
      ) ||
      Number(
        home?.rating
      ) ||
      Number(
        home?.teamOverall
      ) ||
      60,

    awayOverall:
      Number(
        away?.overall
      ) ||
      Number(
        away?.rating
      ) ||
      Number(
        away?.teamOverall
      ) ||
      60,

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp(),
  };
}

/* =========================================================
   GENERATE LEAGUE
========================================================= */

async function generateLeagueFixtures(
  league,
  clubs,
  seasonYear
) {
  const leagueClubs =
    getLeagueClubs(
      league,
      clubs
    );

  /*
   * League must have at least 2 clubs.
   */

  if (
    leagueClubs.length < 2
  ) {
    return [];
  }

  /*
   * Country.
   */

  const country =
    getLeagueCountry(
      league
    );

  /*
   * Build holiday set for the
   * season calendar.
   *
   * We need both season years because
   * fixtures can continue into next year.
   */

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
   * Generate rounds.
   */

  const rounds =
    buildRounds(
      leagueClubs
    );

  if (!rounds.length) {
    return [];
  }

  /*
   * Determine starting weekend.
   */

  let preferredStart =
    getPreferredLeagueStart(
      league,
      seasonYear
    );

  preferredStart =
    clampStartIntoSeasonWindow(
      preferredStart,
      seasonYear
    );

  /*
   * Get holidays for start year.
   */

  let holidaySet =
    await getHolidays(
      seasonYear
    );

  /*
   * First valid weekend.
   */

  let currentWeekend =
    findNextValidWeekendDate(
      preferredStart,
      holidaySet
    );

  /*
   * Important:
   *
   * If country start date falls on
   * a holiday, the match moves to
   * another valid weekend.
   */

  const fixtures = [];

  /*
   * Each round gets ONE weekend.
   */

  for (
    let roundIndex = 0;
    roundIndex <
    rounds.length;
    roundIndex += 1
  ) {
    const round =
      roundIndex + 1;

    /*
     * If year changed, load next year's
     * holiday calendar.
     */

    const currentYear =
      currentWeekend.getFullYear();

    holidaySet =
      await getHolidays(
        currentYear
      );

    /*
     * Make absolutely sure this date
     * is still a valid weekend.
     */

    currentWeekend =
      findNextValidWeekendDate(
        currentWeekend,
        holidaySet
      );

    /*
     * Create all matches for this round.
     */

    rounds[
      roundIndex
    ].forEach(
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
              currentWeekend,
          })
        );
      }
    );

    /*
     * Next round:
     * next weekend.
     */

    currentWeekend =
      addWeeks(
        currentWeekend,
        MATCH_WEEKS_INTERVAL
      );

    /*
     * Find next available weekend
     * after possible holiday.
     */

    const nextYear =
      currentWeekend.getFullYear();

    const nextHolidaySet =
      await getHolidays(
        nextYear
      );

    currentWeekend =
      findNextValidWeekendDate(
        currentWeekend,
        nextHolidaySet
      );
  }

  return fixtures;
}

/* =========================================================
   CHUNK
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
        'matches'
      ),
      where(
        'seasonYear',
        '==',
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
            'matches',
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
   GENERATE SEASON
========================================================= */

async function generateSeasonFixtures({
  leagues,
  clubs,
  seasonYear,
}) {
  if (
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
    };
  }

  /*
   * Existing fixtures.
   */

  const existingIds =
    await getExistingFixtureIds(
      seasonYear
    );

  const fixturesToCreate =
    [];

  let leaguesProcessed =
    0;

  /*
   * Generate each league.
   */

  for (
    const league of leagues
  ) {
    if (
      !league?.id
    ) {
      continue;
    }

    const leagueClubs =
      getLeagueClubs(
        league,
        clubs
      );

    /*
     * No league schedule if
     * fewer than 2 teams.
     */

    if (
      leagueClubs.length < 2
    ) {
      continue;
    }

    leaguesProcessed += 1;

    const generatedFixtures =
      await generateLeagueFixtures(
        league,
        leagueClubs,
        seasonYear
      );

    generatedFixtures.forEach(
      (fixture) => {
        /*
         * Never duplicate fixture.
         */

        if (
          existingIds.has(
            fixture.id
          )
        ) {
          return;
        }

        /*
         * Avoid duplicates inside
         * current generation.
         */

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
  ] = useState(
    'waiting'
  );

  const [
    message,
    setMessage,
  ] = useState(
    'Waiting...'
  );

  const [
    seasonYear,
    setSeasonYear,
  ] = useState(
    null
  );

  const [
    result,
    setResult,
  ] = useState(
    null
  );

  const [
    hasGenerated,
    setHasGenerated,
  ] = useState(
    false
  );

  /* =======================================================
     AUTOMATIC GENERATOR
  ======================================================= */

  const generateAutomatically =
    useCallback(
      async () => {
        if (
          !user ||
          hasGenerated
        ) {
          return;
        }

        try {
          setStatus(
            'generating'
          );

          setMessage(
            'Checking current season...'
          );

          /*
           * Current real date.
           *
           * The season is automatically
           * determined from the current year.
           */

          let currentDate =
            new Date();

          /*
           * Try to read career currentDate.
           */

          try {
            const userQuery =
              query(
                collection(
                  db,
                  'users'
                ),
                where(
                  '__name__',
                  '==',
                  user.uid
                )
              );

            const snapshot =
              await getDocs(
                userQuery
              );

            if (
              !snapshot.empty
            ) {
              const data =
                snapshot
                  .docs[0]
                  .data();

              const savedDate =
                safeDate(
                  data
                    ?.careerData
                    ?.currentDate
                );

              if (
                savedDate
              ) {
                currentDate =
                  savedDate;
              }
            }
          } catch (
            careerError
          ) {
            console.warn(
              '[FIXTURE GENERATOR] Career date unavailable:',
              careerError
            );
          }

          /*
           * Determine season.
           */

          const currentSeason =
            getSeasonYear(
              currentDate
            );

          setSeasonYear(
            currentSeason
          );

          setMessage(
            `Generating ${getSeasonName(
              currentSeason
            )} fixtures...`
          );

          /*
           * Generate.
           */

          const generationResult =
            await generateSeasonFixtures(
              {
                leagues:
                  initialLeagues,
                clubs:
                  initialClubs,
                seasonYear:
                  currentSeason,
              }
            );

          setResult(
            generationResult
          );

          setHasGenerated(
            true
          );

          setStatus(
            'complete'
          );

          if (
            generationResult.generated >
            0
          ) {
            setMessage(
              `${generationResult.generated} fixtures generated automatically.`
            );
          } else {
            setMessage(
              `Fixtures for ${getSeasonName(
                currentSeason
              )} already exist.`
            );
          }
        } catch (
          error
        ) {
          console.error(
            '[FIXTURE GENERATOR ERROR]',
            error
          );

          setStatus(
            'error'
          );

          setMessage(
            'Automatic fixture generation failed.'
          );
        }
      },
      [
        user,
        hasGenerated,
        initialLeagues,
        initialClubs,
      ]
    );

  /* =======================================================
     START AUTOMATICALLY
  ======================================================= */

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setStatus(
        'waiting'
      );

      setMessage(
        'Login required.'
      );

      return;
    }

    generateAutomatically();
  }, [
    loading,
    user,
    generateAutomatically,
  ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading
  ) {
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

  /* =======================================================
     NOT AUTHENTICATED
  ======================================================= */

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
              styles.noNextMatch
            }
          >
            {status ===
              'generating' && (
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
              'complete' && (
              <>
                <div
                  style={{
                    fontSize:
                      '42px',
                    marginBottom:
                      '10px',
                  }}
                >
                  ✓
                </div>

                <h2>
                  {message}
                </h2>

                {seasonYear && (
                  <p>
                    Season:{' '}
                    <strong>
                      {getSeasonName(
                        seasonYear
                      )}
                    </strong>
                  </p>
                )}

                {result && (
                  <p>
                    New fixtures:{' '}
                    <strong>
                      {
                        result.generated
                      }
                    </strong>
                    <br />

                    Existing fixtures:{' '}
                    <strong>
                      {
                        result.existing
                      }
                    </strong>
                    <br />

                    Leagues processed:{' '}
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
              'error' && (
              <>
                <div
                  style={{
                    fontSize:
                      '42px',
                    marginBottom:
                      '10px',
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
              'waiting' && (
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
          'leagues'
        )
      ),

      getDocs(
        collection(
          db,
          'clubs'
        )
      ),
    ]);

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
  } catch (
    error
  ) {
    console.error(
      '[FIXTURE SSR ERROR]',
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
