// components/LineupSelector.jsx

import { useMemo, useState } from "react";
import {
  getPlayerId,
  getPlayerName,
  getPlayerOverall,
  getPlayerRole,
  FORMATIONS,
  validateStartingXI,
} from "../lib/football";

import styles from "./LineupSelector.module.css";

export default function LineupSelector({
  squad = [],
  formation = "4-4-2",
  selectedIds = [],
  onChange,
}) {
  const [filter, setFilter] =
    useState("ALL");

  const selected = useMemo(() => {
    return squad.filter((player) =>
      selectedIds.includes(
        getPlayerId(player)
      )
    );
  }, [squad, selectedIds]);

  const requirements =
    FORMATIONS[formation] ||
    FORMATIONS["4-4-2"];

  const validation =
    validateStartingXI(
      selected,
      formation
    );

  const filteredPlayers =
    squad.filter((player) => {
      if (filter === "ALL") return true;

      return (
        getPlayerRole(player) === filter
      );
    });

  const togglePlayer = (player) => {
    const id = getPlayerId(player);

    if (!id) return;

    const exists =
      selectedIds.includes(id);

    if (exists) {
      onChange(
        selectedIds.filter(
          (playerId) => playerId !== id
        )
      );

      return;
    }

    if (selectedIds.length >= 11) {
      return;
    }

    onChange([
      ...selectedIds,
      id,
    ]);
  };

  const countRole = (role) =>
    selected.filter(
      (player) =>
        getPlayerRole(player) === role
    ).length;

  return (
    <section className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <span>TEAM SELECTION</span>
          <h2>Choose Starting XI</h2>
        </div>

        <div className={styles.counter}>
          <strong>
            {selected.length}/11
          </strong>
        </div>
      </div>

      <div className={styles.formation}>
        <strong>
          Formation: {formation}
        </strong>

        <div className={styles.requirements}>
          <span>
            GK {countRole("GK")}/
            {requirements.GK}
          </span>

          <span>
            DEF {countRole("DEF")}/
            {requirements.DEF}
          </span>

          <span>
            MID {countRole("MID")}/
            {requirements.MID}
          </span>

          <span>
            ATT {countRole("ATT")}/
            {requirements.ATT}
          </span>
        </div>
      </div>

      <div className={styles.filters}>
        {[
          ["ALL", "All"],
          ["GK", "GK"],
          ["DEF", "DEF"],
          ["MID", "MID"],
          ["ATT", "ATT"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={
              filter === value
                ? styles.activeFilter
                : ""
            }
            onClick={() =>
              setFilter(value)
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.players}>
        {filteredPlayers.map(
          (player) => {
            const id =
              getPlayerId(player);

            const isSelected =
              selectedIds.includes(id);

            return (
              <button
                key={id}
                type="button"
                className={
                  isSelected
                    ? styles.playerSelected
                    : styles.player
                }
                onClick={() =>
                  togglePlayer(player)
                }
              >
                <div
                  className={
                    styles.position
                  }
                >
                  {getPlayerRole(player)}
                </div>

                <div
                  className={
                    styles.playerInfo
                  }
                >
                  <strong>
                    {getPlayerName(player)}
                  </strong>

                  <small>
                    OVR{" "}
                    {getPlayerOverall(
                      player
                    )}
                  </small>
                </div>

                <div
                  className={
                    styles.check
                  }
                >
                  {isSelected
                    ? "✓"
                    : "+"}
                </div>
              </button>
            );
          }
        )}
      </div>

      <div
        className={
          validation.valid
            ? styles.valid
            : styles.invalid
        }
      >
        {validation.message}
      </div>
    </section>
  );
}
