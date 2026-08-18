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
   CONFIGURATION
========================================================= */

const MAX_LEAGUES = 500;
const MAX_CLUBS = 5000;

const FIRESTORE_BATCH_SIZE = 450;

// Umwaka w'umupira utangira muri July.
// Urugero:
// 2026-06-20  => season 2025
// 2026-07-01  => season 2026
const SEASON_START_MONTH = 6; // July

// Fixture imwe n'indi
const DAYS_BETWEEN_MATCHDAYS = 7;

// Isaha umukino usanzwe utangiriraho
const DEFAULT_KICKOFF_HOUR = 15;
const DEFAULT_KICKOFF_MINUTE = 0;

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

function getSeasonYear(date) {
  if (!date || Number.isNaN(date.getTime())) {
    return new Date().getFullYear();
  }

  return date.getMonth() >= SEASON_START_MONTH
    ? date.getFullYear()
    : date.getFullYear() - 1;
}

function getSeasonName(seasonYear) {
  return `${seasonYear}/${String(seasonYear + 1).slice(-2)}`;
}

function safeDate(value) {
  if (!value) return null;

  try {
    if (
      typeof value?.toDate === 'function'
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
   CLUB HELPERS
========================================================= */

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
    'International'
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
   * Niba league ifite clubIds/teamIds/teams,
   * tubanza gukoresha ayo makuru.
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

    const selected = clubs.filter((club) =>
      ids.includes(club.id)
    );

    if (selected.length >= 2) {
      return selected;
    }
  }

  /*
   * Niba league itabitse club IDs,
   * dukoresha leagueId iri kuri club.
   */

  return clubs.filter(
    (club) => getLeagueId(club) === league.id
  );
}

/* =========================================================
   ROUND ROBIN GENERATOR
========================================================= */

/*
 * Iyi function ikora schedule ya:
 *
 * Team A vs Team B
 * Team C vs Team D
 *
 * hanyuma second leg:
 *
 * Team B vs Team A
 * Team D vs Team C
 *
 * Iyo clubs ari odd, twongeramo BYE.
 */

function generateRoundRobin(clubs) {
  const original = [...clubs];

  if (original.length < 2) {
    return [];
  }

  const teams = [...original];

  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const totalTeams = teams.length;
  const rounds = totalTeams - 1;

  const firstLeg = [];

  let rotation = [...teams];

  for (let round = 0; round < rounds; round += 1) {
    const matches = [];

    for (let i = 0; i < totalTeams / 2; i += 1) {
      const home = rotation[i];
      const away =
        rotation[totalTeams - 1 - i];

      if (!home || !away) {
        continue;
      }

      /*
       * Guhinduranya home/away kugira ngo
       * schedule ibe balanced.
       */

      if (round % 2 === 0) {
        matches.push({
          home,
          away,
        });
      } else {
        matches.push({
          home: away,
          away: home,
        });
      }
    }

    firstLeg.push(matches);

    /*
     * Circle method rotation.
     */

    const fixed = rotation[0];

    const rotating = rotation.slice(1);

    rotating.unshift(
      rotating.pop()
    );

    rotation = [
      fixed,
      ...rotating,
    ];
  }

  /*
   * Second leg.
   *
   * Home na away birahindurwa.
   */

  const secondLeg = firstLeg.map(
    (round) =>
      round.map((match) => ({
        home: match.away,
        away: match.home,
      }))
  );

  return [
    ...firstLeg,
    ...secondLeg,
  ];
}

/* =========================================================
   FLATTEN ROUNDS
========================================================= */

function buildRounds(clubs) {
  const original = [...clubs];

  if (original.length < 2) {
    return [];
  }

  const teams = [...original];

  if (teams.length % 2 !== 0) {
    teams.push(null);
  }

  const totalTeams = teams.length;
  const roundsPerLeg = totalTeams - 1;

  const rounds = [];

  let rotation = [...teams];

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
      const teamA = rotation[i];

      const teamB =
        rotation[
          totalTeams - 1 - i
        ];

      if (!teamA || !teamB) {
        continue;
      }

      const home =
        roundIndex % 2 === 0
          ? teamA
          : teamB;

      const away =
        roundIndex % 2 === 0
          ? teamB
          : teamA;

      matches.push({
        home,
        away,
      });
    }

    rounds.push(matches);

    const fixed = rotation[0];

    const rotating = rotation.slice(1);

    const last = rotating.pop();

    rotating.unshift(last);

    rotation = [
      fixed,
      ...rotating,
    ];
  }

  /*
   * SECOND LEG
   */

  const firstLegRounds = rounds.map(
    (round) =>
      round.map((match) => ({
        home: match.away,
        away: match.home,
      }))
  );

  return [
    ...rounds,
    ...firstLegRounds,
  ];
}

