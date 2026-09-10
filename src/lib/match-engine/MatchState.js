export default class MatchState {
  constructor(homeTeam, awayTeam) {
    this.status = "not_started";
    this.time = 0;
    this.homeScore = 0;
    this.awayScore = 0;
    this.homeTeam = homeTeam;
    this.awayTeam = awayTeam;
    this.players = [];
    this.ball = null;
    this.events = [];
    this.lastEvent = null;
  }

  addEvent(event) {
    const complete = {
      id: Date.now() + Math.random(),
      minute: Math.floor(this.time / 60),
      ...event,
    };
    this.events.push(complete);
    this.lastEvent = complete;
    if (this.events.length > 100) this.events.shift();
  }

  getScore() { return `${this.homeScore} - ${this.awayScore}`; }
  getMinute() { return Math.floor(this.time / 60); }
}
