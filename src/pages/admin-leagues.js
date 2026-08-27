import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";
import Cookies from "js-cookie";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../components/firebase";

import styles from "./admin-leagues.module.css";


// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_CURRENCY = "EUR";

const DEFAULT_REPUTATION = 50;

const DEFAULT_BALANCE = 1000000;

const DEFAULT_TRANSFER_BUDGET = 500000;

const DEFAULT_WAGE_BUDGET = 100000;


// ============================================================
// NUMBER HELPERS
// ============================================================

function numberValue(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}


function formatMoney(value) {
  const number = numberValue(value, 0);

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(number);
}


// ============================================================
// NORMALIZE LEAGUE
// ============================================================

function normalizeLeague(id, data = {}) {
  return {
    id,

    name:
      data.name ||
      data.leagueName ||
      data.title ||
      "Unnamed League",

    country:
      data.country ||
      data.countryName ||
      "",

    logo:
      data.logo ||
      data.logoUrl ||
      "",

    reputation:
      numberValue(
        data.reputation,
        DEFAULT_REPUTATION
      ),

    ...data,
  };
}


// ============================================================
// NORMALIZE CLUB
// ============================================================

function normalizeClub(id, data = {}) {
  return {
    id,

    name:
      data.name ||
      data.clubName ||
      data.teamName ||
      "Unnamed Club",

    shortName:
      data.shortName ||
      data.short ||
      "",

    logo:
      data.logo ||
      data.logoUrl ||
      "",

    leagueId:
      data.leagueId ||
      data.leagueID ||
      data.league ||
      data.competitionId ||
      "",

    country:
      data.country ||
      data.countryName ||
      "",

    currency:
      data.currency ||
      DEFAULT_CURRENCY,

    reputation:
      numberValue(
        data.reputation,
        DEFAULT_REPUTATION
      ),

    balance:
      numberValue(
        data.balance,
        DEFAULT_BALANCE
      ),

    transferBudget:
      numberValue(
        data.transferBudget,
        DEFAULT_TRANSFER_BUDGET
      ),

    wageBudget:
      numberValue(
        data.wageBudget,
        DEFAULT_WAGE_BUDGET
      ),

    ...data,
  };
}


// ============================================================
// PAGE
// ============================================================

