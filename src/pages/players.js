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
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './players.module.css';


/* =========================================================
   HELPERS
========================================================= */

const MAX_SCOUT_RESULTS = 8;

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getPlayerAge(player) {
  if (player.age) return safeNumber(player.age, 0);

  if (player.dateOfBirth) {
    const dob = new Date(player.dateOfBirth);

    if (!Number.isNaN(dob.getTime())) {
      const today = new Date();

      let age =
        today.getFullYear() -
        dob.getFullYear();

      const month =
        today.getMonth() -
        dob.getMonth();

      if (
        month < 0 ||
        (
          month === 0 &&
          today.getDate() < dob.getDate()
        )
      ) {
        age--;
      }

      return age;
    }
  }

  return 0;
}

function getPosition(player) {
  return (
    player.position ||
    player.primaryPosition ||
    player.role ||
    'Unknown'
  );
}

function getOverall(player) {
  return safeNumber(
    player.overall ??
      player.rating ??
      player.overallRating,
    0
  );
}

function getValue(player) {
  return safeNumber(
    player.marketValue ??
      player.value ??
      player.askingPrice,
    0
  );
}

function getAskingPrice(player) {
  const price =
    player.askingPrice ??
    player.transferFee ??
    player.marketValue ??
    player.value;

  return safeNumber(price, 0);
}

function getTransferStatus(player) {
  return (
    player.transferStatus ||
    player.status ||
    'available'
  );
}

function getClubId(player) {
  return (
    player.clubId ||
    player.currentClub ||
    player.teamId ||
    null
  );
}

function getClubName(player) {
  return (
    player.clubName ||
    player.currentClubName ||
    player.teamName ||
    'Free Agent'
  );
}

function getContractEnd(player) {
  return (
    player.contractEnd ||
    player.contractEndDate ||
    null
  );
}

function daysUntil(date) {
  if (!date) return null;

  const target = new Date(date);

  if (Number.isNaN(target.getTime())) {
    return null;
  }

  return Math.ceil(
    (
      target.getTime() -
      Date.now()
    ) /
      (1000 * 60 * 60 * 24)
  );
}

function statusLabel(status) {
  switch (normalize(status)) {
    case 'listed':
    case 'transfer':
    case 'transfer-listed':
      return 'Transfer Listed';

    case 'loan':
    case 'loan-listed':
      return 'Loan Listed';

    case 'unavailable':
      return 'Unavailable';

    case 'free':
    case 'free-agent':
      return 'Free Agent';

    default:
      return 'Available';
  }
}

function statusClass(status) {
  switch (normalize(status)) {
    case 'listed':
    case 'transfer':
    case 'transfer-listed':
      return 'listed';

    case 'loan':
    case 'loan-listed':
      return 'loan';

    case 'unavailable':
      return 'unavailable';

    case 'free':
    case 'free-agent':
      return 'free';

    default:
      return 'available';
  }
}


/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      playersSnapshot,
      clubsSnapshot,
      leaguesSnapshot,
      countriesSnapshot,
    ] = await Promise.all([
      getDocs(collection(db, 'players')),
      getDocs(collection(db, 'clubs')),
      getDocs(collection(db, 'leagues')),
      getDocs(collection(db, 'countries')),
    ]);

    const players = playersSnapshot.docs.map(
      (playerDoc) => ({
        id: playerDoc.id,
        ...playerDoc.data(),
      })
    );

    const clubs = clubsSnapshot.docs.map(
      (clubDoc) => ({
        id: clubDoc.id,
        ...clubDoc.data(),
      })
    );

    const leagues = leaguesSnapshot.docs.map(
      (leagueDoc) => ({
        id: leagueDoc.id,
        ...leagueDoc.data(),
      })
    );

    const countries = countriesSnapshot.docs.map(
      (countryDoc) => ({
        id: countryDoc.id,
        ...countryDoc.data(),
      })
    );

    return {
      props: {
        initialPlayers: JSON.parse(
          JSON.stringify(players)
        ),
        initialClubs: JSON.parse(
          JSON.stringify(clubs)
        ),
        initialLeagues: JSON.parse(
          JSON.stringify(leagues)
        ),
        initialCountries: JSON.parse(
          JSON.stringify(countries)
        ),
      },
    };
  } catch (error) {
    console.error(
      'Players SSR error:',
      error
    );

    return {
      props: {
        initialPlayers: [],
        initialClubs: [],
        initialLeagues: [],
        initialCountries: [],
      },
    };
  }
}


/* =========================================================
   PAGE
========================================================= */

