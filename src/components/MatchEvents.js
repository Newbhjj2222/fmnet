// components/match/MatchEvents.js

import styles from "./MatchEvents.module.css";

export default function MatchEvents({
  events = [],
}) {
  return (
    <section
      className={styles.panel}
    >
      <h3>
        Match Events
      </h3>

      <div
        className={styles.list}
      >
        {events
          .slice()
          .reverse()
          .map((event) => (
            <div
              key={event.id}
              className={
                styles.event
              }
            >
              <strong>
                {event.minute}'
              </strong>

              <div>
                <span>
                  {event.text}
                </span>

                {event.playerNumber && (
                  <small>
                    #
                    {
                      event.playerNumber
                    }{" "}
                    {
                      event.playerName
                    }
                  </small>
                )}
              </div>
            </div>
          ))}

        {!events.length && (
          <div
            className={
              styles.empty
            }
          >
            Match events will
            appear here.
          </div>
        )}
      </div>
    </section>
  );
}
