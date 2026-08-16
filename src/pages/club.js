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

import styles from './club.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const CONTRACT_WARNING_DAYS = 60;
const DEFAULT_CONTRACT_YEARS = 2;
const DEFAULT_SALARY = 50000;

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'object') {
    return (
      value.name ||
      value.title ||
      value.label ||
      value.displayName ||
      value.id ||
      fallback
    );
  }

  return String(value);
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

function formatDate(value) {
  if (!value) return '-';

  try {
    if (
      typeof value === 'object' &&
      typeof value.toDate === 'function'
    ) {
      return value.toDate().toLocaleDateString();
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    return date.toLocaleDateString();
  } catch {
    return '-';
  }
}

function dateToISOString(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (
    typeof value === 'object' &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate().toISOString();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function daysBetween(start, end) {
  if (!start || !end) return 0;

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return 0;
  }

  return Math.ceil(
    (endDate.getTime() - startDate.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function addYears(date, years) {
  const result = new Date(date);

  result.setFullYear(
    result.getFullYear() + years
  );

  return result.toISOString();
}

function getContractStatus(contract) {
  if (!contract) {
    return 'none';
  }

  if (contract.status === 'terminated') {
    return 'terminated';
  }

  if (!contract.endDate) {
    return 'active';
  }

  const remaining = daysBetween(
    new Date().toISOString(),
    dateToISOString(contract.endDate)
  );

  if (remaining <= 0) {
    return 'expired';
  }

  if (remaining <= CONTRACT_WARNING_DAYS) {
    return 'expiring';
  }

  return 'active';
}

function getConfidenceLabel(value) {
  if (value >= 80) return 'Excellent';
  if (value >= 65) return 'Good';
  if (value >= 50) return 'Stable';
  if (value >= 35) return 'Under Pressure';

  return 'Critical';
}

function getPlayerName(player) {
  return (
    player.name ||
    player.fullName ||
    player.displayName ||
    `${player.firstName || ''} ${player.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return (
    player.position ||
    player.role ||
    player.positionName ||
    'Player'
  );
}

function getPlayerClubId(player) {
  return (
    player.clubId ||
    player.currentClub ||
    player.teamId ||
    player.club ||
    player.currentTeam ||
    null
  );
}

function normalizeRelation(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return (
      value.id ||
      value.name ||
      value.title ||
      value.label ||
      null
    );
  }

  return String(value);
}

function getRelationId(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return value.id || null;
  }

  return null;
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    /*
     * -------------------------------------------------------
     * LOAD CLUBS
     * -------------------------------------------------------
     */

    const clubsSnapshot = await getDocs(
      collection(db, 'clubs')
    );

    /*
     * -------------------------------------------------------
     * LOAD COUNTRIES
     * -------------------------------------------------------
     */

    const countriesSnapshot = await getDocs(
      collection(db, 'countries')
    );

    const countriesMap = {};

    countriesSnapshot.forEach((countryDoc) => {
      const data = countryDoc.data();

      countriesMap[countryDoc.id] = {
        id: countryDoc.id,
        ...data,
        name:
          data.name ||
          data.countryName ||
          data.title ||
          countryDoc.id,
      };
    });

    /*
     * -------------------------------------------------------
     * LOAD LEAGUES
     * -------------------------------------------------------
     */

    const leaguesSnapshot = await getDocs(
      collection(db, 'leagues')
    );

    const leaguesMap = {};

    leaguesSnapshot.forEach((leagueDoc) => {
      const data = leagueDoc.data();

      leaguesMap[leagueDoc.id] = {
        id: leagueDoc.id,
        ...data,
        name:
          data.name ||
          data.leagueName ||
          data.title ||
          leagueDoc.id,
      };
    });

    /*
     * -------------------------------------------------------
     * LOAD PLAYERS
     * -------------------------------------------------------
     *
     * Twebwe turazifilteringa nyuma kugira ngo code ibe
     * compatible na structures zitandukanye.
     */

    const playersSnapshot = await getDocs(
      collection(db, 'players')
    );

    const allPlayers = [];

    playersSnapshot.forEach((playerDoc) => {
      const data = playerDoc.data();

      allPlayers.push({
        id: playerDoc.id,
        ...data,

        name: getPlayerName(data),

        position: getPlayerPosition(data),

        age: safeNumber(
          data.age,
          0
        ),

        overall: safeNumber(
          data.overall ??
          data.rating ??
          data.ovr,
          0
        ),

        marketValue: safeNumber(
          data.marketValue ??
          data.value ??
          data.transferValue,
          0
        ),

        salary: safeNumber(
          data.salary ??
          data.wage ??
          data.weeklyWage,
          0
        ),

        nationality:
          data.nationality ||
          data.country ||
          data.nationalityName ||
          '',

        clubId:
          getPlayerClubId(data),
      });
    });

    /*
     * -------------------------------------------------------
     * NORMALIZE CLUBS
     * -------------------------------------------------------
     */

    const clubs = [];

    clubsSnapshot.forEach((clubDoc) => {
      const data = clubDoc.data();

      const countryId =
        data.countryId ||
        (
          typeof data.country === 'object'
            ? data.country.id
            : null
        );

      const leagueId =
        data.leagueId ||
        (
          typeof data.league === 'object'
            ? data.league.id
            : null
        );

      const country =
        countriesMap[countryId] ||
        (
          typeof data.country === 'object'
            ? data.country
            : null
        );

      const league =
        leaguesMap[leagueId] ||
        (
          typeof data.league === 'object'
            ? data.league
            : null
        );

      const clubPlayers =
        allPlayers.filter(
          (player) =>
            String(player.clubId || '') ===
            String(clubDoc.id)
        );

      clubs.push({
        id: clubDoc.id,

        name:
          data.name ||
          data.clubName ||
          'Unnamed Club',

        logo:
          data.logo ||
          data.logoUrl ||
          data.badge ||
          null,

        countryId:
          countryId || null,

        countryName:
          country?.name ||
          (
            typeof data.country === 'string'
              ? data.country
              : ''
          ) ||
          data.countryName ||
          'Unknown Country',

        leagueId:
          leagueId || null,

        leagueName:
          league?.name ||
          (
            typeof data.league === 'string'
              ? data.league
              : ''
          ) ||
          data.leagueName ||
          'Unknown League',

        country:
          country ||
          null,

        league:
          league ||
          null,

        stadium:
          data.stadium ||
          data.stadiumName ||
          'Stadium',

        city:
          data.city ||
          data.location ||
          '',

        founded:
          data.founded ||
          data.established ||
          null,

        reputation:
          safeNumber(
            data.reputation,
            50
          ),

        transferBudget:
          safeNumber(
            data.transferBudget,
            1000000
          ),

        wageBudget:
          safeNumber(
            data.wageBudget,
            100000
          ),

        balance:
          safeNumber(
            data.balance ??
            data.budget ??
            data.clubBalance,
            5000000
          ),

        squadSize:
          clubPlayers.length ||
          safeNumber(
            data.squadSize,
            0
          ),

        players:
          clubPlayers,

        boardExpectation:
          data.boardExpectation ||
          'Build a competitive team',

        objectives:
          Array.isArray(data.objectives)
            ? data.objectives
            : [],

        facilities:
          data.facilities ||
          {},

        kits:
          data.kits ||
          {
            home: data.homeKit || null,
            away: data.awayKit || null,
            third: data.thirdKit || null,
            goalkeeper:
              data.goalkeeperKit || null,
          },

        colors:
          data.colors ||
          {
            primary:
              data.primaryColor ||
              '#111827',
            secondary:
              data.secondaryColor ||
              '#ffffff',
          },

        managerSalary:
          safeNumber(
            data.managerSalary,
            DEFAULT_SALARY
          ),

        salaryPeriod:
          data.salaryPeriod ||
          'weekly',

        signingBonus:
          safeNumber(
            data.signingBonus,
            0
          ),

        releaseClause:
          safeNumber(
            data.releaseClause,
            0
          ),

        status:
          data.status ||
          'available',

        description:
          data.description ||
          '',

        history:
          data.history ||
          {},

        social:
          data.social ||
          {},
      });
    });

    clubs.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      props: {
        initialClubs: clubs,
      },
    };
  } catch (error) {
    console.error(
      'SSR CLUB PAGE ERROR:',
      error
    );

    return {
      props: {
        initialClubs: [],
      },
    };
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function ClubPage({
  initialClubs = [],
}) {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [clubs, setClubs] =
    useState(initialClubs);

  const [careerData, setCareerData] =
    useState(null);

  const [clubInfo, setClubInfo] =
    useState(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [activeTab, setActiveTab] =
    useState('overview');

  const [showContract, setShowContract] =
    useState(false);

  const [selectedClub, setSelectedClub] =
    useState(null);

  const [search, setSearch] =
    useState('');

  const [leagueFilter, setLeagueFilter] =
    useState('all');

  const [playerSearch, setPlayerSearch] =
    useState('');

  /* =======================================================
     USER NAME
  ======================================================= */

  const managerName =
    userData?.displayName ||
    userData?.name ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'Manager';

  /* =======================================================
     AUTH + CAREER
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
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

  /* =======================================================
     LOAD CAREER
  ======================================================= */

  const loadCareer = async () => {
    try {
      setIsLoading(true);

      const userRef = doc(
        db,
        'users',
        user.uid
      );

      const snapshot =
        await getDoc(userRef);

      if (!snapshot.exists()) {
        setCareerData({});
        setClubInfo(null);
        setIsLoading(false);
        return;
      }

      const data =
        snapshot.data();

      const career =
        data.careerData || {};

      setCareerData(career);

      if (career.currentClub) {
        const clubRef = doc(
          db,
          'clubs',
          career.currentClub
        );

        const clubSnapshot =
          await getDoc(clubRef);

        if (clubSnapshot.exists()) {
          const clubData =
            clubSnapshot.data();

          /*
           * Reload players for the current club.
           * This makes sure changes made after SSR
           * are visible.
           */

          let currentPlayers = [];

          try {
            const playersQuery =
              query(
                collection(
                  db,
                  'players'
                ),
                where(
                  'clubId',
                  '==',
                  career.currentClub
                )
              );

            const playerSnapshot =
              await getDocs(
                playersQuery
              );

            playerSnapshot.forEach(
              (playerDoc) => {
                const player =
                  playerDoc.data();

                currentPlayers.push({
                  id: playerDoc.id,
                  ...player,

                  name:
                    getPlayerName(
                      player
                    ),

                  position:
                    getPlayerPosition(
                      player
                    ),

                  age:
                    safeNumber(
                      player.age,
                      0
                    ),

                  overall:
                    safeNumber(
                      player.overall ??
                      player.rating ??
                      player.ovr,
                      0
                    ),

                  marketValue:
                    safeNumber(
                      player.marketValue ??
                      player.value,
                      0
                    ),

                  salary:
                    safeNumber(
                      player.salary ??
                      player.wage,
                      0
                    ),

                  nationality:
                    player.nationality ||
                    player.country ||
                    '',
                });
              }
            );
          } catch (playerError) {
            console.error(
              'Player query error:',
              playerError
            );
          }

          /*
           * If clubId query finds nothing,
           * fallback to all players and match
           * currentClub/teamId/currentClub.
           */

          if (
            currentPlayers.length === 0
          ) {
            try {
              const allPlayersSnapshot =
                await getDocs(
                  collection(
                    db,
                    'players'
                  )
                );

              allPlayersSnapshot.forEach(
                (playerDoc) => {
                  const player =
                    playerDoc.data();

                  const playerClub =
                    getPlayerClubId(
                      player
                    );

                  if (
                    String(
                      playerClub || ''
                    ) ===
                    String(
                      career.currentClub
                    )
                  ) {
                    currentPlayers.push({
                      id:
                        playerDoc.id,
                      ...player,

                      name:
                        getPlayerName(
                          player
                        ),

                      position:
                        getPlayerPosition(
                          player
                        ),

                      age:
                        safeNumber(
                          player.age,
                          0
                        ),

                      overall:
                        safeNumber(
                          player.overall ??
                          player.rating ??
                          player.ovr,
                          0
                        ),

                      marketValue:
                        safeNumber(
                          player.marketValue ??
                          player.value,
                          0
                        ),

                      salary:
                        safeNumber(
                          player.salary ??
                          player.wage,
                          0
                        ),

                      nationality:
                        player.nationality ||
                        player.country ||
                        '',
                    });
                  }
                }
              );
            } catch (fallbackError) {
              console.error(
                'Fallback player loading error:',
                fallbackError
              );
            }
          }

          setClubInfo({
            id:
              clubSnapshot.id,

            ...clubData,

            name:
              clubData.name ||
              clubData.clubName ||
              'Unnamed Club',

            logo:
              clubData.logo ||
              clubData.logoUrl ||
              clubData.badge ||
              null,

            league:
              clubData.league ||
              clubData.leagueName ||
              'Unknown League',

            country:
              clubData.country ||
              clubData.countryName ||
              'Unknown Country',

            leagueName:
              clubData.leagueName ||
              (
                typeof clubData.league ===
                'string'
                  ? clubData.league
                  : ''
              ) ||
              'Unknown League',

            countryName:
              clubData.countryName ||
              (
                typeof clubData.country ===
                'string'
                  ? clubData.country
                  : ''
              ) ||
              'Unknown Country',

            stadium:
              clubData.stadium ||
              'Stadium',

            city:
              clubData.city ||
              clubData.location ||
              '',

            balance:
              safeNumber(
                clubData.balance ??
                clubData.budget,
                0
              ),

            transferBudget:
              safeNumber(
                clubData.transferBudget,
                0
              ),

            wageBudget:
              safeNumber(
                clubData.wageBudget,
                0
              ),

            squadSize:
              currentPlayers.length ||
              safeNumber(
                clubData.squadSize,
                0
              ),

            players:
              currentPlayers,

            kits:
              clubData.kits ||
              {
                home:
                  clubData.homeKit ||
                  null,
                away:
                  clubData.awayKit ||
                  null,
                third:
                  clubData.thirdKit ||
                  null,
              },

            facilities:
              clubData.facilities ||
              {},

            reputation:
              safeNumber(
                clubData.reputation,
                50
              ),
          });
        }
      } else {
        setClubInfo(null);
      }
    } catch (error) {
      console.error(
        'Career loading error:',
        error
      );

      toast.error(
        'Failed to load club career'
      );
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     DERIVED
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    null;

  const contract =
    careerData?.clubContract ||
    null;

  const contractStatus =
    getContractStatus(
      contract
    );

  const boardConfidence =
    safeNumber(
      careerData?.boardConfidence,
      70
    );

  const objectives =
    careerData?.clubObjectives ||
    clubInfo?.objectives ||
    [];

  /* =======================================================
     CLUB FILTER
  ======================================================= */

  const leagues = useMemo(() => {
    return [
      ...new Set(
        clubs
          .map(
            (club) =>
              club.leagueName ||
              safeString(
                club.league,
                'Unknown League'
              )
          )
          .filter(Boolean)
      ),
    ];
  }, [clubs]);

  const filteredClubs =
    useMemo(() => {
      const value =
        search
          .trim()
          .toLowerCase();

      return clubs.filter(
        (club) => {
          const name =
            safeString(
              club.name
            ).toLowerCase();

          const league =
            safeString(
              club.leagueName
            ).toLowerCase();

          const country =
            safeString(
              club.countryName
            ).toLowerCase();

          const matchesSearch =
            !value ||
            name.includes(value) ||
            league.includes(value) ||
            country.includes(value);

          const matchesLeague =
            leagueFilter ===
              'all' ||
            club.leagueName ===
              leagueFilter;

          return (
            matchesSearch &&
            matchesLeague
          );
        }
      );
    }, [
      clubs,
      search,
      leagueFilter,
    ]);

  /* =======================================================
     PLAYERS
  ======================================================= */

  const squad =
    clubInfo?.players ||
    [];

  const filteredPlayers =
    useMemo(() => {
      const value =
        playerSearch
          .trim()
          .toLowerCase();

      if (!value) {
        return squad;
      }

      return squad.filter(
        (player) =>
          getPlayerName(player)
            .toLowerCase()
            .includes(value) ||
          safeString(
            player.position
          )
            .toLowerCase()
            .includes(value) ||
          safeString(
            player.nationality
          )
            .toLowerCase()
            .includes(value)
      );
    }, [
      squad,
      playerSearch,
    ]);

  /* =======================================================
     SELECT CLUB
  ======================================================= */

  const openClubSelection =
    (club) => {
      setSelectedClub(club);
      setShowContract(true);
    };

  /* =======================================================
     ACCEPT CONTRACT
  ======================================================= */

  const acceptClubContract =
    async () => {
      if (
        !user ||
        !selectedClub
      ) {
        return;
      }

      try {
        setSaving(true);

        const startDate =
          new Date().toISOString();

        const endDate =
          addYears(
            startDate,
            DEFAULT_CONTRACT_YEARS
          );

        const contractData = {
          status:
            'active',

          clubId:
            selectedClub.id,

          clubName:
            selectedClub.name,

          role:
            'Head Coach',

          startDate,

          endDate,

          durationYears:
            DEFAULT_CONTRACT_YEARS,

          salary:
            safeNumber(
              selectedClub.managerSalary,
              DEFAULT_SALARY
            ),

          salaryPeriod:
            selectedClub.salaryPeriod ||
            'weekly',

          signingBonus:
            safeNumber(
              selectedClub.signingBonus,
              0
            ),

          releaseClause:
            safeNumber(
              selectedClub.releaseClause,
              0
            ),

          renewalOffered:
            false,

          createdAt:
            startDate,

          updatedAt:
            startDate,
        };

        const objectives =
          selectedClub.objectives?.length
            ? selectedClub.objectives
            : [
                {
                  id: 'league',
                  title:
                    'Finish in a competitive league position',
                  target:
                    'Top half',
                  progress: 0,
                  completed: false,
                },
                {
                  id: 'matches',
                  title:
                    'Build a competitive team',
                  target:
                    'Improve squad quality',
                  progress: 0,
                  completed: false,
                },
                {
                  id: 'finance',
                  title:
                    'Keep club finances healthy',
                  target:
                    'Maintain positive balance',
                  progress: 0,
                  completed: false,
                },
              ];

        const updatedCareer = {
          ...(careerData || {}),

          currentClub:
            selectedClub.id,

          currentClubName:
            selectedClub.name,

          clubContract:
            contractData,

          clubObjectives:
            objectives,

          boardConfidence:
            70,

          managerSalary:
            contractData.salary,

          transferBudget:
            safeNumber(
              selectedClub.transferBudget,
              0
            ),

          wageBudget:
            safeNumber(
              selectedClub.wageBudget,
              0
            ),

          clubBalance:
            safeNumber(
              selectedClub.balance,
              0
            ),

          clubJoinedAt:
            startDate,

          clubSeasons:
            1,
        };

        await updateDoc(
          doc(
            db,
            'users',
            user.uid
          ),
          {
            careerData:
              updatedCareer,

            updatedAt:
              serverTimestamp(),
          }
        );

        /*
         * Mark club as occupied.
         */

        await updateDoc(
          doc(
            db,
            'clubs',
            selectedClub.id
          ),
          {
            managerId:
              user.uid,

            managerName:
              managerName,

            managerStatus:
              'active',

            updatedAt:
              serverTimestamp(),
          }
        );

        setCareerData(
          updatedCareer
        );

        setClubInfo(
          selectedClub
        );

        setClubs(
          (previous) =>
            previous.map(
              (club) =>
                club.id ===
                selectedClub.id
                  ? {
                      ...club,
                      managerId:
                        user.uid,
                      managerName,
                      managerStatus:
                        'active',
                    }
                  : club
            )
        );

        setShowContract(false);
        setSelectedClub(null);

        toast.success(
          `Contract signed with ${selectedClub.name}`
        );

        setActiveTab(
          'overview'
        );
      } catch (error) {
        console.error(
          'Contract error:',
          error
        );

        toast.error(
          'Unable to sign contract'
        );
      } finally {
        setSaving(false);
      }
    };

  /* =======================================================
     RENEW CONTRACT
  ======================================================= */

  const requestRenewal =
    async () => {
      if (
        !user ||
        !contract
      ) {
        return;
      }

      try {
        setSaving(true);

        const newEndDate =
          addYears(
            contract.endDate
              ? dateToISOString(
                  contract.endDate
                )
              : new Date().toISOString(),
            1
          );

        const updatedContract = {
          ...contract,

          status:
            'active',

          endDate:
            newEndDate,

          durationYears:
            safeNumber(
              contract.durationYears,
              2
            ) + 1,

          renewalOffered:
            false,

          updatedAt:
            new Date().toISOString(),
        };

        const updatedCareer = {
          ...(careerData || {}),

          clubContract:
            updatedContract,

          boardConfidence:
            Math.min(
              boardConfidence + 5,
              100
            ),
        };

        await updateDoc(
          doc(
            db,
            'users',
            user.uid
          ),
          {
            careerData:
              updatedCareer,

            updatedAt:
              serverTimestamp(),
          }
        );

        setCareerData(
          updatedCareer
        );

        toast.success(
          'The board has renewed your contract'
        );
      } catch (error) {
        console.error(
          error
        );

        toast.error(
          'Renewal failed'
        );
      } finally {
        setSaving(false);
      }
    };

  /* =======================================================
     LEAVE CLUB
  ======================================================= */

  const leaveClub =
    async () => {
      if (
        !user ||
        !careerData
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          'Are you sure you want to resign from this club?'
        );

      if (!confirmed) {
        return;
      }

      try {
        setSaving(true);

        const oldClubId =
          careerData.currentClub;

        const updatedCareer = {
          ...careerData,

          currentClub:
            null,

          currentClubName:
            null,

          clubContract: {
            ...(careerData.clubContract ||
              {}),

            status:
              'terminated',

            terminatedAt:
              new Date().toISOString(),

            terminationReason:
              'Manager resignation',
          },

          clubObjectives:
            [],

          managerSalary:
            0,

          transferBudget:
            0,

          wageBudget:
            0,

          clubBalance:
            0,

          clubSeasons:
            0,
        };

        await updateDoc(
          doc(
            db,
            'users',
            user.uid
          ),
          {
            careerData:
              updatedCareer,

            updatedAt:
              serverTimestamp(),
          }
        );

        if (oldClubId) {
          try {
            await updateDoc(
              doc(
                db,
                'clubs',
                oldClubId
              ),
              {
                managerId:
                  null,

                managerName:
                  null,

                managerStatus:
                  'available',

                updatedAt:
                  serverTimestamp(),
              }
            );
          } catch (clubError) {
            console.error(
              'Club release error:',
              clubError
            );
          }
        }

        setCareerData(
          updatedCareer
        );

        setClubInfo(null);

        toast.success(
          'You have left the club'
        );
      } catch (error) {
        console.error(
          error
        );

        toast.error(
          'Unable to leave the club'
        );
      } finally {
        setSaving(false);
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
          Loading club management...
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
            Choose Your Club | Virtual Football Manager
          </title>

          <meta
            name="description"
            content="Choose a football club and begin your managerial career."
          />
        </Head>

        <main
          className={
            styles.page
          }
        >
          <section
            className={
              styles.selectionHero
            }
          >
            <div
              className={
                styles.heroBall
              }
            >
              ⚽
            </div>

            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                CLUB MANAGEMENT
              </span>

              <h1>
                Choose Your Club
              </h1>

              <p>
                Welcome,{' '}
                <strong>
                  {managerName}
                </strong>
                . The boardroom is waiting.
                Choose your club and begin
                your managerial career.
              </p>
            </div>
          </section>

          <section
            className={
              styles.clubSelection
            }
          >
            <div
              className={
                styles.selectionToolbar
              }
            >
              <div
                className={
                  styles.searchBox
                }
              >
                <span>
                  🔎
                </span>

                <input
                  type="text"
                  placeholder="Search clubs, leagues or countries..."
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value
                    )
                  }
                />
              </div>

              <select
                value={
                  leagueFilter
                }
                onChange={(event) =>
                  setLeagueFilter(
                    event.target.value
                  )
                }
                className={
                  styles.filter
                }
              >
                <option value="all">
                  All Leagues
                </option>

                {leagues.map(
                  (league) => (
                    <option
                      key={league}
                      value={league}
                    >
                      {league}
                    </option>
                  )
                )}
              </select>
            </div>

            <div
              className={
                styles.clubGrid
              }
            >
              {filteredClubs.length >
              0 ? (
                filteredClubs.map(
                  (club) => (
                    <article
                      key={
                        club.id
                      }
                      className={
                        styles.clubSelectCard
                      }
                    >
                      <div
                        className={
                          styles.clubCardTop
                        }
                      >
                        <div
                          className={
                            styles.clubLogo
                          }
                        >
                          {club.logo ? (
                            <img
                              src={
                                club.logo
                              }
                              alt={
                                club.name
                              }
                            />
                          ) : (
                            '⚽'
                          )}
                        </div>

                        <div>
                          <h2>
                            {
                              club.name
                            }
                          </h2>

                          <span>
                            {
                              club.leagueName
                            }
                          </span>

                          <small>
                            🌍{' '}
                            {
                              club.countryName
                            }
                          </small>
                        </div>
                      </div>

                      <p
                        className={
                          styles.clubDescription
                        }
                      >
                        {club.description ||
                          `${club.name} are looking for a manager capable of leading the club to success.`}
                      </p>

                      <div
                        className={
                          styles.clubQuickStats
                        }
                      >
                        <div>
                          <span>
                            Reputation
                          </span>

                          <strong>
                            {
                              club.reputation
                            }
                          </strong>
                        </div>

                        <div>
                          <span>
                            Players
                          </span>

                          <strong>
                            {
                              club.squadSize
                            }
                          </strong>
                        </div>

                        <div>
                          <span>
                            Transfer
                          </span>

                          <strong>
                            €
                            {formatMoney(
                              club.transferBudget
                            )}
                          </strong>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={
                          styles.chooseButton
                        }
                        onClick={() =>
                          openClubSelection(
                            club
                          )
                        }
                      >
                        <span>
                          Take Job
                        </span>

                        <span>
                          →
                        </span>
                      </button>
                    </article>
                  )
                )
              ) : (
                <div
                  className={
                    styles.noResults
                  }
                >
                  <span>
                    🔎
                  </span>

                  <h3>
                    No clubs found
                  </h3>

                  <p>
                    Try another search,
                    league or country.
                  </p>
                </div>
              )}
            </div>
          </section>

          {showContract &&
            selectedClub && (
              <div
                className={
                  styles.modalOverlay
                }
                onClick={() =>
                  setShowContract(
                    false
                  )
                }
              >
                <div
                  className={
                    styles.contractModal
                  }
                  onClick={(event) =>
                    event.stopPropagation()
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.closeButton
                    }
                    onClick={() =>
                      setShowContract(
                        false
                      )
                    }
                  >
                    ×
                  </button>

                  <div
                    className={
                      styles.modalClub
                    }
                  >
                    <div
                      className={
                        styles.modalLogo
                      }
                    >
                      {selectedClub.logo ? (
                        <img
                          src={
                            selectedClub.logo
                          }
                          alt={
                            selectedClub.name
                          }
                        />
                      ) : (
                        '⚽'
                      )}
                    </div>

                    <div>
                      <span>
                        BOARD OFFER
                      </span>

                      <h2>
                        {
                          selectedClub.name
                        }
                      </h2>

                      <small>
                        {
                          selectedClub.leagueName
                        }{' '}
                        •{' '}
                        {
                          selectedClub.countryName
                        }
                      </small>
                    </div>
                  </div>

                  <div
                    className={
                      styles.contractTerms
                    }
                  >
                    <div>
                      <span>
                        Role
                      </span>

                      <strong>
                        Head Coach
                      </strong>
                    </div>

                    <div>
                      <span>
                        Contract
                      </span>

                      <strong>
                        2 Seasons
                      </strong>
                    </div>

                    <div>
                      <span>
                        Salary
                      </span>

                      <strong>
                        €
                        {formatMoney(
                          selectedClub.managerSalary ||
                            DEFAULT_SALARY
                        )}
                        / week
                      </strong>
                    </div>

                    <div>
                      <span>
                        Transfer Budget
                      </span>

                      <strong>
                        €
                        {formatMoney(
                          selectedClub.transferBudget
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Wage Budget
                      </span>

                      <strong>
                        €
                        {formatMoney(
                          selectedClub.wageBudget
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Stadium
                      </span>

                      <strong>
                        {
                          selectedClub.stadium
                        }
                      </strong>
                    </div>
                  </div>

                  <div
                    className={
                      styles.boardMessage
                    }
                  >
                    <span>
                      👔
                    </span>

                    <p>
                      The board believes
                      you can take this
                      club forward. Your
                      results, finances and
                      objectives will
                      determine your future.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={saving}
                    className={
                      styles.signButton
                    }
                    onClick={
                      acceptClubContract
                    }
                  >
                    {saving
                      ? 'Signing...'
                      : 'Accept Contract'}
                  </button>
                </div>
              </div>
            )}
        </main>
      </>
    );
  }

  /* =======================================================
     ACTIVE CLUB DATA
  ======================================================= */

  const remainingDays =
    contract?.endDate
      ? daysBetween(
          new Date().toISOString(),
          dateToISOString(
            contract.endDate
          )
        )
      : null;

  const confidenceLabel =
    getConfidenceLabel(
      boardConfidence
    );

  const transferBudget =
    safeNumber(
      careerData?.transferBudget,
      clubInfo?.transferBudget || 0
    );

  const wageBudget =
    safeNumber(
      careerData?.wageBudget,
      clubInfo?.wageBudget || 0
    );

  const balance =
    safeNumber(
      careerData?.clubBalance,
      clubInfo?.balance || 0
    );

  const matches =
    safeNumber(
      careerData?.totalMatches,
      0
    );

  const wins =
    safeNumber(
      careerData?.totalWins,
      0
    );

  const losses =
    safeNumber(
      careerData?.totalLosses,
      0
    );

  const draws =
    safeNumber(
      careerData?.totalDraws,
      0
    );

  const leaguePosition =
    careerData?.currentPosition ||
    '-';

  const clubLeague =
    clubInfo?.leagueName ||
    safeString(
      clubInfo?.league,
      'Unknown League'
    );

  const clubCountry =
    clubInfo?.countryName ||
    safeString(
      clubInfo?.country,
      'Unknown Country'
    );

  const clubPlayers =
    clubInfo?.players ||
    [];

  /* =======================================================
     ACTIVE PAGE
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          {clubInfo?.name ||
            'Club Management'}{' '}
          | Virtual Football Manager
        </title>

        <meta
          name="description"
          content={`Manage ${
            clubInfo?.name ||
            'your football club'
          } in Virtual Football Manager.`}
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

        <section
          className={
            styles.clubHeader
          }
        >
          <div
            className={
              styles.clubHeaderLeft
            }
          >
            <div
              className={
                styles.clubHeaderLogo
              }
            >
              {clubInfo?.logo ? (
                <img
                  src={
                    clubInfo.logo
                  }
                  alt={
                    clubInfo.name
                  }
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
                CURRENT CLUB
              </span>

              <h1>
                {clubInfo?.name}
              </h1>

              <p>
                {clubLeague}
              </p>

              <div
                className={
                  styles.clubHeaderMeta
                }
              >
                <span>
                  🌍 {clubCountry}
                </span>

                <span>
                  🏟️{' '}
                  {
                    clubInfo?.stadium
                  }
                </span>

                {clubInfo?.city && (
                  <span>
                    📍{' '}
                    {
                      clubInfo.city
                    }
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            className={
              styles.boardConfidence
            }
          >
            <span>
              BOARD CONFIDENCE
            </span>

            <strong>
              {boardConfidence}%
            </strong>

            <div
              className={
                styles.confidenceTrack
              }
            >
              <div
                className={
                  styles.confidenceBar
                }
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      boardConfidence
                    )
                  )}%`,
                }}
              />
            </div>

            <small>
              {confidenceLabel}
            </small>
          </div>
        </section>

        {/* =================================================
            NAV
        ================================================= */}

        <nav
          className={
            styles.managementNav
          }
        >
          {[
            [
              'overview',
              '🏠',
              'Overview',
            ],
            [
              'board',
              '👔',
              'Board',
            ],
            [
              'squad',
              '👥',
              'Squad',
            ],
            [
              'finance',
              '💰',
              'Finance',
            ],
            [
              'club',
              '🏟️',
              'Club',
            ],
            [
              'contract',
              '📄',
              'Contract',
            ],
          ].map(
            ([id, icon, label]) => (
              <button
                key={id}
                type="button"
                className={
                  activeTab ===
                  id
                    ? styles.activeNav
                    : ''
                }
                onClick={() =>
                  setActiveTab(
                    id
                  )
                }
              >
                <span>
                  {icon}
                </span>

                {label}
              </button>
            )
          )}
        </nav>

        {/* =================================================
            CONTRACT ALERT
        ================================================= */}

        {contractStatus ===
          'expiring' && (
          <section
            className={
              styles.warningBanner
            }
          >
            <span>
              ⚠️
            </span>

            <div>
              <strong>
                Contract Expiring Soon
              </strong>

              <p>
                Your contract expires
                in{' '}
                <b>
                  {
                    remainingDays
                  }
                </b>{' '}
                days.
              </p>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={
                requestRenewal
              }
            >
              Request Renewal
            </button>
          </section>
        )}

        {contractStatus ===
          'expired' && (
          <section
            className={
              styles.dangerBanner
            }
          >
            <span>
              🚨
            </span>

            <div>
              <strong>
                Contract Expired
              </strong>

              <p>
                Your managerial
                contract has expired.
              </p>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={
                requestRenewal
              }
            >
              Renew Contract
            </button>
          </section>
        )}

        {/* =================================================
            OVERVIEW
        ================================================= */}

        {activeTab ===
          'overview' && (
          <section
            className={
              styles.content
            }
          >
            <div
              className={
                styles.statGrid
              }
            >
              <div
                className={
                  styles.metricCard
                }
              >
                <span>
                  LEAGUE POSITION
                </span>

                <strong>
                  {leaguePosition}
                </strong>

                <small>
                  {clubLeague}
                </small>
              </div>

              <div
                className={
                  styles.metricCard
                }
              >
                <span>
                  SQUAD
                </span>

                <strong>
                  {
                    clubPlayers.length
                  }
                </strong>

                <small>
                  Registered players
                </small>
              </div>

              <div
                className={
                  styles.metricCard
                }
              >
                <span>
                  TRANSFER BUDGET
                </span>

                <strong>
                  €
                  {formatMoney(
                    transferBudget
                  )}
                </strong>

                <small>
                  Available
                </small>
              </div>

              <div
                className={
                  styles.metricCard
                }
              >
                <span>
                  CLUB BALANCE
                </span>

                <strong>
                  €
                  {formatMoney(
                    balance
                  )}
                </strong>

                <small>
                  Financial health
                </small>
              </div>
            </div>

            <div
              className={
                styles.twoColumn
              }
            >
              <article
                className={
                  styles.managementCard
                }
              >
                <div
                  className={
                    styles.cardTitle
                  }
                >
                  <div>
                    <span>
                      SEASON
                    </span>

                    <h2>
                      Team Performance
                    </h2>
                  </div>

                  <span>
                    📊
                  </span>
                </div>

                <div
                  className={
                    styles.performanceGrid
                  }
                >
                  <div>
                    <strong>
                      {matches}
                    </strong>

                    <span>
                      Matches
                    </span>
                  </div>

                  <div>
                    <strong
                      className={
                        styles.green
                      }
                    >
                      {wins}
                    </strong>

                    <span>
                      Wins
                    </span>
                  </div>

                  <div>
                    <strong
                      className={
                        styles.yellow
                      }
                    >
                      {draws}
                    </strong>

                    <span>
                      Draws
                    </span>
                  </div>

                  <div>
                    <strong
                      className={
                        styles.red
                      }
                    >
                      {losses}
                    </strong>

                    <span>
                      Losses
                    </span>
                  </div>
                </div>
              </article>

              <article
                className={
                  styles.managementCard
                }
              >
                <div
                  className={
                    styles.cardTitle
                  }
                >
                  <div>
                    <span>
                      BOARD
                    </span>

                    <h2>
                      Current Feeling
                    </h2>
                  </div>

                  <span>
                    👔
                  </span>
                </div>

                <div
                  className={
                    styles.boardFeeling
                  }
                >
                  <div
                    className={
                      styles.boardFace
                    }
                  >
                    {boardConfidence >=
                    70
                      ? '🙂'
                      : boardConfidence >=
                        50
                      ? '😐'
                      : '😟'}
                  </div>

                  <div>
                    <strong>
                      {
                        confidenceLabel
                      }
                    </strong>

                    <p>
                      The board currently
                      has{' '}
                      {
                        boardConfidence
                      }%
                      confidence in{' '}
                      {
                        managerName
                      }.
                    </p>
                  </div>
                </div>
              </article>
            </div>

            <article
              className={
                styles.managementCard
              }
            >
              <div
                className={
                  styles.cardTitle
                }
              >
                <div>
                  <span>
                    BOARD OBJECTIVES
                  </span>

                  <h2>
                    What the Board Wants
                  </h2>
                </div>

                <span>
                  🎯
                </span>
              </div>

              <div
                className={
                  styles.objectives
                }
              >
                {objectives.length >
                0 ? (
                  objectives.map(
                    (
                      objective,
                      index
                    ) => {
                      const progress =
                        safeNumber(
                          objective.progress,
                          0
                        );

                      return (
                        <div
                          key={
                            objective.id ||
                            index
                          }
                          className={
                            styles.objective
                          }
                        >
                          <div
                            className={
                              styles.objectiveIcon
                            }
                          >
                            {objective.completed
                              ? '✓'
                              : '🎯'}
                          </div>

                          <div
                            className={
                              styles.objectiveBody
                            }
                          >
                            <div
                              className={
                                styles.objectiveTop
                              }
                            >
                              <strong>
                                {objective.title ||
                                  objective.name ||
                                  'Club Objective'}
                              </strong>

                              <span>
                                {
                                  progress
                                }
                                %
                              </span>
                            </div>

                            <div
                              className={
                                styles.objectiveTrack
                              }
                            >
                              <div
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.max(
                                      0,
                                      progress
                                    )
                                  )}%`,
                                }}
                              />
                            </div>

                            <small>
                              Target:{' '}
                              {objective.target ||
                                'Complete objective'}
                            </small>
                          </div>
                        </div>
                      );
                    }
                  )
                ) : (
                  <div
                    className={
                      styles.empty
                    }
                  >
                    No board objectives
                    yet.
                  </div>
                )}
              </div>
            </article>
          </section>
        )}

        {/* =================================================
            BOARD
        ================================================= */}

        {activeTab ===
          'board' && (
          <section
            className={
              styles.content
            }
          >
            <article
              className={
                styles.boardRoom
              }
            >
              <div
                className={
                  styles.boardRoomHeader
                }
              >
                <div>
                  <span>
                    BOARDROOM
                  </span>

                  <h1>
                    Board Management
                  </h1>

                  <p>
                    Your relationship with
                    the board determines how
                    long you remain in charge.
                  </p>
                </div>

                <div
                  className={
                    styles.bigConfidence
                  }
                >
                  <strong>
                    {
                      boardConfidence
                    }
                    %
                  </strong>

                  <span>
                    Confidence
                  </span>
                </div>
              </div>

              <div
                className={
                  styles.boardRules
                }
              >
                <div>
                  <span>
                    🏆
                  </span>

                  <div>
                    <strong>
                      Results
                    </strong>

                    <p>
                      League position and
                      match results affect
                      board confidence.
                    </p>
                  </div>
                </div>

                <div>
                  <span>
                    💰
                  </span>

                  <div>
                    <strong>
                      Finance
                    </strong>

                    <p>
                      Overspending can damage
                      the board's trust.
                    </p>
                  </div>
                </div>

                <div>
                  <span>
                    🎯
                  </span>

                  <div>
                    <strong>
                      Objectives
                    </strong>

                    <p>
                      Completing objectives
                      improves job security.
                    </p>
                  </div>
                </div>
              </div>
            </article>
          </section>
        )}

        {/* =================================================
            SQUAD
        ================================================= */}

        {activeTab ===
          'squad' && (
          <section
            className={
              styles.content
            }
          >
            <article
              className={
                styles.managementCard
              }
            >
              <div
                className={
                  styles.cardTitle
                }
              >
                <div>
                  <span>
                    FIRST TEAM
                  </span>

                  <h2>
                    Squad Management
                  </h2>
                </div>

                <span>
                  👥
                </span>
              </div>

              <div
                className={
                  styles.squadOverview
                }
              >
                <div>
                  <strong>
                    {
                      clubPlayers.length
                    }
                  </strong>

                  <span>
                    Players
                  </span>
                </div>

                <div>
                  <strong>
                    €
                    {formatMoney(
                      wageBudget
                    )}
                  </strong>

                  <span>
                    Wage Budget
                  </span>
                </div>

                <div>
                  <strong>
                    €
                    {formatMoney(
                      transferBudget
                    )}
                  </strong>

                  <span>
                    Transfer Budget
                  </span>
                </div>
              </div>

              <div
                className={
                  styles.squadToolbar
                }
              >
                <input
                  type="text"
                  placeholder="Search player..."
                  value={
                    playerSearch
                  }
                  onChange={(event) =>
                    setPlayerSearch(
                      event.target.value
                    )
                  }
                />
              </div>

              {filteredPlayers.length >
              0 ? (
                <div
                  className={
                    styles.playerGrid
                  }
                >
                  {filteredPlayers.map(
                    (player) => (
                      <article
                        key={
                          player.id
                        }
                        className={
                          styles.playerCard
                        }
                      >
                        <div
                          className={
                            styles.playerAvatar
                          }
                        >
                          {player.photo ||
                          player.image ? (
                            <img
                              src={
                                player.photo ||
                                player.image
                              }
                              alt={getPlayerName(
                                player
                              )}
                            />
                          ) : (
                            '👤'
                          )}
                        </div>

                        <div
                          className={
                            styles.playerMain
                          }
                        >
                          <h3>
                            {getPlayerName(
                              player
                            )}
                          </h3>

                          <span>
                            {getPlayerPosition(
                              player
                            )}
                          </span>

                          <small>
                            {player.nationality ||
                              'Unknown nationality'}
                          </small>
                        </div>

                        <div
                          className={
                            styles.playerRating
                          }
                        >
                          <strong>
                            {safeNumber(
                              player.overall,
                              0
                            ) || '-'}
                          </strong>

                          <span>
                            OVR
                          </span>
                        </div>

                        <div
                          className={
                            styles.playerDetails
                          }
                        >
                          <span>
                            Age
                          </span>

                          <strong>
                            {player.age ||
                              '-'}
                          </strong>

                          <span>
                            Value
                          </span>

                          <strong>
                            €
                            {formatMoney(
                              player.marketValue
                            )}
                          </strong>

                          <span>
                            Wage
                          </span>

                          <strong>
                            €
                            {formatMoney(
                              player.salary
                            )}
                          </strong>
                        </div>
                      </article>
                    )
                  )}
                </div>
              ) : (
                <div
                  className={
                    styles.empty
                  }
                >
                  <span>
                    👥
                  </span>

                  <h3>
                    No players found
                  </h3>

                  <p>
                    No players are currently
                    registered with this club.
                  </p>
                </div>
              )}
            </article>
          </section>
        )}

        {/* =================================================
            FINANCE
        ================================================= */}

        {activeTab ===
          'finance' && (
          <section
            className={
              styles.content
            }
          >
            <div
              className={
                styles.statGrid
              }
            >
              <div
                className={
                  styles.financeCard
                }
              >
                <span>
                  CLUB BALANCE
                </span>

                <strong>
                  €
                  {formatMoney(
                    balance
                  )}
                </strong>

                <small>
                  Current funds
                </small>
              </div>

              <div
                className={
                  styles.financeCard
                }
              >
                <span>
                  TRANSFER BUDGET
                </span>

                <strong>
                  €
                  {formatMoney(
                    transferBudget
                  )}
                </strong>

                <small>
                  Transfer market
                </small>
              </div>

              <div
                className={
                  styles.financeCard
                }
              >
                <span>
                  WAGE BUDGET
                </span>

                <strong>
                  €
                  {formatMoney(
                    wageBudget
                  )}
                </strong>

                <small>
                  Player salaries
                </small>
              </div>
            </div>

            <article
              className={
                styles.managementCard
              }
            >
              <div
                className={
                  styles.cardTitle
                }
              >
                <div>
                  <span>
                    FINANCE
                  </span>

                  <h2>
                    Club Financial Health
                  </h2>
                </div>

                <span>
                  💰
                </span>
              </div>

              <div
                className={
                  styles.financeNotice
                }
              >
                <span>
                  💡
                </span>

                <div>
                  <strong>
                    Protect the club finances
                  </strong>

                  <p>
                    Transfer spending,
                    wages, bonuses and
                    operational costs affect
                    your board confidence.
                  </p>
                </div>
              </div>
            </article>
          </section>
        )}

        {/* =================================================
            CLUB INFORMATION
        ================================================= */}

        {activeTab ===
          'club' && (
          <section
            className={
              styles.content
            }
          >
            <div
              className={
                styles.clubDetailsGrid
              }
            >
              <article
                className={
                  styles.managementCard
                }
              >
                <div
                  className={
                    styles.cardTitle
                  }
                >
                  <div>
                    <span>
                      CLUB PROFILE
                    </span>

                    <h2>
                      {
                        clubInfo?.name
                      }
                    </h2>
                  </div>

                  <span>
                    🏟️
                  </span>
                </div>

                <div
                  className={
                    styles.infoList
                  }
                >
                  <div>
                    <span>
                      Country
                    </span>

                    <strong>
                      {
                        clubCountry
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      League
                    </span>

                    <strong>
                      {
                        clubLeague
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Stadium
                    </span>

                    <strong>
                      {
                        clubInfo?.stadium ||
                        '-'
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Location
                    </span>

                    <strong>
                      {
                        clubInfo?.city ||
                        '-'
                      }
                    </strong>
                  </div>

                  <div>
                    <span>
                      Founded
                    </span>

                    <strong>
                      {formatDate(
                        clubInfo?.founded
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Reputation
                    </span>

                    <strong>
                      {
                        clubInfo?.reputation ||
                        0
                      }
                    </strong>
                  </div>
                </div>
              </article>

              <article
                className={
                  styles.managementCard
                }
              >
                <div
                  className={
                    styles.cardTitle
                  }
                >
                  <div>
                    <span>
                      FACILITIES
                    </span>

                    <h2>
                      Club Facilities
                    </h2>
                  </div>

                  <span>
                    🏗️
                  </span>
                </div>

                <div
                  className={
                    styles.facilityGrid
                  }
                >
                  {Object.keys(
                    clubInfo?.facilities ||
                      {}
                  ).length >
                  0 ? (
                    Object.entries(
                      clubInfo.facilities
                    ).map(
                      ([key, value]) => (
                        <div
                          key={
                            key
                          }
                        >
                          <span>
                            {key}
                          </span>

                          <strong>
                            {safeString(
                              value,
                              '-'
                            )}
                          </strong>
                        </div>
                      )
                    )
                  ) : (
                    <p>
                      No facility data
                      available.
                    </p>
                  )}
                </div>
              </article>
            </div>

            <article
              className={
                styles.managementCard
              }
            >
              <div
                className={
                  styles.cardTitle
                }
              >
                <div>
                  <span>
                    KIT
                  </span>

                  <h2>
                    Club Jerseys
                  </h2>
                </div>

                <span>
                  👕
                </span>
              </div>

              <div
                className={
                  styles.kitGrid
                }
              >
                {[
                  [
                    'Home',
                    clubInfo?.kits
                      ?.home,
                  ],
                  [
                    'Away',
                    clubInfo?.kits
                      ?.away,
                  ],
                  [
                    'Third',
                    clubInfo?.kits
                      ?.third,
                  ],
                  [
                    'Goalkeeper',
                    clubInfo?.kits
                      ?.goalkeeper,
                  ],
                ].map(
                  ([name, kit]) => (
                    <div
                      key={
                        name
                      }
                      className={
                        styles.kitCard
                      }
                    >
                      {kit ? (
                        typeof kit ===
                          'string' &&
                        kit.startsWith(
                          'http'
                        ) ? (
                          <img
                            src={kit}
                            alt={`${name} kit`}
                          />
                        ) : (
                          <div
                            className={
                              styles.kitText
                            }
                          >
                            {
                              kit
                            }
                          </div>
                        )
                      ) : (
                        <div
                          className={
                            styles.kitPlaceholder
                          }
                        >
                          👕
                        </div>
                      )}

                      <strong>
                        {name} Kit
                      </strong>
                    </div>
                  )
                )}
              </div>
            </article>
          </section>
        )}

        {/* =================================================
            CONTRACT
        ================================================= */}

        {activeTab ===
          'contract' && (
          <section
            className={
              styles.content
            }
          >
            <article
              className={
                styles.contractPage
              }
            >
              <div
                className={
                  styles.contractPageHeader
                }
              >
                <div>
                  <span>
                    MANAGER CONTRACT
                  </span>

                  <h1>
                    {
                      contract?.role ||
                      'Head Coach'
                    }
                  </h1>

                  <p>
                    {
                      clubInfo?.name
                    }
                  </p>
                </div>

                <div
                  className={
                    styles.contractStatus
                  }
                >
                  <span>
                    STATUS
                  </span>

                  <strong>
                    {contractStatus ===
                    'expiring'
                      ? 'EXPIRING'
                      : contractStatus ===
                        'expired'
                      ? 'EXPIRED'
                      : 'ACTIVE'}
                  </strong>
                </div>
              </div>

              <div
                className={
                  styles.contractGrid
                }
              >
                <div>
                  <span>
                    MANAGER
                  </span>

                  <strong>
                    {
                      managerName
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    START DATE
                  </span>

                  <strong>
                    {formatDate(
                      contract?.startDate
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    END DATE
                  </span>

                  <strong>
                    {formatDate(
                      contract?.endDate
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    TIME REMAINING
                  </span>

                  <strong>
                    {remainingDays !==
                    null
                      ? `${Math.max(
                          0,
                          remainingDays
                        )} days`
                      : '-'}
                  </strong>
                </div>

                <div>
                  <span>
                    SALARY
                  </span>

                  <strong>
                    €
                    {formatMoney(
                      contract?.salary
                    )}
                    / week
                  </strong>
                </div>

                <div>
                  <span>
                    SIGNING BONUS
                  </span>

                  <strong>
                    €
                    {formatMoney(
                      contract?.signingBonus
                    )}
                  </strong>
                </div>
              </div>

              {remainingDays !==
                null &&
                remainingDays <=
                  CONTRACT_WARNING_DAYS && (
                  <div
                    className={
                      styles.renewalBox
                    }
                  >
                    <span>
                      📋
                    </span>

                    <div>
                      <strong>
                        Contract Review
                      </strong>

                      <p>
                        The board is reviewing
                        your future with the
                        club.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={
                        requestRenewal
                      }
                    >
                      Request Renewal
                    </button>
                  </div>
                )}

              <button
                type="button"
                className={
                  styles.leaveButton
                }
                disabled={saving}
                onClick={
                  leaveClub
                }
              >
                Resign from Club
              </button>
            </article>
          </section>
        )}
      </main>
    </>
  );
}
