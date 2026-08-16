import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './club.module.css';


/* =========================================================
   HELPERS
========================================================= */

const CONTRACT_WARNING_DAYS = 60;
const CONTRACT_EXPIRED = 0;

const DEFAULT_CONTRACT_YEARS = 2;

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function formatMoney(value) {
  const amount = safeNumber(value);

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value) {
  if (!value) return '-';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString();
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
    contract.endDate
  );

  if (remaining <= CONTRACT_EXPIRED) {
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


/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const clubsSnapshot = await getDocs(
      collection(db, 'clubs')
    );

    const clubs = [];

    clubsSnapshot.forEach((clubDoc) => {
      const data = clubDoc.data();

      clubs.push({
        id: clubDoc.id,

        name: data.name || 'Unnamed Club',

        logo: data.logo || null,

        league: data.league || 'Unknown League',

        country: data.country || '',

        stadium: data.stadium || '',

        city: data.city || '',

        founded: data.founded || null,

        reputation: safeNumber(
          data.reputation,
          50
        ),

        transferBudget: safeNumber(
          data.transferBudget,
          1000000
        ),

        wageBudget: safeNumber(
          data.wageBudget,
          100000
        ),

        balance: safeNumber(
          data.balance,
          5000000
        ),

        squadSize: safeNumber(
          data.squadSize,
          0
        ),

        boardExpectation:
          data.boardExpectation ||
          'Build a competitive team',

        objectives:
          Array.isArray(data.objectives)
            ? data.objectives
            : [],

        facilities:
          data.facilities || {},

        status:
          data.status || 'available',

        description:
          data.description || '',
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
      'SSR clubs error:',
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


  /* =======================================================
     LOAD USER CAREER
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
        setIsLoading(false);
        return;
      }

      const data = snapshot.data();

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
          setClubInfo({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
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
     DERIVED DATA
  ======================================================= */

  const currentClubId =
    careerData?.currentClub || null;

  const contract =
    careerData?.clubContract || null;

  const contractStatus =
    getContractStatus(contract);

  const boardConfidence =
    safeNumber(
      careerData?.boardConfidence,
      70
    );

  const objectives =
    careerData?.clubObjectives ||
    clubInfo?.objectives ||
    [];

  const filteredClubs =
    useMemo(() => {
      return clubs.filter((club) => {
        const searchValue =
          search.trim().toLowerCase();

        const matchesSearch =
          !searchValue ||
          club.name
            .toLowerCase()
            .includes(searchValue) ||
          club.league
            .toLowerCase()
            .includes(searchValue) ||
          club.country
            .toLowerCase()
            .includes(searchValue);

        const matchesLeague =
          leagueFilter === 'all' ||
          club.league === leagueFilter;

        return (
          matchesSearch &&
          matchesLeague
        );
      });
    }, [
      clubs,
      search,
      leagueFilter,
    ]);

  const leagues = useMemo(() => {
    return [
      ...new Set(
        clubs
          .map((club) => club.league)
          .filter(Boolean)
      ),
    ];
  }, [clubs]);


  /* =======================================================
     SELECT CLUB
  ======================================================= */

  const openClubSelection = (club) => {
    setSelectedClub(club);
    setShowContract(true);
  };


  /* =======================================================
     CREATE CONTRACT
  ======================================================= */

  const acceptClubContract = async () => {
    if (!user || !selectedClub) {
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

      const objectives =
        selectedClub.objectives?.length
          ? selectedClub.objectives
          : [
              {
                id: 'league',
                title:
                  'Finish in a competitive league position',
                target: 'Top half',
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

      const contractData = {
        status: 'active',

        clubId: selectedClub.id,

        clubName:
          selectedClub.name,

        role: 'Head Coach',

        startDate,

        endDate,

        durationYears:
          DEFAULT_CONTRACT_YEARS,

        salary:
          safeNumber(
            selectedClub.managerSalary,
            50000
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

        renewalOffered: false,

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString(),
      };

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

        boardConfidence: 70,

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

        clubJoinedAt:
          startDate,

        clubSeasons:
          1,
      };

      const userRef = doc(
        db,
        'users',
        user.uid
      );

      await updateDoc(
        userRef,
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

      setClubInfo(
        selectedClub
      );

      setShowContract(false);
      setSelectedClub(null);

      toast.success(
        `Contract signed with ${selectedClub.name}`
      );

      setActiveTab('overview');
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
     RESIGN / RENEW CONTRACT
  ======================================================= */

  const requestRenewal = async () => {
    if (!user || !contract) {
      return;
    }

    try {
      setSaving(true);

      const newEndDate =
        addYears(
          contract.endDate
            ? contract.endDate
            : new Date().toISOString(),
          1
        );

      const updatedContract = {
        ...contract,

        status: 'active',

        endDate:
          newEndDate,

        durationYears:
          safeNumber(
            contract.durationYears,
            2
          ) + 1,

        renewalOffered: false,

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

  const leaveClub = async () => {
    if (!user || !careerData) {
      return;
    }

    const confirmed =
      window.confirm(
        'Are you sure you want to leave the club?'
      );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);

      const updatedCareer = {
        ...careerData,

        currentClub: null,

        currentClubName: null,

        clubContract: {
          ...(careerData.clubContract || {}),
          status: 'terminated',
          terminatedAt:
            new Date().toISOString(),
          terminationReason:
            'Manager resignation',
        },

        clubObjectives: [],

        managerSalary: 0,

        transferBudget: 0,

        wageBudget: 0,

        clubSeasons: 0,
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
      <div className={styles.loading}>
        <div className={styles.spinner}></div>

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

        <main className={styles.page}>

          <section className={styles.selectionHero}>

            <div className={styles.heroBall}>
              ⚽
            </div>

            <div>
              <span className={styles.eyebrow}>
                CLUB MANAGEMENT
              </span>

              <h1>
                Choose Your Club
              </h1>

              <p>
                The boardroom is waiting. Pick a club,
                negotiate your first contract and begin
                building your legacy.
              </p>
            </div>

          </section>


          <section className={styles.clubSelection}>

            <div className={styles.selectionToolbar}>

              <div className={styles.searchBox}>
                <span>⌕</span>

                <input
                  type="text"
                  placeholder="Search clubs..."
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value
                    )
                  }
                />
              </div>

              <select
                value={leagueFilter}
                onChange={(event) =>
                  setLeagueFilter(
                    event.target.value
                  )
                }
                className={styles.filter}
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


            <div className={styles.clubGrid}>

              {filteredClubs.length > 0 ? (
                filteredClubs.map(
                  (club) => (
                    <article
                      key={club.id}
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
                              src={club.logo}
                              alt={club.name}
                            />
                          ) : (
                            '⚽'
                          )}
                        </div>

                        <div>
                          <h2>
                            {club.name}
                          </h2>

                          <span>
                            {club.league}
                          </span>
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
                            {club.reputation}
                          </strong>
                        </div>

                        <div>
                          <span>
                            Transfer
                          </span>

                          <strong>
                            €{formatMoney(
                              club.transferBudget
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>
                            Stadium
                          </span>

                          <strong>
                            {club.stadium ||
                              'N/A'}
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
                  <span>🔎</span>

                  <h3>
                    No clubs found
                  </h3>

                  <p>
                    Try another search or league.
                  </p>
                </div>
              )}

            </div>

          </section>


          {/* CONTRACT MODAL */}

          {showContract &&
            selectedClub && (
              <div
                className={
                  styles.modalOverlay
                }
                onClick={() =>
                  setShowContract(false)
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
                      setShowContract(false)
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
                        {selectedClub.name}
                      </h2>
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
                          50000
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
                        Board Expectation
                      </span>

                      <strong>
                        {selectedClub.boardExpectation}
                      </strong>
                    </div>

                  </div>


                  <div
                    className={
                      styles.boardMessage
                    }
                  >
                    <span>👔</span>

                    <p>
                      The board believes you can
                      take this club forward. Your
                      performance will determine
                      whether they extend your stay.
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
     ACTIVE CLUB DASHBOARD
  ======================================================= */

  const remainingDays =
    contract?.endDate
      ? daysBetween(
          new Date().toISOString(),
          contract.endDate
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


  return (
    <>
      <Head>
        <title>
          {clubInfo?.name || 'Club Management'} | Virtual Football Manager
        </title>

        <meta
          name="description"
          content={`Manage ${clubInfo?.name || 'your club'} in Virtual Football Manager.`}
        />
      </Head>


      <main className={styles.page}>

        {/* =================================================
            CLUB HEADER
        ================================================= */}

        <section className={styles.clubHeader}>

          <div className={styles.clubHeaderLeft}>

            <div
              className={
                styles.clubHeaderLogo
              }
            >
              {clubInfo?.logo ? (
                <img
                  src={clubInfo.logo}
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
                {clubInfo?.name ||
                  careerData?.currentClubName}
              </h1>

              <p>
                {clubInfo?.league ||
                  'Professional Football Club'}
              </p>

              <div
                className={
                  styles.clubHeaderMeta
                }
              >
                <span>
                  🏟️{' '}
                  {clubInfo?.stadium ||
                    'Stadium'}
                </span>

                <span>
                  🌍{' '}
                  {clubInfo?.country ||
                    'Country'}
                </span>
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
            NAVIGATION
        ================================================= */}

        <nav
          className={
            styles.managementNav
          }
        >

          {[
            ['overview', '🏠', 'Overview'],
            ['board', '👔', 'Board'],
            ['squad', '👥', 'Squad'],
            ['finance', '💰', 'Finance'],
            ['contract', '📄', 'Contract'],
          ].map(
            ([id, icon, label]) => (
              <button
                key={id}
                type="button"
                className={
                  activeTab === id
                    ? styles.activeNav
                    : ''
                }
                onClick={() =>
                  setActiveTab(id)
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
            CONTRACT WARNING
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
                Your contract expires in{' '}
                <b>
                  {remainingDays}
                </b>{' '}
                days. The board is reviewing
                your performance.
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
                Your contract has expired.
                The board must decide whether
                to offer you a new deal.
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
                  Current standing
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
                  €{formatMoney(
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
                  WEEKLY WAGE
                </span>

                <strong>
                  €
                  {formatMoney(
                    contract?.salary ||
                    careerData?.managerSalary ||
                    0
                  )}
                </strong>

                <small>
                  Manager salary
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
                  €{formatMoney(
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

              {/* SEASON PERFORMANCE */}

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


              {/* BOARD */}

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
                    {boardConfidence >= 70
                      ? '🙂'
                      : boardConfidence >= 50
                      ? '😐'
                      : '😟'}
                  </div>

                  <div>

                    <strong>
                      {confidenceLabel}
                    </strong>

                    <p>
                      The board currently
                      has {boardConfidence}%
                      confidence in your
                      management.
                    </p>

                  </div>

                </div>

              </article>

            </div>


            {/* OBJECTIVES */}

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

                {objectives.length > 0 ? (
                  objectives.map(
                    (objective, index) => {

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
                                {progress}%
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
                    No board objectives yet.
                  </div>
                )}

              </div>

            </article>

          </section>
        )}


        {/* =================================================
            BOARD TAB
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
                    Your relationship with the
                    club hierarchy determines how
                    long you keep your job.
                  </p>
                </div>

                <div
                  className={
                    styles.bigConfidence
                  }
                >
                  <strong>
                    {boardConfidence}%
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
                      League performance and
                      match results influence
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
                      improves your job security.
                    </p>
                  </div>
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
                    MANAGEMENT
                  </span>

                  <h2>
                    Managerial Decisions
                  </h2>
                </div>

                <span>
                  ⚙️
                </span>
              </div>


              <div
                className={
                  styles.actionGrid
                }
              >

                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      'squad'
                    )
                  }
                >
                  <span>
                    👥
                  </span>

                  <strong>
                    Squad Management
                  </strong>

                  <small>
                    Review your players
                  </small>
                </button>


                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      'finance'
                    )
                  }
                >
                  <span>
                    💰
                  </span>

                  <strong>
                    Club Finance
                  </strong>

                  <small>
                    Manage budgets
                  </small>
                </button>


                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      'contract'
                    )
                  }
                >
                  <span>
                    📄
                  </span>

                  <strong>
                    Contract
                  </strong>

                  <small>
                    Review your deal
                  </small>
                </button>

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
                    {clubInfo?.squadSize ||
                      careerData?.squadSize ||
                      0}
                  </strong>

                  <span>
                    Players
                  </span>
                </div>

                <div>
                  <strong>
                    €{formatMoney(
                      wageBudget
                    )}
                  </strong>

                  <span>
                    Wage Budget
                  </span>
                </div>

                <div>
                  <strong>
                    €{formatMoney(
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
                  styles.comingSoon
                }
              >

                <span>
                  👥
                </span>

                <h3>
                  Squad Room
                </h3>

                <p>
                  Player contracts, formations,
                  starting XI, training and
                  transfer negotiations will be
                  managed here.
                </p>

              </div>

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
                  €{formatMoney(
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
                  €{formatMoney(
                    transferBudget
                  )}
                </strong>

                <small>
                  Player transfers
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
                  €{formatMoney(
                    wageBudget
                  )}
                </strong>

                <small>
                  Salary budget
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
                    CLUB FINANCE
                  </span>

                  <h2>
                    Financial Management
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
                    Transfer spending, player wages,
                    bonuses and club income should
                    remain within the board's budget.
                  </p>
                </div>

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
                    {contract?.role ||
                      'Head Coach'}
                  </h1>

                  <p>
                    {clubInfo?.name}
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
                    {remainingDays !== null
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
                        your future with the club.
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