export default function AdminLeaguesPage() {
  const router = useRouter();

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [leagues, setLeagues] =
    useState([]);

  const [clubs, setClubs] =
    useState([]);

  const [selectedLeagueId, setSelectedLeagueId] =
    useState("");

  const [selectedClubId, setSelectedClubId] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [form, setForm] = useState({
    reputation: DEFAULT_REPUTATION,
    balance: DEFAULT_BALANCE,
    transferBudget: DEFAULT_TRANSFER_BUDGET,
    wageBudget: DEFAULT_WAGE_BUDGET,
  });


  // ==========================================================
  // ADMIN CHECK
  // ==========================================================

  useEffect(() => {
    const username =
      Cookies.get("user");

    if (!username) {
      router.replace("/login");

      return;
    }

    /*
     * If your project already has a stronger
     * admin authentication system, keep that
     * system here.
     */
  }, [router]);


  // ==========================================================
  // LOAD LEAGUES
  // ==========================================================

  useEffect(() => {
    let unsubscribe;

    async function loadLeagues() {
      try {
        setLoading(true);
        setError("");

        const snapshot =
          await getDocs(
            collection(
              db,
              "leagues"
            )
          );

        const list =
          snapshot.docs
            .map((item) =>
              normalizeLeague(
                item.id,
                item.data()
              )
            )
            .sort((a, b) =>
              a.name.localeCompare(
                b.name
              )
            );

        setLeagues(list);

        if (
          list.length > 0 &&
          !selectedLeagueId
        ) {
          setSelectedLeagueId(
            list[0].id
          );
        }
      } catch (err) {
        console.error(
          "Load leagues error:",
          err
        );

        setError(
          err?.message ||
          "Failed to load leagues."
        );
      } finally {
        setLoading(false);
      }
    }

    loadLeagues();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedLeagueId]);


  // ==========================================================
  // LOAD CLUBS
  // ==========================================================

  useEffect(() => {
    if (!selectedLeagueId) {
      setClubs([]);
      setSelectedClubId("");

      return;
    }

    let unsubscribe =
      null;

    async function loadClubs() {
      try {
        setLoading(true);
        setError("");

        /*
         * First try:
         * clubs where leagueId == selectedLeagueId
         */

        const clubsQuery =
          query(
            collection(
              db,
              "clubs"
            ),
            where(
              "leagueId",
              "==",
              selectedLeagueId
            )
          );

        const snapshot =
          await getDocs(
            clubsQuery
          );

        const list =
          snapshot.docs
            .map((item) =>
              normalizeClub(
                item.id,
                item.data()
              )
            )
            .sort((a, b) =>
              a.name.localeCompare(
                b.name
              )
            );

        setClubs(list);

        if (list.length > 0) {
          setSelectedClubId(
            list[0].id
          );
        } else {
          setSelectedClubId("");
        }
      } catch (err) {
        console.error(
          "Load clubs error:",
          err
        );

        /*
         * Firestore index/query problems
         * should not destroy the page.
         *
         * Fallback: load all clubs and
         * filter locally.
         */

        try {
          const snapshot =
            await getDocs(
              collection(
                db,
                "clubs"
              )
            );

          const all =
            snapshot.docs.map(
              (item) =>
                normalizeClub(
                  item.id,
                  item.data()
                )
            );

          const filtered =
            all
              .filter(
                (club) =>
                  String(
                    club.leagueId
                  ) ===
                  String(
                    selectedLeagueId
                  )
              )
              .sort((a, b) =>
                a.name.localeCompare(
                  b.name
                )
              );

          setClubs(filtered);

          if (
            filtered.length > 0
          ) {
            setSelectedClubId(
              filtered[0].id
            );
          } else {
            setSelectedClubId("");
          }

          setError("");
        } catch (fallbackError) {
          console.error(
            "Fallback clubs error:",
            fallbackError
          );

          setError(
            fallbackError?.message ||
            "Failed to load clubs."
          );
        }
      } finally {
        setLoading(false);
      }
    }

    loadClubs();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedLeagueId]);


  // ==========================================================
  // SELECTED CLUB
  // ==========================================================

  const selectedClub =
    useMemo(
      () =>
        clubs.find(
          (club) =>
            club.id ===
            selectedClubId
        ) || null,
      [
        clubs,
        selectedClubId,
      ]
    );


  // ==========================================================
  // FILTERED CLUBS
  // ==========================================================

  const filteredClubs =
    useMemo(() => {
      const value =
        search
          .trim()
          .toLowerCase();

      if (!value) {
        return clubs;
      }

      return clubs.filter(
        (club) =>
          club.name
            .toLowerCase()
            .includes(value) ||
          club.shortName
            ?.toLowerCase()
            .includes(value)
      );
    }, [
      clubs,
      search,
    ]);


  // ==========================================================
  // SELECT CLUB
  // ==========================================================

  const selectClub =
    useCallback(
      (club) => {
        setSelectedClubId(
          club.id
        );

        setForm({
          reputation:
            numberValue(
              club.reputation,
              DEFAULT_REPUTATION
            ),

          balance:
            numberValue(
              club.balance,
              DEFAULT_BALANCE
            ),

          transferBudget:
            numberValue(
              club.transferBudget,
              DEFAULT_TRANSFER_BUDGET
            ),

          wageBudget:
            numberValue(
              club.wageBudget,
              DEFAULT_WAGE_BUDGET
            ),
        });

        setSuccess("");
        setError("");
      },
      []
    );


  // ==========================================================
  // WHEN SELECTED CLUB CHANGES
  // ==========================================================

  useEffect(() => {
    if (!selectedClub) {
      return;
    }

    setForm({
      reputation:
        numberValue(
          selectedClub.reputation,
          DEFAULT_REPUTATION
        ),

      balance:
        numberValue(
          selectedClub.balance,
          DEFAULT_BALANCE
        ),

      transferBudget:
        numberValue(
          selectedClub.transferBudget,
          DEFAULT_TRANSFER_BUDGET
        ),

      wageBudget:
        numberValue(
          selectedClub.wageBudget,
          DEFAULT_WAGE_BUDGET
        ),
    });
  }, [selectedClub]);


  // ==========================================================
  // FORM CHANGE
  // ==========================================================

  function handleChange(
    event
  ) {
    const {
      name,
      value,
    } = event.target;

    setForm((current) => ({
      ...current,

      [name]:
        value === ""
          ? ""
          : value,
    }));

    setSuccess("");
  }


  // ==========================================================
  // SAVE CLUB
  // ==========================================================

  async function saveClub(
    event
  ) {
    event.preventDefault();

    if (!selectedClub) {
      setError(
        "Please select a club first."
      );

      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const reputation =
        Math.max(
          0,
          Math.min(
            100,
            numberValue(
              form.reputation,
              DEFAULT_REPUTATION
            )
          )
        );

      const balance =
        Math.max(
          0,
          numberValue(
            form.balance,
            DEFAULT_BALANCE
          )
        );

      const transferBudget =
        Math.max(
          0,
          numberValue(
            form.transferBudget,
            DEFAULT_TRANSFER_BUDGET
          )
        );

      const wageBudget =
        Math.max(
          0,
          numberValue(
            form.wageBudget,
            DEFAULT_WAGE_BUDGET
          )
        );

      const clubRef =
        doc(
          db,
          "clubs",
          selectedClub.id
        );

      await updateDoc(
        clubRef,
        {
          reputation,

          balance,

          transferBudget,

          wageBudget,

          updatedAt:
            new Date(),
        }
      );

      /*
       * Update local state immediately.
       */

      setClubs(
        (current) =>
          current.map(
            (club) =>
              club.id ===
              selectedClub.id
                ? {
                    ...club,

                    reputation,

                    balance,

                    transferBudget,

                    wageBudget,
                  }
                : club
          )
      );

      setSuccess(
        `${selectedClub.name} updated successfully.`
      );
    } catch (err) {
      console.error(
        "Save club error:",
        err
      );

      setError(
        err?.message ||
        "Failed to update club."
      );
    } finally {
      setSaving(false);
    }
  }


  // ==========================================================
  // LEAGUE CHANGE
  // ==========================================================

  function handleLeagueChange(
    event
  ) {
    const value =
      event.target.value;

    setSelectedLeagueId(
      value
    );

    setSelectedClubId("");

    setSearch("");

    setSuccess("");
    setError("");
  }


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <Head>
        <title>
          League & Club Manager
        </title>

        <meta
          name="description"
          content="Manage leagues and football clubs."
        />
      </Head>


      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.container
          }
        >

          {/* ==================================================
              HEADER
          ================================================== */}

          <header
            className={
              styles.header
            }
          >
            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                ADMIN PANEL
              </span>

              <h1
                className={
                  styles.title
                }
              >
                League & Club Manager
              </h1>

              <p
                className={
                  styles.subtitle
                }
              >
                Select a league, choose a club,
                and edit its financial and
                reputation settings.
              </p>
            </div>

            <button
              type="button"
              className={
                styles.backButton
              }
              onClick={() =>
                router.push(
                  "/admin"
                )
              }
            >
              ← Back to Admin
            </button>
          </header>


          {/* ==================================================
              MESSAGES
          ================================================== */}

          {error && (
            <div
              className={
                styles.error
              }
            >
              {error}
            </div>
          )}

          {success && (
            <div
              className={
                styles.success
              }
            >
              {success}
            </div>
          )}


          {/* ==================================================
              LEAGUE SELECTOR
          ================================================== */}

          <section
            className={
              styles.panel
            }
          >
            <div
              className={
                styles.panelHeader
              }
            >
              <div>
                <h2>
                  Select League
                </h2>

                <p>
                  Choose the competition
                  whose clubs you want
                  to manage.
                </p>
              </div>
            </div>

            <div
              className={
                styles.leagueGrid
              }
            >
              {loading &&
                leagues.length ===
                  0 && (
                  <div
                    className={
                      styles.loading
                    }
                  >
                    Loading leagues...
                  </div>
                )}

              {!loading &&
                leagues.length ===
                  0 && (
                  <div
                    className={
                      styles.empty
                    }
                  >
                    No leagues found.
                  </div>
                )}

              {leagues.map(
                (league) => {
                  const active =
                    league.id ===
                    selectedLeagueId;

                  return (
                    <button
                      key={
                        league.id
                      }
                      type="button"
                      className={`${styles.leagueCard} ${
                        active
                          ? styles.leagueCardActive
                          : ""
                      }`}
                      onClick={() =>
                        handleLeagueChange({
                          target: {
                            value:
                              league.id,
                          },
                        })
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
                            alt={
                              league.name
                            }
                          />
                        ) : (
                          <span>
                            ⚽
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.leagueInfo
                        }
                      >
                        <strong>
                          {
                            league.name
                          }
                        </strong>

                        {league.country && (
                          <span>
                            {
                              league.country
                            }
                          </span>
                        )}
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </section>


          {/* ==================================================
              MAIN CONTENT
          ================================================== */}

          {selectedLeagueId && (
            <div
              className={
                styles.workspace
              }
            >

              {/* ==============================================
                  CLUB LIST
              ============================================== */}

              <section
                className={
                  styles.panel
                }
              >
                <div
                  className={
                    styles.panelHeader
                  }
                >
                  <div>
                    <h2>
                      Clubs
                    </h2>

                    <p>
                      {
                        clubs.length
                      }{" "}
                      clubs in this league
                    </p>
                  </div>

                  <div
                    className={
                      styles.clubCount
                    }
                  >
                    {
                      filteredClubs.length
                    }
                  </div>
                </div>


                <div
                  className={
                    styles.searchBox
                  }
                >
                  <span>
                    🔎
                  </span>

                  <input
                    type="search"
                    value={
                      search
                    }
                    onChange={(event) =>
                      setSearch(
                        event.target.value
                      )
                    }
                    placeholder="Search club..."
                  />
                </div>


                <div
                  className={
                    styles.clubList
                  }
                >
                  {loading && (
                    <div
                      className={
                        styles.loading
                      }
                    >
                      Loading clubs...
                    </div>
                  )}

                  {!loading &&
                    filteredClubs.length ===
                      0 && (
                      <div
                        className={
                          styles.empty
                        }
                      >
                        No clubs were found
                        for this league.
                      </div>
                    )}

                  {filteredClubs.map(
                    (club) => {
                      const active =
                        club.id ===
                        selectedClubId;

                      return (
                        <button
                          type="button"
                          key={
                            club.id
                          }
                          className={`${styles.clubItem} ${
                            active
                              ? styles.clubItemActive
                              : ""
                          }`}
                          onClick={() =>
                            selectClub(
                              club
                            )
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
                              <span>
                                ⚽
                              </span>
                            )}
                          </div>

                          <div
                            className={
                              styles.clubDetails
                            }
                          >
                            <strong>
                              {
                                club.name
                              }
                            </strong>

                            {club.shortName && (
                              <small>
                                {
                                  club.shortName
                                }
                              </small>
                            )}
                          </div>

                          <span
                            className={
                              styles.arrow
                            }
                          >
                            →
                          </span>
                        </button>
                      );
                    }
                  )}
                </div>
              </section>


              {/* ==============================================
                  EDIT FORM
              ============================================== */}

              <section
                className={
                  styles.panel
                }
              >
                {!selectedClub ? (
                  <div
                    className={
                      styles.noSelection
                    }
                  >
                    <div>
                      ⚽
                    </div>

                    <h2>
                      Select a club
                    </h2>

                    <p>
                      Choose a club from
                      the list to edit
                      its settings.
                    </p>
                  </div>
                ) : (
                  <>
                    <div
                      className={
                        styles.clubHero
                      }
                    >
                      <div
                        className={
                          styles.heroLogo
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
                          <span>
                            ⚽
                          </span>
                        )}
                      </div>

                      <div>
                        <span
                          className={
                            styles.heroLabel
                          }
                        >
                          SELECTED CLUB
                        </span>

                        <h2>
                          {
                            selectedClub.name
                          }
                        </h2>

                        <p>
                          {
                            selectedClub.country ||
                            "Football Club"
                          }
                        </p>
                      </div>
                    </div>


                    <form
                      className={
                        styles.form
                      }
                      onSubmit={
                        saveClub
                      }
                    >

                      {/* REPUTATION */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="reputation"
                        >
                          Reputation
                        </label>

                        <div
                          className={
                            styles.inputWithSuffix
                          }
                        >
                          <input
                            id="reputation"
                            name="reputation"
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={
                              form.reputation
                            }
                            onChange={
                              handleChange
                            }
                          />

                          <span>
                            / 100
                          </span>
                        </div>

                        <small>
                          Club reputation
                          affects its
                          overall standing.
                        </small>
                      </div>


                      {/* BALANCE */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="balance"
                        >
                          Club Balance
                        </label>

                        <div
                          className={
                            styles.inputWithSuffix
                          }
                        >
                          <input
                            id="balance"
                            name="balance"
                            type="number"
                            min="0"
                            step="1"
                            value={
                              form.balance
                            }
                            onChange={
                              handleChange
                            }
                          />

                          <span>
                            {
                              selectedClub.currency ||
                              DEFAULT_CURRENCY
                            }
                          </span>
                        </div>

                        <small>
                          Current money
                          available to the
                          club.
                        </small>
                      </div>


                      {/* TRANSFER BUDGET */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="transferBudget"
                        >
                          Transfer Budget
                        </label>

                        <div
                          className={
                            styles.inputWithSuffix
                          }
                        >
                          <input
                            id="transferBudget"
                            name="transferBudget"
                            type="number"
                            min="0"
                            step="1"
                            value={
                              form.transferBudget
                            }
                            onChange={
                              handleChange
                            }
                          />

                          <span>
                            {
                              selectedClub.currency ||
                              DEFAULT_CURRENCY
                            }
                          </span>
                        </div>

                        <small>
                          Money available for
                          player transfers.
                        </small>
                      </div>


                      {/* WAGE BUDGET */}

                      <div
                        className={
                          styles.field
                        }
                      >
                        <label
                          htmlFor="wageBudget"
                        >
                          Wage Budget
                        </label>

                        <div
                          className={
                            styles.inputWithSuffix
                          }
                        >
                          <input
                            id="wageBudget"
                            name="wageBudget"
                            type="number"
                            min="0"
                            step="1"
                            value={
                              form.wageBudget
                            }
                            onChange={
                              handleChange
                            }
                          />

                          <span>
                            {
                              selectedClub.currency ||
                              DEFAULT_CURRENCY
                            }
                          </span>
                        </div>

                        <small>
                          Budget available for
                          player and staff
                          wages.
                        </small>
                      </div>


                      {/* CURRENT VALUES */}

                      <div
                        className={
                          styles.summary
                        }
                      >
                        <div>
                          <span>
                            Reputation
                          </span>

                          <strong>
                            {
                              form.reputation ||
                              0
                            }
                            /100
                          </strong>
                        </div>

                        <div>
                          <span>
                            Balance
                          </span>

                          <strong>
                            {
                              formatMoney(
                                form.balance
                              )
                            }
                          </strong>
                        </div>

                        <div>
                          <span>
                            Transfers
                          </span>

                          <strong>
                            {
                              formatMoney(
                                form.transferBudget
                              )
                            }
                          </strong>
                        </div>

                        <div>
                          <span>
                            Wages
                          </span>

                          <strong>
                            {
                              formatMoney(
                                form.wageBudget
                              )
                            }
                          </strong>
                        </div>
                      </div>


                      {/* SAVE */}

                      <button
                        type="submit"
                        disabled={
                          saving
                        }
                        className={
                          styles.saveButton
                        }
                      >
                        {saving
                          ? "Saving..."
                          : "Save Club Changes"}
                      </button>
                    </form>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
