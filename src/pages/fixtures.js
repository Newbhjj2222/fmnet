import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

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
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './fixture.module.css';


/* =========================================================
   CONSTANTS
========================================================= */

const PRESEASON_FRIENDLIES = 4;

const LEAGUE_START_MONTH_MIN = 7; // August
const LEAGUE_START_MONTH_MAX = 8; // September

const LEAGUE_END_MONTH_MIN = 4;   // May
const LEAGUE_END_MONTH_MAX = 5;   // June

const TRANSFER_WINDOWS = [
  {
    id: 'summer',
    name: 'Summer Transfer Window',
    startMonth: 6,
    startDay: 1,
    endMonth: 7,
    endDay: 31,
  },
  {
    id: 'winter',
    name: 'Winter Transfer Window',
    startMonth: 0,
    startDay: 1,
    endMonth: 0,
    endDay: 31,
  },
];


/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


function getTeamName(team) {
  if (!team) return 'Unknown Club';

  return (
    team.name ||
    team.clubName ||
    team.teamName ||
    'Unknown Club'
  );
}


function getClubId(club) {
  if (!club) return null;

  return (
    club.id ||
    club.clubId ||
    null
  );
}


function getLeagueName(league) {
  if (!league) return 'Unknown League';

  return (
    league.name ||
    league.leagueName ||
    league.title ||
    'Unknown League'
  );
}


function getLeagueCountry(league) {
  if (!league) return '';

  return (
    league.country ||
    league.countryName ||
    league.nation ||
    ''
  );
}


function parseDate(value) {
  if (!value) return null;

  if (
    value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}


function dateKey(date) {
  const d = parseDate(date);

  if (!d) return '';

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}


function startOfDay(date) {
  const d =
    parseDate(date) ||
    new Date();

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  );
}


function addDays(date, amount) {
  const d =
    parseDate(date) ||
    new Date();

  const result = new Date(d);

  result.setDate(
    result.getDate() + amount
  );

  return result;
}


function addMonths(date, amount) {
  const d =
    parseDate(date) ||
    new Date();

  const result = new Date(d);

  result.setMonth(
    result.getMonth() + amount
  );

  return result;
}


function randomBetween(min, max) {
  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}


function formatDate(date) {
  const d = parseDate(date);

  if (!d) return '-';

  return d.toLocaleDateString(
    'en-US',
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }
  );
}


function formatShortDate(date) {
  const d = parseDate(date);

  if (!d) return '-';

  return d.toLocaleDateString(
    'en-US',
    {
      month: 'short',
      day: 'numeric',
    }
  );
}


