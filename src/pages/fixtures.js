import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './fixture.module.css';


/* =========================================================
   CONSTANTS
========================================================= */

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MATCH_TYPES = {
  LEAGUE: 'league',
  CUP: 'cup',
  FRIENDLY: 'friendly',
};


/* =========================================================
   DATE HELPERS
========================================================= */

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateKey(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}`;
}

function parseDateKey(dateKey) {
  if (!dateKey) {
    return null;
  }

  const parts = String(dateKey).split('-');

  if (parts.length !== 3) {
    return null;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  const date = new Date(
    year,
    month - 1,
    day
  );

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return dateKey;
  }

  date.setDate(
    date.getDate() + amount
  );

  return formatDateKey(date);
}

function formatLongDate(dateKey) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return 'Unknown date';
  }

  return `${DAYS[date.getDay()]}, ${
    MONTHS[date.getMonth()]
  } ${date.getDate()}, ${date.getFullYear()}`;
}

function formatShortDate(dateKey) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return '-';
  }

  return `${pad(
    date.getDate()
  )}/${pad(
    date.getMonth() + 1
  )}/${date.getFullYear()}`;
}

function normalize(value) {
  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
}

function safeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


/* =========================================================
   TIME HELPERS
========================================================= */

function normalizeKickoffTime(
  time
) {
  if (!time) {
    return '15:00';
  }

  const value =
    String(time).trim();

  const match =
    value.match(
      /^(\d{1,2}):(\d{2})/
    );

  if (!match) {
    return '15:00';
  }

  const hour = Math.min(
    23,
    Math.max(
      0,
      Number(match[1])
    )
  );

  const minute = Math.min(
    59,
    Math.max(
      0,
      Number(match[2])
    )
  );

  return `${pad(hour)}:${pad(
    minute
  )}`;
}

function getMatchDateKey(match) {
  return (
    match.date ||
    match.matchDate ||
    match.fixtureDate ||
    match.scheduledDate ||
    ''
  );
}

function getKickoffTime(match) {
  return normalizeKickoffTime(
    match.kickoffTime ||
      match.time ||
      match.matchTime ||
      match.kickoff
  );
}

function getMatchDateTime(match) {
  const dateKey =
    getMatchDateKey(match);

  const time =
    getKickoffTime(match);

  const date =
    parseDateKey(dateKey);

  if (!date) {
    return null;
  }

  const [
    hours,
    minutes,
  ] = time
    .split(':')
    .map(Number);

  date.setHours(
    hours || 0,
    minutes || 0,
    0,
    0
  );

  return date;
}


/* =========================================================
   MATCH STATUS
========================================================= */

function isCompleted(match) {
  return (
    normalize(
      match.status
    ) === 'completed' ||
    normalize(
      match.status
    ) === 'finished' ||
    match.played === true ||
    match.completed === true ||
    Boolean(match.result)
  );
}

function isPostponed(match) {
  return (
    normalize(
      match.status
    ) === 'postponed'
  );
}

function getMatchState(
  match,
  gameDate
) {
  if (isCompleted(match)) {
    return 'completed';
  }

  if (isPostponed(match)) {
    return 'postponed';
  }

  const matchDate =
    getMatchDateKey(match);

  if (!matchDate) {
    return 'unknown';
  }

  if (
    gameDate <
    matchDate
  ) {
    return 'future';
  }

  if (
    gameDate >
    matchDate
  ) {
    /*
     * Umukino wanyuzeho ariko utarakinnye.
     * Ntitugomba kuwita completed.
     * Uyu ni state y'ingenzi cyane.
     */
    return 'overdue';
  }

  /*
   * Ni uyu munsi.
   * Noneho tureba isaha nyayo ya match.
   */
  const matchDateTime =
    getMatchDateTime(match);

  if (!matchDateTime) {
    return 'today';
  }

  const now =
    new Date();

  if (
    now >=
    matchDateTime
  ) {
    return 'ready';
  }

  return 'today';
}


/* =========================================================
   PLAYER / CLUB HELPERS
========================================================= */

function getTeamId(
  match,
  home = true
) {
  if (home) {
    return (
      match.homeTeamId ||
      match.homeClubId ||
      match.homeId ||
      match.homeTeam?.id ||
      match.homeClub?.id ||
      null
    );
  }

  return (
    match.awayTeamId ||
    match.awayClubId ||
    match.awayId ||
    match.awayTeam?.id ||
    match.awayClub?.id ||
    null
  );
}

function getTeamName(
  match,
  home = true
) {
  if (home) {
    return (
      match.homeTeamName ||
      match.homeClubName ||
      match.homeName ||
      match.homeTeam?.name ||
      match.homeClub?.name ||
      'Home Team'
    );
  }

  return (
    match.awayTeamName ||
    match.awayClubName ||
    match.awayName ||
    match.awayTeam?.name ||
    match.awayClub?.name ||
    'Away Team'
  );
}

function getTeamLogo(
  match,
  home = true
) {
  if (home) {
    return (
      match.homeTeamLogo ||
      match.homeClubLogo ||
      match.homeTeam?.logo ||
      match.homeClub?.logo ||
      ''
    );
  }

  return (
    match.awayTeamLogo ||
    match.awayClubLogo ||
    match.awayTeam?.logo ||
    match.awayClub?.logo ||
    ''
  );
}

function getCompetitionName(
  match
) {
  return (
    match.leagueName ||
    match.competitionName ||
    match.league ||
    match.competition ||
    (
      normalize(
        match.type
      ) === 'friendly'
        ? 'Friendly'
        : 'Competition'
    )
  );
}

function getCompetitionType(
  match
) {
  return normalize(
    match.type ||
      match.matchType ||
      match.competitionType ||
      'league'
  );
}

function getStadium(match) {
  return (
    match.stadium ||
    match.venue ||
    match.stadiumName ||
    'Stadium TBA'
  );
}

function getResult(match) {
  if (
    match.homeScore !== undefined &&
    match.awayScore !== undefined
  ) {
    return `${match.homeScore} - ${match.awayScore}`;
  }

  if (match.result) {
    if (
      typeof match.result ===
      'string'
    ) {
      return match.result;
    }

    if (
      match.result.homeScore !==
        undefined &&
      match.result.awayScore !==
        undefined
    ) {
      return `${match.result.homeScore} - ${match.result.awayScore}`;
    }
  }

  return 'Played';
}


/* =========================================================
   SORT
========================================================= */

function compareFixtures(
  a,
  b
) {
  const dateA =
    getMatchDateTime(a);

  const dateB =
    getMatchDateTime(b);

  if (!dateA && !dateB) {
    return 0;
  }

  if (!dateA) {
    return 1;
  }

  if (!dateB) {
    return -1;
  }

  return (
    dateA.getTime() -
    dateB.getTime()
  );
}


/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      fixturesSnapshot,
      leaguesSnapshot,
      clubsSnapshot,
      stadiumsSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(
          db,
          'fixtures'
        )
      ),

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

      getDocs(
        collection(
          db,
          'stadiums'
        )
      ),
    ]);

    const fixtures =
      fixturesSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    const leagues =
      leaguesSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    const clubs =
      clubsSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    const stadiums =
      stadiumsSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    return {
      props: {
        initialFixtures:
          JSON.parse(
            JSON.stringify(
              fixtures
            )
          ),

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

        initialStadiums:
          JSON.parse(
            JSON.stringify(
              stadiums
            )
          ),
      },
    };
  } catch (error) {
    console.error(
      'Fixtures SSR error:',
      error
    );

    return {
      props: {
        initialFixtures: [],
        initialLeagues: [],
        initialClubs: [],
        initialStadiums: [],
      },
    };
  }
}


/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialFixtures = [],
  initialLeagues = [],
  initialClubs = [],
  initialStadiums = [],
}) {
  const router =
    useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [fixtures] =
    useState(
      initialFixtures
    );

  const [leagues] =
    useState(
      initialLeagues
    );

  const [clubs] =
    useState(
      initialClubs
    );

  const [stadiums] =
    useState(
      initialStadiums
    );

  const [
    careerData,
    setCareerData,
  ] = useState(null);

  const [
    currentClub,
    setCurrentClub,
  ] = useState(null);

  const [
    gameDate,
    setGameDate,
  ] = useState('');

  const [
    selectedCompetition,
    setSelectedCompetition,
  ] = useState('all');

  const [
    selectedDate,
    setSelectedDate,
  ] = useState('');

  const [
    activeView,
    setActiveView,
  ] = useState('all');

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    advancing,
    setAdvancing,
  ] = useState(false);


  /* =======================================================
     AUTH + CAREER
  ======================================================= */

  useEffect(() => {
    if (
      !loading &&
      !user
    ) {
      router.push('/login');
      return;
    }

    if (user) {
      loadCareer();
    }
  }, [
    user,
    loading,
    router,
  ]);


  const loadCareer =
    async () => {
      try {
        setIsLoading(true);

        const userRef =
          doc(
            db,
            'users',
            user.uid
          );

        const snapshot =
          await getDoc(
            userRef
          );

        if (!snapshot.exists()) {
          setCareerData({});
          setIsLoading(false);
          return;
        }

        const data =
          snapshot.data();

        const career =
          data.careerData || {};

        setCareerData(
          career
        );

        let clubId =
          career.currentClub ||
          null;

        if (!clubId) {
          setIsLoading(false);
          return;
        }

        const clubRef =
          doc(
            db,
            'clubs',
            clubId
          );

        const clubSnapshot =
          await getDoc(
            clubRef
          );

        if (
          clubSnapshot.exists()
        ) {
          setCurrentClub({
            id:
              clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }

        /*
         * Game date.
         * Niba itarabaho, tuyitangiza uyu munsi.
         */
        const savedGameDate =
          career.gameDate ||
          data.gameDate ||
          formatDateKey(
            new Date()
          );

        setGameDate(
          savedGameDate
        );
      } catch (error) {
        console.error(
          'Career loading error:',
          error
        );

        toast.error(
          'Failed to load career'
        );
      } finally {
        setIsLoading(false);
      }
    };


  /* =======================================================
     CURRENT CLUB
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    currentClub?.id ||
    null;


  /* =======================================================
     USER FIXTURES
  ======================================================= */

  const userFixtures =
    useMemo(() => {
      if (!currentClubId) {
        return [];
      }

      return fixtures
        .filter(
          (match) => {
            const homeId =
              getTeamId(
                match,
                true
              );

            const awayId =
              getTeamId(
                match,
                false
              );

            return (
              homeId ===
                currentClubId ||
              awayId ===
                currentClubId
            );
          }
        )
        .sort(
          compareFixtures
        );
    }, [
      fixtures,
      currentClubId,
    ]);


  /* =======================================================
     NEXT USER MATCH
========================================================= */

  const nextUserMatch =
    useMemo(() => {
      if (!gameDate) {
        return null;
      }

      const candidates =
        userFixtures.filter(
          (match) => {
            if (
              isCompleted(
                match
              )
            ) {
              return false;
            }

            const date =
              getMatchDateKey(
                match
              );

            return (
              date >= gameDate
            );
          }
        );

      return (
        candidates.sort(
          compareFixtures
        )[0] ||
        null
      );
    }, [
      userFixtures,
      gameDate,
    ]);


  /* =======================================================
     CURRENT DAY USER MATCHES
========================================================= */

  const todayMatches =
    useMemo(() => {
      return userFixtures.filter(
        (match) =>
          getMatchDateKey(
            match
          ) === gameDate
      );
    }, [
      userFixtures,
      gameDate,
    ]);


  /* =======================================================
     BLOCK ADVANCE
========================================================= */

  const blockingMatch =
    useMemo(() => {
      if (!gameDate) {
        return null;
      }

      /*
       * Reba niba hari match y'umukipe
       * user atoza itarakinwa kandi igihe
       * cyayo cyageze.
       */
      const overdue =
        userFixtures
          .filter(
            (match) => {
              const state =
                getMatchState(
                  match,
                  gameDate
                );

              return (
                state ===
                  'ready' ||
                state ===
                  'overdue'
              );
            }
          )
          .sort(
            compareFixtures
          );

      return (
        overdue[0] ||
        null
      );
    }, [
      userFixtures,
      gameDate,
    ]);


  const canAdvance =
    !blockingMatch;


  /* =======================================================
     FILTERED FIXTURES
======================================================= */

  const filteredFixtures =
    useMemo(() => {
      let result =
        [...fixtures];

      if (
        activeView ===
        'my-team'
      ) {
        result =
          result.filter(
            (match) => {
              const home =
                getTeamId(
                  match,
                  true
                );

              const away =
                getTeamId(
                  match,
                  false
                );

              return (
                home ===
                  currentClubId ||
                away ===
                  currentClubId
              );
            }
          );
      }

      if (
        selectedCompetition !==
        'all'
      ) {
        result =
          result.filter(
            (match) =>
              (
                match.leagueId ||
                match.competitionId
              ) ===
              selectedCompetition
          );
      }

      if (selectedDate) {
        result =
          result.filter(
            (match) =>
              getMatchDateKey(
                match
              ) ===
              selectedDate
          );
      }

      return result.sort(
        compareFixtures
      );
    }, [
      fixtures,
      activeView,
      currentClubId,
      selectedCompetition,
      selectedDate,
    ]);


  /* =======================================================
     COMPETITIONS
======================================================= */

  const competitions =
    useMemo(() => {
      const map =
        new Map();

      leagues.forEach(
        (league) => {
          map.set(
            league.id,
            league
          );
        }
      );

      fixtures.forEach(
        (match) => {
          const id =
            match.leagueId ||
            match.competitionId;

          if (
            id &&
            !map.has(id)
          ) {
            map.set(
              id,
              {
                id,
                name:
                  getCompetitionName(
                    match
                  ),
              }
            );
          }
        }
      );

      return Array.from(
        map.values()
      ).sort(
        (a, b) =>
          String(
            a.name || ''
          ).localeCompare(
            String(
              b.name || ''
            )
          )
      );
    }, [
      leagues,
      fixtures,
    ]);


  /* =======================================================
     STATS
======================================================= */

  const completedCount =
    userFixtures.filter(
      isCompleted
    ).length;

  const upcomingCount =
    userFixtures.filter(
      (match) =>
        !isCompleted(
          match
        ) &&
        getMatchDateKey(
          match
        ) >= gameDate
    ).length;

  const totalCount =
    userFixtures.length;


  /* =======================================================
     PLAY MATCH
======================================================= */

  const playMatch =
    (match) => {
      if (!match) {
        return;
      }

      const state =
        getMatchState(
          match,
          gameDate
        );

      /*
       * Ntabwo yemera Play mbere y'igihe.
       */
      if (
        state !==
        'ready'
      ) {
        toast.error(
          'This match is not ready to play yet.'
        );

        return;
      }

      /*
       * Ntabwo twemera match yamaze gukinwa.
       */
      if (
        isCompleted(
          match
        )
      ) {
        toast.error(
          'This match has already been played.'
        );

        return;
      }

      router.push(
        `/match/${match.id}`
      );
    };


  /* =======================================================
     ADVANCE DAY
======================================================= */

  const handleAdvanceDay =
    async () => {
      if (
        !user ||
        !gameDate
      ) {
        return;
      }

      /*
       * IKI NI CYO KIBUZA USER
       * GUSIMBUKA MATCH.
       */
      if (blockingMatch) {
        toast.error(
          `You must play ${
            getTeamName(
              blockingMatch,
              true
            ) ===
            currentClub?.name
              ? getTeamName(
                  blockingMatch,
                  false
                )
              : getTeamName(
                  blockingMatch,
                  true
                )
          } before advancing.`
        );

        return;
      }

      const nextDate =
        addDays(
          gameDate,
          1
        );

      try {
        setAdvancing(true);

        const userRef =
          doc(
            db,
            'users',
            user.uid
          );

        await updateDoc(
          userRef,
          {
            'careerData.gameDate':
              nextDate,

            updatedAt:
              serverTimestamp(),
          }
        );

        setGameDate(
          nextDate
        );

        setCareerData(
          (previous) => ({
            ...(previous || {}),
            gameDate:
              nextDate,
          })
        );
      } catch (error) {
        console.error(
          'Advance day error:',
          error
        );

        toast.error(
          'Could not advance the game day.'
        );
      } finally {
        setAdvancing(false);
      }
    };


  /* =======================================================
     GO TO PREVIOUS DAY
  ======================================================= */

  const handlePreviousDay =
    async () => {
      if (!gameDate) {
        return;
      }

      const previousDate =
        addDays(
          gameDate,
          -1
        );

      /*
       * Ntabwo tugomba gusubiza
       * gameDate inyuma cyane.
       *
       * Niba ushaka ko user atabasha
       * gusubira inyuma na gato,
       * ushobora gukuraho iyi button.
       */
      try {
        setAdvancing(true);

        await updateDoc(
          doc(
            db,
            'users',
            user.uid
          ),
          {
            'careerData.gameDate':
              previousDate,

            updatedAt:
              serverTimestamp(),
          }
        );

        setGameDate(
          previousDate
        );

        setCareerData(
          (previous) => ({
            ...(previous || {}),
            gameDate:
              previousDate,
          })
        );
      } catch (error) {
        console.error(
          error
        );

        toast.error(
          'Could not change date.'
        );
      } finally {
        setAdvancing(false);
      }
    };


  /* =======================================================
     LOADING
======================================================= */

  if (
    loading ||
    isLoading
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
          Loading fixtures...
        </p>
      </div>
    );
  }


  if (!user) {
    return null;
  }


  /* =======================================================
     NO CLUB
======================================================= */

  if (!currentClubId) {
    return (
      <>
        <Head>
          <title>
            Fixtures | Virtual Football Manager
          </title>
        </Head>

        <main
          className={
            styles.emptyPage
          }
        >
          <div
            className={
              styles.emptyIcon
            }
          >
            📅
          </div>

          <h1>
            No Club Assigned
          </h1>

          <p>
            Choose a club before
            managing fixtures and
            matches.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push(
                '/club'
              )
            }
          >
            Choose a Club
          </button>
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
          Fixtures |{' '}
          {currentClub?.name ||
            'Football Manager'}
        </title>

        <meta
          name="description"
          content="Manage league fixtures, match days, friendlies and your club's football calendar."
        />
      </Head>


      <main
        className={
          styles.page
        }
      >

        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={
            styles.header
          }
        >

          <div
            className={
              styles.headerIdentity
            }
          >

            <div
              className={
                styles.clubLogo
              }
            >
              {currentClub?.logo ? (
                <img
                  src={
                    currentClub.logo
                  }
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                FOOTBALL CALENDAR
              </span>

              <h1>
                Fixtures
              </h1>

              <p>
                {currentClub?.name}
              </p>
            </div>

          </div>


          <div
            className={
              styles.headerStats
            }
          >

            <div>
              <span>
                TOTAL
              </span>

              <strong>
                {totalCount}
              </strong>
            </div>

            <div>
              <span>
                PLAYED
              </span>

              <strong>
                {completedCount}
              </strong>
            </div>

            <div>
              <span>
                UPCOMING
              </span>

              <strong>
                {upcomingCount}
              </strong>
            </div>

          </div>

        </header>


        {/* =================================================
            NEXT MATCH HERO
        ================================================= */}

        {nextUserMatch && (
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
                <span
                  className={
                    styles.eyebrow
                  }
                >
                  NEXT MATCH
                </span>

                <h2>
                  {getCompetitionName(
                    nextUserMatch
                  )}
                </h2>

                <p>
                  {formatLongDate(
                    getMatchDateKey(
                      nextUserMatch
                    )
                  )}
                  {' • '}
                  {getKickoffTime(
                    nextUserMatch
                  )}
                </p>
              </div>

              <span
                className={
                  styles.nextMatchType
                }
              >
                {getCompetitionType(
                  nextUserMatch
                ) ===
                'friendly'
                  ? 'FRIENDLY'
                  : 'COMPETITIVE'}
              </span>

            </div>


            <div
              className={
                styles.nextTeams
              }
            >

              <div
                className={
                  styles.nextTeam
                }
              >

                <div
                  className={
                    styles.nextLogo
                  }
                >
                  {getTeamLogo(
                    nextUserMatch,
                    true
                  ) ? (
                    <img
                      src={getTeamLogo(
                        nextUserMatch,
                        true
                      )}
                      alt=""
                    />
                  ) : (
                    '⚽'
                  )}
                </div>

                <strong>
                  {getTeamName(
                    nextUserMatch,
                    true
                  )}
                </strong>

              </div>


              <div
                className={
                  styles.vs
                }
              >
                VS
              </div>


              <div
                className={
                  styles.nextTeam
                }
              >

                <div
                  className={
                    styles.nextLogo
                  }
                >
                  {getTeamLogo(
                    nextUserMatch,
                    false
                  ) ? (
                    <img
                      src={getTeamLogo(
                        nextUserMatch,
                        false
                      )}
                      alt=""
                    />
                  ) : (
                    '⚽'
                  )}
                </div>

                <strong>
                  {getTeamName(
                    nextUserMatch,
                    false
                  )}
                </strong>

              </div>

            </div>


            <div
              className={
                styles.nextMatchFooter
              }
            >

              <span>
                🏟️{' '}
                {getStadium(
                  nextUserMatch
                )}
              </span>


              {getMatchState(
                nextUserMatch,
                gameDate
              ) ===
                'ready' ? (

                <button
                  type="button"
                  className={
                    styles.playButton
                  }
                  onClick={() =>
                    playMatch(
                      nextUserMatch
                    )
                  }
                >
                  ▶ Play Match
                </button>

              ) : (
                <button
                  type="button"
                  className={
                    styles.advanceButton
                  }
                  disabled={
                    !canAdvance ||
                    advancing
                  }
                  onClick={
                    handleAdvanceDay
                  }
                >
                  ⏭ Next Day
                </button>
              )}

            </div>


            {blockingMatch && (
              <div
                className={
                  styles.blockNotice
                }
              >
                🔒 You cannot advance until
                this match is played.
              </div>
            )}

          </section>
        )}


        {/* =================================================
            GAME DATE CONTROL
        ================================================= */}

        <section
          className={
            styles.calendarControl
          }
        >

          <button
            type="button"
            onClick={
              handlePreviousDay
            }
            disabled={
              advancing
            }
          >
            ‹
          </button>


          <div>
            <span>
              CURRENT GAME DATE
            </span>

            <strong>
              {formatLongDate(
                gameDate
              )}
            </strong>
          </div>


          <button
            type="button"
            disabled={
              !canAdvance ||
              advancing
            }
            onClick={
              handleAdvanceDay
            }
          >
            {advancing
              ? '...'
              : '›'}
          </button>

        </section>


        {/* =================================================
            FILTER BAR
        ================================================= */}

        <section
          className={
            styles.filters
          }
        >

          <div
            className={
              styles.viewTabs
            }
          >

            <button
              type="button"
              className={
                activeView ===
                'all'
                  ? styles.active
                  : ''
              }
              onClick={() =>
                setActiveView(
                  'all'
                )
              }
            >
              All Fixtures
            </button>

            <button
              type="button"
              className={
                activeView ===
                'my-team'
                  ? styles.active
                  : ''
              }
              onClick={() =>
                setActiveView(
                  'my-team'
                )
              }
            >
              My Club
            </button>

          </div>


          <select
            value={
              selectedCompetition
            }
            onChange={(event) =>
              setSelectedCompetition(
                event.target.value
              )
            }
          >
            <option value="all">
              All Competitions
            </option>

            {competitions.map(
              (competition) => (
                <option
                  key={
                    competition.id
                  }
                  value={
                    competition.id
                  }
                >
                  {competition.name}
                </option>
              )
            )}

          </select>


          <input
            type="date"
            value={
              selectedDate
            }
            onChange={(event) =>
              setSelectedDate(
                event.target.value
              )
            }
          />

          {selectedDate && (
            <button
              type="button"
              className={
                styles.clearDate
              }
              onClick={() =>
                setSelectedDate(
                  ''
                )
              }
            >
              Clear
            </button>
          )}

        </section>


        {/* =================================================
            TODAY
        ================================================= */}

        <section
          className={
            styles.todaySection
          }
        >

          <div
            className={
              styles.sectionHeading
            }
          >
            <div>
              <span>
                GAME DAY
              </span>

              <h2>
                {formatLongDate(
                  gameDate
                )}
              </h2>
            </div>

            <strong>
              {todayMatches.length}{' '}
              match
              {todayMatches.length ===
              1
                ? ''
                : 'es'}
            </strong>
          </div>


          {todayMatches.length >
          0 ? (

            <div
              className={
                styles.todayGrid
              }
            >

              {todayMatches.map(
                (match) => {

                  const state =
                    getMatchState(
                      match,
                      gameDate
                    );

                  const userIsHome =
                    getTeamId(
                      match,
                      true
                    ) ===
                    currentClubId;

                  return (
                    <article
                      key={
                        match.id
                      }
                      className={
                        `${styles.todayMatch} ${
                          state ===
                          'ready'
                            ? styles.readyMatch
                            : ''
                        }`
                      }
                    >

                      <div
                        className={
                          styles.matchMeta
                        }
                      >
                        <span>
                          {getCompetitionName(
                            match
                          )}
                        </span>

                        <strong>
                          {getKickoffTime(
                            match
                          )}
                        </strong>
                      </div>


                      <div
                        className={
                          styles.matchTeams
                        }
                      >

                        <div>
                          <div
                            className={
                              styles.smallLogo
                            }
                          >
                            {getTeamLogo(
                              match,
                              true
                            ) ? (
                              <img
                                src={getTeamLogo(
                                  match,
                                  true
                                )}
                                alt=""
                              />
                            ) : (
                              '⚽'
                            )}
                          </div>

                          <strong>
                            {getTeamName(
                              match,
                              true
                            )}
                          </strong>
                        </div>


                        <span>
                          VS
                        </span>


                        <div>
                          <div
                            className={
                              styles.smallLogo
                            }
                          >
                            {getTeamLogo(
                              match,
                              false
                            ) ? (
                              <img
                                src={getTeamLogo(
                                  match,
                                  false
                                )}
                                alt=""
                              />
                            ) : (
                              '⚽'
                            )}
                          </div>

                          <strong>
                            {getTeamName(
                              match,
                              false
                            )}
                          </strong>
                        </div>

                      </div>


                      <div
                        className={
                          styles.matchVenue
                        }
                      >
                        🏟️{' '}
                        {getStadium(
                          match
                        )}
                      </div>


                      <div
                        className={
                          styles.todayAction
                        }
                      >

                        {state ===
                          'ready' && (
                          <button
                            type="button"
                            className={
                              styles.playButton
                            }
                            onClick={() =>
                              playMatch(
                                match
                              )
                            }
                          >
                            ▶ Play Match
                          </button>
                        )}

                        {state ===
                          'today' && (
                          <span
                            className={
                              styles.waiting
                            }
                          >
                            Match starts at{' '}
                            {getKickoffTime(
                              match
                            )}
                          </span>
                        )}

                        {state ===
                          'completed' && (
                          <button
                            type="button"
                            className={
                              styles.resultButton
                            }
                            onClick={() =>
                              router.push(
                                `/match/${match.id}`
                              )
                            }
                          >
                            Result
                          </button>
                        )}

                      </div>

                    </article>
                  );
                }
              )}

            </div>

          ) : (

            <div
              className={
                styles.noMatches
              }
            >
              <span>
                📅
              </span>

              <p>
                No matches scheduled
                for this day.
              </p>

              <button
                type="button"
                disabled={
                  !canAdvance ||
                  advancing
                }
                onClick={
                  handleAdvanceDay
                }
              >
                ⏭ Advance Day
              </button>
            </div>

          )}

        </section>


        {/* =================================================
            FIXTURE LIST
        ================================================= */}

        <section
          className={
            styles.fixtureSection
          }
        >

          <div
            className={
              styles.sectionHeading
            }
          >

            <div>
              <span>
                MATCH CALENDAR
              </span>

              <h2>
                Fixtures
              </h2>
            </div>

            <strong>
              {filteredFixtures.length}{' '}
              fixtures
            </strong>

          </div>


          <div
            className={
              styles.fixtureList
            }
          >

            {filteredFixtures.length >
            0 ? (

              filteredFixtures.map(
                (match) => {

                  const state =
                    getMatchState(
                      match,
                      gameDate
                    );

                  const homeId =
                    getTeamId(
                      match,
                      true
                    );

                  const awayId =
                    getTeamId(
                      match,
                      false
                    );

                  const isMyMatch =
                    homeId ===
                      currentClubId ||
                    awayId ===
                      currentClubId;

                  return (
                    <article
                      key={
                        match.id
                      }
                      className={
                        `${styles.fixtureCard} ${
                          isMyMatch
                            ? styles.myFixture
                            : ''
                        }`
                      }
                    >

                      <div
                        className={
                          styles.fixtureDate
                        }
                      >
                        <strong>
                          {formatShortDate(
                            getMatchDateKey(
                              match
                            )
                          )}
                        </strong>

                        <span>
                          {formatLongDate(
                            getMatchDateKey(
                              match
                            )
                          ).split(
                            ','
                          )[0]}
                        </span>
                      </div>


                      <div
                        className={
                          styles.fixtureCompetition
                        }
                      >
                        <span>
                          {getCompetitionName(
                            match
                          )}
                        </span>

                        <small>
                          {getCompetitionType(
                            match
                          )}
                        </small>
                      </div>


                      <div
                        className={
                          styles.fixtureTeams
                        }
                      >

                        <div>
                          {getTeamLogo(
                            match,
                            true
                          ) ? (
                            <img
                              src={getTeamLogo(
                                match,
                                true
                              )}
                              alt=""
                            />
                          ) : (
                            '⚽'
                          )}

                          <strong>
                            {getTeamName(
                              match,
                              true
                            )}
                          </strong>
                        </div>


                        <span className={
                          styles.fixtureVs
                        }>
                          VS
                        </span>


                        <div>
                          {getTeamLogo(
                            match,
                            false
                          ) ? (
                            <img
                              src={getTeamLogo(
                                match,
                                false
                              )}
                              alt=""
                            />
                          ) : (
                            '⚽'
                          )}

                          <strong>
                            {getTeamName(
                              match,
                              false
                            )}
                          </strong>
                        </div>

                      </div>


                      <div
                        className={
                          styles.fixtureTime
                        }
                      >
                        <strong>
                          {getKickoffTime(
                            match
                          )}
                        </strong>

                        <span>
                          🏟️{' '}
                          {getStadium(
                            match
                          )}
                        </span>
                      </div>


                      <div
                        className={
                          styles.fixtureStatus
                        }
                      >

                        {state ===
                          'completed' && (
                          <>
                            <span
                              className={
                                styles.completed
                              }
                            >
                              {getResult(
                                match
                              )}
                            </span>

                            {isMyMatch && (
                              <button
                                type="button"
                                className={
                                  styles.resultButton
                                }
                                onClick={() =>
                                  router.push(
                                    `/match/${match.id}`
                                  )
                                }
                              >
                                Result
                              </button>
                            )}
                          </>
                        )}


                        {state ===
                          'ready' &&
                          isMyMatch && (
                          <button
                            type="button"
                            className={
                              styles.playButton
                            }
                            onClick={() =>
                              playMatch(
                                match
                              )
                            }
                          >
                            ▶ Play Match
                          </button>
                        )}


                        {state ===
                          'today' && (
                          <span
                            className={
                              styles.upcoming
                            }
                          >
                            {getKickoffTime(
                              match
                            )}
                          </span>
                        )}


                        {state ===
                          'future' && (
                          <span
                            className={
                              styles.future
                            }
                          >
                            Upcoming
                          </span>
                        )}


                        {state ===
                          'overdue' &&
                          isMyMatch && (
                          <button
                            type="button"
                            className={
                              styles.playButton
                            }
                            onClick={() =>
                              playMatch(
                                match
                              )
                            }
                          >
                            ▶ Play Match
                          </button>
                        )}


                        {state ===
                          'postponed' && (
                          <span
                            className={
                              styles.postponed
                            }
                          >
                            Postponed
                          </span>
                        )}

                      </div>

                    </article>
                  );
                }
              )

            ) : (

              <div
                className={
                  styles.noFixtures
                }
              >
                <span>
                  📭
                </span>

                <h3>
                  No fixtures found
                </h3>

                <p>
                  There are no fixtures
                  matching your filters.
                </p>
              </div>

            )}

          </div>

        </section>


        {/* =================================================
            ADVANCE DAY FOOTER
        ================================================= */}

        <section
          className={
            styles.advanceSection
          }
        >

          {blockingMatch ? (

            <div
              className={
                styles.lockedAdvance
              }
            >

              <div>
                <span>
                  🔒 MATCH DAY LOCKED
                </span>

                <strong>
                  Play the scheduled match
                  before continuing.
                </strong>

                <p>
                  {
                    getTeamName(
                      blockingMatch,
                      true
                    )
                  }
                  {' '}
                  vs{' '}
                  {
                    getTeamName(
                      blockingMatch,
                      false
                    )
                  }
                </p>
              </div>


              <button
                type="button"
                className={
                  styles.playButton
                }
                onClick={() =>
                  playMatch(
                    blockingMatch
                  )
                }
              >
                ▶ Play Match
              </button>

            </div>

          ) : (

            <div
              className={
                styles.freeAdvance
              }
            >

              <div>
                <span>
                  CALENDAR
                </span>

                <strong>
                  No pending match is
                  blocking your career.
                </strong>
              </div>

              <button
                type="button"
                disabled={
                  advancing
                }
                onClick={
                  handleAdvanceDay
                }
              >
                {advancing
                  ? 'Advancing...'
                  : '⏭ Next Day'}
              </button>

            </div>

          )}

        </section>

      </main>
    </>
  );
}
