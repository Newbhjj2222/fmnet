// components/match/TacticsPanel.js

import styles from "./TacticsPanel.module.css";

export default function TacticsPanel({
  tactics,
  formation,
  onChange,
  onFormationChange,
  disabled = false,
}) {
  const update =
    (key) =>
    (event) => {
      onChange?.({
        ...tactics,
        [key]:
          event.target.value,
      });
    };

  return (
    <section
      className={styles.panel}
    >
      <div
        className={styles.title}
      >
        <div>
          <h3>
            Team Tactics
          </h3>

          <span>
            Only your team
          </span>
        </div>
      </div>

      <div
        className={styles.grid}
      >
        <label>
          Formation

          <select
            value={formation}
            disabled={disabled}
            onChange={(e) =>
              onFormationChange?.(
                e.target.value
              )
            }
          >
            <option>
              4-4-2
            </option>

            <option>
              4-3-3
            </option>

            <option>
              3-5-2
            </option>

            <option>
              5-3-2
            </option>

            <option>
              4-2-3-1
            </option>
          </select>
        </label>

        <label>
          Mentality

          <select
            value={
              tactics.mentality
            }
            disabled={disabled}
            onChange={update(
              "mentality"
            )}
          >
            <option value="defensive">
              Defensive
            </option>

            <option value="balanced">
              Balanced
            </option>

            <option value="attacking">
              Attacking
            </option>
          </select>
        </label>

        <label>
          Pressing

          <select
            value={
              tactics.pressing
            }
            disabled={disabled}
            onChange={update(
              "pressing"
            )}
          >
            <option value="low">
              Low
            </option>

            <option value="medium">
              Medium
            </option>

            <option value="high">
              High
            </option>
          </select>
        </label>

        <label>
          Defensive Line

          <select
            value={
              tactics.defensiveLine
            }
            disabled={disabled}
            onChange={update(
              "defensiveLine"
            )}
          >
            <option value="low">
              Low
            </option>

            <option value="medium">
              Medium
            </option>

            <option value="high">
              High
            </option>
          </select>
        </label>

        <label>
          Width

          <select
            value={
              tactics.width
            }
            disabled={disabled}
            onChange={update(
              "width"
            )}
          >
            <option value="narrow">
              Narrow
            </option>

            <option value="medium">
              Medium
            </option>

            <option value="wide">
              Wide
            </option>
          </select>
        </label>

        <label>
          Tempo

          <select
            value={
              tactics.tempo
            }
            disabled={disabled}
            onChange={update(
              "tempo"
            )}
          >
            <option value="slow">
              Slow
            </option>

            <option value="medium">
              Medium
            </option>

            <option value="fast">
              Fast
            </option>
          </select>
        </label>

        <label>
          Passing Style

          <select
            value={
              tactics.passingStyle
            }
            disabled={disabled}
            onChange={update(
              "passingStyle"
            )}
          >
            <option value="short">
              Short
            </option>

            <option value="mixed">
              Mixed
            </option>

            <option value="direct">
              Direct
            </option>
          </select>
        </label>
      </div>

      <label
        className={styles.checkbox}
      >
        <input
          type="checkbox"
          checked={
            Boolean(
              tactics.counterAttack
            )
          }
          disabled={disabled}
          onChange={(e) =>
            onChange?.({
              ...tactics,
              counterAttack:
                e.target.checked,
            })
          }
        />

        <span>
          Counter Attack
        </span>
      </label>
    </section>
  );
}
