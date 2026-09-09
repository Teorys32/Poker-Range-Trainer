export type TableSize = 6 | 9;
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = '♠' | '♥' | '♦' | '♣';
export type Card = { rank: Rank; suit: Suit };
export type Street = 'FLOP' | 'TURN' | 'RIVER';
export type PreflopAction = 'OPEN' | 'FOLD' | 'CALL' | '3BET' | '4BET';
export type PostAction = 'CHECK' | 'BET 25%' | 'BET 33%' | 'BET 50%' | 'BET 75%' | 'BET 125%' | 'CALL' | 'RAISE' | 'FOLD';
export type Difficulty = 'Tous' | 'Débutant' | 'Intermédiaire' | 'Avancé';

export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
export const SIX_MAX = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
export const NINE_MAX = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const OPEN_RANGES: Record<string, string[]> = {
  UTG: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', 'AKs', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs', 'AKo', 'AQo'],
  'UTG+1': ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', 'AKs', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'QJs', 'JTs', 'T9s', 'AKo', 'AQo', 'AJo'],
  MP: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'QJs', 'JTs', 'T9s', '98s', 'AKo', 'AQo', 'AJo', 'KQo'],
  LJ: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', 'AKo', 'AQo', 'AJo', 'KQo'],
  HJ: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', 'AKo', 'AQo', 'AJo', 'KQo', 'KJo'],
  CO: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'A4s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', '98s', '87s', '76s', '65s', 'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo'],
  BTN: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'QJs', 'QTs', 'Q9s', 'Q8s', 'JTs', 'J9s', 'J8s', 'T9s', 'T8s', '98s', '87s', '76s', '65s', '54s', 'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo', 'QJo'],
  SB: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', '98s', '87s', '76s', '65s', '54s', 'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo', 'QJo'],
  BB: [],
};

export type PostDecision = {
  action: PostAction;
  frequency: number;
  reason: string;
  sizing?: string;
  options: PostAction[];
};

export type Spot = {
  id: string;
  table: TableSize;
  heroPosition: string;
  villainPosition: string;
  effectiveStack: number;
  pot: number;
  line: string;
  category: string;
  difficulty: 1 | 2 | 3;
  handClass: string;
  hole: Card[];
  runout: Card[];
  texture: string;
  preflop: {
    action: PreflopAction;
    frequency: number;
    explanation: string;
    options: PreflopAction[];
    rangeLabel: string;
  };
  post: Record<Street, PostDecision>;
};

type SpotTemplate = Omit<Spot, 'table' | 'hole' | 'runout'> & {
  tables?: TableSize[];
  flop: string[];
};

