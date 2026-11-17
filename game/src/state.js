// The match, kept in one place: the phase, the round, the score, the clock
// and the reason the round ended. main.js reads it and writes it; nothing
// else keeps a copy of a round's outcome.
export const PHASES = ['menu', 'buy', 'live', 'roundEnd', 'matchEnd'];
export const WIN_SCORE = 5;
export const MAX_ROUNDS = 9;
export const ROUND_SECONDS = 100;
export const BUY_SECONDS = 12;

export function createMatch() {
  return {
    phase: 'menu',
    round: 0,
    scoreSable: 0,
    scoreAshen: 0,
    time: 0,
    roundTimeLeft: ROUND_SECONDS,
    buyTimeLeft: BUY_SECONDS,
    winner: null,
    reason: '',
    plantedSite: null,
    started: false,
  };
}
