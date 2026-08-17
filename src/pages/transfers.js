import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './transfer.module.css';


/* =========================================================
   CONSTANTS
========================================================= */

const CONTRACT_WAIT_DAYS = 3;
const JOIN_DELAY_DAYS = 1;
const MAX_SUGGESTIONS = 8;


/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function money(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(
    safeNumber(value)
  );
}


function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


function playerName(player) {
  if (!player) return 'Unknown Player';

  return (
    player.name ||
    player.fullName ||
    [
      player.firstName,
      player.lastName,
    ]
      .filter(Boolean)
      .join(' ') ||
    'Unknown Player'
  );
}


function playerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'Unknown'
  );
}


function playerOverall(player) {
  return safeNumber(
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    0
  );
}


function playerValue(player) {
  return safeNumber(
    player?.marketValue ??
      player?.value ??
      player?.askingPrice,
    0
  );
}


function askingPrice(player) {
  return safeNumber(
    player?.askingPrice ??
      player?.transferFee ??
      playerValue(player),
    0
  );
}


function clubId(player) {
  return (
    player?.clubId ||
    player?.currentClub ||
    player?.teamId ||
    null
  );
}


function clubName(player) {
  return (
    player?.clubName ||
    player?.currentClubName ||
    player?.teamName ||
    'Free Agent'
  );
}


function dateValue(value) {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }

  if (
    typeof value === 'object' &&
    value.seconds
  ) {
    return new Date(
      value.seconds * 1000
    );
  }

  const date = new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function formatDate(value) {
  const date = dateValue(value);

  if (!date) return 'Not set';

  return date.toLocaleDateString(
    undefined,
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }
  );
}