const templates: SpotTemplate[] = [
  { id: 'utg-open-ajo', heroPosition: 'UTG', villainPosition: '—', effectiveStack: 100, pot: 1.5, line: 'Personne n’a parlé', category: 'Open first in', difficulty: 1, handClass: 'AJo', flop: ['A♠', '7♦', '2♣'], texture: 'A-haut · rainbow', preflop: { action: 'OPEN', frequency: 100, explanation: 'AJo est dans la range d’ouverture UTG. Le sizing standard garde une range forte et compacte.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open UTG · 16%' }, post: basePost('BET 33%', 72, 'Top paire sur un board sec : un petit bet prend de la value et protège contre les overcards.', '33% pot') },
  { id: 'hj-mix-98s', heroPosition: 'HJ', villainPosition: '—', effectiveStack: 100, pot: 1.5, line: 'Personne n’a parlé', category: 'Open first in', difficulty: 1, handClass: '98s', flop: ['T♥', '7♣', '2♦'], texture: 'T-haut · connecté', preflop: { action: 'OPEN', frequency: 72, explanation: '98s est une ouverture mixée : la jouabilité postflop justifie l’entrée, mais pas à 100%.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open HJ · mixée 72%' }, post: basePost('BET 50%', 60, 'Le tirage quinte par les deux bouts profite d’un bet qui fait folder les hauteurs.', '50% pot') },
  { id: 'co-open-kqs', heroPosition: 'CO', villainPosition: '—', effectiveStack: 100, pot: 1.5, line: 'Personne n’a parlé', category: 'Open first in', difficulty: 1, handClass: 'KQs', flop: ['A♦', '7♣', '2♠'], texture: 'A-haut · sec', preflop: { action: 'OPEN', frequency: 100, explanation: 'KQs domine les broadways offsuit et se joue très bien en position. C’est une ouverture standard au cutoff.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open CO · 28%' }, post: basePost('BET 33%', 68, 'Le board avantage votre range d’open. Un petit sizing met la pression à toute la range adverse.', '33% pot') },
  { id: 'btn-open-a5s', heroPosition: 'BTN', villainPosition: '—', effectiveStack: 100, pot: 1.5, line: 'Personne n’a parlé', category: 'Open first in', difficulty: 1, handClass: 'A5s', flop: ['K♦', '8♠', '4♠'], texture: 'K-haut · two-tone', preflop: { action: 'OPEN', frequency: 100, explanation: 'Le bouton ouvre très large. A5s ajoute des backdoors et bloque les meilleures mains adverses.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open BTN · 45%' }, post: basePost('CHECK', 55, 'Avec deux backdoors et A-haut, réaliser son équité est souvent préférable à un bet automatique.', 'Check') },
  { id: 'sb-mix-a2o', heroPosition: 'SB', villainPosition: 'BB', effectiveStack: 100, pot: 1.5, line: 'Personne n’a parlé', category: 'Open first in', difficulty: 2, handClass: 'A2o', flop: ['J♠', '6♠', '2♥'], texture: 'J-haut · flush draw', preflop: { action: 'OPEN', frequency: 35, explanation: 'En SB contre BB, A2o est parfois ouvert mais préfère souvent abandonner face à la position de défense.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open SB · mixée 35%' }, post: basePost('BET 33%', 65, 'La paire basse peut miser petit pour deny l’équité des overcards et des tirages.', '33% pot') },
  { id: 'bb-call-q9s', heroPosition: 'BB', villainPosition: 'BTN', effectiveStack: 100, pot: 5.5, line: 'BTN open 2.3 bb', category: 'BB defend', difficulty: 2, handClass: 'Q9s', flop: ['K♦', '8♠', '4♠'], texture: 'K-haut · two-tone', preflop: { action: 'CALL', frequency: 66, explanation: 'Q9s réalise correctement son équité contre l’open large du bouton. Le call conserve les mains dominées et évite de sur-3-bet.', options: ['FOLD', 'CALL', '3BET'], rangeLabel: 'BB vs BTN · défense 66%' }, post: basePost('CHECK', 64, 'Le défenseur de BB a davantage de mains faibles. Checker garde toute cette range et laisse réaliser les backdoors.', 'Check') },
  { id: 'bb-3bet-a5s', heroPosition: 'BB', villainPosition: 'CO', effectiveStack: 100, pot: 5.5, line: 'CO open 2.3 bb', category: 'Resteal', difficulty: 2, handClass: 'A5s', flop: ['Q♠', '7♦', '2♠'], texture: 'Q-haut · backdoor', preflop: { action: '3BET', frequency: 55, explanation: 'A5s bloque les as forts adverses et conserve une bonne jouabilité lorsque le 3-bet est payé.', options: ['FOLD', 'CALL', '3BET'], rangeLabel: 'Resteal BB vs CO · 55%' }, post: basePost('BET 33%', 58, 'Dans un pot 3-bet, le petit sizing met la range de call sous pression sur un board avantageux.', '33% pot') },
  { id: 'btn-flat-aqs', heroPosition: 'BTN', villainPosition: 'CO', effectiveStack: 100, pot: 5.5, line: 'CO open 2.3 bb', category: 'Flat / 3-bet', difficulty: 2, handClass: 'AQs', flop: ['A♥', '9♣', '4♦'], texture: 'A-haut · rainbow', preflop: { action: 'CALL', frequency: 58, explanation: 'AQs domine la range d’open mais n’a pas besoin de transformer systématiquement sa main en 3-bet.', options: ['CALL', '3BET', 'FOLD'], rangeLabel: 'BTN vs CO · call 58%' }, post: basePost('BET 33%', 70, 'Top paire top kicker peut miser petit sur un board qui touche fortement votre range de call.', '33% pot') },
  { id: 'co-4bet-qq', heroPosition: 'CO', villainPosition: 'BTN', effectiveStack: 100, pot: 21.5, line: 'BTN 3-bet 8.5 bb', category: '4-bet pot', difficulty: 3, handClass: 'QQ', flop: ['9♣', '6♦', '2♠'], texture: 'bas · rainbow', preflop: { action: '4BET', frequency: 34, explanation: 'QQ est assez forte pour 4-bet une partie du temps, tout en gardant des calls pour ne pas surpolariser la range.', options: ['FOLD', 'CALL', '4BET'], rangeLabel: 'CO vs BTN 3-bet · 4-bet 34%' }, post: basePost('CHECK', 72, 'Dans un pot 4-bet, le check protège la showdown value et évite de faire grossir le pot inutilement.', 'Check') },
  { id: 'sb-3bet-kjo', heroPosition: 'SB', villainPosition: 'BTN', effectiveStack: 40, pot: 5.5, line: 'BTN open 2.3 bb', category: 'Short stack resteal', difficulty: 3, handClass: 'KJo', flop: ['K♣', '8♦', '3♠'], texture: 'K-haut · rainbow', preflop: { action: '3BET', frequency: 62, explanation: 'À 40 BB, KJo gagne de la valeur comme resteal depuis SB. Le stack réduit rend le 3-bet plus difficile à exploiter.', options: ['FOLD', 'CALL', '3BET'], rangeLabel: 'SB resteal 40bb · 62%' }, post: basePost('BET 50%', 64, 'Le SPR est bas. Une mise moyenne prépare les streets restantes sans donner de carte gratuite.', '50% pot') },
  { id: 'utg-fold-kjo', heroPosition: 'UTG', villainPosition: '—', effectiveStack: 20, pot: 1.5, line: 'Personne n’a parlé', category: 'Short stack open', difficulty: 3, handClass: 'KJo', flop: ['Q♣', '9♠', '4♦'], texture: 'Q-haut · sec', preflop: { action: 'FOLD', frequency: 100, explanation: 'Même en short stack, KJo reste dominée par les calls et les 3-bets quand elle ouvre trop tôt.', options: ['OPEN', 'FOLD'], rangeLabel: 'Open UTG 20bb · fold' }, post: basePost('CHECK', 100, 'Spot arrêté avant le flop.', '—') },
  { id: 'bb-4bet-aks', heroPosition: 'BB', villainPosition: 'BTN', effectiveStack: 25, pot: 21.5, line: 'BTN open 2.3 bb · BB 3-bet 9 bb · BTN 4-bet 20 bb', category: 'Short stack 4-bet', difficulty: 3, handClass: 'AKs', flop: ['K♥', '7♣', '2♦'], texture: 'K-haut · rainbow', preflop: { action: 'CALL', frequency: 28, explanation: 'Avec 25 BB, AKs peut mixer le call pour conserver les bluffs adverses, même si le shove reste très fréquent.', options: ['CALL', '4BET', 'FOLD'], rangeLabel: 'BB vs 4-bet · call 28%' }, post: basePost('CHECK', 80, 'Le board est sec : checker laisse l’adversaire bluffer et garde votre range protégée.', 'Check') },
];

