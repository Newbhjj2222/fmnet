// pages/transfer.js

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../components/firebase";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

import styles from "./transfer.module.css";

/* =========================================================
   CONSTANTS
========================================================= */

const CONTRACT_WAIT_DAYS = 3;
const JOIN_DELAY_DAYS = 1;
const TRANSFER_RESPONSE_DAYS = 2;

const MAX_SUGGESTIONS = 8;
const MAX_AI_TRANSFERS_PER_DAY = 10;
const MAX_AI_CONTRACTS_PER_DAY = 10;

const FIRESTORE_BATCH_SIZE = 450;

const YOUTH_COLLECTION = "youthPlayers";

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(safeNumber(value));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function playerName(player) {
  if (!player) return "Unknown Player";

  return (
    player.name ||
    player.fullName ||
    [player.firstName, player.lastName]
      .filter(Boolean)
      .join(" ") ||
    "Unknown Player"
  );
}

function playerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    "Unknown"
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

function getPlayerClubId(player) {
  return (
    player?.clubId ||
    player?.currentClub ||
    player?.teamId ||
    null
  );
}

function getPlayerClubName(player) {
  return (
    player?.clubName ||
    player?.currentClubName ||
    player?.teamName ||
    "Free Agent"
  );
}

function dateValue(value) {
  if (!value) return null;

  if (
    typeof value === "object" &&
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatDate(value) {
  const date = dateValue(value);

  if (!date) return "Not set";

  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value) {
  const date = dateValue(value);

  if (!date) return "Not set";

  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =========================================================
   GAME CALENDAR
========================================================= */

function getCareerGameDate(careerData) {
  return dateValue(
    careerData?.currentDate ||
      careerData?.gameDate ||
      careerData?.calendarDate
  );
}

function addGameDays(date, days) {
  const base = dateValue(date) || new Date();

  return new Date(
    base.getTime() +
      safeNumber(days, 0) *
        24 *
        60 *
        60 *
        1000
  ).toISOString();
}

function gameDaysSince(fromDate, currentGameDate) {
  const from = dateValue(fromDate);
  const current = dateValue(currentGameDate);

  if (!from || !current) return 0;

  return Math.floor(
    (current.getTime() - from.getTime()) /
      (24 * 60 * 60 * 1000)
  );
}

function gameDaysRemaining(deadline, currentGameDate) {
  const end = dateValue(deadline);
  const current = dateValue(currentGameDate);

  if (!end || !current) return null;

  return Math.ceil(
    (end.getTime() - current.getTime()) /
      (24 * 60 * 60 * 1000)
  );
}

/* =========================================================
   STATUS
========================================================= */

function offerStatus(offer) {
  return normalize(offer?.status || "pending");
}

function statusText(status) {
  switch (normalize(status)) {
    case "accepted":
      return "Accepted";

    case "rejected":
      return "Rejected";

    case "pending":
      return "Pending";

    case "negotiation":
      return "Negotiation";

    case "contract-offered":
      return "Contract Offered";

    case "contract-accepted":
      return "Contract Accepted";

    case "joining":
      return "Joining Club";

    case "contract-pending":
      return "Contract Pending";

    case "completed":
      return "Completed";

    case "expired":
      return "Expired";

    default:
      return status || "Pending";
  }
}

function statusClass(status) {
  const value = normalize(status);

  if (
    value === "accepted" ||
    value === "contract-accepted" ||
    value === "completed"
  ) {
    return "success";
  }

  if (
    value === "rejected" ||
    value === "expired"
  ) {
    return "danger";
  }

  if (
    value === "negotiation" ||
    value === "contract-offered" ||
    value === "joining" ||
    value === "contract-pending"
  ) {
    return "warning";
  }

  return "pending";
}

/* =========================================================
   POSITION NEED
========================================================= */

function getPositionNeed(players) {
  const positions = {};

  players.forEach((player) => {
    const position = normalize(playerPosition(player));

    if (!position) return;

    positions[position] =
      (positions[position] || 0) + 1;
  });

  return positions;
}

/* =========================================================
   AI PLAYER SCORING
========================================================= */

function calculateAIPlayerScore(
  player,
  aiClub,
  aiPlayers
) {
  const overall = playerOverall(player);
  const value = playerValue(player);

  const budget = safeNumber(
    aiClub?.transferBudget,
    0
  );

  const positions = getPositionNeed(aiPlayers);
  const position = normalize(playerPosition(player));

  let score = 0;

  score += overall * 2;

  if (!positions[position]) {
    score += 45;
  } else if (positions[position] < 2) {
    score += 25;
  } else if (positions[position] < 3) {
    score += 10;
  }

  if (
    budget > 0 &&
    value > 0 &&
    value <= budget
  ) {
    score += 30;
  }

  const age = safeNumber(player.age, 28);

  if (age <= 21) {
    score += 30;
  } else if (age <= 23) {
    score += 20;
  } else if (age <= 26) {
    score += 10;
  }

  const transferStatus = normalize(
    player.transferStatus
  );

  if (
    transferStatus.includes("listed") ||
    transferStatus.includes("available") ||
    transferStatus.includes("transfer")
  ) {
    score += 20;
  }

  const potential = safeNumber(
    player.potential,
    overall
  );

  score += Math.min(
    20,
    Math.max(0, potential - overall)
  );

  const reputation = safeNumber(
    aiClub?.reputation,
    50
  );

  if (overall >= 80 && reputation >= 70) {
    score += 20;
  }

  return score;
}

/* =========================================================
   AI BID NEGOTIATION
========================================================= */

function aiNegotiateBid(
  offer,
  player,
  sellingClub,
  buyerClub
) {
  const overall = playerOverall(player);

  const value = playerValue(player);

  const asking = safeNumber(
    offer.askingPrice || askingPrice(player),
    value
  );

  const amount = safeNumber(
    offer.offerAmount,
    0
  );

  let acceptChance = 0.25;

  if (asking > 0) {
    const ratio = amount / asking;

    if (ratio >= 1.5) {
      acceptChance += 0.45;
    } else if (ratio >= 1.3) {
      acceptChance += 0.35;
    } else if (ratio >= 1.1) {
      acceptChance += 0.25;
    } else if (ratio >= 1.0) {
      acceptChance += 0.15;
    } else if (ratio >= 0.9) {
      acceptChance += 0.05;
    } else {
      acceptChance -= 0.15;
    }
  }

  if (overall >= 90) {
    acceptChance -= 0.20;
  } else if (overall >= 85) {
    acceptChance -= 0.15;
  } else if (overall >= 80) {
    acceptChance -= 0.10;
  } else if (overall >= 75) {
    acceptChance -= 0.05;
  }

  const transferStatus = normalize(
    player.transferStatus
  );

  if (
    transferStatus.includes("listed") ||
    transferStatus.includes("available")
  ) {
    acceptChance += 0.20;
  }

  const sellerReputation = safeNumber(
    sellingClub?.reputation,
    50
  );

  if (sellerReputation < 40) {
    acceptChance += 0.05;
  }

  acceptChance = Math.max(
    0.05,
    Math.min(0.95, acceptChance)
  );

  if (Math.random() < acceptChance) {
    return {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote:
        `The selling club accepted the €${money(
          amount
        )} offer.`,
    };
  }

  if (
    Math.random() < 0.55 &&
    asking > amount
  ) {
    let counterOffer = Math.round(
      asking *
        (0.9 + Math.random() * 0.15)
    );

    const buyerBudget = safeNumber(
      buyerClub?.transferBudget,
      0
    );

    if (
      buyerBudget > 0 &&
      counterOffer > buyerBudget
    ) {
      counterOffer = buyerBudget;
    }

    if (counterOffer > amount) {
      return {
        status: "negotiation",
        counterOffer,
        systemResponse: true,
        responseNote:
          `The selling club rejected the offer but wants €${money(
            counterOffer
          )}.`,
      };
    }
  }

  return {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    systemResponse: true,
    responseNote:
      "The selling club rejected the transfer offer.",
  };
}

/* =========================================================
   AI CONTRACT NEGOTIATION
========================================================= */

function aiNegotiateContract(
  offer,
  player,
  club
) {
  const overall = playerOverall(player);

  const offeredWage = safeNumber(
    offer.weeklyWage,
    0
  );

  const currentWage = safeNumber(
    player.wage || player.salary,
    500
  );

  let acceptChance = 0.30;

  if (currentWage > 0) {
    const ratio =
      offeredWage / currentWage;

    if (ratio >= 2) {
      acceptChance += 0.40;
    } else if (ratio >= 1.5) {
      acceptChance += 0.30;
    } else if (ratio >= 1.2) {
      acceptChance += 0.20;
    } else if (ratio >= 1) {
      acceptChance += 0.10;
    } else {
      acceptChance -= 0.25;
    }
  }

  if (overall >= 90) {
    acceptChance -= 0.15;
  } else if (overall >= 80) {
    acceptChance -= 0.10;
  } else if (overall >= 75) {
    acceptChance -= 0.05;
  }

  const reputation = safeNumber(
    club?.reputation,
    50
  );

  if (reputation >= 80) {
    acceptChance += 0.10;
  } else if (reputation >= 65) {
    acceptChance += 0.05;
  }

  acceptChance = Math.max(
    0.05,
    Math.min(0.90, acceptChance)
  );

  if (
    Math.random() < acceptChance
  ) {
    return {
      status: "contract-accepted",
      acceptedAt: new Date().toISOString(),
      systemResponse: true,
      responseNote:
        `${playerName(
          player
        )} accepted the contract.`,
    };
  }

  return {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    systemResponse: true,
    responseNote:
      `${playerName(
        player
      )} rejected the contract.`,
  };
}

/* =========================================================
   AI BID CREATION
========================================================= */

function createAIBid({
  aiClub,
  player,
  gameDate,
}) {
  const value = playerValue(player);
  const asking = askingPrice(player);

  const baseValue =
    asking > 0
      ? asking
      : value > 0
      ? value
      : 100000;

  const offerAmount = Math.max(
    1,
    Math.round(
      baseValue *
        (0.78 + Math.random() * 0.27)
    )
  );

  return {
    id:
      `ai-${aiClub.id}-${player.id}-${Date.now()}-${Math.floor(
        Math.random() * 10000
      )}`,

    buyerClubId: aiClub.id,

    buyerClubName:
      aiClub.name ||
      aiClub.clubName ||
      "AI Club",

    playerId: player.id,

    playerName: playerName(player),

    offerAmount,

    askingPrice: asking,

    type: "transfer",

    status: "pending",

    createdBy: "system-ai",

    createdAt: gameDate.toISOString(),

    responseDeadline: addGameDays(
      gameDate,
      TRANSFER_RESPONSE_DAYS
    ),
  };
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
        collection(db, "players")
      ),
      getDocs(
        collection(db, "clubs")
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
            JSON.stringify(players)
          ),

        initialClubs:
          JSON.parse(
            JSON.stringify(clubs)
          ),
      },
    };
  } catch (error) {
    console.error(
      "Transfer SSR error:",
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
  const router = useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const [
    players,
    setPlayers,
  ] = useState(initialPlayers);

  const [
    clubs,
    setClubs,
  ] = useState(initialClubs);

  const [
    youthPlayers,
    setYouthPlayers,
  ] = useState([]);

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
  ] = useState("incoming");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

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
  ] = useState("");

  const [
    contractBonus,
    setContractBonus,
  ] = useState("");

  const [
    contractYears,
    setContractYears,
  ] = useState("3");

  const [
    contractLoading,
    setContractLoading,
  ] = useState(false);

  const [
    isProcessingSystem,
    setIsProcessingSystem,
  ] = useState(false);

  const processedCalendarRef =
    useRef(new Set());

  /* =======================================================
     GAME DATE
  ======================================================= */

  const currentGameDate = useMemo(
    () =>
      getCareerGameDate(
        careerData
      ),
    [careerData]
  );

  const currentGameDateKey =
    currentGameDate
      ? currentGameDate
          .toISOString()
          .slice(0, 10)
      : null;

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    loadCareer();
  }, [
    user,
    loading,
    router,
  ]);

  /* =======================================================
     LOAD CAREER
  ======================================================= */

  async function loadCareer() {
    if (!user?.uid) return;

    try {
      setIsLoading(true);

      const userRef = doc(
        db,
        "users",
        user.uid
      );

      const snapshot =
        await getDoc(userRef);

      if (!snapshot.exists()) {
        setCareerData({});
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
          "clubs",
          career.currentClub
        );

        const clubSnapshot =
          await getDoc(clubRef);

        if (
          clubSnapshot.exists()
        ) {
          setCurrentClub({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        } else {
          setCurrentClub(null);
        }
      } else {
        setCurrentClub(null);
      }
    } catch (error) {
      console.error(error);

      toast.error(
        "Could not load transfer centre"
      );
    } finally {
      setIsLoading(false);
    }
  }

  /* =======================================================
     REALTIME PLAYERS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe =
      onSnapshot(
        collection(db, "players"),
        (snapshot) => {
          setPlayers(
            snapshot.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            )
          );
        },
        (error) => {
          console.error(
            "Players realtime error:",
            error
          );
        }
      );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     REALTIME CLUBS
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe =
      onSnapshot(
        collection(db, "clubs"),
        (snapshot) => {
          setClubs(
            snapshot.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            )
          );
        },
        (error) => {
          console.error(
            "Clubs realtime error:",
            error
          );
        }
      );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     SYNC currentClub WITH CLUBS DATA
     (so budget updates immediately)
  ======================================================= */

  useEffect(() => {
    if (currentClubId && clubs.length > 0) {
      const updatedClub = clubs.find(
        (club) => club.id === currentClubId
      );
      setCurrentClub(updatedClub || null);
    }
  }, [clubs, currentClubId]);

  /* =======================================================
     REALTIME YOUTH
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const unsubscribe =
      onSnapshot(
        collection(
          db,
          YOUTH_COLLECTION
        ),
        (snapshot) => {
          setYouthPlayers(
            snapshot.docs.map(
              (item) => ({
                id: item.id,
                ...item.data(),
              })
            )
          );
        },
        (error) => {
          console.warn(
            "Youth players realtime error:",
            error
          );
        }
      );

    return () => unsubscribe();
  }, [user]);

  /* =======================================================
     MAPS
  ======================================================= */

  const clubMap = useMemo(
    () =>
      clubs.reduce(
        (map, club) => {
          map[club.id] = club;
          return map;
        },
        {}
      ),
    [clubs]
  );

  const playerMap = useMemo(
    () =>
      players.reduce(
        (map, player) => {
          map[player.id] =
            player;
          return map;
        },
        {}
      ),
    [players]
  );

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
          getPlayerClubId(player) ===
          currentClubId
      );
    }, [
      players,
      currentClubId,
    ]);

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
          "players",
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
      console.error(error);

      toast.error(
        "Could not update player"
      );

      return false;
    }
  }

  /* =======================================================
     COMPLETE DUE TRANSFERS

     IMPORTANT:
     Transfer is NOT completed here.

     The player:
       seller
        ↓
       joining
        ↓
       buyer club
        ↓
       contract-offered
        ↓
       contract-accepted
        ↓
       completed

     NOTE:
     When buyer club is AI-managed,
     the system creates a contract
     automatically.

     When buyer club is user-managed,
     the user must offer a contract
     manually from the Joining tab.
  ======================================================= */

  const completeDueTransfers =
    useCallback(
      async (gameDate) => {
        if (!gameDate) return;

        const dueTransfers = [];

        players.forEach(
          (player) => {
            const pending =
              player.pendingTransfer;

            if (!pending) return;

            if (
              normalize(
                pending.status
              ) !== "joining"
            ) {
              return;
            }

            const joiningDate =
              dateValue(
                pending.joiningDate
              );

            if (!joiningDate) {
              return;
            }

            if (
              joiningDate.getTime() >
              gameDate.getTime()
            ) {
              return;
            }

            if (
              !pending.toClubId
            ) {
              return;
            }

            dueTransfers.push({
              player,
              pending,
            });
          }
        );

        if (
          dueTransfers.length === 0
        ) {
          return;
        }

        let batch =
          writeBatch(db);

        let operationCount = 0;
        let completedCount = 0;

        const commitBatch =
          async () => {
            if (
              operationCount > 0
            ) {
              await batch.commit();
            }

            batch =
              writeBatch(db);

            operationCount = 0;
          };

        for (
          const item of dueTransfers
        ) {
          if (
            operationCount >=
            FIRESTORE_BATCH_SIZE - 3
          ) {
            await commitBatch();
          }

          const {
            player,
            pending,
          } = item;

          const fromClubId =
            pending.fromClubId ||
            getPlayerClubId(
              player
            );

          const toClubId =
            pending.toClubId;

          const buyerClub =
            clubMap[toClubId];

          const sellerClub =
            clubMap[fromClubId];

          if (!buyerClub) {
            continue;
          }

          const transferFee =
            safeNumber(
              pending.offerAmount,
              0
            );

          const buyerName =
            buyerClub.name ||
            buyerClub.clubName ||
            "";

          /*
            Keep the actual transfer offer
            as accepted/joining.
          */

          const existingOffers =
            Array.isArray(
              player.transferOffers
            )
              ? player.transferOffers
              : [];

          const transferOffers =
            existingOffers.map(
              (offer) => {
                if (
                  offer.id ===
                  pending.id
                ) {
                  return {
                    ...offer,
                    status: "joining",
                    joiningDate:
                      pending.joiningDate,
                  };
                }

                return offer;
              }
            );

          const playerUpdate = {
            clubId: toClubId,

            currentClub: toClubId,

            teamId: toClubId,

            clubName: buyerName,

            currentClubName: buyerName,

            transferStatus:
              "contract-pending",

            pendingTransfer: null,

            transferOffers,

            latestOffer:
              pending,

            lastTransferFee:
              transferFee,

            lastTransferDate:
              gameDate.toISOString(),

            updatedAt:
              serverTimestamp(),
          };

          /*
            Only AI clubs get an automatic
            contract from the system.

            User-managed clubs must use the
            Transfer Centre UI to offer a
            contract to the arriving player.
          */

          if (!buyerClub.managerId) {
            const currentWage =
              safeNumber(
                player.wage ||
                  player.salary,
                500
              );

            const weeklyWage =
              Math.round(
                currentWage * 1.2
              );

            const contractId =
              `transfer-contract-${toClubId}-${player.id}-${gameDate.getTime()}`;

            const contract = {
              id: contractId,

              clubId: toClubId,

              clubName: buyerName,

              playerId: player.id,

              playerName:
                playerName(player),

              weeklyWage,

              signingBonus: 0,

              years: 3,

              status:
                "contract-offered",

              negotiationRound: 1,

              secondChanceUsed: false,

              createdAt:
                gameDate.toISOString(),

              responseDeadline:
                addGameDays(
                  gameDate,
                  CONTRACT_WAIT_DAYS
                ),

              createdBy:
                "system-ai",

              transferId:
                pending.id || null,

              transferFee,
            };

            const existingContracts =
              Array.isArray(
                player.contractOffers
              )
                ? player.contractOffers
                : [];

            const alreadyHasContract =
              existingContracts.some(
                (offer) =>
                  offer.transferId ===
                    pending.id &&
                  (
                    offer.status ===
                      "contract-offered" ||
                    offer.status ===
                      "contract-accepted"
                  )
              );

            const newContractOffers =
              alreadyHasContract
                ? existingContracts
                : [
                    ...existingContracts,
                    contract,
                  ];

            playerUpdate.contractOffers =
              newContractOffers;

            playerUpdate.latestContractOffer =
              alreadyHasContract
                ? player.latestContractOffer ||
                  null
                : contract;
          }

          batch.update(
            doc(
              db,
              "players",
              player.id
            ),
            playerUpdate
          );

          operationCount++;
          completedCount++;

          /*
            Transfer money is paid only once,
            when the player actually moves.
          */

          if (transferFee > 0) {
            const buyerBudget =
              safeNumber(
                buyerClub.transferBudget,
                0
              );

            batch.update(
              doc(
                db,
                "clubs",
                toClubId
              ),
              {
                transferBudget:
                  Math.max(
                    0,
                    buyerBudget -
                      transferFee
                  ),

                updatedAt:
                  serverTimestamp(),
              }
            );

            operationCount++;

            if (sellerClub) {
              const sellerBudget =
                safeNumber(
                  sellerClub.transferBudget,
                  0
                );

              batch.update(
                doc(
                  db,
                  "clubs",
                  fromClubId
                ),
                {
                  transferBudget:
                    sellerBudget +
                    transferFee,

                  updatedAt:
                    serverTimestamp(),
                }
              );

              operationCount++;
            }
          }
        }

        await commitBatch();

        if (
          completedCount > 0
        ) {
          toast.success(
            `${completedCount} player${
              completedCount > 1
                ? "s"
                : ""
            } reached the new club.`
          );
        }
      },
      [
        players,
        clubMap,
      ]
    );

  /* =======================================================
     SYSTEM TRANSFER RESPONSES
  ======================================================= */

  const processSystemResponses =
    useCallback(
      async () => {
        if (
          !user ||
          !currentClub ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          const gameDate =
            currentGameDate;

          const playerUpdates =
            new Map();

          for (
            const player of players
          ) {
            const sellerClubId =
              getPlayerClubId(
                player
              );

            if (!sellerClubId) {
              continue;
            }

            /*
              User's own club handles offers manually.
            */

            if (
              sellerClubId ===
              currentClub.id
            ) {
              continue;
            }

            const sellerClub =
              clubMap[sellerClubId];

            /*
              User-managed clubs don't get
              AI responses.
            */

            if (
              sellerClub?.managerId
            ) {
              continue;
            }

            const offers =
              Array.isArray(
                player.transferOffers
              )
                ? player.transferOffers
                : [];

            if (
              offers.length === 0
            ) {
              continue;
            }

            const updatedOffers =
              [...offers];

            let changed = false;

            for (
              let index = 0;
              index <
              updatedOffers.length;
              index++
            ) {
              const offer =
                updatedOffers[index];

              if (
                offerStatus(
                  offer
                ) !== "pending"
              ) {
                continue;
              }

              /*
                Only AI buyer offers
                need system response
                from the seller.

                If buyer is current user,
                seller is AI and this page
                may be showing outgoing bids.
              */

              if (
                offer.buyerClubId ===
                currentClub.id
              ) {
                continue;
              }

              const offerDate =
                dateValue(
                  offer.createdAt
                );

              if (!offerDate) {
                continue;
              }

              const daysSince =
                gameDaysSince(
                  offerDate,
                  gameDate
                );

              if (
                daysSince <
                TRANSFER_RESPONSE_DAYS
              ) {
                continue;
              }

              const buyerClub =
                clubMap[
                  offer.buyerClubId
                ];

              if (!buyerClub) {
                updatedOffers[index] = {
                  ...offer,

                  status:
                    "rejected",

                  rejectedAt:
                    gameDate.toISOString(),

                  systemResponse: true,

                  responseNote:
                    "Transfer rejected because the buying club no longer exists.",
                };

                changed = true;

                continue;
              }

              const response =
                aiNegotiateBid(
                  offer,
                  player,
                  sellerClub,
                  buyerClub
                );

              if (
                response.status ===
                "accepted"
              ) {
                const joiningDate =
                  addGameDays(
                    gameDate,
                    JOIN_DELAY_DAYS
                  );

                const acceptedOffer = {
                  ...offer,

                  ...response,

                  status:
                    "accepted",

                  acceptedAt:
                    gameDate.toISOString(),

                  joiningDate,
                };

                updatedOffers[index] =
                  acceptedOffer;

                playerUpdates.set(
                  player.id,
                  {
                    player,
                    updatedOffers,
                    pendingTransfer: {
                      ...acceptedOffer,

                      fromClubId:
                        sellerClubId,

                      fromClubName:
                        sellerClub?.name ||
                        getPlayerClubName(
                          player
                        ),

                      toClubId:
                        offer.buyerClubId,

                      toClubName:
                        buyerClub.name ||
                        buyerClub.clubName ||
                        offer.buyerClubName,

                      status:
                        "joining",

                      joiningDate,
                    },

                    transferStatus:
                      "accepted",
                  }
                );
              } else {
                updatedOffers[index] = {
                  ...offer,
                  ...response,
                };

                playerUpdates.set(
                  player.id,
                  {
                    player,
                    updatedOffers,
                    pendingTransfer:
                      player.pendingTransfer ||
                      null,

                    transferStatus:
                      response.status,
                  }
                );
              }

              changed = true;
            }

            if (
              !changed
            ) {
              continue;
            }
          }

          if (
            playerUpdates.size === 0
          ) {
            return;
          }

          let batch =
            writeBatch(db);

          let count = 0;

          for (
            const item of
              playerUpdates.values()
          ) {
            if (
              count >=
              FIRESTORE_BATCH_SIZE
            ) {
              await batch.commit();

              batch =
                writeBatch(db);

              count = 0;
            }

            batch.update(
              doc(
                db,
                "players",
                item.player.id
              ),
              {
                transferOffers:
                  item.updatedOffers,

                latestOffer:
                  item.updatedOffers[
                    item.updatedOffers.length -
                      1
                  ] || null,

                transferStatus:
                  item.transferStatus,

                pendingTransfer:
                  item.pendingTransfer,

                updatedAt:
                  serverTimestamp(),
              }
            );

            count++;
          }

          if (count > 0) {
            await batch.commit();
          }
        } catch (error) {
          console.error(
            "System transfer response error:",
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentClub,
        currentGameDate,
        players,
        clubMap,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     SYSTEM CONTRACT RESPONSES

     This is where contract acceptance
     finally completes the transfer.
  ======================================================= */

  const processSystemContractResponses =
    useCallback(
      async () => {
        if (
          !user ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        try {
          setIsProcessingSystem(true);

          const gameDate =
            currentGameDate;

          const updates =
            [];

          for (
            const player of players
          ) {
            const offers =
              Array.isArray(
                player.contractOffers
              )
                ? player.contractOffers
                : [];

            if (
              offers.length === 0
            ) {
              continue;
            }

            const updatedOffers =
              [...offers];

            let changed = false;

            for (
              let index = 0;
              index <
              updatedOffers.length;
              index++
            ) {
              const offer =
                updatedOffers[index];

              if (
                offerStatus(
                  offer
                ) !==
                "contract-offered"
              ) {
                continue;
              }

              const offerDate =
                dateValue(
                  offer.createdAt
                );

              if (!offerDate) {
                continue;
              }

              const daysSince =
                gameDaysSince(
                  offerDate,
                  gameDate
                );

              if (
                daysSince <
                CONTRACT_WAIT_DAYS
              ) {
                continue;
              }

              /*
                IMPORTANT FIX:
                Use the club stored inside
                the contract.

                Never use currentClub here.
              */

              const contractClub =
                clubMap[
                  offer.clubId
                ];

              if (
                !contractClub
              ) {
                updatedOffers[index] = {
                  ...offer,

                  status:
                    "rejected",

                  rejectedAt:
                    gameDate.toISOString(),

                  systemResponse:
                    true,

                  responseNote:
                    "Contract rejected because the club no longer exists.",
                };

                changed = true;

                continue;
              }

              const response =
                aiNegotiateContract(
                  offer,
                  player,
                  contractClub
                );

              updatedOffers[index] = {
                ...offer,
                ...response,
              };

              changed = true;

              /*
                CONTRACT ACCEPTED
                =================

                Only here can transfer
                become COMPLETED.
              */

              if (
                response.status ===
                "contract-accepted"
              ) {
                updatedOffers[index] = {
                  ...updatedOffers[index],

                  status:
                    "contract-accepted",

                  acceptedAt:
                    gameDate.toISOString(),
                };
              }
            }

            if (!changed) {
              continue;
            }

            const latest =
              updatedOffers[
                updatedOffers.length - 1
              ];

            /*
              Find the most recent
              accepted contract.
            */

            const acceptedContract =
              [...updatedOffers]
                .reverse()
                .find(
                  (offer) =>
                    offerStatus(
                      offer
                    ) ===
                    "contract-accepted"
                );

            updates.push({
              player,
              updatedOffers,
              latest,
              acceptedContract:
                acceptedContract ||
                null,
            });
          }

          if (
            updates.length === 0
          ) {
            return;
          }

          let batch =
            writeBatch(db);

          let count = 0;

          for (
            const item of updates
          ) {
            if (
              count >=
              FIRESTORE_BATCH_SIZE
            ) {
              await batch.commit();

              batch =
                writeBatch(db);

              count = 0;
            }

            const data = {
              contractOffers:
                item.updatedOffers,

              latestContractOffer:
                item.latest,

              updatedAt:
                serverTimestamp(),
            };

            /*
              CONTRACT ACCEPTED
              = TRANSFER COMPLETED
            */

            if (
              item.acceptedContract
            ) {
              data.transferStatus =
                "completed";

              data.activeContract =
                item.acceptedContract;

              data.contractStatus =
                "active";

              data.contractClubId =
                item.acceptedContract.clubId;

              data.contractWeeklyWage =
                safeNumber(
                  item.acceptedContract
                    .weeklyWage,
                  0
                );

              data.contractSigningBonus =
                safeNumber(
                  item.acceptedContract
                    .signingBonus,
                  0
                );

              data.contractYears =
                safeNumber(
                  item.acceptedContract
                    .years,
                  3
                );

              data.contractStartDate =
                gameDate.toISOString();

              /*
                Once the contract is accepted,
                no joining transfer remains.
              */

              data.pendingTransfer =
                null;
            }

            batch.update(
              doc(
                db,
                "players",
                item.player.id
              ),
              data
            );

            count++;
          }

          if (count > 0) {
            await batch.commit();

            const acceptedCount =
              updates.filter(
                (item) =>
                  Boolean(
                    item.acceptedContract
                  )
              ).length;

            if (
              acceptedCount > 0
            ) {
              toast.success(
                `${acceptedCount} player contract${
                  acceptedCount > 1
                    ? "s"
                    : ""
                } accepted. Transfer completed.`
              );
            }
          }
        } catch (error) {
          console.error(
            "System contract response error:",
            error
          );
        } finally {
          setIsProcessingSystem(false);
        }
      },
      [
        user,
        currentGameDate,
        players,
        clubMap,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     AI TRANSFER MARKET
  ======================================================= */

  const processSystemAITransfers =
    useCallback(
      async () => {
        if (
          !user ||
          !currentClub ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        const gameDate =
          currentGameDate;

        const dateKey =
          gameDate
            .toISOString()
            .slice(0, 10);

        const processKey =
          `ai-${dateKey}`;

        if (
          processedCalendarRef.current.has(
            processKey
          )
        ) {
          return;
        }

        try {
          setIsProcessingSystem(
            true
          );

          /*
            June, July, August
            + January.
          */

          const month =
            gameDate.getUTCMonth();

          const isSummerWindow =
            month >= 5 &&
            month <= 7;

          const isWinterWindow =
            month === 0;

          if (
            !isSummerWindow &&
            !isWinterWindow
          ) {
            processedCalendarRef.current.add(
              processKey
            );

            return;
          }

          const aiClubs =
            clubs.filter(
              (club) =>
                !club.managerId &&
                club.id !==
                  currentClub.id
            );

          if (
            aiClubs.length === 0
          ) {
            processedCalendarRef.current.add(
              processKey
            );

            return;
          }

          const operations =
            [];

          let transferCount = 0;

          for (
            const aiClub of aiClubs
          ) {
            if (
              transferCount >=
              MAX_AI_TRANSFERS_PER_DAY
            ) {
              break;
            }

            const budget =
              safeNumber(
                aiClub.transferBudget,
                0
              );

            if (budget <= 0) {
              continue;
            }

            const aiSquad =
              players.filter(
                (player) =>
                  getPlayerClubId(
                    player
                  ) === aiClub.id
              );

            const seniorCandidates =
              players.filter(
                (player) => {
                  const pClub =
                    getPlayerClubId(
                      player
                    );

                  if (
                    !pClub ||
                    pClub ===
                      aiClub.id
                  ) {
                    return false;
                  }

                  if (
                    player.pendingTransfer
                  ) {
                    return false;
                  }

                  if (
                    normalize(
                      player.transferStatus
                    ) ===
                    "completed"
                  ) {
                    return false;
                  }

                  const status =
                    normalize(
                      player.transferStatus
                    );

                  return (
                    status.includes(
                      "listed"
                    ) ||
                    status.includes(
                      "available"
                    ) ||
                    status.includes(
                      "transfer"
                    ) ||
                    Math.random() <
                      0.20
                  );
                }
              );

            const youthCandidates =
              youthPlayers.filter(
                (player) => {
                  const pClub =
                    getPlayerClubId(
                      player
                    );

                  if (
                    pClub ===
                    aiClub.id
                  ) {
                    return false;
                  }

                  if (
                    player.pendingTransfer
                  ) {
                    return false;
                  }

                  return true;
                }
              );

            const candidates = [
              ...seniorCandidates.map(
                (player) => ({
                  player,
                  source: "players",
                })
              ),

              ...youthCandidates.map(
                (player) => ({
                  player,
                  source:
                    "youthPlayers",
                })
              ),
            ];

            if (
              candidates.length ===
              0
            ) {
              continue;
            }

            const scored =
              candidates
                .map(
                  ({
                    player,
                    source,
                  }) => ({
                    player,
                    source,
                    score:
                      calculateAIPlayerScore(
                        player,
                        aiClub,
                        aiSquad
                      ),
                  })
                )
                .sort(
                  (a, b) =>
                    b.score -
                    a.score
                );

            const topCandidates =
              scored.slice(
                0,
                Math.min(
                  5,
                  scored.length
                )
              );

            if (
              topCandidates.length ===
              0
            ) {
              continue;
            }

            const selected =
              topCandidates[
                Math.floor(
                  Math.random() *
                    topCandidates.length
                )
              ];

            const targetPlayer =
              selected.player;

            const value =
              playerValue(
                targetPlayer
              );

            const asking =
              askingPrice(
                targetPlayer
              );

            const estimatedCost =
              asking > 0
                ? asking
                : value;

            if (
              estimatedCost > budget &&
              estimatedCost > 0
            ) {
              continue;
            }

            const existingOffers =
              Array.isArray(
                targetPlayer.transferOffers
              )
                ? targetPlayer.transferOffers
                : [];

            const duplicate =
              existingOffers.some(
                (offer) =>
                  offer.buyerClubId ===
                    aiClub.id &&
                  (
                    offerStatus(
                      offer
                    ) === "pending" ||
                    offerStatus(
                      offer
                    ) ===
                      "negotiation"
                  )
              );

            if (duplicate) {
              continue;
            }

            const bid =
              createAIBid({
                aiClub,
                player:
                  targetPlayer,
                gameDate,
              });

            operations.push({
              aiClub,
              player:
                targetPlayer,
              source:
                selected.source,
              bid,
            });

            transferCount++;
          }

          if (
            operations.length > 0
          ) {
            let batch =
              writeBatch(db);

            let count = 0;

            for (
              const operation of
                operations
            ) {
              if (
                count >=
                FIRESTORE_BATCH_SIZE
              ) {
                await batch.commit();

                batch =
                  writeBatch(db);

                count = 0;
              }

              const existing =
                Array.isArray(
                  operation.player
                    .transferOffers
                )
                  ? operation.player
                      .transferOffers
                  : [];

              batch.update(
                doc(
                  db,
                  "players",
                  operation.player.id
                ),
                {
                  transferOffers: [
                    ...existing,
                    operation.bid,
                  ],

                  latestOffer:
                    operation.bid,

                  transferStatus:
                    "available",

                  updatedAt:
                    serverTimestamp(),
                }
              );

              count++;
            }

            if (count > 0) {
              await batch.commit();
            }

            toast.success(
              `AI clubs submitted ${operations.length} transfer bid${
                operations.length > 1
                  ? "s"
                  : ""
              }.`
            );
          }

          processedCalendarRef.current.add(
            processKey
          );
        } catch (error) {
          console.error(
            "AI transfer market error:",
            error
          );
        } finally {
          setIsProcessingSystem(
            false
          );
        }
      },
      [
        user,
        currentClub,
        currentGameDate,
        players,
        youthPlayers,
        clubs,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     AI CONTRACT SIGNINGS

     AI clubs can offer contracts to
     players who don't have an active
     contract.
  ======================================================= */

  const processAIContractSignings =
    useCallback(
      async () => {
        if (
          !user ||
          !currentGameDate ||
          isProcessingSystem
        ) {
          return;
        }

        const gameDate =
          currentGameDate;

        const dateKey =
          gameDate
            .toISOString()
            .slice(0, 10);

        const processKey =
          `contracts-${dateKey}`;

        if (
          processedCalendarRef.current.has(
            processKey
          )
        ) {
          return;
        }

        try {
          setIsProcessingSystem(
            true
          );

          const aiClubs =
            clubs.filter(
              (club) =>
                !club.managerId
            );

          if (
            aiClubs.length ===
            0
          ) {
            processedCalendarRef.current.add(
              processKey
            );

            return;
          }

          const operations =
            [];

          let count = 0;

          for (
            const aiClub of aiClubs
          ) {
            if (
              count >=
              MAX_AI_CONTRACTS_PER_DAY
            ) {
              break;
            }

            const squad =
              players.filter(
                (player) =>
                  getPlayerClubId(
                    player
                  ) === aiClub.id
              );

            const candidates =
              squad.filter(
                (player) => {
                  const offers =
                    Array.isArray(
                      player.contractOffers
                    )
                      ? player.contractOffers
                      : [];

                  const hasActive =
                    offers.some(
                      (offer) =>
                        offer.clubId ===
                          aiClub.id &&
                        (
                          offerStatus(
                            offer
                          ) ===
                            "contract-offered" ||
                          offerStatus(
                            offer
                          ) ===
                            "contract-accepted"
                        )
                    );

                  if (hasActive) {
                    return false;
                  }

                  /*
                    Don't create a new
                    contract for a player
                    whose transfer is not
                    yet completed.
                  */

                  if (
                    normalize(
                      player.transferStatus
                    ) ===
                      "contract-pending"
                  ) {
                    return false;
                  }

                  return true;
                }
              );

            for (
              const player of candidates
            ) {
              if (
                count >=
                MAX_AI_CONTRACTS_PER_DAY
              ) {
                break;
              }

              const overall =
                playerOverall(
                  player
                );

              const currentWage =
                safeNumber(
                  player.wage ||
                    player.salary,
                  500
                );

              const wageMultiplier =
                overall >= 85
                  ? 1.45
                  : overall >= 75
                  ? 1.30
                  : 1.15;

              const weeklyWage =
                Math.round(
                  currentWage *
                    wageMultiplier
                );

              const contract = {
                id:
                  `ai-contract-${aiClub.id}-${player.id}-${gameDate.getTime()}-${Math.floor(
                    Math.random() *
                      10000
                  )}`,

                clubId:
                  aiClub.id,

                clubName:
                  aiClub.name ||
                  aiClub.clubName ||
                  "",

                playerId:
                  player.id,

                playerName:
                  playerName(player),

                weeklyWage,

                signingBonus:
                  Math.round(
                    weeklyWage * 4
                  ),

                years:
                  overall >= 80
                    ? 4
                    : 3,

                status:
                  "contract-offered",

                negotiationRound: 1,

                secondChanceUsed:
                  false,

                createdAt:
                  gameDate.toISOString(),

                responseDeadline:
                  addGameDays(
                    gameDate,
                    CONTRACT_WAIT_DAYS
                  ),

                createdBy:
                  "system-ai",
              };

              operations.push({
                player,
                contract,
              });

              count++;
            }
          }

          if (
            operations.length > 0
          ) {
            let batch =
              writeBatch(db);

            let batchCount = 0;

            for (
              const operation of
                operations
            ) {
              if (
                batchCount >=
                FIRESTORE_BATCH_SIZE
              ) {
                await batch.commit();

                batch =
                  writeBatch(db);

                batchCount = 0;
              }

              const existing =
                Array.isArray(
                  operation.player
                    .contractOffers
                )
                  ? operation.player
                      .contractOffers
                  : [];

              batch.update(
                doc(
                  db,
                  "players",
                  operation.player.id
                ),
                {
                  contractOffers: [
                    ...existing,
                    operation.contract,
                  ],

                  latestContractOffer:
                    operation.contract,

                  updatedAt:
                    serverTimestamp(),
                }
              );

              batchCount++;
            }

            if (
              batchCount > 0
            ) {
              await batch.commit();
            }

            toast.success(
              `AI clubs sent ${operations.length} contract offer${
                operations.length > 1
                  ? "s"
                  : ""
              }.`
            );
          }

          processedCalendarRef.current.add(
            processKey
          );
        } catch (error) {
          console.error(
            "AI contract signing error:",
            error
          );
        } finally {
          setIsProcessingSystem(
            false
          );
        }
      },
      [
        user,
        currentGameDate,
        clubs,
        players,
        isProcessingSystem,
      ]
    );

  /* =======================================================
     RUN GAME CALENDAR

     ORDER MATTERS:

     1. Due players move.
     2. Existing contracts get responses.
     3. AI creates transfer bids.
     4. AI creates normal contracts.
  ======================================================= */

  useEffect(() => {
    if (
      !user ||
      !currentClub ||
      !currentGameDate
    ) {
      return;
    }

    let cancelled = false;

    async function run() {
      if (cancelled) return;

      /*
        Step 1:
        Players whose joining date has arrived
        move to their new club and receive
        contract offers (AI clubs only).
      */

      await completeDueTransfers(
        currentGameDate
      );

      if (cancelled) return;

      /*
        Step 2:
        AI responds to transfer bids.
      */

      await processSystemResponses();

      if (cancelled) return;

      /*
        Step 3:
        AI responds to contracts.
      */

      await processSystemContractResponses();

      if (cancelled) return;

      /*
        Step 4:
        AI starts new transfers.
      */

      await processSystemAITransfers();

      if (cancelled) return;

      /*
        Step 5:
        AI sends normal contracts.
      */

      await processAIContractSignings();
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [
    user,
    currentClub,
    currentGameDateKey,
    completeDueTransfers,
    processSystemResponses,
    processSystemContractResponses,
    processSystemAITransfers,
    processAIContractSignings,
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
              if (!offer) {
                return;
              }

              if (
                offer.type ===
                "loan"
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

                buyerClubId,

                buyerClubName:
                  offer.buyerClubName ||
                  clubMap[
                    buyerClubId
                  ]?.name ||
                  "Unknown Club",
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
            )?.getTime() || 0;

          const bDate =
            dateValue(
              b.createdAt
            )?.getTime() || 0;

          return (
            bDate - aDate
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
              if (!offer) {
                return;
              }

              if (
                offer.type ===
                "loan"
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
            )?.getTime() || 0;

          const bDate =
            dateValue(
              b.createdAt
            )?.getTime() || 0;

          return (
            bDate - aDate
          );
        }
      );
    }, [
      players,
      currentClubId,
    ]);

  /* =======================================================
     JOINING PLAYERS
  ======================================================= */

  const joiningPlayers =
    useMemo(() => {
      if (!currentClubId) {
        return [];
      }

      return players.filter(
        (player) =>
          player.pendingTransfer &&
          player.pendingTransfer
            .toClubId ===
            currentClubId &&
          offerStatus(
            player.pendingTransfer
          ) === "joining"
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

              const status =
                offerStatus(
                  offer
                );

              if (
                ![
                  "contract-offered",
                  "contract-accepted",
                  "rejected",
                ].includes(status)
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

      return result.sort(
        (a, b) => {
          const aDate =
            dateValue(
              a.createdAt
            )?.getTime() || 0;

          const bDate =
            dateValue(
              b.createdAt
            )?.getTime() || 0;

          return (
            bDate - aDate
          );
        }
      );
    }, [
      players,
      currentClubId,
    ]);

  /* =======================================================
     FILTER
  ======================================================= */

  const visibleBids =
    useMemo(() => {
      let source =
        activeTab ===
        "incoming"
          ? incomingBids
          : outgoingBids;

      const term =
        normalize(search);

      if (term) {
        source =
          source.filter(
            (bid) =>
              normalize(
                playerName(
                  bid.player
                )
              ).includes(term) ||
              normalize(
                bid.buyerClubName
              ).includes(term)
          );
      }

      if (
        statusFilter !==
        "all"
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
        offerStatus(
          bid
        ) === "pending"
    ).length;

  const pendingOutgoing =
    outgoingBids.filter(
      (bid) =>
        offerStatus(
          bid
        ) === "pending" ||
        offerStatus(
          bid
        ) === "negotiation"
    ).length;

  const acceptedDeals = [
    ...incomingBids,
    ...outgoingBids,
  ].filter(
    (bid) =>
      [
        "accepted",
        "completed",
        "joining",
      ].includes(
        offerStatus(bid)
      )
  ).length;

  const contractWaiting =
    contractOffers.filter(
      (offer) =>
        offerStatus(
          offer
        ) ===
          "contract-offered" ||
        offerStatus(
          offer
        ) ===
          "contract-accepted"
    ).length;

  const joiningCount =
    joiningPlayers.length;

  /* =======================================================
     GM SUGGESTIONS
  ======================================================= */

  const suggestions =
    useMemo(() => {
      const budget =
        safeNumber(
          currentClub?.transferBudget ||
            0
        );

      const positions =
        getPositionNeed(
          currentClubPlayers
        );

      return players
        .filter(
          (player) =>
            getPlayerClubId(
              player
            ) !== currentClubId &&
            !player.pendingTransfer
        )
        .map((player) => {
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

          const reasons =
            [];

          if (
            budget > 0 &&
            value <= budget
          ) {
            score += 30;

            reasons.push(
              "Fits transfer budget"
            );
          }

          if (
            !positions[position]
          ) {
            score += 30;

            reasons.push(
              "Squad needs this position"
            );
          } else if (
            positions[position] <
            2
          ) {
            score += 20;

            reasons.push(
              "Squad depth is low"
            );
          }

          if (
            overall >= 75
          ) {
            score += 15;

            reasons.push(
              "Strong overall rating"
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
              "High development potential"
            );
          }

          const status =
            normalize(
              player.transferStatus
            );

          if (
            status.includes(
              "listed"
            ) ||
            status.includes(
              "available"
            )
          ) {
            score += 10;

            reasons.push(
              "Available on the market"
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
        })
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
      currentClub,
    ]);

  /* =======================================================
     ACCEPT INCOMING BID
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
        "Player no longer exists"
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

      const gameDate =
        currentGameDate ||
        new Date();

      const joiningDate =
        addGameDays(
          gameDate,
          JOIN_DELAY_DAYS
        );

      const offers =
        Array.isArray(
          player.transferOffers
        )
          ? player.transferOffers
          : [];

      const acceptedOffer =
        {
          ...offers[
            bid.offerIndex
          ],

          status:
            "accepted",

          acceptedAt:
            gameDate.toISOString(),

          joiningDate,

          manualResponse:
            true,
        };

      const updatedOffers =
        offers.map(
          (offer, index) =>
            index ===
            bid.offerIndex
              ? acceptedOffer
              : offer
        );

      const success =
        await updatePlayer(
          player.id,
          {
            transferOffers:
              updatedOffers,

            latestOffer:
              acceptedOffer,

            transferStatus:
              "accepted",

            pendingTransfer: {
              ...acceptedOffer,

              id:
                acceptedOffer.id,

              fromClubId:
                currentClubId,

              fromClubName:
                currentClub?.name ||
                currentClub?.clubName ||
                "",

              toClubId:
                bid.buyerClubId,

              toClubName:
                bid.buyerClubName,

              status:
                "joining",

              joiningDate,
            },
          }
        );

      if (!success) {
        return;
      }

      setSelectedBid(null);
      setShowBidModal(false);

      toast.success(
        "Transfer accepted. The player will join according to the game calendar."
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

      const gameDate =
        currentGameDate ||
        new Date();

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
                    "rejected",

                  rejectedAt:
                    gameDate.toISOString(),
                }
              : offer
        );

      await updatePlayer(
        player.id,
        {
          transferOffers:
            updatedOffers,

          latestOffer: {
            ...bid,

            status:
              "rejected",

            rejectedAt:
              gameDate.toISOString(),
          },

          transferStatus:
            "available",
        }
      );

      setSelectedBid(null);
      setShowBidModal(false);

      toast.success(
        "Offer rejected"
      );
    } catch (error) {
      console.error(error);

      toast.error(
        "Could not reject offer"
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     ACCEPT COUNTER OFFER
  ======================================================= */

  async function acceptCounterOffer(
    bid
  ) {
    if (
      !bid?.playerId ||
      !bid?.counterOffer ||
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
        "Player no longer exists"
      );

      return;
    }

    const counterAmount =
      safeNumber(
        bid.counterOffer,
        0
      );

    const budget =
      safeNumber(
        currentClub?.transferBudget ||
          0
      );

    if (
      counterAmount >
      budget
    ) {
      toast.error(
        "You cannot afford this counter offer."
      );

      return;
    }

    try {
      setSaving(true);

      const gameDate =
        currentGameDate ||
        new Date();

      const joiningDate =
        addGameDays(
          gameDate,
          JOIN_DELAY_DAYS
        );

      const offers =
        Array.isArray(
          player.transferOffers
        )
          ? player.transferOffers
          : [];

      const acceptedOffer =
        {
          ...offers[
            bid.offerIndex
          ],

          offerAmount:
            counterAmount,

          status:
            "accepted",

          acceptedAt:
            gameDate.toISOString(),

          joiningDate,
        };

      const updatedOffers =
        offers.map(
          (offer, index) =>
            index ===
            bid.offerIndex
              ? acceptedOffer
              : offer
        );

      await updatePlayer(
        player.id,
        {
          transferOffers:
            updatedOffers,

          latestOffer:
            acceptedOffer,

          transferStatus:
            "accepted",

          pendingTransfer: {
            ...acceptedOffer,

            fromClubId:
              currentClubId,

            fromClubName:
              currentClub?.name ||
              "",

            toClubId:
              bid.buyerClubId,

            toClubName:
              bid.buyerClubName,

            status:
              "joining",

            joiningDate,
          },
        }
      );

      setSelectedBid(null);
      setShowBidModal(false);

      toast.success(
        `Counter offer accepted: €${money(
          counterAmount
        )}`
      );
    } catch (error) {
      console.error(error);

      toast.error(
        "Could not accept counter offer"
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     OPEN CONTRACT
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

    setContractBonus("");
    setContractYears("3");

    setShowContractModal(
      true
    );
  }

  /* =======================================================
     MAKE CONTRACT OFFER
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

    if (wage <= 0) {
      toast.error(
        "Enter a valid weekly wage"
      );

      return;
    }

    if (years <= 0) {
      toast.error(
        "Contract duration is invalid"
      );

      return;
    }

    try {
      setContractLoading(
        true
      );

      const gameDate =
        currentGameDate ||
        new Date();

      const contract = {
        id:
          `${currentClubId}-${contractPlayer.id}-${gameDate.getTime()}`,

        clubId:
          currentClubId,

        clubName:
          currentClub?.name ||
          currentClub?.clubName ||
          "",

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
          "contract-offered",

        negotiationRound: 1,

        secondChanceUsed:
          false,

        createdAt:
          gameDate.toISOString(),

        responseDeadline:
          addGameDays(
            gameDate,
            CONTRACT_WAIT_DAYS
          ),

        createdBy:
          user?.uid ||
          "user",

        transferId:
          contractPlayer
            ?.latestOffer?.id ||
          null,
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

          /*
            If the player is already
            in this club but contract
            was missing, keep it
            contract-pending.
          */

          transferStatus:
            "contract-pending",
        }
      );

      setShowContractModal(
        false
      );

      setContractPlayer(
        null
      );

      toast.success(
        "Contract offer sent. The player will respond using the game calendar."
      );
    } catch (error) {
      console.error(error);

      toast.error(
        "Could not send contract offer"
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
    if (
      !contract ||
      !contract.playerId ||
      contract.secondChanceUsed
    ) {
      return;
    }

    const player =
      playerMap[
        contract.playerId
      ];

    if (!player) {
      toast.error(
        "Player no longer exists"
      );

      return;
    }

    try {
      setSaving(true);

      const currentWage =
        safeNumber(
          contract.weeklyWage,
          0
        );

      const improvedWage =
        Math.round(
          currentWage * 1.15
        );

      const gameDate =
        currentGameDate ||
        new Date();

      const offers =
        Array.isArray(
          player.contractOffers
        )
          ? player.contractOffers
          : [];

      const updatedOffers =
        offers.map(
          (offer) => {
            if (
              offer.id !==
              contract.id
            ) {
              return offer;
            }

            return {
              ...offer,

              weeklyWage:
                improvedWage,

              negotiationRound:
                safeNumber(
                  offer.negotiationRound,
                  1
                ) + 1,

              secondChanceUsed:
                true,

              status:
                "contract-offered",

              createdAt:
                gameDate.toISOString(),

              responseDeadline:
                addGameDays(
                  gameDate,
                  CONTRACT_WAIT_DAYS
                ),
            };
          }
        );

      const latest =
        updatedOffers.find(
          (offer) =>
            offer.id ===
            contract.id
        );

      await updatePlayer(
        player.id,
        {
          contractOffers:
            updatedOffers,

          latestContractOffer:
            latest,

          transferStatus:
            "contract-pending",
        }
      );

      toast.success(
        `Second negotiation sent with €${money(
          improvedWage
        )} weekly wage.`
      );
    } catch (error) {
      console.error(error);

      toast.error(
        "Could not start second negotiation"
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
      <main
        className={
          styles.loadingPage
        }
      >
        <div
          className={
            styles.loadingCard
          }
        >
          <span>⚽</span>

          <h1>
            Loading transfer centre...
          </h1>

          <p>
            Loading clubs,
            players and transfer
            negotiations.
          </p>
        </div>
      </main>
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

          <meta
            name="description"
            content="Football transfer centre"
          />
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
            You need to manage
            a club before
            negotiating transfers.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/club"
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
      currentClub?.transferBudget ||
        0
    );

  const wageBudget =
    safeNumber(
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
          Transfer Centre |{" "}
          {currentClub?.name ||
            "Club"}
        </title>

        <meta
          name="description"
          content="Manage football transfers, AI negotiations, contracts, incoming offers and General Manager recommendations."
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
                "⚽"
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

              {currentGameDate && (
                <small>
                  Game date:{" "}
                  {formatDate(
                    currentGameDate
                  )}
                </small>
              )}
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
                €
                {money(
                  transferBudget
                )}
              </strong>
            </div>

            <div>
              <span>
                WAGE BUDGET
              </span>

              <strong>
                €
                {money(
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
            <span>📥</span>

            <div>
              <small>
                INCOMING
              </small>

              <strong>
                {pendingIncoming}
              </strong>

              <p>
                Offers awaiting
                decision
              </p>
            </div>
          </article>

          <article
            className={
              styles.summaryCard
            }
          >
            <span>📤</span>

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
            <span>✍️</span>

            <div>
              <small>
                CONTRACTS
              </small>

              <strong>
                {contractWaiting}
              </strong>

              <p>
                Players considering
                offers
              </p>
            </div>
          </article>

          <article
            className={
              styles.summaryCard
            }
          >
            <span>✅</span>

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

          <article
            className={
              styles.summaryCard
            }
          >
            <span>⏳</span>

            <div>
              <small>
                JOINING
              </small>

              <strong>
                {joiningCount}
              </strong>

              <p>
                Players arriving
                soon
              </p>
            </div>
          </article>
        </section>

        {/* =================================================
            GM
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
                targets.
              </strong>

              <p>
                Based on squad needs,
                budget, rating, age
                and market availability.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  "suggestions"
                )
              }
            >
              View Recommendations
            </button>
          </section>
        )}

        {/* =================================================
            NAVIGATION
        ================================================= */}

        <nav
          className={
            styles.tabs
          }
        >
          <button
            type="button"
            className={
              activeTab ===
              "incoming"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setActiveTab(
                "incoming"
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
            type="button"
            className={
              activeTab ===
              "outgoing"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setActiveTab(
                "outgoing"
              )
            }
          >
            📤 My Bids
          </button>

          <button
            type="button"
            className={
              activeTab ===
              "joining"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setActiveTab(
                "joining"
              )
            }
          >
            ⏳ Joining Club

            {joiningCount >
              0 && (
              <b>
                {joiningCount}
              </b>
            )}
          </button>

          <button
            type="button"
            className={
              activeTab ===
              "contracts"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setActiveTab(
                "contracts"
              )
            }
          >
            ✍️ Contracts
          </button>

          <button
            type="button"
            className={
              activeTab ===
              "suggestions"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setActiveTab(
                "suggestions"
              )
            }
          >
            🧠 GM Suggestions
          </button>
        </nav>

        {/* =================================================
            BIDS
        ================================================= */}

        {(
          activeTab ===
            "incoming" ||
          activeTab ===
            "outgoing"
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
                  "incoming"
                    ? "Offers for Your Players"
                    : "Your Transfer Bids"}
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

                  <option value="joining">
                    Joining
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
                  {visibleBids
                    .length > 0 ? (
                    visibleBids.map(
                      (bid) => {
                        const player =
                          bid.player;

                        const status =
                          offerStatus(
                            bid
                          );

                        const remaining =
                          gameDaysRemaining(
                            bid.responseDeadline,
                            currentGameDate
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
                                  router.push(
                                    `/player/${player.id}`
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
                                    )}{" "}
                                    • OVR{" "}
                                    {playerOverall(
                                      player
                                    )}
                                  </small>
                                </span>
                              </button>
                            </td>

                            <td>
                              {bid.buyerClubName ||
                                "Unknown Club"}
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
                                className={`${styles.status} ${styles[statusClass(
                                  status
                                )]}`}
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

                                {remaining !==
                                  null && (
                                  <>
                                    {" "}
                                    •{" "}
                                    {remaining >
                                    0
                                      ? `${remaining} game days`
                                      : "Due"}
                                  </>
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
                                  "incoming" &&
                                  status ===
                                    "pending" && (
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
                            No transfer activity
                          </strong>

                          <p>
                            There are no
                            offers matching
                            your filters.
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
            JOINING
        ================================================= */}

        {activeTab ===
          "joining" && (
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
                  PENDING ARRIVALS
                </span>

                <h2>
                  Players Joining Your Club
                </h2>

                <p>
                  These players have
                  accepted transfers
                  and are waiting for
                  their joining date.
                </p>
              </div>
            </div>

            {joiningPlayers.length >
            0 ? (
              <div
                className={
                  styles.joiningList
                }
              >
                {joiningPlayers.map(
                  (player) => {
                    const pending =
                      player.pendingTransfer;

                    const remaining =
                      gameDaysRemaining(
                        pending.joiningDate,
                        currentGameDate
                      );

                    return (
                      <article
                        key={
                          player.id
                        }
                        className={
                          styles.joiningCard
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

                        <div
                          className={
                            styles.joiningInfo
                          }
                        >
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
                            From:{" "}
                            {pending.fromClubName ||
                              "Unknown"}
                          </p>

                          <p>
                            Fee: €
                            {money(
                              pending.offerAmount
                            )}
                          </p>
                        </div>

                        <div
                          className={
                            styles.joiningDate
                          }
                        >
                          <span>
                            JOINING DATE
                          </span>

                          <strong>
                            {formatDate(
                              pending.joiningDate
                            )}
                          </strong>

                          {remaining !==
                            null && (
                            <small>
                              {remaining >
                              0
                                ? `${remaining} game days remaining`
                                : "Joining today"}
                            </small>
                          )}

                          <button
                            type="button"
                            className={
                              styles.secondaryButton
                            }
                            onClick={() =>
                              openContract(
                                player
                              )
                            }
                          >
                            Offer Contract
                          </button>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
            ) : (
              <div
                className={
                  styles.emptyState
                }
              >
                <span>
                  ⏳
                </span>

                <h3>
                  No players joining
                </h3>

                <p>
                  Accepted transfers
                  waiting for their
                  joining date will
                  appear here.
                </p>
              </div>
            )}
          </section>
        )}

        {/* =================================================
            CONTRACTS
        ================================================= */}

        {activeTab ===
          "contracts" && (
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

                <p>
                  A transfer becomes
                  fully completed only
                  after the player accepts
                  the contract.
                </p>
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
                      gameDaysRemaining(
                        contract.responseDeadline,
                        currentGameDate
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
                              {getPlayerClubName(
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
                                0}{" "}
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
                            className={`${styles.status} ${styles[statusClass(
                              status
                            )]}`}
                          >
                            {statusText(
                              status
                            )}
                          </span>

                          {remaining !==
                            null &&
                            status ===
                              "contract-offered" && (
                              <span>
                                {remaining >
                                0
                                  ? `${remaining} game days remaining`
                                  : "Response deadline reached"}
                              </span>
                            )}
                        </div>

                        <div
                          className={
                            styles.contractActions
                          }
                        >
                          {status ===
                            "contract-offered" && (
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
                                ? "Second Chance Used"
                                : "Second Negotiation"}
                            </button>
                          )}

                          <button
                            type="button"
                            className={
                              styles.secondaryButton
                            }
                            onClick={() =>
                              router.push(
                                `/player/${player?.id}`
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
                    will appear here.
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
          "suggestions" && (
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
                  based on squad needs,
                  budget, rating and
                  availability.
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
                      )}{" "}
                      • OVR{" "}
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
                            ✓{" "}
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
                          router.push(
                            `/player/${player.id}`
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
                  {
                    selectedBid.buyerClubName
                  }{" "}
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
                      )}{" "}
                      • OVR{" "}
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

                  {selectedBid.responseDeadline &&
                    currentGameDate && (
                      <div>
                        <span>
                          GAME DEADLINE
                        </span>

                        <strong>
                          {formatDate(
                            selectedBid.responseDeadline
                          )}
                        </strong>
                      </div>
                    )}
                </div>

                {selectedBid.systemResponse &&
                  selectedBid.responseNote && (
                    <div
                      className={
                        styles.systemResponse
                      }
                    >
                      💬{" "}
                      {
                        selectedBid.responseNote
                      }
                    </div>
                  )}

                {selectedBid.counterOffer && (
                  <div
                    className={
                      styles.systemResponse
                    }
                  >
                    💰 AI counter
                    offer:{" "}
                    <strong>
                      €
                      {money(
                        selectedBid.counterOffer
                      )}
                    </strong>
                  </div>
                )}

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
                      router.push(
                        `/player/${selectedBid.playerId}`
                      )
                    }
                  >
                    View Player
                  </button>

                  {activeTab ===
                    "incoming" &&
                    offerStatus(
                      selectedBid
                    ) ===
                      "pending" && (
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
                            ? "Processing..."
                            : "Accept Bid"}
                        </button>
                      </>
                    )}

                  {activeTab ===
                    "outgoing" &&
                    selectedBid.counterOffer &&
                    selectedBid.status ===
                      "negotiation" && (
                      <button
                        type="button"
                        className={
                          styles.acceptButton
                        }
                        disabled={
                          saving
                        }
                        onClick={() =>
                          acceptCounterOffer(
                            selectedBid
                          )
                        }
                      >
                        Accept Counter €
                        {money(
                          selectedBid.counterOffer
                        )}
                      </button>
                    )}
                </div>
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
                  Offer the player a
                  new contract.
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
                            event
                              .target
                              .value
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
                            event
                              .target
                              .value
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
                          event
                            .target
                            .value
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
                  ⏱️ The player will
                  have approximately{" "}
                  <strong>
                    {
                      CONTRACT_WAIT_DAYS
                    }{" "}
                    game days
                  </strong>{" "}
                  to respond.
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
                    ? "Sending..."
                    : "Send Contract Offer"}
                </button>
              </div>
            </div>
          )}
      </main>
    </>
  );
}