export default function PlayersPage({
  initialPlayers = [],
  initialClubs = [],
  initialLeagues = [],
  initialCountries = [],
}) {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [players, setPlayers] =
    useState(initialPlayers);

  const [clubs] =
    useState(initialClubs);

  const [leagues] =
    useState(initialLeagues);

  const [countries] =
    useState(initialCountries);

  const [careerData, setCareerData] =
    useState(null);

  const [currentClub, setCurrentClub] =
    useState(null);

  const [activeTab, setActiveTab] =
    useState('squad');

  const [search, setSearch] =
    useState('');

  const [positionFilter, setPositionFilter] =
    useState('all');

  const [statusFilter, setStatusFilter] =
    useState('all');

  const [clubFilter, setClubFilter] =
    useState('all');

  const [sortBy, setSortBy] =
    useState('overall');

  const [selectedPlayer, setSelectedPlayer] =
    useState(null);

  const [showNegotiation, setShowNegotiation] =
    useState(false);

  const [showLoan, setShowLoan] =
    useState(false);

  const [negotiationType, setNegotiationType] =
    useState('transfer');

  const [offerAmount, setOfferAmount] =
    useState('');

  const [loanFee, setLoanFee] =
    useState('');

  const [loanDuration, setLoanDuration] =
    useState('1');

  const [saving, setSaving] =
    useState(false);

  const [isLoading, setIsLoading] =
    useState(true);


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


  const loadCareer = async () => {
    try {
      setIsLoading(true);

      const userRef =
        doc(db, 'users', user.uid);

      const userSnapshot =
        await getDoc(userRef);

      if (!userSnapshot.exists()) {
        setCareerData({});
        setIsLoading(false);
        return;
      }

      const data =
        userSnapshot.data();

      const career =
        data.careerData || {};

      setCareerData(career);

      if (career.currentClub) {
        const clubRef =
          doc(
            db,
            'clubs',
            career.currentClub
          );

        const clubSnapshot =
          await getDoc(clubRef);

        if (clubSnapshot.exists()) {
          setCurrentClub({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error(
        'Career error:',
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
    null;

  const currentClubPlayers =
    useMemo(() => {
      if (!currentClubId) {
        return [];
      }

      return players.filter(
        (player) =>
          getClubId(player) ===
          currentClubId
      );
    }, [
      players,
      currentClubId,
    ]);


  /* =======================================================
     TRANSFER MARKET
  ======================================================= */

  const transferMarket =
    useMemo(() => {
      return players.filter(
        (player) => {
          const clubId =
            getClubId(player);

          const status =
            normalize(
              getTransferStatus(player)
            );

          return (
            clubId !== currentClubId &&
            (
              status === 'listed' ||
              status === 'transfer' ||
              status === 'transfer-listed' ||
              status === 'loan' ||
              status === 'loan-listed' ||
              status === 'free' ||
              status === 'free-agent' ||
              status === 'available'
            )
          );
        }
      );
    }, [
      players,
      currentClubId,
    ]);


  /* =======================================================
     SCOUT SUGGESTIONS
  ======================================================= */

  const scoutSuggestions =
    useMemo(() => {
      const budget =
        safeNumber(
          careerData?.transferBudget,
          currentClub?.transferBudget || 0
        );

      return players
        .filter(
          (player) =>
            getClubId(player) !==
            currentClubId
        )
        .map((player) => {
          const overall =
            getOverall(player);

          const value =
            getValue(player);

          let score =
            overall * 2;

          if (
            budget > 0 &&
            value <= budget
          ) {
            score += 25;
          }

          if (
            normalize(
              getTransferStatus(player)
            ).includes('listed')
          ) {
            score += 15;
          }

          if (
            getPlayerAge(player) > 0 &&
            getPlayerAge(player) <= 23
          ) {
            score += 12;
          }

          return {
            ...player,
            scoutScore: Math.round(
              score
            ),
          };
        })
        .sort(
          (a, b) =>
            b.scoutScore -
            a.scoutScore
        )
        .slice(
          0,
          MAX_SCOUT_RESULTS
        );
    }, [
      players,
      currentClubId,
      careerData,
      currentClub,
    ]);


  /* =======================================================
     FILTERS
  ======================================================= */

  const positions =
    useMemo(() => {
      return [
        ...new Set(
          players
            .map(getPosition)
            .filter(
              (position) =>
                position &&
                position !== 'Unknown'
            )
        ),
      ].sort();
    }, [players]);


  const filteredPlayers =
    useMemo(() => {
      let source =
        activeTab === 'squad'
          ? currentClubPlayers
          : transferMarket;

      const searchValue =
        normalize(search);

      if (searchValue) {
        source =
          source.filter(
            (player) => {
              return (
                normalize(
                  player.name ||
                  player.fullName ||
                  player.firstName
                ).includes(
                  searchValue
                ) ||
                normalize(
                  getPosition(player)
                ).includes(
                  searchValue
                ) ||
                normalize(
                  getClubName(player)
                ).includes(
                  searchValue
                ) ||
                normalize(
                  player.country ||
                  player.nationality
                ).includes(
                  searchValue
                )
              );
            }
          );
      }

      if (
        positionFilter !==
        'all'
      ) {
        source =
          source.filter(
            (player) =>
              getPosition(player) ===
              positionFilter
          );
      }

      if (
        statusFilter !==
        'all'
      ) {
        source =
          source.filter(
            (player) =>
              normalize(
                getTransferStatus(player)
              ) ===
              normalize(
                statusFilter
              )
          );
      }

      if (
        clubFilter !==
        'all'
      ) {
        source =
          source.filter(
            (player) =>
              getClubId(player) ===
              clubFilter
          );
      }

      return [...source].sort(
        (a, b) => {
          switch (sortBy) {
            case 'value':
              return (
                getValue(b) -
                getValue(a)
              );

            case 'age':
              return (
                getPlayerAge(a) -
                getPlayerAge(b)
              );

            case 'name':
              return (
                (
                  a.name ||
                  a.fullName ||
                  ''
                ).localeCompare(
                  b.name ||
                  b.fullName ||
                  ''
                )
              );

            default:
              return (
                getOverall(b) -
                getOverall(a)
              );
          }
        }
      );
    }, [
      activeTab,
      currentClubPlayers,
      transferMarket,
      search,
      positionFilter,
      statusFilter,
      clubFilter,
      sortBy,
    ]);


  /* =======================================================
     PLAYER UPDATE
  ======================================================= */

  const updatePlayer = async (
    playerId,
    data
  ) => {
    try {
      setSaving(true);

      await updateDoc(
        doc(
          db,
          'players',
          playerId
        ),
        {
          ...data,
          updatedAt:
            serverTimestamp(),
        }
      );

      setPlayers(
        (previous) =>
          previous.map(
            (player) =>
              player.id === playerId
                ? {
                    ...player,
                    ...data,
                  }
                : player
          )
      );

      return true;
    } catch (error) {
      console.error(
        'Player update error:',
        error
      );

      toast.error(
        'Player update failed'
      );

      return false;
    } finally {
      setSaving(false);
    }
  };


  /* =======================================================
     LIST FOR TRANSFER
  ======================================================= */

  const listForTransfer = async (
    player
  ) => {
    if (!currentClubId) return;

    const price =
      getAskingPrice(player);

    const success =
      await updatePlayer(
        player.id,
        {
          transferStatus:
            'transfer-listed',

          listedBy:
            currentClubId,

          askingPrice:
            price,

          transferListedAt:
            new Date().toISOString(),
        }
      );

    if (success) {
      toast.success(
        `${player.name || player.fullName} added to transfer list`
      );
    }
  };


  /* =======================================================
     REMOVE TRANSFER LIST
  ======================================================= */

  const removeFromTransfer =
    async (player) => {
      const success =
        await updatePlayer(
          player.id,
          {
            transferStatus:
              'available',

            listedBy: null,

            transferListedAt: null,
          }
        );

      if (success) {
        toast.success(
          'Player removed from transfer list'
        );
      }
    };


  /* =======================================================
     LIST FOR LOAN
  ======================================================= */

  const listForLoan = async (
    player
  ) => {
    const success =
      await updatePlayer(
        player.id,
        {
          transferStatus:
            'loan-listed',

          loanListedBy:
            currentClubId,

          loanListedAt:
            new Date().toISOString(),
        }
      );

    if (success) {
      toast.success(
        'Player added to loan list'
      );
    }
  };


  /* =======================================================
     REMOVE LOAN
  ======================================================= */

  const removeFromLoan =
    async (player) => {
      const success =
        await updatePlayer(
          player.id,
          {
            transferStatus:
              'available',

            loanListedBy: null,

            loanListedAt: null,
          }
        );

      if (success) {
        toast.success(
          'Player removed from loan list'
        );
      }
    };


  /* =======================================================
     OPEN NEGOTIATION
  ======================================================= */

  const openNegotiation =
    (player) => {
      setSelectedPlayer(player);

      setOfferAmount(
        String(
          getAskingPrice(player) ||
          getValue(player) ||
          ''
        )
      );

      setNegotiationType(
        'transfer'
      );

      setShowNegotiation(true);
    };


  /* =======================================================
     MAKE OFFER
  ======================================================= */

  const makeTransferOffer =
    async () => {
      if (
        !selectedPlayer ||
        !currentClubId
      ) {
        return;
      }

      const offer =
        safeNumber(
          offerAmount,
          0
        );

      if (offer <= 0) {
        toast.error(
          'Enter a valid offer'
        );
        return;
      }

      const budget =
        safeNumber(
          careerData?.transferBudget,
          currentClub?.transferBudget || 0
        );

      if (
        budget > 0 &&
        offer > budget
      ) {
        toast.error(
          'The offer exceeds your transfer budget'
        );
        return;
      }

      try {
        setSaving(true);

        const offerData = {
          buyerClubId:
            currentClubId,

          buyerClubName:
            currentClub?.name ||
            careerData?.currentClubName ||
            '',

          playerId:
            selectedPlayer.id,

          playerName:
            selectedPlayer.name ||
            selectedPlayer.fullName ||
            '',

          offerAmount:
            offer,

          askingPrice:
            getAskingPrice(
              selectedPlayer
            ),

          type:
            'transfer',

          status:
            'pending',

          createdAt:
            new Date().toISOString(),
        };

        await updateDoc(
          doc(
            db,
            'players',
            selectedPlayer.id
          ),
          {
            transferOffers:
              arrayUnion(
                offerData
              ),

            latestOffer:
              offerData,

            transferStatus:
              'negotiation',

            updatedAt:
              serverTimestamp(),
          }
        );

        setPlayers(
          (previous) =>
            previous.map(
              (player) =>
                player.id ===
                selectedPlayer.id
                  ? {
                      ...player,
                      transferOffers: [
                        ...(player.transferOffers || []),
                        offerData,
                      ],
                      latestOffer:
                        offerData,
                      transferStatus:
                        'negotiation',
                    }
                  : player
            )
        );

        setShowNegotiation(
          false
        );

        toast.success(
          'Transfer offer submitted'
        );
      } catch (error) {
        console.error(
          'Offer error:',
          error
        );

        toast.error(
          'Could not submit offer'
        );
      } finally {
        setSaving(false);
      }
    };


  /* =======================================================
     LOAN OFFER
  ======================================================= */

  const openLoanOffer =
    (player) => {
      setSelectedPlayer(player);

      setLoanFee('');

      setLoanDuration('1');

      setShowLoan(true);
    };


  const makeLoanOffer =
    async () => {
      if (
        !selectedPlayer ||
        !currentClubId
      ) {
        return;
      }

      const fee =
        safeNumber(
          loanFee,
          0
        );

      const duration =
        safeNumber(
          loanDuration,
          1
        );

      if (duration <= 0) {
        toast.error(
          'Invalid loan duration'
        );
        return;
      }

      try {
        setSaving(true);

        const offerData = {
          buyerClubId:
            currentClubId,

          buyerClubName:
            currentClub?.name ||
            careerData?.currentClubName ||
            '',

          playerId:
            selectedPlayer.id,

          playerName:
            selectedPlayer.name ||
            selectedPlayer.fullName ||
            '',

          loanFee:
            fee,

          durationMonths:
            duration * 12,

          type:
            'loan',

          status:
            'pending',

          createdAt:
            new Date().toISOString(),
        };

        await updateDoc(
          doc(
            db,
            'players',
            selectedPlayer.id
          ),
          {
            loanOffers:
              arrayUnion(
                offerData
              ),

            latestLoanOffer:
              offerData,

            updatedAt:
              serverTimestamp(),
          }
        );

        setShowLoan(false);

        toast.success(
          'Loan offer submitted'
        );
      } catch (error) {
        console.error(
          error
        );

        toast.error(
          'Could not submit loan offer'
        );
      } finally {
        setSaving(false);
      }
    };


  /* =======================================================
     BUY / SIGN PLAYER
  ======================================================= */

  const buyPlayer =
    async (player) => {
      if (
        !currentClubId ||
        !currentClub
      ) {
        return;
      }

      const price =
        getAskingPrice(player);

      const budget =
        safeNumber(
          careerData?.transferBudget,
          currentClub.transferBudget || 0
        );

      if (
        budget > 0 &&
        price > budget
      ) {
        toast.error(
          'The asking price is above your transfer budget'
        );
        return;
      }

      const confirmed =
        window.confirm(
          `Submit an offer of €${money(price)} for ${
            player.name ||
            player.fullName ||
            'this player'
          }?`
        );

      if (!confirmed) {
        return;
      }

      setOfferAmount(
        String(price)
      );

      setSelectedPlayer(player);

      setShowNegotiation(true);
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
          Loading transfer centre...
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
            Players & Transfers | Virtual Football Manager
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
            ⚽
          </div>

          <h1>
            No Club Assigned
          </h1>

          <p>
            You need to take charge of a
            club before managing players
            and transfers.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push('/club')
            }
          >
            Choose a Club
          </button>
        </main>
      </>
    );
  }


  /* =======================================================
     DASHBOARD
  ======================================================= */

  const transferBudget =
    safeNumber(
      careerData?.transferBudget,
      currentClub?.transferBudget || 0
    );

  const wageBudget =
    safeNumber(
      careerData?.wageBudget,
      currentClub?.wageBudget || 0
    );

  const listedPlayers =
    currentClubPlayers.filter(
      (player) => {
        const status =
          normalize(
            getTransferStatus(player)
          );

        return (
          status ===
            'transfer-listed' ||
          status ===
            'loan-listed' ||
          status === 'listed' ||
          status === 'loan'
        );
      }
    );

  const contractWarnings =
    currentClubPlayers.filter(
      (player) => {
        const days =
          daysUntil(
            getContractEnd(player)
          );

        return (
          days !== null &&
          days >= 0 &&
          days <= 180
        );
      }
    );


  return (
    <>
      <Head>
        <title>
          Players & Transfers |{' '}
          {currentClub?.name ||
            'Club'}
        </title>

        <meta
          name="description"
          content="Manage your squad, transfers, loans and scouting."
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
                  alt={
                    currentClub.name
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
                FOOTBALL OPERATIONS
              </span>

              <h1>
                Players & Transfers
              </h1>

              <p>
                {currentClub?.name ||
                  careerData?.currentClubName}
              </p>
            </div>

          </div>


          <div
            className={
              styles.headerBudgets
            }
          >

            <div>
              <span>
                TRANSFER BUDGET
              </span>

              <strong>
                €{money(
                  transferBudget
                )}
              </strong>
            </div>

            <div>
              <span>
                WAGE BUDGET
              </span>

              <strong>
                €{money(
                  wageBudget
                )}
              </strong>
            </div>

          </div>

        </header>


        {/* =================================================
            TOP STATS
        ================================================= */}

        <section
          className={
            styles.stats
          }
        >

          <div
            className={
              styles.statCard
            }
          >
            <span>
              👥
            </span>

            <div>
              <small>
                SQUAD
              </small>

              <strong>
                {currentClubPlayers.length}
              </strong>

              <p>
                First team players
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              🔄
            </span>

            <div>
              <small>
                MARKET
              </small>

              <strong>
                {transferMarket.length}
              </strong>

              <p>
                Players available
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              📋
            </span>

            <div>
              <small>
                LISTED
              </small>

              <strong>
                {listedPlayers.length}
              </strong>

              <p>
                Your listed players
              </p>
            </div>
          </div>


          <div
            className={
              styles.statCard
            }
          >
            <span>
              ⏳
            </span>

            <div>
              <small>
                CONTRACTS
              </small>

              <strong>
                {contractWarnings.length}
              </strong>

              <p>
                Expiring within 180 days
              </p>
            </div>
          </div>

        </section>


        {/* =================================================
            NAVIGATION
        ================================================= */}

        <nav
          className={
            styles.tabs
          }
        >

          <button
            className={
              activeTab === 'squad'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab('squad')
            }
          >
            👥 My Squad
          </button>

          <button
            className={
              activeTab === 'market'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab('market')
            }
          >
            🔄 Transfer Market
          </button>

          <button
            className={
              activeTab === 'scouting'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab('scouting')
            }
          >
            🔭 Scout Reports
          </button>

          <button
            className={
              activeTab === 'contracts'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab('contracts')
            }
          >
            📄 Contracts
          </button>

        </nav>


        {/* =================================================
            FILTERS
        ================================================= */}

        {(
          activeTab === 'squad' ||
          activeTab === 'market'
        ) && (
          <section
            className={
              styles.filters
            }
          >

            <div
              className={
                styles.search
              }
            >
              🔎

              <input
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder={
                  activeTab === 'squad'
                    ? 'Search your players...'
                    : 'Search transfer market...'
                }
              />

            </div>


            <select
              value={
                positionFilter
              }
              onChange={(event) =>
                setPositionFilter(
                  event.target.value
                )
              }
            >
              <option value="all">
                All Positions
              </option>

              {positions.map(
                (position) => (
                  <option
                    key={position}
                    value={position}
                  >
                    {position}
                  </option>
                )
              )}
            </select>


            {activeTab ===
              'market' && (
              <select
                value={
                  statusFilter
                }
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value
                  )
                }
              >
                <option value="all">
                  All Status
                </option>

                <option value="transfer-listed">
                  Transfer Listed
                </option>

                <option value="loan-listed">
                  Loan Listed
                </option>

                <option value="available">
                  Available
                </option>
              </select>
            )}


            {activeTab ===
              'market' && (
              <select
                value={
                  clubFilter
                }
                onChange={(event) =>
                  setClubFilter(
                    event.target.value
                  )
                }
              >
                <option value="all">
                  All Clubs
                </option>

                {clubs.map(
                  (club) => (
                    <option
                      key={club.id}
                      value={club.id}
                    >
                      {club.name}
                    </option>
                  )
                )}
              </select>
            )}


            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value
                )
              }
            >
              <option value="overall">
                Best Rated
              </option>

              <option value="value">
                Market Value
              </option>

              <option value="age">
                Youngest
              </option>

              <option value="name">
                Name
              </option>
            </select>

          </section>
        )}


        {/* =================================================
            PLAYER TABLE
        ================================================= */}

        {(
          activeTab === 'squad' ||
          activeTab === 'market'
        ) && (

          <section
            className={
              styles.tableCard
            }
          >

            <div
              className={
                styles.tableHeader
              }
            >
              <div>
                <span>
                  {activeTab ===
                  'squad'
                    ? 'FIRST TEAM'
                    : 'GLOBAL MARKET'}
                </span>

                <h2>
                  {activeTab ===
                  'squad'
                    ? 'Squad'
                    : 'Transfer Market'}
                </h2>
              </div>

              <strong>
                {filteredPlayers.length}{' '}
                players
              </strong>
            </div>


            <div
              className={
                styles.tableWrapper
              }
            >

              <table
                className={
                  styles.playersTable
                }
              >

                <thead>
                  <tr>
                    <th>
                      Player
                    </th>

                    <th>
                      Position
                    </th>

                    <th>
                      Age
                    </th>

                    <th>
                      OVR
                    </th>

                    <th>
                      Club
                    </th>

                    <th>
                      Market Value
                    </th>

                    <th>
                      Asking Price
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Action
                    </th>
                  </tr>
                </thead>


                <tbody>

                  {filteredPlayers.length >
                  0 ? (
                    filteredPlayers.map(
                      (player) => {

                        const playerName =
                          player.name ||
                          player.fullName ||
                          'Unnamed Player';

                        const status =
                          getTransferStatus(
                            player
                          );

                        const isOwnPlayer =
                          getClubId(
                            player
                          ) ===
                          currentClubId;

                        return (
                          <tr
                            key={
                              player.id
                            }
                          >

                            <td>
                              <div
                                className={
                                  styles.playerCell
                                }
                              >

                                <div
                                  className={
                                    styles.playerAvatar
                                  }
                                >
                                  {player.photo ? (
                                    <img
                                      src={
                                        player.photo
                                      }
                                      alt={
                                        playerName
                                      }
                                    />
                                  ) : (
                                    playerName
                                      .charAt(0)
                                      .toUpperCase()
                                  )}
                                </div>

                                <div>
                                  <strong>
                                    {playerName}
                                  </strong>

                                  <small>
                                    {player.nationality ||
                                      player.country ||
                                      'Unknown'}
                                  </small>
                                </div>

                              </div>
                            </td>


                            <td>
                              <span
                                className={
                                  styles.position
                                }
                              >
                                {getPosition(
                                  player
                                )}
                              </span>
                            </td>


                            <td>
                              {getPlayerAge(
                                player
                              ) || '-'}
                            </td>


                            <td>
                              <strong
                                className={
                                  styles.overall
                                }
                              >
                                {getOverall(
                                  player
                                ) || '-'}
                              </strong>
                            </td>


                            <td>
                              <span
                                className={
                                  styles.clubName
                                }
                              >
                                {getClubName(
                                  player
                                )}
                              </span>
                            </td>


                            <td>
                              €
                              {money(
                                getValue(
                                  player
                                )
                              )}
                            </td>


                            <td>
                              <strong>
                                €
                                {money(
                                  getAskingPrice(
                                    player
                                  )
                                )}
                              </strong>
                            </td>


                            <td>
                              <span
                                className={`${styles.status} ${
                                  styles[
                                    statusClass(
                                      status
                                    )
                                  ]
                                }`}
                              >
                                {statusLabel(
                                  status
                                )}
                              </span>
                            </td>


                            <td>
                              <div
                                className={
                                  styles.actions
                                }
                              >

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedPlayer(
                                      player
                                    );

                                    setShowNegotiation(
                                      false
                                    );

                                    setShowLoan(
                                      false
                                    );
                                  }}
                                >
                                  View
                                </button>


                                {isOwnPlayer ? (
                                  <>
                                    {normalize(
                                      status
                                    ) ===
                                    'transfer-listed' ||
                                    normalize(
                                      status
                                    ) ===
                                    'listed' ? (
                                      <button
                                        type="button"
                                        className={
                                          styles.dangerAction
                                        }
                                        onClick={() =>
                                          removeFromTransfer(
                                            player
                                          )
                                        }
                                      >
                                        Remove Transfer
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          listForTransfer(
                                            player
                                          )
                                        }
                                      >
                                        Add Transfer
                                      </button>
                                    )}


                                    {normalize(
                                      status
                                    ) ===
                                    'loan-listed' ||
                                    normalize(
                                      status
                                    ) ===
                                    'loan' ? (
                                      <button
                                        type="button"
                                        className={
                                          styles.dangerAction
                                        }
                                        onClick={() =>
                                          removeFromLoan(
                                            player
                                          )
                                        }
                                      >
                                        Remove Loan
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className={
                                          styles.loanAction
                                        }
                                        onClick={() =>
                                          listForLoan(
                                            player
                                          )
                                        }
                                      >
                                        Add Loan
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className={
                                        styles.buyAction
                                      }
                                      onClick={() =>
                                        buyPlayer(
                                          player
                                        )
                                      }
                                    >
                                      Negotiate
                                    </button>

                                    <button
                                      type="button"
                                      className={
                                        styles.loanAction
                                      }
                                      onClick={() =>
                                        openLoanOffer(
                                          player
                                        )
                                      }
                                    >
                                      Loan
                                    </button>
                                  </>
                                )}

                              </div>
                            </td>

                          </tr>
                        );
                      }
                    )
                  ) : (
                    <tr>
                      <td
                        colSpan="9"
                        className={
                          styles.noPlayers
                        }
                      >
                        No players found.
                      </td>
                    </tr>
                  )}

                </tbody>

              </table>

            </div>

          </section>
        )}


        {/* =================================================
            SCOUTING
        ================================================= */}

        {activeTab ===
          'scouting' && (

          <section
            className={
              styles.scouting
            }
          >

            <div
              className={
                styles.sectionHeading
              }
            >
              <div>
                <span>
                  RECRUITMENT
                </span>

                <h2>
                  Scout Recommendations
                </h2>

                <p>
                  Players your scouting
                  department believes could
                  improve the squad.
                </p>
              </div>

              <span
                className={
                  styles.scoutIcon
                }
              >
                🔭
              </span>
            </div>


            <div
              className={
                styles.scoutGrid
              }
            >

              {scoutSuggestions.map(
                (player) => {

                  const playerName =
                    player.name ||
                    player.fullName ||
                    'Unnamed Player';

                  return (
                    <article
                      key={
                        player.id
                      }
                      className={
                        styles.scoutCard
                      }
                    >

                      <div
                        className={
                          styles.scoutTop
                        }
                      >

                        <div
                          className={
                            styles.largeAvatar
                          }
                        >
                          {player.photo ? (
                            <img
                              src={
                                player.photo
                              }
                              alt={
                                playerName
                              }
                            />
                          ) : (
                            playerName
                              .charAt(0)
                              .toUpperCase()
                          )}
                        </div>

                        <div>
                          <span>
                            SCOUT SCORE
                          </span>

                          <strong>
                            {player.scoutScore}
                          </strong>
                        </div>

                      </div>


                      <h3>
                        {playerName}
                      </h3>

                      <p>
                        {getPosition(
                          player
                        )}{' '}
                        •{' '}
                        {getPlayerAge(
                          player
                        ) || '-'} years
                      </p>


                      <div
                        className={
                          styles.scoutStats
                        }
                      >
                        <div>
                          <span>
                            OVR
                          </span>

                          <strong>
                            {getOverall(
                              player
                            ) || '-'}
                          </strong>
                        </div>

                        <div>
                          <span>
                            VALUE
                          </span>

                          <strong>
                            €
                            {money(
                              getValue(
                                player
                              )
                            )}
                          </strong>
                        </div>

                        <div>
                          <span>
                            CLUB
                          </span>

                          <strong>
                            {getClubName(
                              player
                            )}
                          </strong>
                        </div>
                      </div>


                      <div
                        className={
                          styles.scoutReason
                        }
                      >
                        {getPlayerAge(
                          player
                        ) <= 23
                          ? '🌟 Young development prospect'
                          : '📈 Experienced squad option'}
                      </div>


                      <button
                        type="button"
                        onClick={() =>
                          openNegotiation(
                            player
                          )
                        }
                      >
                        Scout & Negotiate
                      </button>

                    </article>
                  );
                }
              )}

            </div>

          </section>
        )}


        {/* =================================================
            CONTRACTS
        ================================================= */}

        {activeTab ===
          'contracts' && (

          <section
            className={
              styles.tableCard
            }
          >

            <div
              className={
                styles.tableHeader
              }
            >
              <div>
                <span>
                  SQUAD CONTRACTS
                </span>

                <h2>
                  Contract Monitor
                </h2>
              </div>
            </div>


            <div
              className={
                styles.contractList
              }
            >

              {currentClubPlayers.map(
                (player) => {

                  const end =
                    getContractEnd(
                      player
                    );

                  const remaining =
                    daysUntil(end);

                  const warning =
                    remaining !== null &&
                    remaining <= 180;

                  return (
                    <div
                      key={
                        player.id
                      }
                      className={
                        styles.contractRow
                      }
                    >

                      <div>
                        <strong>
                          {player.name ||
                            player.fullName}
                        </strong>

                        <span>
                          {getPosition(
                            player
                          )}
                        </span>
                      </div>


                      <div>
                        <small>
                          Contract Ends
                        </small>

                        <strong
                          className={
                            warning
                              ? styles.contractWarning
                              : ''
                          }
                        >
                          {end
                            ? new Date(
                                end
                              ).toLocaleDateString()
                            : 'No date'}
                        </strong>
                      </div>


                      <div>
                        <small>
                          Remaining
                        </small>

                        <strong
                          className={
                            warning
                              ? styles.contractWarning
                              : ''
                          }
                        >
                          {remaining !== null
                            ? `${Math.max(
                                0,
                                remaining
                              )} days`
                            : '-'}
                        </strong>
                      </div>

                    </div>
                  );
                }
              )}

            </div>

          </section>
        )}


        {/* =================================================
            PLAYER DETAILS
        ================================================= */}

        {selectedPlayer &&
          !showNegotiation &&
          !showLoan && (
          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setSelectedPlayer(null)
            }
          >

            <div
              className={
                styles.playerModal
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
                  setSelectedPlayer(null)
                }
              >
                ×
              </button>


              <div
                className={
                  styles.modalPlayerHeader
                }
              >

                <div
                  className={
                    styles.modalAvatar
                  }
                >
                  {selectedPlayer.photo ? (
                    <img
                      src={
                        selectedPlayer.photo
                      }
                      alt=""
                    />
                  ) : (
                    (
                      selectedPlayer.name ||
                      selectedPlayer.fullName ||
                      '?'
                    )
                      .charAt(0)
                      .toUpperCase()
                  )}
                </div>

                <div>
                  <span>
                    {getPosition(
                      selectedPlayer
                    )}
                  </span>

                  <h2>
                    {selectedPlayer.name ||
                      selectedPlayer.fullName}
                  </h2>

                  <p>
                    {getClubName(
                      selectedPlayer
                    )}
                  </p>
                </div>

              </div>


              <div
                className={
                  styles.detailsGrid
                }
              >

                <div>
                  <span>
                    AGE
                  </span>

                  <strong>
                    {getPlayerAge(
                      selectedPlayer
                    ) || '-'}
                  </strong>
                </div>

                <div>
                  <span>
                    OVERALL
                  </span>

                  <strong>
                    {getOverall(
                      selectedPlayer
                    ) || '-'}
                  </strong>
                </div>

                <div>
                  <span>
                    MARKET VALUE
                  </span>

                  <strong>
                    €
                    {money(
                      getValue(
                        selectedPlayer
                      )
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    ASKING PRICE
                  </span>

                  <strong>
                    €
                    {money(
                      getAskingPrice(
                        selectedPlayer
                      )
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    NATIONALITY
                  </span>

                  <strong>
                    {selectedPlayer.nationality ||
                      selectedPlayer.country ||
                      '-'}
                  </strong>
                </div>

                <div>
                  <span>
                    CONTRACT
                  </span>

                  <strong>
                    {getContractEnd(
                      selectedPlayer
                    )
                      ? new Date(
                          getContractEnd(
                            selectedPlayer
                          )
                        ).toLocaleDateString()
                      : 'Unknown'}
                  </strong>
                </div>

              </div>


              <div
                className={
                  styles.modalActions
                }
              >

                <button
                  type="button"
                  onClick={() =>
                    openNegotiation(
                      selectedPlayer
                    )
                  }
                >
                  Negotiate Transfer
                </button>

                <button
                  type="button"
                  className={
                    styles.loanAction
                  }
                  onClick={() =>
                    openLoanOffer(
                      selectedPlayer
                    )
                  }
                >
                  Make Loan Offer
                </button>

              </div>

            </div>

          </div>
        )}


        {/* =================================================
            TRANSFER NEGOTIATION
        ================================================= */}

        {showNegotiation &&
          selectedPlayer && (

          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowNegotiation(false)
            }
          >

            <div
              className={
                styles.negotiationModal
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
                  setShowNegotiation(false)
                }
              >
                ×
              </button>


              <span
                className={
                  styles.eyebrow
                }
              >
                TRANSFER NEGOTIATION
              </span>

              <h2>
                {selectedPlayer.name ||
                  selectedPlayer.fullName}
              </h2>

              <p>
                {getClubName(
                  selectedPlayer
                )}{' '}
                •{' '}
                {getPosition(
                  selectedPlayer
                )}
              </p>


              <div
                className={
                  styles.negotiationSummary
                }
              >

                <div>
                  <span>
                    Market Value
                  </span>

                  <strong>
                    €
                    {money(
                      getValue(
                        selectedPlayer
                      )
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Asking Price
                  </span>

                  <strong>
                    €
                    {money(
                      getAskingPrice(
                        selectedPlayer
                      )
                    )}
                  </strong>
                </div>

              </div>


              <label>
                Your Transfer Offer

                <div
                  className={
                    styles.moneyInput
                  }
                >
                  <span>
                    €
                  </span>

                  <input
                    type="number"
                    min="0"
                    value={
                      offerAmount
                    }
                    onChange={(event) =>
                      setOfferAmount(
                        event.target.value
                      )
                    }
                  />
                </div>
              </label>


              <div
                className={
                  styles.negotiationHint
                }
              >
                💡 You can offer below the
                asking price. The selling
                club may accept, reject or
                negotiate.
              </div>


              <button
                type="button"
                disabled={saving}
                className={
                  styles.primaryButton
                }
                onClick={
                  makeTransferOffer
                }
              >
                {saving
                  ? 'Submitting...'
                  : 'Submit Offer'}
              </button>

            </div>

          </div>
        )}


        {/* =================================================
            LOAN MODAL
        ================================================= */}

        {showLoan &&
          selectedPlayer && (

          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowLoan(false)
            }
          >

            <div
              className={
                styles.negotiationModal
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
                  setShowLoan(false)
                }
              >
                ×
              </button>


              <span
                className={
                  styles.eyebrow
                }
              >
                LOAN NEGOTIATION
              </span>

              <h2>
                {selectedPlayer.name ||
                  selectedPlayer.fullName}
              </h2>

              <p>
                Request a temporary loan
                agreement.
              </p>


              <label>
                Loan Fee

                <div
                  className={
                    styles.moneyInput
                  }
                >
                  <span>
                    €
                  </span>

                  <input
                    type="number"
                    min="0"
                    value={
                      loanFee
                    }
                    onChange={(event) =>
                      setLoanFee(
                        event.target.value
                      )
                    }
                  />
                </div>
              </label>


              <label>
                Duration

                <select
                  value={
                    loanDuration
                  }
                  onChange={(event) =>
                    setLoanDuration(
                      event.target.value
                    )
                  }
                >
                  <option value="1">
                    1 Season
                  </option>

                  <option value="2">
                    2 Seasons
                  </option>

                  <option value="3">
                    3 Seasons
                  </option>
                </select>
              </label>


              <div
                className={
                  styles.negotiationHint
                }
              >
                📋 The owning club will
                review your loan proposal
                before accepting it.
              </div>


              <button
                type="button"
                disabled={saving}
                className={
                  styles.primaryButton
                }
                onClick={
                  makeLoanOffer
                }
              >
                {saving
                  ? 'Submitting...'
                  : 'Submit Loan Offer'}
              </button>

            </div>

          </div>
        )}

      </main>
    </>
  );
}