function basePost(flopAction: PostAction, flopFrequency: number, flopReason: string, flopSizing: string): Record<Street, PostDecision> {
  return {
    FLOP: { action: flopAction, frequency: flopFrequency, reason: flopReason, sizing: flopSizing, options: ['CHECK', 'BET 25%', 'BET 33%', 'BET 50%', 'BET 75%'] },
    TURN: { action: 'CHECK', frequency: 58, reason: 'La turn demande de contrôler la taille du pot lorsque la carte ne renforce pas clairement votre avantage.', sizing: 'Check', options: ['CHECK', 'BET 33%', 'BET 50%', 'BET 75%', 'FOLD'] },
    RIVER: { action: 'BET 50%', frequency: 46, reason: 'La river choisit entre value thin, bluff et abandon selon les bloqueurs et la texture finale.', sizing: '50% pot', options: ['CHECK', 'BET 33%', 'BET 50%', 'BET 75%', 'BET 125%', 'FOLD'] },
  };
}

export function cardLabel(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function cardColor(card: Card): string {
  return card.suit === '♠' || card.suit === '♣' ? '#183329' : '#ae4c46';
}

export function parseCard(label: string): Card {
  return { rank: label.slice(0, -1) as Rank, suit: label.slice(-1) as Suit };
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function deck(): Card[] {
  return RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardsRemaining(excluded: Card[]): Card[] {
  const blocked = new Set(excluded.map(cardKey));
  return deck().filter((card) => !blocked.has(cardKey(card)));
}

function chooseHole(handClass: string, excluded: Card[]): Card[] {
  const rank1 = handClass[0] as Rank;
  const rank2 = handClass[1] as Rank;
  const suffix = handClass[2];
  const available = cardsRemaining(excluded);
  if (rank1 === rank2) {
    const choices = available.filter((card) => card.rank === rank1);
    return shuffle(choices).slice(0, 2);
  }
  if (suffix === 's') {
    const suit = shuffle(SUITS.filter((candidate) => available.some((card) => card.rank === rank1 && card.suit === candidate) && available.some((card) => card.rank === rank2 && card.suit === candidate)))[0] ?? '♠';
    return [{ rank: rank1, suit }, { rank: rank2, suit }];
  }
  const combos = shuffle(available.filter((card) => card.rank === rank1).flatMap((first) => available.filter((card) => card.rank === rank2 && card.suit !== first.suit).map((second) => [first, second] as Card[])));
  return combos[0] ?? [{ rank: rank1, suit: '♠' }, { rank: rank2, suit: '♥' }];
}

function rangeToClass(hole: Card[]): string {
  const [first, second] = [...hole].sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank));
  if (first.rank === second.rank) return `${first.rank}${second.rank}`;
  return `${first.rank}${second.rank}${first.suit === second.suit ? 's' : 'o'}`;
}

export function handLabel(hole: Card[]): string {
  return rangeToClass(hole);
}

export function pickSpot(table: TableSize, current?: string, difficulty: Difficulty = 'Tous'): Spot {
  const allowed = table === 6 ? SIX_MAX : NINE_MAX;
  const maxDifficulty = difficulty === 'Débutant' ? 1 : difficulty === 'Intermédiaire' ? 2 : difficulty === 'Avancé' ? 3 : 3;
  const pool = templates.filter((template) => allowed.includes(template.heroPosition) && template.difficulty <= maxDifficulty && template.id !== current);
  const template = pool[Math.floor(Math.random() * pool.length)] ?? templates[0];
  const flop = template.flop.map(parseCard);
  const hole = chooseHole(template.handClass, flop);
  const future = shuffle(cardsRemaining([...flop, ...hole])).slice(0, 2);
  return {
    ...template,
    table,
    hole,
    runout: [...flop, ...future],
  };
}

export const MATRIX_LABELS = Array.from({ length: 169 }, (_, index) => {
  const row = Math.floor(index / 13);
  const column = index % 13;
  const high = RANKS[12 - Math.min(row, column)];
  const low = RANKS[12 - Math.max(row, column)];
  if (row === column) return `${high}${low}`;
  return row < column ? `${high}${low}s` : `${high}${low}o`;
});

function combinations(n: number, k: number): number {
  if (k === 0) return 1;
  if (k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function hasFlush(cards: Card[]): boolean {
  return SUITS.some((suit) => cards.filter((card) => card.suit === suit).length >= 5);
}

function hasTrips(cards: Card[]): boolean {
  return RANKS.some((rank) => cards.filter((card) => card.rank === rank).length >= 3);
}

function hasStraight(cards: Card[]): boolean {
  const unique = new Set(cards.map((card) => card.rank));
  if (unique.has('A')) unique.add('1' as Rank);
  for (let start = 0; start <= 9; start += 1) {
    const window = RANKS.slice(start, start + 5);
    if (window.every((rank) => unique.has(rank))) return true;
  }
  const wheel: Rank[] = ['A', '2', '3', '4', '5'];
  return wheel.every((rank) => unique.has(rank));
}

function drawProbability(hole: Card[], board: Card[], target: (cards: Card[]) => boolean) {
  const visible = [...hole, ...board];
  const remaining = cardsRemaining(visible);
  const current = target(visible);
  const oneCardHits = remaining.filter((card) =>
    target([...visible, card]),
  ).length;
  const oneCardChance = current ? 100 : (oneCardHits / remaining.length) * 100;
  const cardsToCome = Math.max(0, 5 - board.length);
  let byRiver = oneCardChance;
  if (!current && cardsToCome >= 2) {
    let hits = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        if (target([...visible, remaining[i], remaining[j]])) hits += 1;
      }
    }
    byRiver = (hits / combinations(remaining.length, 2)) * 100;
  }
  return { outs: current ? 0 : oneCardHits, next: oneCardChance, river: current ? 100 : byRiver };
}

export type DrawStat = {
  name: string;
  outs: number;
  next: number;
  river: number;
  detail: string;
};

export function calculateDrawStats(hole: Card[], board: Card[]): DrawStat[] {
  const cards = [...hole, ...board];
  const stats: DrawStat[] = [];
  const suitCount = Math.max(...SUITS.map((suit) => cards.filter((card) => card.suit === suit).length));
  if (suitCount >= 3 && !hasFlush(cards)) {
    const result = drawProbability(hole, board, hasFlush);
    stats.push({ name: 'Couleur', ...result, detail: suitCount >= 4 ? '4 cartes de la même couleur : 9 outs classiques.' : '3 cartes de la même couleur : il faut toucher deux fois d’ici la river.' });
  }
  const pairExists = RANKS.some((rank) => cards.filter((card) => card.rank === rank).length >= 2);
  if (pairExists && !hasTrips(cards)) {
    const result = drawProbability(hole, board, hasTrips);
    stats.push({ name: 'Brelan / set', ...result, detail: 'Une paire peut trouver l’un de ses deux outs restants.' });
  }
  if (!hasStraight(cards)) {
    const result = drawProbability(hole, board, hasStraight);
    if (result.river > 0) {
      const label = result.outs === 8 ? 'Quinte par les deux bouts' : result.outs === 4 ? 'Quinte par un bout' : 'Tirage quinte';
      stats.push({ name: label, ...result, detail: result.outs === 8 ? 'Huit cartes complètent les deux extrémités.' : 'Les cartes manquantes sont comptées sans doublon.' });
    }
  }
  return stats;
}

export function visibleBoard(spot: Spot, street: Street): Card[] {
  return spot.runout.slice(0, street === 'FLOP' ? 3 : street === 'TURN' ? 4 : 5);
}

export function formatPercent(value: number): string {
  if (value === 0) return '0%';
  if (value >= 99.95) return '100%';
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}