/* =========================================================
   FIXTURE ID
========================================================= */

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
    leagueId,
    round,
    homeClubId,
    awayClubId,
  ]
    .map((value) =>
      String(value)
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')
    )
    .join('_');
}

/* =========================================================
   FIXTURE DATE GENERATOR
========================================================= */

/*
 * Season itangira July.
 *
 * Round 1:
 * seasonYear July 4
 *
 * Round 2:
 * July 11
 *
 * Round 3:
 * July 18
 *
 * ...
 *
 * Second leg ikomeza nyuma ya first leg.
 */

function getSeasonStartDate(seasonYear) {
  return new Date(
    seasonYear,
    SEASON_START_MONTH,
    4,
    DEFAULT_KICKOFF_HOUR,
    DEFAULT_KICKOFF_MINUTE,
    0,
    0
  );
}

function getFixtureDate(
  seasonYear,
  roundIndex
) {
  const seasonStart =
    getSeasonStartDate(seasonYear);

  return makeKickoff(
    addDays(
      seasonStart,
      roundIndex *
        DAYS_BETWEEN_MATCHDAYS
    )
  );
}

/* =========================================================
   BUILD FIXTURE OBJECT
========================================================= */

function createFixture({
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
  });

  return {
    id,

    type: 'league',

    seasonYear,
    season: getSeasonName(seasonYear),

    leagueId: league.id,
    leagueName: getLeagueName(league),

    country: getLeagueCountry(league),

    round,

    homeClubId: home.id,
    homeClubName: getClubName(home),
    homeLogo: getClubLogo(home),

    awayClubId: away.id,
    awayClubName: getClubName(away),
    awayLogo: getClubLogo(away),

    stadium:
      home?.stadium ||
      home?.stadiumName ||
      'Club Stadium',

    date: date.toISOString(),

    status: 'scheduled',

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

    generated: true,
    generatedBy: 'fixture-generator',

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/* =========================================================
   GENERATE ONE LEAGUE
========================================================= */

function generateLeagueFixtures(
  league,
  clubs,
  seasonYear
) {
  const leagueClubs =
    getLeagueClubs(
      league,
      clubs
    );

  if (leagueClubs.length < 2) {
    return [];
  }

  const rounds =
    buildRounds(leagueClubs);

  const fixtures = [];

  rounds.forEach(
    (matches, roundIndex) => {
      const round =
        roundIndex + 1;

      const date =
        getFixtureDate(
          seasonYear,
          roundIndex
        );

      matches.forEach(
        ({ home, away }) => {
          fixtures.push(
            createFixture({
              league,
              home,
              away,
              seasonYear,
              round,
              date,
            })
          );
        }
      );
    }
  );

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
      array.slice(i, i + size)
    );
  }

  return chunks;
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

  const chunks = chunkArray(
    fixtures,
    FIRESTORE_BATCH_SIZE
  );

  let saved = 0;

  for (const chunk of chunks) {
    const batch = writeBatch(db);

    chunk.forEach((fixture) => {
      const fixtureRef = doc(
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
    });

    await batch.commit();
  }

  return saved;
}

/* =========================================================
   GET EXISTING FIXTURE IDS
========================================================= */

async function getExistingFixtureIds(
  seasonYear
) {
  const matchesQuery = query(
    collection(db, 'matches'),
    where(
      'seasonYear',
      '==',
      seasonYear
    )
  );

  const snapshot =
    await getDocs(matchesQuery);

  const ids = new Set();

  snapshot.forEach((item) => {
    ids.add(item.id);
  });

  return ids;
}

/* =========================================================
   GENERATE COMPLETE SEASON
========================================================= */