function formatTime(date) {
  const d = parseDate(date);

  if (!d) return '-';

  return d.toLocaleTimeString(
    'en-US',
    {
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}


function formatCurrency(value) {
  return new Intl.NumberFormat(
    'en-US',
    {
      maximumFractionDigits: 0,
    }
  ).format(
    safeNumber(value)
  );
}


function getRandomKickoff() {
  const hours = [
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
  ];

  const hour =
    hours[
      Math.floor(
        Math.random() *
          hours.length
      )
    ];

  const minute =
    Math.random() > 0.5
      ? 0
      : 30;

  return {
    hour,
    minute,
  };
}


function makeDateWithTime(
  date,
  hour,
  minute
) {
  const d =
    parseDate(date) ||
    new Date();

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    hour,
    minute,
    0,
    0
  );
}


function getLeagueId(league) {
  if (!league) return null;

  return (
    league.id ||
    league.leagueId ||
    null
  );
}


function getLeagueTeams(
  league,
  clubs
) {
  const leagueId =
    getLeagueId(league);

  return clubs.filter(
    (club) => {
      const clubLeague =
        club.leagueId ||
        club.currentLeague ||
        club.league ||
        null;

      return (
        String(clubLeague) ===
        String(leagueId)
      );
    }
  );
}


/* =========================================================
   SEASON DATE GENERATOR
========================================================= */

function generateLeagueDates(
  teamCount,
  year
) {
  const rounds =
    teamCount % 2 === 0
      ? (teamCount - 1) * 2
      : teamCount * 2;

  /*
   * League starts randomly between August and September.
   */
  const startMonth =
    randomBetween(
      LEAGUE_START_MONTH_MIN,
      LEAGUE_START_MONTH_MAX
    );

  const startDay =
    randomBetween(
      1,
      startMonth === 7 ? 31 : 15
    );

  const startDate =
    new Date(
      year,
      startMonth,
      startDay
    );

  /*
   * League ends randomly between
   * May and June of the following year.
   */
  const endMonth =
    randomBetween(
      LEAGUE_END_MONTH_MIN,
      LEAGUE_END_MONTH_MAX
    );

  const endDay =
    randomBetween(
      15,
      endMonth === 4 ? 31 : 20
    );

  const endDate =
    new Date(
      year + 1,
      endMonth,
      endDay
    );

  const totalDays =
    Math.max(
      1,
      Math.floor(
        (
          endDate.getTime() -
          startDate.getTime()
        ) /
        (1000 * 60 * 60 * 24)
      )
    );

  const interval =
    rounds > 1
      ? totalDays /
        (rounds - 1)
      : 7;

  const dates = [];

  for (
    let i = 0;
    i < rounds;
    i++
  ) {
    dates.push(
      startOfDay(
        new Date(
          startDate.getTime() +
          interval *
            i *
            24 *
            60 *
            60 *
            1000
        )
      )
    );
  }

  return {
    startDate,
    endDate,
    rounds,
    dates,
  };
}


/* =========================================================
   ROUND ROBIN GENERATOR
========================================================= */

function generateRoundRobin(
  teams
) {
  let list =
    teams.map(
      (team) => ({
        id: getClubId(team),
        name: getTeamName(team),
      })
    );

  /*
   * Add a BYE team for odd numbers.
   */
  if (list.length % 2 !== 0) {
    list.push({
      id: '__BYE__',
      name: 'BYE',
    });
  }

  const total =
    list.length;

  const rounds =
    total - 1;

  const matchesPerRound =
    total / 2;

  const firstHalf = [];

  let rotation = [
    ...list,
  ];

  for (
    let round = 0;
    round < rounds;
    round++
  ) {
    const matches = [];

    for (
      let i = 0;
      i < matchesPerRound;
      i++
    ) {
      const home =
        rotation[i];

      const away =
        rotation[
          total - 1 - i
        ];

      if (
        home.id !== '__BYE__' &&
        away.id !== '__BYE__'
      ) {
        matches.push({
          homeId: home.id,
          homeName: home.name,
          awayId: away.id,
          awayName: away.name,
        });
      }
    }

    firstHalf.push(
      matches
    );

    const fixed =
      rotation[0];

    const rest =
      rotation.slice(1);

    rest.unshift(
      rest.pop()
    );

    rotation = [
      fixed,
      ...rest,
    ];
  }

  /*
   * Second half reverses home / away.
   */
  const secondHalf =
    firstHalf.map(
      (round) =>
        round.map(
          (match) => ({
            homeId:
              match.awayId,
            homeName:
              match.awayName,
            awayId:
              match.homeId,
            awayName:
              match.homeName,
          })
        )
    );

  return [
    ...firstHalf,
    ...secondHalf,
  ];
}


/* =========================================================
   FRIENDLY GENERATOR
========================================================= */

function generateFriendlies(
  userClub,
  clubs,
  leagueStartDate,
  seasonYear
) {
  if (!userClub) {
    return [];
  }

  const opponents =
    clubs
      .filter(
        (club) =>
          getClubId(club) !==
          getClubId(userClub)
      )
      .sort(
        () =>
          Math.random() -
          0.5
      )
      .slice(
        0,
        PRESEASON_FRIENDLIES
      );

  const firstFriendly =
    addDays(
      leagueStartDate,
      -28
    );

  return opponents.map(
    (opponent, index) => {
      const date =
        addDays(
          firstFriendly,
          index * 7
        );

      const kickoff =
        getRandomKickoff();

      return {
        id: `friendly-${seasonYear}-${getClubId(userClub)}-${index}`,
        type: 'friendly',
        competition: 'Pre-Season Friendly',
        leagueId: null,
        leagueName:
          'Pre-Season Friendly',
        season: seasonYear,
        date: makeDateWithTime(
          date,
          kickoff.hour,
          kickoff.minute
        ).toISOString(),
        homeClubId:
          index % 2 === 0
            ? getClubId(userClub)
            : getClubId(opponent),
        homeClubName:
          index % 2 === 0
            ? getTeamName(userClub)
            : getTeamName(opponent),
        awayClubId:
          index % 2 === 0
            ? getClubId(opponent)
            : getClubId(userClub),
        awayClubName:
          index % 2 === 0
            ? getTeamName(opponent)
            : getTeamName(userClub),
        stadium:
          index % 2 === 0
            ? (
                userClub.stadium ||
                userClub.stadiumName ||
                'Home Stadium'
              )
            : (
                opponent.stadium ||
                opponent.stadiumName ||
                'Away Stadium'
              ),
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        createdBy: 'system',
      };
    }
  );
}


/* =========================================================
   TRANSFER WINDOW HELPERS
========================================================= */

function getTransferWindows(
  seasonYear
) {
  return [
    {
      id: 'summer',
      name:
        'Summer Transfer Window',
      start: new Date(
        seasonYear,
        6,
        1
      ),
      end: new Date(
        seasonYear,
        7,
        31,
        23,
        59,
        59
      ),
    },
    {
      id: 'winter',
      name:
        'Winter Transfer Window',
      start: new Date(
        seasonYear + 1,
        0,
        1
      ),
      end: new Date(
        seasonYear + 1,
        0,
        31,
        23,
        59,
        59
      ),
    },
  ];
}


function getCurrentTransferWindow(
  currentDate,
  seasonYear
) {
  const date =
    startOfDay(currentDate);

  const windows =
    getTransferWindows(
      seasonYear
    );

  return (
    windows.find(
      (window) =>
        date >=
          startOfDay(
            window.start
          ) &&
        date <=
          window.end
    ) || null
  );
}


/* =========================================================
   FIXTURE STATUS
========================================================= */

function getFixtureStatus(
  fixture,
  currentDate
) {
  if (
    fixture.status ===
      'finished' ||
    fixture.status ===
      'completed'
  ) {
    return 'finished';
  }

  const matchDate =
    parseDate(
      fixture.date
    );

  const now =
    parseDate(
      currentDate
    ) || new Date();

  if (!matchDate) {
    return 'scheduled';
  }

  if (
    matchDate.getTime() <=
    now.getTime()
  ) {
    return 'ready';
  }

  return 'scheduled';
}


function isUserFixture(
  fixture,
  clubId
) {
  return (
    String(
      fixture.homeClubId
    ) ===
      String(clubId) ||
    String(
      fixture.awayClubId
    ) ===
      String(clubId)
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
      stadiumsSnapshot,
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
      getDocs(
        collection(
          db,
          'stadiums'
        )
      ),
    ]);

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

  const [
    leagues,
    setLeagues,
  ] = useState(
    initialLeagues
  );

  const [
    clubs,
    setClubs,
  ] = useState(
    initialClubs
  );

  const [
    stadiums,
  ] = useState(
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
    fixtures,
    setFixtures,
  ] = useState([]);

  const [
    currentDate,
    setCurrentDate,
  ] = useState(
    new Date()
  );

  const [
    selectedLeague,
    setSelectedLeague,
  ] = useState('all');

  const [
    calendarDate,
    setCalendarDate,
  ] = useState(
    new Date()
  );

  const [
    loadingPage,
    setLoadingPage,
  ] = useState(true);

  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    friendlyOpponent,
    setFriendlyOpponent,
  ] = useState('');

  const [
    friendlyDate,
    setFriendlyDate,
  ] = useState('');

  const [
    showFriendly,
    setShowFriendly,
  ] = useState(false);


  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (
      !loading &&
      !user
    ) {
      router.push(
        '/login'
      );
    }
  }, [
    user,
    loading,
    router,
  ]);


  /* =======================================================
     LOAD CAREER
  ======================================================= */

  const loadCareer =
    useCallback(
      async () => {
        if (!user?.uid) {
          return;
        }

        try {
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

          if (
            !snapshot.exists()
          ) {
            setCareerData({});
            return;
          }

          const data =
            snapshot.data();

          const career =
            data.careerData ||
            {};

          setCareerData(
            career
          );

          if (
            career.currentDate
          ) {
            setCurrentDate(
              parseDate(
                career.currentDate
              ) || new Date()
            );
          }

          if (
            career.currentClub
          ) {
            const clubRef =
              doc(
                db,
                'clubs',
                career.currentClub
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
          }
        } catch (error) {
          console.error(
            'Career load error:',
            error
          );

          toast.error(
            'Failed to load career'
          );
        }
      },
      [user]
    );


  /* =======================================================
     LOAD FIXTURES
  ======================================================= */

  const loadFixtures =
    useCallback(
      async () => {
        if (!user?.uid) {
          return;
        }

        try {
          const snapshot =
            await getDocs(
              collection(
                db,
                'fixtures'
              )
            );

          const data =
            snapshot.docs.map(
              (item) => ({
                id:
                  item.id,
                ...item.data(),
              })
            );

          setFixtures(
            data
          );
        } catch (error) {
          console.error(
            'Fixtures load error:',
            error
          );

          toast.error(
            'Failed to load fixtures'
          );
        }
      },
      [user]
    );


  useEffect(() => {
    if (
      !loading &&
      user
    ) {
      Promise.all([
        loadCareer(),
        loadFixtures(),
      ]).finally(() =>
        setLoadingPage(
          false
        )
      );
    }
  }, [
    loading,
    user,
    loadCareer,
    loadFixtures,
  ]);


  /* =======================================================
     CURRENT LEAGUE
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    currentClub?.id ||
    null;

  const currentLeagueId =
    currentClub?.leagueId ||
    currentClub?.currentLeague ||
    currentClub?.league ||
    careerData?.currentLeague ||
    null;

  const currentLeague =
    useMemo(
      () =>
        leagues.find(
          (league) =>
            String(
              getLeagueId(
                league
              )
            ) ===
            String(
              currentLeagueId
            )
        ) || null,
      [
        leagues,
        currentLeagueId,
      ]
    );


  /* =======================================================
     USER FIXTURES
  ======================================================= */

  const userFixtures =
    useMemo(
      () =>
        fixtures
          .filter(
            (fixture) =>
              isUserFixture(
                fixture,
                currentClubId
              )
          )
          .sort(
            (a, b) =>
              new Date(
                a.date
              ) -
              new Date(
                b.date
              )
          ),
      [
        fixtures,
        currentClubId,
      ]
    );


  /* =======================================================
     NEXT MATCH
  ======================================================= */

  const nextMatch =
    useMemo(() => {
      const now =
        currentDate.getTime();

      return (
        userFixtures.find(
          (fixture) => {
            const status =
              getFixtureStatus(
                fixture,
                currentDate
              );

            return (
              status !==
                'finished' &&
              new Date(
                fixture.date
              ).getTime() >=
                now
            );
          }
        ) || null
      );
    }, [
      userFixtures,
      currentDate,
    ]);


  /* =======================================================
     TRANSFER WINDOWS
  ======================================================= */

  const seasonYear =
    currentLeague?.seasonYear ||
    currentLeague?.season ||
    currentDate.getFullYear();

  const transferWindows =
    useMemo(
      () =>
        getTransferWindows(
          safeNumber(
            seasonYear,
            currentDate.getFullYear()
          )
        ),
      [
        seasonYear,
        currentDate,
      ]
    );

  const activeTransferWindow =
    getCurrentTransferWindow(
      currentDate,
      safeNumber(
        seasonYear,
        currentDate.getFullYear()
      )
    );


  /* =======================================================
     GENERATE LEAGUE FIXTURES
  ======================================================= */

  const generateLeagueFixtures =
    async (league) => {
      if (!league) {
        return;
      }

      const leagueId =
        getLeagueId(
          league
        );

      const leagueClubs =
        getLeagueTeams(
          league,
          clubs
        );

      if (
        leagueClubs.length <
        2
      ) {
        toast.error(
          `${getLeagueName(
            league
          )} needs at least 2 clubs`
        );

        return;
      }

      setGenerating(
        true
      );

      try {
        const existing =
          fixtures.filter(
            (fixture) =>
              String(
                fixture.leagueId
              ) ===
              String(
                leagueId
              )
          );

        if (
          existing.length > 0
        ) {
          toast.success(
            `${getLeagueName(
              league
            )} fixtures already exist`
          );

          return;
        }

        const year =
          safeNumber(
            league.seasonYear,
            currentDate.getFullYear()
          );

        const schedule =
          generateLeagueDates(
            leagueClubs.length,
            year
          );

        const rounds =
          generateRoundRobin(
            leagueClubs
          );

        const newFixtures =
          [];

        rounds.forEach(
          (
            round,
            roundIndex
          ) => {
            const roundDate =
              schedule.dates[
                roundIndex
              ];

            round.forEach(
              (
                match,
                matchIndex
              ) => {
                const kickoff =
                  getRandomKickoff();

                const date =
                  makeDateWithTime(
                    roundDate,
                    kickoff.hour,
                    kickoff.minute
                  );

                const homeClub =
                  leagueClubs.find(
                    (club) =>
                      String(
                        getClubId(
                          club
                        )
                      ) ===
                      String(
                        match.homeId
                      )
                  );

                const stadium =
                  homeClub?.stadium ||
                  homeClub?.stadiumName ||
                  stadiums.find(
                    (item) =>
                      String(
                        item.clubId
                      ) ===
                      String(
                        match.homeId
                      )
                  )?.name ||
                  'Main Stadium';

                newFixtures.push({
                  type: 'league',

                  leagueId:
                    leagueId,

                  leagueName:
                    getLeagueName(
                      league
                    ),

                  country:
                    getLeagueCountry(
                      league
                    ),

                  season:
                    year,

                  round:
                    roundIndex + 1,

                  matchNumber:
                    matchIndex + 1,

                  date:
                    date.toISOString(),

                  homeClubId:
                    match.homeId,

                  homeClubName:
                    match.homeName,

                  awayClubId:
                    match.awayId,

                  awayClubName:
                    match.awayName,

                  stadium,

                  status:
                    'scheduled',

                  homeScore:
                    null,

                  awayScore:
                    null,

                  createdBy:
                    'system',

                  createdAt:
                    new Date().toISOString(),
                });
              }
            );
          }
        );

        /*
         * Firestore does not allow unlimited parallel writes
         * here, so save sequentially in small batches.
         */
        const created =
          [];

        for (
          const fixture of
          newFixtures
        ) {
          const ref =
            await addDoc(
              collection(
                db,
                'fixtures'
              ),
              fixture
            );

          created.push({
            id: ref.id,
            ...fixture,
          });
        }

        /*
         * Generate preseason fixtures
         * for the user's club if it belongs
         * to this league.
         */
        if (
          String(
            currentLeagueId
          ) ===
          String(
            leagueId
          ) &&
          currentClub
        ) {
          const friendlies =
            generateFriendlies(
              currentClub,
              clubs,
              schedule.startDate,
              year
            );

          for (
            const friendly of
            friendlies
          ) {
            const ref =
              await addDoc(
                collection(
                  db,
                  'fixtures'
                ),
                friendly
              );

            created.push({
              id:
                ref.id,
              ...friendly,
            });
          }
        }

        setFixtures(
          (previous) => [
            ...previous,
            ...created,
          ]
        );

        /*
         * Store generated season information
         * inside league document.
         */
        await updateDoc(
          doc(
            db,
            'leagues',
            leagueId
          ),
          {
            seasonYear:
              year,

            seasonStart:
              schedule.startDate.toISOString(),

            seasonEnd:
              schedule.endDate.toISOString(),

            totalRounds:
              schedule.rounds,

            fixturesGenerated:
              true,

            transferWindows:
              transferWindows.map(
                (window) => ({
                  id:
                    window.id,
                  name:
                    window.name,
                  start:
                    window.start.toISOString(),
                  end:
                    window.end.toISOString(),
                })
              ),

            updatedAt:
              serverTimestamp(),
          }
        );

        setLeagues(
          (previous) =>
            previous.map(
              (item) =>
                item.id ===
                leagueId
                  ? {
                      ...item,
                      seasonYear:
                        year,
                      seasonStart:
                        schedule.startDate.toISOString(),
                      seasonEnd:
                        schedule.endDate.toISOString(),
                      totalRounds:
                        schedule.rounds,
                      fixturesGenerated:
                        true,
                    }
                  : item
            )
        );

        toast.success(
          `${getLeagueName(
            league
          )} schedule generated`
        );
      } catch (error) {
        console.error(
          'Fixture generation error:',
          error
        );

        toast.error(
          'Could not generate league fixtures'
        );
      } finally {
        setGenerating(
          false
        );
      }
    };


  /* =======================================================
     ENSURE USER LEAGUE EXISTS
  ======================================================= */

  useEffect(() => {
    if (
      !currentLeague ||
      fixtures.length === 0 &&
      currentLeague.fixturesGenerated !== true
    ) {
      return;
    }

    if (
      currentLeague &&
      currentLeague.fixturesGenerated !== true &&
      !generating
    ) {
      generateLeagueFixtures(
        currentLeague
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentLeague?.id,
    currentLeague?.fixturesGenerated,
  ]);


  /* =======================================================
     CALENDAR FIXTURES
  ======================================================= */

  const calendarFixtures =
    useMemo(() => {
      const selectedDate =
        dateKey(
          calendarDate
        );

      return fixtures
        .filter(
          (fixture) => {
            if (
              selectedLeague !==
              'all'
            ) {
              if (
                String(
                  fixture.leagueId
                ) !==
                String(
                  selectedLeague
                )
              ) {
                return false;
              }
            }

            return (
              dateKey(
                fixture.date
              ) ===
              selectedDate
            );
          }
        )
        .sort(
          (a, b) =>
            new Date(
              a.date
            ) -
            new Date(
              b.date
            )
        );
    }, [
      fixtures,
      calendarDate,
      selectedLeague,
    ]);


  /* =======================================================
     SELECTED LEAGUE FIXTURES
  ======================================================= */

  const leagueFixtures =
    useMemo(() => {
      if (
        selectedLeague ===
        'all'
      ) {
        return fixtures;
      }

      return fixtures.filter(
        (fixture) =>
          String(
            fixture.leagueId
          ) ===
          String(
            selectedLeague
          )
      );
    }, [
      fixtures,
      selectedLeague,
    ]);


  /* =======================================================
     RESULTS
  ======================================================= */

  const results =
    useMemo(
      () =>
        userFixtures
          .filter(
            (fixture) =>
              getFixtureStatus(
                fixture,
                currentDate
              ) ===
                'finished' ||
              fixture.status ===
                'completed'
          )
          .slice(-10)
          .reverse(),
      [
        userFixtures,
        currentDate,
      ]
    );


  /* =======================================================
     ADVANCE DAY
  ======================================================= */

  const advanceDay =
    async () => {
      if (!user?.uid) {
        return;
      }

      const nextDay =
        addDays(
          currentDate,
          1
        );

      try {
        await updateDoc(
          doc(
            db,
            'users',
            user.uid
          ),
          {
            careerData: {
              ...(careerData || {}),
              currentDate:
                nextDay.toISOString(),
            },
            updatedAt:
              serverTimestamp(),
          }
        );

        setCurrentDate(
          nextDay
        );

        setCareerData(
          (previous) => ({
            ...(previous || {}),
            currentDate:
              nextDay.toISOString(),
          })
        );
      } catch (error) {
        console.error(
          'Advance day error:',
          error
        );

        toast.error(
          'Could not advance the day'
        );
      }
    };


  /* =======================================================
     PLAY MATCH
  ======================================================= */

  const playMatch =
    (fixture) => {
      if (!fixture) {
        return;
      }

      const status =
        getFixtureStatus(
          fixture,
          currentDate
        );

      if (
        status !==
        'ready'
      ) {
        toast.error(
          'This match is not ready yet'
        );

        return;
      }

      router.push(
        `/match?id=${encodeURIComponent(
          fixture.id
        )}`
      );
    };


  /* =======================================================
     FRIENDLY
  ======================================================= */

  const createFriendly =
    async () => {
      if (
        !currentClub ||
        !friendlyOpponent ||
        !friendlyDate
      ) {
        toast.error(
          'Choose an opponent and date'
        );

        return;
      }

      const opponent =
        clubs.find(
          (club) =>
            String(
              getClubId(
                club
              )
            ) ===
            String(
              friendlyOpponent
            )
        );

      if (!opponent) {
        return;
      }

      const date =
        new Date(
          `${friendlyDate}T18:00:00`
        );

      if (
        Number.isNaN(
          date.getTime()
        )
      ) {
        toast.error(
          'Invalid friendly date'
        );

        return;
      }

      const leagueStart =
        parseDate(
          currentLeague?.seasonStart
        );

      if (
        leagueStart &&
        date >= leagueStart
      ) {
        toast.error(
          'Friendly matches must be before the league starts'
        );

        return;
      }

      try {
        setGenerating(
          true
        );

        const fixture = {
          type: 'friendly',

          competition:
            'Pre-Season Friendly',

          leagueId: null,

          leagueName:
            'Pre-Season Friendly',

          season:
            safeNumber(
              seasonYear
            ),

          date:
            date.toISOString(),

          homeClubId:
            currentClub.id,

          homeClubName:
            getTeamName(
              currentClub
            ),

          awayClubId:
            getClubId(
              opponent
            ),

          awayClubName:
            getTeamName(
              opponent
            ),

          stadium:
            currentClub.stadium ||
            currentClub.stadiumName ||
            'Home Stadium',

          status:
            'scheduled',

          homeScore:
            null,

          awayScore:
            null,

          createdBy:
            user.uid,

          createdAt:
            new Date().toISOString(),
        };

        const ref =
          await addDoc(
            collection(
              db,
              'fixtures'
            ),
            fixture
          );

        setFixtures(
          (previous) => [
            ...previous,
            {
              id: ref.id,
              ...fixture,
            },
          ]
        );

        setShowFriendly(
          false
        );

        setFriendlyOpponent(
          ''
        );

        setFriendlyDate(
          ''
        );

        toast.success(
          'Friendly match scheduled'
        );
      } catch (error) {
        console.error(
          'Friendly error:',
          error
        );

        toast.error(
          'Could not create friendly'
        );
      } finally {
        setGenerating(
          false
        );
      }
    };


  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    loadingPage
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
          Loading fixtures centre...
        </p>
      </div>
    );
  }


  if (!user) {
    return null;
  }


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Fixtures Centre | Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Manage fixtures, league schedules, results, preseason friendlies and transfer windows."
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
                styles.headerIcon
              }
            >
              📅
            </div>

            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                MATCH CENTRE
              </span>

              <h1>
                Fixtures & Calendar
              </h1>

              <p>
                {currentClub
                  ? `${getTeamName(
                      currentClub
                    )} • ${
                      currentLeague
                        ? getLeagueName(
                            currentLeague
                          )
                        : 'No League'
                    }`
                  : 'Football Calendar'}
              </p>
            </div>

          </div>


          <div
            className={
              styles.currentDate
            }
          >
            <span>
              CAREER DATE
            </span>

            <strong>
              {formatDate(
                currentDate
              )}
            </strong>
          </div>

        </header>


        {/* =================================================
            NEXT MATCH
        ================================================= */}

        {nextMatch && (
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
                  {nextMatch.competition ||
                    nextMatch.leagueName ||
                    'Fixture'}
                </h2>
              </div>

              <span
                className={
                  styles.nextBadge
                }
              >
                {formatShortDate(
                  nextMatch.date
                )}
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
                    styles.teamBadge
                  }
                >
                  ⚽
                </div>

                <strong>
                  {nextMatch.homeClubName}
                </strong>

                <span>
                  HOME
                </span>
              </div>


              <div
                className={
                  styles.nextMiddle
                }
              >
                <span>
                  {formatTime(
                    nextMatch.date
                  )}
                </span>

                <strong>
                  VS
                </strong>

                <small>
                  {nextMatch.stadium ||
                    'Stadium TBA'}
                </small>
              </div>


              <div
                className={
                  styles.nextTeam
                }
              >
                <div
                  className={
                    styles.teamBadge
                  }
                >
                  ⚽
                </div>

                <strong>
                  {nextMatch.awayClubName}
                </strong>

                <span>
                  AWAY
                </span>
              </div>

            </div>


            <div
              className={
                styles.nextActions
              }
            >

              {new Date(
                nextMatch.date
              ).getTime() >
                currentDate.getTime() ? (
                <button
                  type="button"
                  className={
                    styles.advanceButton
                  }
                  onClick={
                    advanceDay
                  }
                >
                  <span>
                    ▶
                  </span>

                  Advance to Next Day
                </button>
              ) : (
                <button
                  type="button"
                  className={
                    styles.playButton
                  }
                  onClick={() =>
                    playMatch(
                      nextMatch
                    )
                  }
                >
                  ⚽ Play Match
                </button>
              )}

            </div>

          </section>
        )}


        {/* =================================================
            TRANSFER WINDOWS
        ================================================= */}

        <section
          className={
            styles.transferPanel
          }
        >

          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              TRANSFERS
            </span>

            <h2>
              Transfer Windows
            </h2>

            <p>
              The system controls when clubs
              can buy, sell and negotiate.
            </p>
          </div>


          <div
            className={
              styles.transferWindows
            }
          >

            {transferWindows.map(
              (window) => (
                <div
                  key={
                    window.id
                  }
                  className={
                    activeTransferWindow?.id ===
                    window.id
                      ? styles.transferWindowActive
                      : styles.transferWindow
                  }
                >
                  <span>
                    {window.id ===
                    'summer'
                      ? '☀️'
                      : '❄️'}
                  </span>

                  <div>
                    <strong>
                      {window.name}
                    </strong>

                    <small>
                      {formatShortDate(
                        window.start
                      )}{' '}
                      -
                      {' '}
                      {formatShortDate(
                        window.end
                      )}
                    </small>
                  </div>

                  {activeTransferWindow?.id ===
                    window.id && (
                    <b>
                      OPEN
                    </b>
                  )}
                </div>
              )
            )}

          </div>

        </section>


        {/* =================================================
            LEAGUES
        ================================================= */}

        <section
          className={
            styles.leaguesSection
          }
        >

          <div
            className={
              styles.sectionHeading
            }
          >
            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                COMPETITIONS
              </span>

              <h2>
                Leagues
              </h2>

              <p>
                Browse every competition
                and its fixtures.
              </p>
            </div>

            <span
              className={
                styles.countBadge
              }
            >
              {leagues.length}
              {' '}
              leagues
            </span>
          </div>


          <div
            className={
              styles.leagueCards
            }
          >

            <button
              type="button"
              className={
                selectedLeague ===
                'all'
                  ? styles.leagueCardActive
                  : styles.leagueCard
              }
              onClick={() =>
                setSelectedLeague(
                  'all'
                )
              }
            >
              <span>
                🌍
              </span>

              <div>
                <strong>
                  All Leagues
                </strong>

                <small>
                  {fixtures.length}
                  {' '}
                  fixtures
                </small>
              </div>
            </button>


            {leagues.map(
              (league) => {
                const leagueId =
                  getLeagueId(
                    league
                  );

                const count =
                  fixtures.filter(
                    (fixture) =>
                      String(
                        fixture.leagueId
                      ) ===
                      String(
                        leagueId
                      )
                  ).length;

                const isCurrent =
                  String(
                    leagueId
                  ) ===
                  String(
                    currentLeagueId
                  );

                return (
                  <button
                    type="button"
                    key={
                      leagueId
                    }
                    className={
                      String(
                        selectedLeague
                      ) ===
                        String(
                          leagueId
                        )
                        ? styles.leagueCardActive
                        : styles.leagueCard
                    }
                    onClick={() =>
                      setSelectedLeague(
                        leagueId
                      )
                    }
                  >

                    <div
                      className={
                        styles.leagueLogo
                      }
                    >
                      {league.logo ? (
                        <img
                          src={
                            league.logo
                          }
                          alt=""
                        />
                      ) : (
                        '🏆'
                      )}
                    </div>

                    <div>
                      <strong>
                        {getLeagueName(
                          league
                        )}
                      </strong>

                      <small>
                        {getLeagueCountry(
                          league
                        ) ||
                          'International'}
                      </small>
                    </div>

                    {isCurrent && (
                      <b>
                        YOUR LEAGUE
                      </b>
                    )}

                  </button>
                );
              }
            )}

          </div>

        </section>


        {/* =================================================
            CALENDAR
        ================================================= */}

        <section
          className={
            styles.calendarSection
          }
        >

          <div
            className={
              styles.calendarHeader
            }
          >

            <button
              type="button"
              onClick={() =>
                setCalendarDate(
                  (date) =>
                    addDays(
                      date,
                      -1
                    )
                )
              }
            >
              ‹
            </button>

            <div>
              <span>
                MATCH DAY
              </span>

              <strong>
                {formatDate(
                  calendarDate
                )}
              </strong>
            </div>

            <button
              type="button"
              onClick={() =>
                setCalendarDate(
                  (date) =>
                    addDays(
                      date,
                      1
                    )
                )
              }
            >
              ›
            </button>

          </div>


          <div
            className={
              styles.calendarStrip
            }
          >
            {[-2, -1, 0, 1, 2].map(
              (offset) => {
                const date =
                  addDays(
                    calendarDate,
                    offset
                  );

                const active =
                  dateKey(
                    date
                  ) ===
                  dateKey(
                    calendarDate
                  );

                return (
                  <button
                    type="button"
                    key={
                      dateKey(
                        date
                      )
                    }
                    className={
                      active
                        ? styles.dayActive
                        : styles.day
                    }
                    onClick={() =>
                      setCalendarDate(
                        date
                      )
                    }
                  >
                    <small>
                      {date.toLocaleDateString(
                        'en-US',
                        {
                          weekday:
                            'short',
                        }
                      )}
                    </small>

                    <strong>
                      {date.getDate()}
                    </strong>

                    <span>
                      {date.toLocaleDateString(
                        'en-US',
                        {
                          month:
                            'short',
                        }
                      )}
                    </span>
                  </button>
                );
              }
            )}
          </div>


          <div
            className={
              styles.fixtureList
            }
          >

            {calendarFixtures.length >
            0 ? (
              calendarFixtures.map(
                (fixture) => {

                  const status =
                    getFixtureStatus(
                      fixture,
                      currentDate
                    );

                  return (
                    <article
                      key={
                        fixture.id
                      }
                      className={
                        styles.fixtureCard
                      }
                    >

                      <div
                        className={
                          styles.fixtureMeta
                        }
                      >
                        <span>
                          {fixture.leagueName ||
                            fixture.competition}
                        </span>

                        <small>
                          {fixture.type ===
                          'friendly'
                            ? 'FRIENDLY'
                            : `ROUND ${
                                fixture.round ||
                                '-'
                              }`}
                        </small>
                      </div>


                      <div
                        className={
                          styles.fixtureTeams
                        }
                      >

                        <strong>
                          {fixture.homeClubName}
                        </strong>

                        <div
                          className={
                            styles.fixtureScore
                          }
                        >
                          {status ===
                            'finished' ? (
                            <>
                              <b>
                                {
                                  fixture.homeScore
                                }
                              </b>

                              <span>
                                -
                              </span>

                              <b>
                                {
                                  fixture.awayScore
                                }
                              </b>
                            </>
                          ) : (
                            <>
                              <span>
                                {formatTime(
                                  fixture.date
                                )}
                              </span>

                              <small>
                                VS
                              </small>
                            </>
                          )}
                        </div>

                        <strong>
                          {fixture.awayClubName}
                        </strong>

                      </div>


                      <div
                        className={
                          styles.fixtureFooter
                        }
                      >
                        <span>
                          🏟️{' '}
                          {fixture.stadium ||
                            'Stadium TBA'}
                        </span>

                        <span>
                          {formatDate(
                            fixture.date
                          )}
                        </span>

                        {status ===
                          'finished' ? (
                          <b
                            className={
                              styles.resultBadge
                            }
                          >
                            RESULT
                          </b>
                        ) : isUserFixture(
                            fixture,
                            currentClubId
                          ) &&
                          status ===
                            'ready' ? (
                          <button
                            type="button"
                            className={
                              styles.smallPlay
                            }
                            onClick={() =>
                              playMatch(
                                fixture
                              )
                            }
                          >
                            PLAY MATCH
                          </button>
                        ) : (
                          <span
                            className={
                              styles.scheduledBadge
                            }
                          >
                            SCHEDULED
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
                  📅
                </span>

                <h3>
                  No fixtures today
                </h3>

                <p>
                  No match was scheduled
                  for this date.
                </p>
              </div>
            )}

          </div>

        </section>


        {/* =================================================
            MY CLUB FIXTURES
        ================================================= */}

        <section
          className={
            styles.myFixtures
          }
        >

          <div
            className={
              styles.sectionHeading
            }
          >
            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                YOUR CLUB
              </span>

              <h2>
                Upcoming Fixtures
              </h2>
            </div>

            <span
              className={
                styles.countBadge
              }
            >
              {userFixtures.length}
              {' '}
              matches
            </span>
          </div>


          <div
            className={
              styles.upcomingGrid
            }
          >

            {userFixtures
              .filter(
                (fixture) =>
                  new Date(
                    fixture.date
                  ).getTime() >=
                  currentDate.getTime()
              )
              .slice(
                0,
                8
              )
              .map(
                (fixture) => {

                  const home =
                    String(
                      fixture.homeClubId
                    ) ===
                    String(
                      currentClubId
                    );

                  return (
                    <div
                      key={
                        fixture.id
                      }
                      className={
                        styles.upcomingCard
                      }
                    >

                      <div>
                        <small>
                          {formatShortDate(
                            fixture.date
                          )}
                        </small>

                        <span>
                          {fixture.leagueName ||
                            fixture.competition}
                        </span>
                      </div>

                      <strong>
                        {home
                          ? `vs ${fixture.awayClubName}`
                          : `@ ${fixture.homeClubName}`}
                      </strong>

                      <span>
                        {formatTime(
                          fixture.date
                        )}
                        {' • '}
                        {fixture.stadium ||
                          'TBA'}
                      </span>

                    </div>
                  );
                }
              )}

          </div>

        </section>


        {/* =================================================
            RESULTS
        ================================================= */}

        <section
          className={
            styles.resultsSection
          }
        >

          <div
            className={
              styles.sectionHeading
            }
          >
            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                MATCH HISTORY
              </span>

              <h2>
                Recent Results
              </h2>
            </div>
          </div>


          <div
            className={
              styles.resultsList
            }
          >

            {results.length >
            0 ? (
              results.map(
                (fixture) => {

                  const home =
                    String(
                      fixture.homeClubId
                    ) ===
                    String(
                      currentClubId
                    );

                  const userScore =
                    home
                      ? safeNumber(
                          fixture.homeScore
                        )
                      : safeNumber(
                          fixture.awayScore
                        );

                  const opponentScore =
                    home
                      ? safeNumber(
                          fixture.awayScore
                        )
                      : safeNumber(
                          fixture.homeScore
                        );

                  const result =
                    userScore >
                    opponentScore
                      ? 'W'
                      : userScore <
                        opponentScore
                      ? 'L'
                      : 'D';

                  return (
                    <div
                      key={
                        fixture.id
                      }
                      className={
                        styles.resultRow
                      }
                    >

                      <span
                        className={
                          result === 'W'
                            ? styles.win
                            : result === 'L'
                            ? styles.loss
                            : styles.draw
                        }
                      >
                        {result}
                      </span>

                      <div>
                        <strong>
                          {home
                            ? fixture.awayClubName
                            : fixture.homeClubName}
                        </strong>

                        <small>
                          {fixture.leagueName ||
                            fixture.competition}
                          {' • '}
                          {formatShortDate(
                            fixture.date
                          )}
                        </small>
                      </div>

                      <b>
                        {userScore}
                        {' - '}
                        {opponentScore}
                      </b>

                    </div>
                  );
                }
              )
            ) : (
              <div
                className={
                  styles.emptyResults
                }
              >
                No completed matches yet.
              </div>
            )}

          </div>

        </section>


        {/* =================================================
            PRESEASON
        ================================================= */}

        <section
          className={
            styles.preseason
          }
        >

          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              PRE-SEASON
            </span>

            <h2>
              Friendly Matches
            </h2>

            <p>
              Prepare your squad before the
              league campaign begins.
            </p>
          </div>

          <button
            type="button"
            className={
              styles.primaryButton
            }
            onClick={() =>
              setShowFriendly(
                true
              )
            }
          >
            + Schedule Friendly
          </button>

        </section>


        {/* =================================================
            FRIENDLY MODAL
        ================================================= */}

        {showFriendly && (
          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowFriendly(
                false
              )
            }
          >

            <div
              className={
                styles.modal
              }
              onClick={(event) =>
                event.stopPropagation()
              }
            >

              <button
                type="button"
                className={
                  styles.close
                }
                onClick={() =>
                  setShowFriendly(
                    false
                  )
                }
              >
                ×
              </button>

              <span
                className={
                  styles.eyebrow
                }
              >
                PRE-SEASON
              </span>

              <h2>
                Schedule Friendly
              </h2>

              <p>
                Arrange a warm-up match before
                the competitive season starts.
              </p>


              <label>
                Opponent

                <select
                  value={
                    friendlyOpponent
                  }
                  onChange={(event) =>
                    setFriendlyOpponent(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    Select opponent
                  </option>

                  {clubs
                    .filter(
                      (club) =>
                        String(
                          getClubId(
                            club
                          )
                        ) !==
                        String(
                          currentClubId
                        )
                    )
                    .map(
                      (club) => (
                        <option
                          key={
                            getClubId(
                              club
                            )
                          }
                          value={
                            getClubId(
                              club
                            )
                          }
                        >
                          {getTeamName(
                            club
                          )}
                        </option>
                      )
                    )}
                </select>
              </label>


              <label>
                Match Date

                <input
                  type="date"
                  value={
                    friendlyDate
                  }
                  onChange={(event) =>
                    setFriendlyDate(
                      event.target.value
                    )
                  }
                />
              </label>


              <button
                type="button"
                disabled={
                  generating
                }
                className={
                  styles.primaryButton
                }
                onClick={
                  createFriendly
                }
              >
                {generating
                  ? 'Scheduling...'
                  : 'Schedule Match'}
              </button>

            </div>

          </div>
        )}

      </main>
    </>
  );
}