function formatDateTime(value) {
  const date = dateValue(value);

  if (!date) return 'Not set';

  return date.toLocaleString(
    undefined,
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}


function addDays(date, days) {
  const base =
    dateValue(date) ||
    new Date();

  return new Date(
    base.getTime() +
      days *
        24 *
        60 *
        60 *
        1000
  ).toISOString();
}


function daysRemaining(value) {
  const date = dateValue(value);

  if (!date) return null;

  return Math.ceil(
    (
      date.getTime() -
      Date.now()
    ) /
      (
        1000 *
        60 *
        60 *
        24
      )
  );
}


function offerStatus(offer) {
  return normalize(
    offer?.status || 'pending'
  );
}


function statusText(status) {
  switch (
    normalize(status)
  ) {
    case 'accepted':
      return 'Accepted';

    case 'rejected':
      return 'Rejected';

    case 'pending':
      return 'Pending';

    case 'negotiation':
      return 'Negotiation';

    case 'contract-offered':
      return 'Contract Offered';

    case 'contract-accepted':
      return 'Contract Accepted';

    case 'joining':
      return 'Joining Club';

    case 'completed':
      return 'Completed';

    case 'expired':
      return 'Expired';

    default:
      return status || 'Pending';
  }
}


function statusClass(status) {
  const value =
    normalize(status);

  if (
    value === 'accepted' ||
    value === 'contract-accepted' ||
    value === 'completed'
  ) {
    return 'success';
  }

  if (
    value === 'rejected' ||
    value === 'expired'
  ) {
    return 'danger';
  }

  if (
    value === 'negotiation' ||
    value === 'contract-offered' ||
    value === 'joining'
  ) {
    return 'warning';
  }

  return 'pending';
}


/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      playersSnapshot,
      clubsSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(
          db,
          'players'
        )
      ),

      getDocs(
        collection(
          db,
          'clubs'
        )
      ),
    ]);

    const players =
      playersSnapshot.docs.map(
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

    return {
      props: {
        initialPlayers:
          JSON.parse(
            JSON.stringify(
              players
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
      'Transfer SSR error:',
      error
    );

    return {
      props: {
        initialPlayers: [],
        initialClubs: [],
      },
    };
  }
}


/* =========================================================
   PAGE
========================================================= */

export default function TransferPage({
  initialPlayers = [],
  initialClubs = [],
}) {
  const router =
    useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [
    players,
    setPlayers,
  ] = useState(
    initialPlayers
  );

  const [
    clubs,
  ] = useState(
    initialClubs
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
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    activeTab,
    setActiveTab,
  ] = useState('incoming');

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('all');

  const [
    selectedBid,
    setSelectedBid,
  ] = useState(null);

  const [
    showBidModal,
    setShowBidModal,
  ] = useState(false);

  const [
    showContractModal,
    setShowContractModal,
  ] = useState(false);

  const [
    contractPlayer,
    setContractPlayer,
  ] = useState(null);

  const [
    contractWage,
    setContractWage,
  ] = useState('');

  const [
    contractBonus,
    setContractBonus,
  ] = useState('');

  const [
    contractYears,
    setContractYears,
  ] = useState('3');

  const [
    contractLoading,
    setContractLoading,
  ] = useState(false);


  /* =======================================================
     LOAD CAREER
  ======================================================= */

  useEffect(() => {
    if (
      !loading &&
      !user
    ) {
      router.push(
        '/login'
      );

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


  async function loadCareer() {
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
        error
      );

      toast.error(
        'Could not load transfer centre'
      );
    } finally {
      setIsLoading(false);
    }
  }


  /* =======================================================
     CLUB
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    null;


  const currentClubPlayers =
    useMemo(() => {
      if (
        !currentClubId
      ) {
        return [];
      }

      return players.filter(
        (player) =>
          clubId(player) ===
          currentClubId
      );
    }, [
      players,
      currentClubId,
    ]);


  const playerMap =
    useMemo(() => {
      return players.reduce(
        (map, player) => {
          map[player.id] =
            player;

          return map;
        },
        {}
      );
    }, [
      players,
    ]);


  const clubMap =
    useMemo(() => {
      return clubs.reduce(
        (map, club) => {
          map[club.id] =
            club;

          return map;
        },
        {}
      );
    }, [
      clubs,
    ]);


  /* =======================================================
     INCOMING BIDS
  ======================================================= */

  const incomingBids =
    useMemo(() => {
      const result = [];

      currentClubPlayers.forEach(
        (player) => {
          const offers =
            Array.isArray(
              player.transferOffers
            )
              ? player.transferOffers
              : [];

          offers.forEach(
            (offer, index) => {
              if (
                !offer ||
                offer.type ===
                  'loan'
              ) {
                return;
              }

              const buyerClubId =
                offer.buyerClubId ||
                offer.fromClubId ||
                offer.clubId;

              if (
                buyerClubId ===
                currentClubId
              ) {
                return;
              }

              result.push({
                ...offer,

                player,

                playerId:
                  player.id,

                offerIndex:
                  index,

                id:
                  offer.id ||
                  `${player.id}-${index}`,

                buyerClubName:
                  offer.buyerClubName ||
                  clubMap[
                    buyerClubId
                  ]?.name ||
                  'Unknown Club',

                buyerClubId,
              });
            }
          );
        }
      );

      return result.sort(
        (a, b) => {
          const aDate =
            dateValue(
              a.createdAt
            )?.getTime() ||
            0;

          const bDate =
            dateValue(
              b.createdAt
            )?.getTime() ||
            0;

          return (
            bDate -
            aDate
          );
        }
      );
    }, [
      currentClubPlayers,
      currentClubId,
      clubMap,
    ]);


  /* =======================================================
     OUTGOING BIDS
  ======================================================= */

  const outgoingBids =
    useMemo(() => {
      const result = [];

      players.forEach(
        (player) => {
          const offers =
            Array.isArray(
              player.transferOffers
            )
              ? player.transferOffers
              : [];

          offers.forEach(
            (offer, index) => {
              if (
                !offer ||
                offer.type ===
                  'loan'
              ) {
                return;
              }

              if (
                offer.buyerClubId !==
                currentClubId
              ) {
                return;
              }

              result.push({
                ...offer,

                player,

                playerId:
                  player.id,

                offerIndex:
                  index,

                id:
                  offer.id ||
                  `${player.id}-${index}`,
              });
            }
          );
        }
      );

      return result.sort(
        (a, b) => {
          const aDate =
            dateValue(
              a.createdAt
            )?.getTime() ||
            0;

          const bDate =
            dateValue(
              b.createdAt
            )?.getTime() ||
            0;

          return (
            bDate -
            aDate
          );
        }
      );
    }, [
      players,
      currentClubId,
    ]);


  /* =======================================================
     CONTRACT OFFERS
  ======================================================= */

  const contractOffers =
    useMemo(() => {
      const result = [];

      players.forEach(
        (player) => {
          const offers =
            Array.isArray(
              player.contractOffers
            )
              ? player.contractOffers
              : [];

          offers.forEach(
            (offer, index) => {
              if (
                offer.clubId !==
                currentClubId
              ) {
                return;
              }

              result.push({
                ...offer,

                player,

                playerId:
                  player.id,

                offerIndex:
                  index,

                id:
                  offer.id ||
                  `${player.id}-contract-${index}`,
              });
            }
          );
        }
      );

      return result;
    }, [
      players,
      currentClubId,
    ]);


  /* =======================================================
     SEARCH + FILTER
  ======================================================= */

  const visibleBids =
    useMemo(() => {
      let source =
        activeTab ===
        'incoming'
          ? incomingBids
          : outgoingBids;

      const term =
        normalize(search);

      if (term) {
        source =
          source.filter(
            (bid) => {
              return (
                normalize(
                  playerName(
                    bid.player
                  )
                ).includes(
                  term
                ) ||
                normalize(
                  bid.buyerClubName
                ).includes(
                  term
                ) ||
                normalize(
                  bid.type
                ).includes(
                  term
                )
              );
            }
          );
      }

      if (
        statusFilter !==
        'all'
      ) {
        source =
          source.filter(
            (bid) =>
              normalize(
                bid.status
              ) ===
              normalize(
                statusFilter
              )
          );
      }

      return source;
    }, [
      activeTab,
      incomingBids,
      outgoingBids,
      search,
      statusFilter,
    ]);


  /* =======================================================
     STATS
  ======================================================= */

  const pendingIncoming =
    incomingBids.filter(
      (bid) =>
        offerStatus(bid) ===
        'pending'
    ).length;

  const pendingOutgoing =
    outgoingBids.filter(
      (bid) =>
        offerStatus(bid) ===
        'pending' ||
        offerStatus(bid) ===
        'negotiation'
    ).length;

  const acceptedDeals =
    [
      ...incomingBids,
      ...outgoingBids,
    ].filter(
      (bid) =>
        offerStatus(bid) ===
        'accepted'
    ).length;


  const contractWaiting =
    contractOffers.filter(
      (offer) =>
        offerStatus(offer) ===
          'contract-offered' ||
        offerStatus(offer) ===
          'contract-accepted'
    ).length;


  /* =======================================================
     GENERAL MANAGER SUGGESTIONS
  ======================================================= */

  const suggestions =
    useMemo(() => {
      const budget =
        safeNumber(
          careerData?.transferBudget,
          currentClub?.transferBudget ||
            0
        );

      const squad =
        currentClubPlayers;

      const positions =
        squad.reduce(
          (map, player) => {
            const pos =
              normalize(
                playerPosition(
                  player
                )
              );

            if (!map[pos]) {
              map[pos] = 0;
            }

            map[pos]++;

            return map;
          },
          {}
        );

      return players
        .filter(
          (player) =>
            clubId(player) !==
            currentClubId
        )
        .map(
          (player) => {
            const position =
              normalize(
                playerPosition(
                  player
                )
              );

            const overall =
              playerOverall(
                player
              );

            const value =
              playerValue(
                player
              );

            let score =
              overall * 2;

            const reasons = [];

            if (
              budget > 0 &&
              value <= budget
            ) {
              score += 30;

              reasons.push(
                'Fits transfer budget'
              );
            }

            if (
              positions[position] <
                2
            ) {
              score += 25;

              reasons.push(
                'Squad needs this position'
              );
            }

            if (
              overall >= 75
            ) {
              score += 15;

              reasons.push(
                'Strong overall rating'
              );
            }

            if (
              safeNumber(
                player.age,
                30
              ) <= 23
            ) {
              score += 12;

              reasons.push(
                'High development potential'
              );
            }

            const status =
              normalize(
                player.transferStatus
              );

            if (
              status.includes(
                'listed'
              ) ||
              status.includes(
                'available'
              )
            ) {
              score += 10;

              reasons.push(
                'Available on the market'
              );
            }

            return {
              player,

              score:
                Math.round(
                  score
                ),

              reasons:
                reasons.slice(
                  0,
                  3
                ),
            };
          }
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(
          0,
          MAX_SUGGESTIONS
        );
    }, [
      players,
      currentClubPlayers,
      currentClubId,
      careerData,
      currentClub,
    ]);


  /* =======================================================
     NAVIGATION
  ======================================================= */

  function openPlayer(
    player
  ) {
    if (!player?.id) {
      return;
    }

    router.push(
      `/player/${player.id}`
    );
  }


  function openClub(
    id
  ) {
    if (!id) return;

    router.push(
      `/club/${id}`
    );
  }


  /* =======================================================
     UPDATE PLAYER
  ======================================================= */

  async function updatePlayer(
    playerId,
    data
  ) {
    try {
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
              player.id ===
              playerId
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
        error
      );

      toast.error(
        'Could not update player'
      );

      return false;
    }
  }


  /* =======================================================
     ACCEPT BID
  ======================================================= */

  async function acceptBid(
    bid
  ) {
    if (
      !bid?.playerId ||
      !currentClubId
    ) {
      return;
    }

    const player =
      playerMap[
        bid.playerId
      ];

    if (!player) {
      toast.error(
        'Player no longer exists'
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Accept €${money(
          bid.offerAmount
        )} offer for ${playerName(
          player
        )}?`
      );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);

      const acceptedOffer = {
        ...bid,
        status:
          'accepted',
        acceptedAt:
          new Date().toISOString(),
      };

      const existingOffers =
        Array.isArray(
          player.transferOffers
        )
          ? player.transferOffers
          : [];

      const updatedOffers =
        existingOffers.map(
          (offer, index) => {
            const same =
              index ===
              bid.offerIndex;

            return same
              ? acceptedOffer
              : offer;
          }
        );

      await updatePlayer(
        player.id,
        {
          transferOffers:
            updatedOffers,

          latestOffer:
            acceptedOffer,

          transferStatus:
            'accepted',

          pendingTransfer:
            {
              ...acceptedOffer,

              fromClubId:
                currentClubId,

              fromClubName:
                currentClub?.name ||
                '',

              toClubId:
                bid.buyerClubId,

              toClubName:
                bid.buyerClubName,

              acceptedAt:
                new Date().toISOString(),

              joiningDate:
                addDays(
                  new Date(),
                  JOIN_DELAY_DAYS
                ),

              status:
                'joining',
            },
        }
      );

      setSelectedBid(null);
      setShowBidModal(false);

      toast.success(
        'Transfer accepted. Player will join the new club after the transition period.'
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not accept transfer'
      );
    } finally {
      setSaving(false);
    }
  }


  /* =======================================================
     REJECT BID
  ======================================================= */

  async function rejectBid(
    bid
  ) {
    if (!bid?.playerId) {
      return;
    }

    const player =
      playerMap[
        bid.playerId
      ];

    if (!player) {
      return;
    }

    const confirmed =
      window.confirm(
        `Reject the offer for ${playerName(
          player
        )}?`
      );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);

      const offers =
        Array.isArray(
          player.transferOffers
        )
          ? player.transferOffers
          : [];

      const updatedOffers =
        offers.map(
          (offer, index) =>
            index ===
            bid.offerIndex
              ? {
                  ...offer,
                  status:
                    'rejected',
                  rejectedAt:
                    new Date().toISOString(),
                }
              : offer
        );

      await updatePlayer(
        player.id,
        {
          transferOffers:
            updatedOffers,

          latestOffer:
            {
              ...bid,
              status:
                'rejected',
            },

          transferStatus:
            'available',
        }
      );

      setSelectedBid(null);
      setShowBidModal(false);

      toast.success(
        'Offer rejected'
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not reject offer'
      );
    } finally {
      setSaving(false);
    }
  }


  /* =======================================================
     CONTRACT MODAL
  ======================================================= */

  function openContract(
    player
  ) {
    setContractPlayer(
      player
    );

    setContractWage(
      String(
        safeNumber(
          player?.wage ||
            player?.salary,
          0
        )
      )
    );

    setContractBonus('');

    setContractYears('3');

    setShowContractModal(
      true
    );
  }


  /* =======================================================
     CONTRACT OFFER
  ======================================================= */

  async function makeContractOffer() {
    if (
      !contractPlayer ||
      !currentClubId
    ) {
      return;
    }

    const wage =
      safeNumber(
        contractWage,
        0
      );

    const bonus =
      safeNumber(
        contractBonus,
        0
      );

    const years =
      safeNumber(
        contractYears,
        3
      );

    if (
      wage <= 0
    ) {
      toast.error(
        'Enter a valid weekly wage'
      );

      return;
    }

    if (
      years <= 0
    ) {
      toast.error(
        'Contract duration is invalid'
      );

      return;
    }

    try {
      setContractLoading(
        true
      );

      const contract = {
        id:
          `${currentClubId}-${contractPlayer.id}-${Date.now()}`,

        clubId:
          currentClubId,

        clubName:
          currentClub?.name ||
          '',

        playerId:
          contractPlayer.id,

        playerName:
          playerName(
            contractPlayer
          ),

        weeklyWage:
          wage,

        signingBonus:
          bonus,

        years,

        status:
          'contract-offered',

        negotiationRound:
          1,

        secondChanceUsed:
          false,

        createdAt:
          new Date().toISOString(),

        responseDeadline:
          addDays(
            new Date(),
            CONTRACT_WAIT_DAYS
          ),
      };

      await updatePlayer(
        contractPlayer.id,
        {
          contractOffers:
            arrayUnion(
              contract
            ),

          latestContractOffer:
            contract,

          transferStatus:
            'contract-offered',
        }
      );

      setShowContractModal(
        false
      );

      setContractPlayer(
        null
      );

      toast.success(
        'Contract offer sent. The player now has a response period.'
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not send contract offer'
      );
    } finally {
      setContractLoading(
        false
      );
    }
  }


  /* =======================================================
     SECOND NEGOTIATION
  ======================================================= */

  async function secondNegotiation(
    contract
  ) {
    const player =
      playerMap[
        contract.playerId
      ];

    if (!player) {
      toast.error(
        'Player not found'
      );

      return;
    }

    if (
      contract.secondChanceUsed
    ) {
      toast.error(
        'The second negotiation chance has already been used.'
      );

      return;
    }

    const newWage =
      window.prompt(
        `New weekly wage for ${playerName(
          player
        )}:`,
        String(
          contract.weeklyWage ||
            ''
        )
      );

    if (
      newWage === null
    ) {
      return;
    }

    const wage =
      safeNumber(
        newWage,
        0
      );

    if (
      wage <= 0
    ) {
      toast.error(
        'Invalid wage'
      );

      return;
    }

    try {
      setSaving(true);

      const updatedContract = {
        ...contract,

        weeklyWage:
          wage,

        negotiationRound:
          2,

        secondChanceUsed:
          true,

        status:
          'contract-offered',

        createdAt:
          new Date().toISOString(),

        responseDeadline:
          addDays(
            new Date(),
            CONTRACT_WAIT_DAYS
          ),
      };

      const offers =
        Array.isArray(
          player.contractOffers
        )
          ? player.contractOffers
          : [];

      const updatedOffers =
        offers.map(
          (item, index) =>
            index ===
            contract.offerIndex
              ? updatedContract
              : item
        );

      await updatePlayer(
        player.id,
        {
          contractOffers:
            updatedOffers,

          latestContractOffer:
            updatedContract,

          transferStatus:
            'contract-offered',
        }
      );

      toast.success(
        'Second negotiation offer sent'
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not update negotiation'
      );
    } finally {
      setSaving(false);
    }
  }


  /* =======================================================
     COMPLETE JOINING TRANSFER
  ======================================================= */

  async function completeJoining(
    bid
  ) {
    const player =
      playerMap[
        bid.playerId
      ];

    if (!player) {
      return;
    }

    const joiningDate =
      dateValue(
        bid?.pendingTransfer
          ?.joiningDate
      );

    if (
      joiningDate &&
      joiningDate.getTime() >
        Date.now()
    ) {
      toast.error(
        `Player joins on ${formatDate(
          joiningDate
        )}`
      );

      return;
    }

    const destination =
      bid?.pendingTransfer
        ?.toClubId ||
      bid?.buyerClubId;

    if (!destination) {
      return;
    }

    try {
      setSaving(true);

      await updatePlayer(
        player.id,
        {
          clubId:
            destination,

          currentClub:
            destination,

          clubIdUpdatedAt:
            new Date().toISOString(),

          transferStatus:
            'completed',

          pendingTransfer:
            null,
        }
      );

      toast.success(
        `${playerName(
          player
        )} has joined the new club`
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not complete transfer'
      );
    } finally {
      setSaving(false);
    }
  }


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
            Transfer Centre
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
            🔄
          </div>

          <h1>
            No Club Assigned
          </h1>

          <p>
            You need to manage a club
            before you can negotiate
            transfers.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push(
                '/club'
              )
            }
          >
            Choose Club
          </button>
        </main>
      </>
    );
  }


  /* =======================================================
     BUDGETS
  ======================================================= */

  const transferBudget =
    safeNumber(
      careerData?.transferBudget,
      currentClub?.transferBudget ||
        0
    );

  const wageBudget =
    safeNumber(
      careerData?.wageBudget,
      currentClub?.wageBudget ||
        0
    );


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Transfer Centre |{' '}
          {currentClub?.name ||
            'Club'}
        </title>

        <meta
          name="description"
          content="Manage transfer bids, contract negotiations, incoming offers and General Manager recommendations."
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
              styles.headerLeft
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
                FOOTBALL OPERATIONS
              </span>

              <h1>
                Transfer Centre
              </h1>

              <p>
                {currentClub?.name}
              </p>
            </div>

          </div>


          <div
            className={
              styles.budgetPanel
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
            SUMMARY
        ================================================= */}

        <section
          className={
            styles.summaryGrid
          }
        >

          <article
            className={
              styles.summaryCard
            }
          >
            <span>
              📥
            </span>

            <div>
              <small>
                INCOMING
              </small>

              <strong>
                {pendingIncoming}
              </strong>

              <p>
                Offers awaiting decision
              </p>
            </div>
          </article>


          <article
            className={
              styles.summaryCard
            }
          >
            <span>
              📤
            </span>

            <div>
              <small>
                OUTGOING
              </small>

              <strong>
                {pendingOutgoing}
              </strong>

              <p>
                Your active bids
              </p>
            </div>
          </article>


          <article
            className={
              styles.summaryCard
            }
          >
            <span>
              ✍️
            </span>

            <div>
              <small>
                CONTRACTS
              </small>

              <strong>
                {contractWaiting}
              </strong>

              <p>
                Players considering offers
              </p>
            </div>
          </article>


          <article
            className={
              styles.summaryCard
            }
          >
            <span>
              ✅
            </span>

            <div>
              <small>
                DEALS
              </small>

              <strong>
                {acceptedDeals}
              </strong>

              <p>
                Accepted transfers
              </p>
            </div>
          </article>

        </section>


        {/* =================================================
            GM ALERT
        ================================================= */}

        {suggestions.length >
          0 && (
          <section
            className={
              styles.gmBanner
            }
          >

            <div
              className={
                styles.gmAvatar
              }
            >
              GM
            </div>

            <div>
              <span>
                GENERAL MANAGER
              </span>

              <strong>
                I have identified
                potential recruitment
                targets for the club.
              </strong>

              <p>
                Based on squad needs,
                budget, player rating
                and market availability.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  'suggestions'
                )
              }
            >
              View Recommendations
            </button>

          </section>
        )}


        {/* =================================================
            NAV
        ================================================= */}

        <nav
          className={
            styles.tabs
          }
        >

          <button
            className={
              activeTab ===
              'incoming'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'incoming'
              )
            }
          >
            📥 Incoming Bids

            {pendingIncoming >
              0 && (
              <b>
                {pendingIncoming}
              </b>
            )}
          </button>


          <button
            className={
              activeTab ===
              'outgoing'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'outgoing'
              )
            }
          >
            📤 My Bids
          </button>


          <button
            className={
              activeTab ===
              'contracts'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'contracts'
              )
            }
          >
            ✍️ Contracts
          </button>


          <button
            className={
              activeTab ===
              'suggestions'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'suggestions'
              )
            }
          >
            🧠 GM Suggestions
          </button>

        </nav>


        {/* =================================================
            BID LISTS
        ================================================= */}

        {(
          activeTab ===
            'incoming' ||
          activeTab ===
            'outgoing'
        ) && (

          <section
            className={
              styles.contentCard
            }
          >

            <div
              className={
                styles.contentHeader
              }
            >

              <div>
                <span>
                  TRANSFER MARKET
                </span>

                <h2>
                  {activeTab ===
                  'incoming'
                    ? 'Offers for Your Players'
                    : 'Your Transfer Bids'}
                </h2>
              </div>


              <div
                className={
                  styles.headerTools
                }
              >

                <div
                  className={
                    styles.search
                  }
                >
                  🔎

                  <input
                    value={
                      search
                    }
                    onChange={(
                      event
                    ) =>
                      setSearch(
                        event
                          .target
                          .value
                      )
                    }
                    placeholder="Search player or club..."
                  />
                </div>


                <select
                  value={
                    statusFilter
                  }
                  onChange={(
                    event
                  ) =>
                    setStatusFilter(
                      event
                        .target
                        .value
                    )
                  }
                >
                  <option value="all">
                    All Status
                  </option>

                  <option value="pending">
                    Pending
                  </option>

                  <option value="accepted">
                    Accepted
                  </option>

                  <option value="rejected">
                    Rejected
                  </option>

                  <option value="negotiation">
                    Negotiation
                  </option>
                </select>

              </div>

            </div>


            <div
              className={
                styles.tableWrapper
              }
            >

              <table
                className={
                  styles.transferTable
                }
              >

                <thead>
                  <tr>

                    <th>
                      Player
                    </th>

                    <th>
                      Club
                    </th>

                    <th>
                      Offer
                    </th>

                    <th>
                      Asking
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Submitted
                    </th>

                    <th>
                      Action
                    </th>

                  </tr>
                </thead>


                <tbody>

                  {visibleBids.length >
                  0 ? (
                    visibleBids.map(
                      (bid) => {

                        const player =
                          bid.player;

                        const status =
                          offerStatus(
                            bid
                          );

                        return (
                          <tr
                            key={
                              bid.id
                            }
                          >

                            <td>
                              <button
                                type="button"
                                className={
                                  styles.playerButton
                                }
                                onClick={() =>
                                  openPlayer(
                                    player
                                  )
                                }
                              >

                                <div
                                  className={
                                    styles.avatar
                                  }
                                >
                                  {player?.photo ? (
                                    <img
                                      src={
                                        player.photo
                                      }
                                      alt=""
                                    />
                                  ) : (
                                    playerName(
                                      player
                                    )
                                      .charAt(
                                        0
                                      )
                                      .toUpperCase()
                                  )}
                                </div>

                                <span>
                                  <strong>
                                    {playerName(
                                      player
                                    )}
                                  </strong>

                                  <small>
                                    {playerPosition(
                                      player
                                    )}{' '}
                                    • OVR{' '}
                                    {playerOverall(
                                      player
                                    )}
                                  </small>
                                </span>

                              </button>
                            </td>


                            <td>
                              <button
                                type="button"
                                className={
                                  styles.clubButton
                                }
                                onClick={() =>
                                  openClub(
                                    bid.buyerClubId
                                  )
                                }
                              >
                                {bid.buyerClubName ||
                                  'Unknown Club'}
                              </button>
                            </td>


                            <td>
                              <strong
                                className={
                                  styles.offerAmount
                                }
                              >
                                €
                                {money(
                                  bid.offerAmount
                                )}
                              </strong>
                            </td>


                            <td>
                              €
                              {money(
                                bid.askingPrice ||
                                  askingPrice(
                                    player
                                  )
                              )}
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
                                {statusText(
                                  status
                                )}
                              </span>
                            </td>


                            <td>
                              <small
                                className={
                                  styles.date
                                }
                              >
                                {formatDate(
                                  bid.createdAt
                                )}
                              </small>
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
                                    setSelectedBid(
                                      bid
                                    );

                                    setShowBidModal(
                                      true
                                    );
                                  }}
                                >
                                  View
                                </button>


                                {activeTab ===
                                  'incoming' &&
                                  status ===
                                    'pending' && (
                                    <>
                                      <button
                                        type="button"
                                        className={
                                          styles.acceptButton
                                        }
                                        disabled={
                                          saving
                                        }
                                        onClick={() =>
                                          acceptBid(
                                            bid
                                          )
                                        }
                                      >
                                        Accept
                                      </button>

                                      <button
                                        type="button"
                                        className={
                                          styles.rejectButton
                                        }
                                        disabled={
                                          saving
                                        }
                                        onClick={() =>
                                          rejectBid(
                                            bid
                                          )
                                        }
                                      >
                                        Reject
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
                        colSpan="7"
                        className={
                          styles.emptyTable
                        }
                      >
                        <div>
                          <span>
                            📭
                          </span>

                          <strong>
                            No transfer
                            activity
                          </strong>

                          <p>
                            There are no
                            offers matching
                            your current
                            filters.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}

                </tbody>

              </table>

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
              styles.contentCard
            }
          >

            <div
              className={
                styles.contentHeader
              }
            >

              <div>
                <span>
                  PLAYER NEGOTIATIONS
                </span>

                <h2>
                  Contract Offers
                </h2>
              </div>

            </div>


            <div
              className={
                styles.contractGrid
              }
            >

              {contractOffers.length >
              0 ? (
                contractOffers.map(
                  (contract) => {

                    const remaining =
                      daysRemaining(
                        contract.responseDeadline
                      );

                    const player =
                      contract.player;

                    const status =
                      offerStatus(
                        contract
                      );

                    return (
                      <article
                        key={
                          contract.id
                        }
                        className={
                          styles.contractCard
                        }
                      >

                        <div
                          className={
                            styles.contractTop
                          }
                        >

                          <div
                            className={
                              styles.avatarLarge
                            }
                          >
                            {player?.photo ? (
                              <img
                                src={
                                  player.photo
                                }
                                alt=""
                              />
                            ) : (
                              playerName(
                                player
                              )
                                .charAt(
                                  0
                                )
                                .toUpperCase()
                            )}
                          </div>

                          <div>
                            <span>
                              {playerPosition(
                                player
                              )}
                            </span>

                            <h3>
                              {playerName(
                                player
                              )}
                            </h3>

                            <p>
                              {clubName(
                                player
                              )}
                            </p>
                          </div>

                        </div>


                        <div
                          className={
                            styles.contractStats
                          }
                        >

                          <div>
                            <small>
                              WEEKLY WAGE
                            </small>

                            <strong>
                              €
                              {money(
                                contract.weeklyWage
                              )}
                            </strong>
                          </div>

                          <div>
                            <small>
                              BONUS
                            </small>

                            <strong>
                              €
                              {money(
                                contract.signingBonus
                              )}
                            </strong>
                          </div>

                          <div>
                            <small>
                              TERM
                            </small>

                            <strong>
                              {contract.years ||
                                0}{' '}
                              yrs
                            </strong>
                          </div>

                        </div>


                        <div
                          className={
                            styles.contractStatus
                          }
                        >

                          <span
                            className={`${styles.status} ${
                              styles[
                                statusClass(
                                  status
                                )
                              ]
                            }`}
                          >
                            {statusText(
                              status
                            )}
                          </span>


                          {remaining !==
                            null && (
                            <span>
                              {remaining >
                              0
                                ? `${remaining} days remaining`
                                : 'Response deadline reached'}
                            </span>
                          )}

                        </div>


                        <div
                          className={
                            styles.contractActions
                          }
                        >

                          {status ===
                            'contract-offered' && (
                            <button
                              type="button"
                              onClick={() =>
                                secondNegotiation(
                                  contract
                                )
                              }
                              disabled={
                                contract.secondChanceUsed ||
                                saving
                              }
                            >
                              {contract.secondChanceUsed
                                ? 'Second Chance Used'
                                : 'Second Negotiation'}
                            </button>
                          )}

                          <button
                            type="button"
                            className={
                              styles.secondaryButton
                            }
                            onClick={() =>
                              openPlayer(
                                player
                              )
                            }
                          >
                            View Player
                          </button>

                        </div>

                      </article>
                    );
                  }
                )
              ) : (
                <div
                  className={
                    styles.emptyState
                  }
                >
                  <span>
                    ✍️
                  </span>

                  <h3>
                    No active contracts
                  </h3>

                  <p>
                    Contract negotiations
                    with players will
                    appear here.
                  </p>
                </div>
              )}

            </div>

          </section>
        )}


        {/* =================================================
            GM SUGGESTIONS
        ================================================= */}

        {activeTab ===
          'suggestions' && (

          <section
            className={
              styles.contentCard
            }
          >

            <div
              className={
                styles.contentHeader
              }
            >

              <div>
                <span>
                  MANAGEMENT INTELLIGENCE
                </span>

                <h2>
                  General Manager
                  Recommendations
                </h2>

                <p>
                  Recruitment targets
                  selected according to
                  your squad profile and
                  financial situation.
                </p>
              </div>

              <div
                className={
                  styles.gmBadge
                }
              >
                🧠 GM
              </div>

            </div>


            <div
              className={
                styles.suggestionGrid
              }
            >

              {suggestions.map(
                ({
                  player,
                  score,
                  reasons,
                }) => (
                  <article
                    key={
                      player.id
                    }
                    className={
                      styles.suggestionCard
                    }
                  >

                    <div
                      className={
                        styles.suggestionHeader
                      }
                    >

                      <div
                        className={
                          styles.avatarLarge
                        }
                      >
                        {player.photo ? (
                          <img
                            src={
                              player.photo
                            }
                            alt=""
                          />
                        ) : (
                          playerName(
                            player
                          )
                            .charAt(
                              0
                            )
                            .toUpperCase()
                        )}
                      </div>


                      <div>
                        <span>
                          GM SCORE
                        </span>

                        <strong>
                          {score}
                        </strong>
                      </div>

                    </div>


                    <h3>
                      {playerName(
                        player
                      )}
                    </h3>

                    <p>
                      {playerPosition(
                        player
                      )}{' '}
                      • OVR{' '}
                      {playerOverall(
                        player
                      )}
                    </p>


                    <div
                      className={
                        styles.suggestionInfo
                      }
                    >

                      <div>
                        <span>
                          VALUE
                        </span>

                        <strong>
                          €
                          {money(
                            playerValue(
                              player
                            )
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>
                          ASKING
                        </span>

                        <strong>
                          €
                          {money(
                            askingPrice(
                              player
                            )
                          )}
                        </strong>
                      </div>

                    </div>


                    <div
                      className={
                        styles.reasons
                      }
                    >
                      {reasons.map(
                        (
                          reason,
                          index
                        ) => (
                          <span
                            key={
                              index
                            }
                          >
                            ✓{' '}
                            {reason}
                          </span>
                        )
                      )}
                    </div>


                    <div
                      className={
                        styles.suggestionActions
                      }
                    >

                      <button
                        type="button"
                        onClick={() =>
                          openPlayer(
                            player
                          )
                        }
                      >
                        View Player
                      </button>

                      <button
                        type="button"
                        className={
                          styles.acceptButton
                        }
                        onClick={() =>
                          router.push(
                            `/players?player=${player.id}`
                          )
                        }
                      >
                        Start Negotiation
                      </button>

                    </div>

                  </article>
                )
              )}

            </div>

          </section>
        )}


        {/* =================================================
            BID MODAL
        ================================================= */}

        {showBidModal &&
          selectedBid && (

          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowBidModal(
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
                  setShowBidModal(
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
                TRANSFER BID
              </span>

              <h2>
                {playerName(
                  selectedBid.player
                )}
              </h2>

              <p
                className={
                  styles.modalSubtitle
                }
              >
                {selectedBid.buyerClubName}
                {' '}
                has submitted a
                transfer offer.
              </p>


              <div
                className={
                  styles.bidSummary
                }
              >

                <div>
                  <span>
                    OFFER
                  </span>

                  <strong>
                    €
                    {money(
                      selectedBid.offerAmount
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
                      selectedBid.askingPrice ||
                        askingPrice(
                          selectedBid.player
                        )
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    MARKET VALUE
                  </span>

                  <strong>
                    €
                    {money(
                      playerValue(
                        selectedBid.player
                      )
                    )}
                  </strong>
                </div>

              </div>


              <div
                className={
                  styles.bidMeta
                }
              >

                <div>
                  <span>
                    PLAYER
                  </span>

                  <strong>
                    {playerPosition(
                      selectedBid.player
                    )}{' '}
                    • OVR{' '}
                    {playerOverall(
                      selectedBid.player
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    SUBMITTED
                  </span>

                  <strong>
                    {formatDateTime(
                      selectedBid.createdAt
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    STATUS
                  </span>

                  <strong>
                    {statusText(
                      selectedBid.status
                    )}
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
                  className={
                    styles.secondaryButton
                  }
                  onClick={() =>
                    openPlayer(
                      selectedBid.player
                    )
                  }
                >
                  View Player
                </button>


                {activeTab ===
                  'incoming' &&
                  offerStatus(
                    selectedBid
                  ) ===
                    'pending' && (
                    <>
                      <button
                        type="button"
                        className={
                          styles.rejectButton
                        }
                        disabled={
                          saving
                        }
                        onClick={() =>
                          rejectBid(
                            selectedBid
                          )
                        }
                      >
                        Reject
                      </button>

                      <button
                        type="button"
                        className={
                          styles.acceptButton
                        }
                        disabled={
                          saving
                        }
                        onClick={() =>
                          acceptBid(
                            selectedBid
                          )
                        }
                      >
                        {saving
                          ? 'Processing...'
                          : 'Accept Bid'}
                      </button>
                    </>
                  )}

              </div>


              {activeTab ===
                'incoming' &&
                offerStatus(
                  selectedBid
                ) ===
                  'rejected' && (
                  <div
                    className={
                      styles.contractPrompt
                    }
                  >
                    <div>
                      <strong>
                        Want to keep the
                        player?
                      </strong>

                      <p>
                        You rejected the
                        transfer. You can
                        now offer the player
                        a new contract and
                        wait for his decision.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowBidModal(
                          false
                        );

                        openContract(
                          selectedBid.player
                        );
                      }}
                    >
                      Offer Contract
                    </button>
                  </div>
                )}

            </div>

          </div>
        )}


        {/* =================================================
            CONTRACT MODAL
        ================================================= */}

        {showContractModal &&
          contractPlayer && (

          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowContractModal(
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
                  setShowContractModal(
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
                CONTRACT NEGOTIATION
              </span>

              <h2>
                {playerName(
                  contractPlayer
                )}
              </h2>

              <p
                className={
                  styles.modalSubtitle
                }
              >
                Offer the player a new
                contract after rejecting
                the transfer.
              </p>


              <div
                className={
                  styles.contractForm
                }
              >

                <label>
                  Weekly Wage

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
                        contractWage
                      }
                      onChange={(
                        event
                      ) =>
                        setContractWage(
                          event.target.value
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                </label>


                <label>
                  Signing Bonus

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
                        contractBonus
                      }
                      onChange={(
                        event
                      ) =>
                        setContractBonus(
                          event.target.value
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                </label>


                <label>
                  Contract Length

                  <select
                    value={
                      contractYears
                    }
                    onChange={(
                      event
                    ) =>
                      setContractYears(
                        event.target.value
                      )
                    }
                  >
                    <option value="1">
                      1 Year
                    </option>

                    <option value="2">
                      2 Years
                    </option>

                    <option value="3">
                      3 Years
                    </option>

                    <option value="4">
                      4 Years
                    </option>

                    <option value="5">
                      5 Years
                    </option>
                  </select>
                </label>

              </div>


              <div
                className={
                  styles.contractNotice
                }
              >
                ⏱️ The player will have
                approximately{' '}
                <strong>
                  {CONTRACT_WAIT_DAYS}
                  days
                </strong>{' '}
                to respond. If the player
                rejects the first offer,
                the manager gets one second
                negotiation opportunity.
              </div>


              <button
                type="button"
                className={
                  styles.primaryButton
                }
                disabled={
                  contractLoading
                }
                onClick={
                  makeContractOffer
                }
              >
                {contractLoading
                  ? 'Sending...'
                  : 'Send Contract Offer'}
              </button>

            </div>

          </div>
        )}

      </main>
    </>
  );
}