async function generateSeasonFixtures({
  leagues,
  clubs,
  seasonYear,
}) {
  if (
    !Array.isArray(leagues) ||
    !Array.isArray(clubs)
  ) {
    return {
      generated: 0,
      skipped: 0,
      leaguesProcessed: 0,
    };
  }

  /*
   * Dufata IDs zisanzwe muri Firestore.
   *
   * Ibi ni byo bituma season idakorwa kabiri.
   */

  const existingIds =
    await getExistingFixtureIds(
      seasonYear
    );

  const fixturesToCreate = [];

  let leaguesProcessed = 0;

  for (const league of leagues) {
    if (!league?.id) {
      continue;
    }

    const leagueClubs =
      getLeagueClubs(
        league,
        clubs
      );

    if (leagueClubs.length < 2) {
      continue;
    }

    leaguesProcessed += 1;

    const fixtures =
      generateLeagueFixtures(
        league,
        leagueClubs,
        seasonYear
      );

    fixtures.forEach(
      (fixture) => {
        /*
         * Niba fixture isanzwe ihari,
         * ntituyongera kuyandika.
         */

        if (
          existingIds.has(
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

  const generated =
    await saveFixtures(
      fixturesToCreate
    );

  return {
    generated,
    skipped:
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
  const { user, loading } =
    useAuth();

  const [status, setStatus] =
    useState('waiting');

  const [message, setMessage] =
    useState(
      'Waiting for authentication...'
    );

  const [seasonYear, setSeasonYear] =
    useState(null);

  const [result, setResult] =
    useState(null);

  /*
   * Automatic generator.
   *
   * Nta button.
   * Nta action y'umukoresha.
   *
   * Iyo user yinjiye:
   *
   * 1. tubona season
   * 2. tureba fixtures zihari
   * 3. dukora izibura
   */

  const generateAutomatically =
    useCallback(async () => {
      if (!user) {
        return;
      }

      try {
        setStatus('generating');

        setMessage(
          'Checking season fixtures...'
        );

        /*
         * Dufata current date ya career
         * niba ihari.
         *
         * Ariko kugira ngo generator
         * idashingira kuri page ya career,
         * dukoresha current year nka fallback.
         */

        let currentDate =
          new Date();

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

          const userSnapshot =
            await getDocs(
              userQuery
            );

          if (
            !userSnapshot.empty
          ) {
            const userData =
              userSnapshot.docs[0].data();

            const savedDate =
              safeDate(
                userData
                  ?.careerData
                  ?.currentDate
              );

            if (savedDate) {
              currentDate =
                savedDate;
            }
          }
        } catch (careerError) {
          /*
           * Niba careerData itabonetse,
           * generator irakomeza ikoreshe
           * current real date.
           */

          console.warn(
            '[FIXTURE GENERATOR] Could not read career date:',
            careerError
          );
        }

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

        const generated =
          await generateSeasonFixtures({
            leagues:
              initialLeagues,
            clubs:
              initialClubs,
            seasonYear:
              currentSeason,
          });

        setResult(
          generated
        );

        setStatus('complete');

        if (
          generated.generated > 0
        ) {
          setMessage(
            `Season ${getSeasonName(
              currentSeason
            )} fixtures generated successfully.`
          );
        } else {
          setMessage(
            `Season ${getSeasonName(
              currentSeason
            )} fixtures already exist.`
          );
        }
      } catch (error) {
        console.error(
          '[FIXTURE GENERATOR]',
          error
        );

        setStatus('error');

        setMessage(
          'Fixture generation failed.'
        );
      }
    }, [
      user,
      initialLeagues,
      initialClubs,
    ]);

  /*
   * Automatic execution.
   */

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setStatus('waiting');

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

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />

        <p>
          Loading fixture generator...
        </p>
      </div>
    );
  }

  /* =======================================================
     NOT LOGGED IN
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
            You need to be logged in
            before fixtures can be
            generated.
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
          Fixture Generator
        </title>

        <meta
          name="description"
          content="Automatic football fixture generator"
        />
      </Head>

      <main
        className={styles.page}
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
                FIXTURE GENERATOR
              </span>

              <h1>
                Automatic Season
                Fixtures
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
                      {result.generated}
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
              </>
            )}

            {status ===
              'error' && (
              <>
                <div
                  style={{
                    fontSize:
                      '42px',
                  }}
                >
                  !
                </div>

                <h2>
                  {message}
                </h2>

                <p>
                  Check the browser
                  console and Firestore
                  permissions.
                </p>
              </>
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
        .map((item) => ({
          id: item.id,
          ...item.data(),
        }));

    const clubs =
      clubsSnapshot.docs
        .slice(
          0,
          MAX_CLUBS
        )
        .map((item) => ({
          id: item.id,
          ...item.data(),
        }));

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
      '[FIXTURE SSR]',
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
