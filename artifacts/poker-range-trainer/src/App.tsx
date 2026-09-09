import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Download,
  Gauge,
  History,
  Layers3,
  Menu,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  type Card,
  type Difficulty,
  type PostAction,
  type PreflopAction,
  type Spot,
  type Street,
  type TableSize,
  SIX_MAX,
  NINE_MAX,
  OPEN_RANGES,
  MATRIX_LABELS,
  cardColor,
  cardLabel,
  calculateDrawStats,
  formatPercent,
  handLabel,
  pickSpot,
  visibleBoard,
} from './poker';

type HandLog = {
  id: string;
  hand: string;
  position: string;
  street: 'Préflop' | Street;
  correct: boolean;
  decision: string;
  recommended: string;
  category: string;
  difficulty: number;
  stack: number;
  timestamp: number;
};

const STORAGE_KEY = 'poker-desk-progress-v2';

function readHistory(): HandLog[] {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('poker-desk-progress-v1');
    if (!raw) return [];
    const previous = JSON.parse(raw) as Array<
      Partial<HandLog> & { is3bet?: boolean }
    >;
    return previous.map((item) => ({
      id: item.id ?? `${Date.now()}-${Math.random()}`,
      hand: item.hand ?? '—',
      position: item.position ?? '—',
      street: item.street ?? 'Préflop',
      correct: Boolean(item.correct),
      decision: item.decision ?? '—',
      recommended: item.recommended ?? '—',
      category:
        item.category ?? (item.is3bet ? 'Pot 3-bet' : 'Préflop'),
      difficulty: item.difficulty ?? 1,
      stack: item.stack ?? 100,
      timestamp: item.timestamp ?? Date.now(),
    }));
  } catch {
    return [];
  }
}

function saveHistory(history: HandLog[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-400)));
}

function difficultyName(level: number) {
  return level === 1
    ? 'Débutant'
    : level === 2
      ? 'Intermédiaire'
      : 'Avancé';
}

function actionName(action: string) {
  if (action === '3BET') return '3-bet';
  if (action === '4BET') return '4-bet';
  if (action === 'OPEN') return 'Open';
  if (action === 'FOLD') return 'Fold';
  if (action === 'CALL') return 'Call';
  return action;
}

function IconMark() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#c99b48]/40 bg-[#c99b48]/10 text-[#e4b65e]">
      <Crosshair size={21} strokeWidth={1.7} />
    </div>
  );
}

function PlayingCard({ card, large = false }: { card: Card; large?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg border border-[#d7bd83]/50 bg-[#f3ecd9] font-semibold tracking-[-.08em] shadow-[3px_4px_0_rgba(197,153,69,.28)] ${
        large
          ? 'h-[76px] w-[56px] text-2xl sm:h-[92px] sm:w-[68px] sm:text-3xl'
          : 'h-11 w-9 text-sm'
      }`}
      style={{ color: cardColor(card) }}
    >
      {cardLabel(card)}
    </div>
  );
}

function HoleCards({ cards }: { cards: Card[] }) {
  return (
    <div className="flex items-center gap-2" data-testid="display-hole-cards">
      {cards.map((card) => (
        <PlayingCard key={cardLabel(card)} card={card} large />
      ))}
    </div>
  );
}

function Board({ cards }: { cards: Card[] }) {
  return (
    <div className="flex gap-1.5" data-testid="display-board">
      {cards.map((card) => (
        <PlayingCard key={cardLabel(card)} card={card} />
      ))}
    </div>
  );
}

function RangeMatrix({ spot }: { spot: Spot }) {
  const range = OPEN_RANGES[spot.heroPosition] ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="mono text-[10px] uppercase tracking-[.16em] text-[#759386]">
          Range de référence · {spot.heroPosition}
        </p>
        <div className="flex gap-3 text-[10px] text-[#839b8e]">
          <span>
            <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#d5a850]" />
            Action
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#315846]" />
            Hors range
          </span>
        </div>
      </div>
      <div
        className="grid grid-cols-13 gap-[2px] rounded-md border border-[#25483a] bg-[#081913] p-1.5"
        style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}
        data-testid="display-range-matrix"
      >
        {MATRIX_LABELS.map((cell) => {
          const active = range.includes(cell);
          const current = cell === spot.handClass;
          return (
            <div
              key={cell}
              title={cell}
              className={`flex aspect-square items-center justify-center rounded-[2px] font-mono text-[7px] transition-colors sm:text-[8px] ${
                current
                  ? 'ring-2 ring-[#f5e6bd] ring-offset-1 ring-offset-[#081913]'
                  : ''
              }`}
              style={{
                backgroundColor: active
                  ? 'rgba(213,168,80,.86)'
                  : 'rgba(117,147,134,.12)',
                color: active ? '#182419' : '#6d8b7d',
              }}
            >
              {cell}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[9px] text-[#5e7b6d]">
        <span>{spot.preflop.rangeLabel}</span>
        <span>169 combinaisons · lecture simplifiée</span>
      </div>
    </div>
  );
}

function OddsPanel({
  hole,
  board,
  compact = false,
}: {
  hole: Card[];
  board: Card[];
  compact?: boolean;
}) {
  const stats = calculateDrawStats(hole, board);
  return (
    <div
      className={`rounded-xl border border-[#315846] bg-[#10271f]/80 ${
        compact ? 'p-4' : 'p-5'
      }`}
      data-testid="draw-probabilities"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#e5bd67]">
          <Calculator size={16} />
          <p className="mono text-[10px] uppercase tracking-[.17em]">
            Calculateur de tirages
          </p>
        </div>
        <span className="mono text-[9px] text-[#6d8b7d]">
          {board.length === 3
            ? 'flop · 2 cartes à venir'
            : board.length === 4
              ? 'turn · 1 carte à venir'
              : 'river · terminée'}
        </span>
      </div>
      {stats.length === 0 ? (
        <p className="text-xs leading-5 text-[#829d8d]">
          Aucun tirage direct détecté sur cette texture. Les pourcentages sont
          calculés sur les cartes restantes, sans doublon.
        </p>
      ) : (
        <div className="space-y-3">
          {stats.map((stat) => (
            <div
              key={stat.name}
              className="rounded-lg border border-[#244538] bg-[#0c2119] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#e8ddbd]">
                  {stat.name}
                </p>
                <span className="mono text-xs text-[#e4b65e]">
                  {stat.outs} outs
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="mono text-[9px] uppercase tracking-[.12em] text-[#6e8b7d]">
                    Prochaine carte
                  </p>
                  <p className="mono mt-1 text-base text-[#d9aa56]">
                    {formatPercent(stat.next)}
                  </p>
                </div>
                <div>
                  <p className="mono text-[9px] uppercase tracking-[.12em] text-[#6e8b7d]">
                    D’ici la river
                  </p>
                  <p className="mono mt-1 text-base text-[#d9aa56]">
                    {formatPercent(stat.river)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[#799687]">
                {stat.detail}
              </p>
            </div>
          ))}
        </div>
      )}
      {!compact && (
        <p className="mt-4 border-t border-[#214235] pt-3 text-[11px] leading-4 text-[#6f8d7e]">
          Exemple : avec 4 cartes de la même couleur au flop, il reste 9 outs.
          Cela donne 9/47 au turn et environ 35% d’ici la river.
        </p>
      )}
    </div>
  );
}

function SideNav({ mobileOpen, close }: { mobileOpen: boolean; close: () => void }) {
  const [location] = useLocation();
  const item = (href: string, icon: ReactNode, label: string) => (
    <Link
      href={href}
      onClick={close}
      className={`group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${
        location === href
          ? 'bg-[#c99b48]/12 text-[#f0c46f]'
          : 'text-[#91a99c] hover:bg-[#10271f] hover:text-[#f5e9c9]'
      }`}
    >
      {icon}
      {label}
      {location === href && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#d9aa56]" />
      )}
    </Link>
  );

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-[258px] flex-col border-r border-[#1d3b31] bg-[#071712] px-4 py-5 transition-transform duration-300 lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center gap-3 px-2">
        <IconMark />
        <div>
          <p className="font-semibold tracking-[-0.03em] text-[#f5e9c9]">
            RANGE / DESK
          </p>
          <p className="mono mt-0.5 text-[9px] uppercase tracking-[0.18em] text-[#829b8d]">
            atelier de décision
          </p>
        </div>
      </div>
      <div className="mt-11 px-2">
        <p className="mono mb-3 text-[10px] uppercase tracking-[0.2em] text-[#5d796c]">
          Session
        </p>
        <nav className="space-y-1">
          {item('/', <Target size={17} strokeWidth={1.8} />, 'Entraînement')}
          {item(
            '/stats',
            <BarChart3 size={17} strokeWidth={1.8} />,
            'Étude & statistiques',
          )}
          {item('/odds', <Calculator size={17} strokeWidth={1.8} />, 'Probabilités')}
        </nav>
      </div>
      <div className="mt-auto rounded-xl border border-[#1d3b31] bg-[#0c2119] p-4">
        <div className="mb-3 flex items-center gap-2 text-[#c99b48]">
          <ShieldCheck size={16} />
          <span className="mono text-[10px] uppercase tracking-[.16em]">
            Mode local
          </span>
        </div>
        <p className="text-xs leading-5 text-[#8da89a]">
          Vos sessions restent dans ce navigateur. Le build génère aussi un
          HTML autonome.
        </p>
      </div>
      <p className="mono px-2 pt-5 text-[9px] uppercase tracking-[.18em] text-[#46675a]">
        v2.0 · cash & tournoi
      </p>
    </aside>
  );
}

async function downloadStandalone() {
  try {
    const response = await fetch(new URL('range-desk.html', window.location.href));
    if (!response.ok) throw new Error('standalone file unavailable');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'range-desk-v2.html';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    window.alert(
      'Le fichier autonome est généré lors du build de l’application. Utilisez la version publiée pour le télécharger.',
    );
  }
}

function TopBar({ onMenu, onReset }: { onMenu: () => void; onReset: () => void }) {
  const [location] = useLocation();
  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#1b372c] bg-[#081913]/90 px-4 backdrop-blur-md sm:px-7 lg:ml-[258px] lg:px-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenu}
          aria-label="Ouvrir le menu"
          className="rounded-lg p-2 text-[#91a99c] hover:bg-[#10271f] hover:text-[#f2d68f] lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div>
          <p className="mono text-[9px] uppercase tracking-[.2em] text-[#678476]">
            {location === '/stats'
              ? 'Revue de travail'
              : location === '/odds'
                ? 'Laboratoire de calcul'
                : 'Table de travail'}
          </p>
          <h1 className="mt-0.5 text-[15px] font-semibold tracking-[-.02em] text-[#f1e7cf]">
            {location === '/stats'
              ? 'Vos décisions, sans le bruit'
              : location === '/odds'
                ? 'Comprendre les outs'
                : 'Une main à la fois'}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void downloadStandalone()}
          className="group flex items-center gap-2 rounded-lg border border-[#25483a] px-3 py-2 text-xs text-[#8da89a] transition-colors hover:border-[#c99b48]/60 hover:text-[#f1c66f]"
        >
          <Download size={14} />
          <span className="hidden sm:inline">HTML autonome</span>
        </button>
        <button
          onClick={onReset}
          className="group flex items-center gap-2 rounded-lg border border-[#25483a] px-3 py-2 text-xs text-[#8da89a] transition-colors hover:border-[#c99b48]/60 hover:text-[#f1c66f]"
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Réinitialiser</span>
        </button>
      </div>
    </header>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const reset = () => {
    if (
      window.confirm(
        'Effacer toutes les mains et statistiques enregistrées sur cet appareil ?',
      )
    ) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('poker-desk-progress-v1');
      window.location.reload();
    }
  };
  return (
    <div className="noise min-h-[100dvh] bg-[#081913]">
      <SideNav mobileOpen={mobileOpen} close={() => setMobileOpen(false)} />
      {mobileOpen && (
        <button
          aria-label="Fermer le menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-[#020b07]/70 lg:hidden"
        />
      )}
      <TopBar onMenu={() => setMobileOpen(true)} onReset={reset} />
      <main className="min-h-[calc(100dvh-72px)] lg:ml-[258px]">{children}</main>
    </div>
  );
}

function TableToggle({
  table,
  setTable,
}: {
  table: TableSize;
  setTable: (value: TableSize) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[#244538] bg-[#0c2119] p-1">
      {[6, 9].map((size) => (
        <button
          key={size}
          onClick={() => setTable(size as TableSize)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            table === size
              ? 'bg-[#d5a850] text-[#132118]'
              : 'text-[#85a293] hover:text-[#f1dfb4]'
          }`}
        >
          {size}-max
        </button>
      ))}
    </div>
  );
}

function DifficultyToggle({
  difficulty,
  setDifficulty,
}: {
  difficulty: Difficulty;
  setDifficulty: (value: Difficulty) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-[#244538] bg-[#0c2119] px-3 py-2 text-xs text-[#9bb09f]">
      <Gauge size={14} className="text-[#d5a850]" />
      <select
        value={difficulty}
        onChange={(event) => setDifficulty(event.target.value as Difficulty)}
        className="bg-transparent text-xs text-[#d8dfcf] outline-none"
      >
        <option className="bg-[#0c2119]" value="Tous">
          Tous niveaux
        </option>
        <option className="bg-[#0c2119]" value="Débutant">
          Débutant
        </option>
        <option className="bg-[#0c2119]" value="Intermédiaire">
          Intermédiaire
        </option>
        <option className="bg-[#0c2119]" value="Avancé">
          Avancé
        </option>
      </select>
    </label>
  );
}

function FeedbackPreflop({
  spot,
  selected,
  onNext,
  onContinue,
}: {
  spot: Spot;
  selected: PreflopAction;
  onNext: () => void;
  onContinue: () => void;
}) {
  const correct = selected === spot.preflop.action;
  const canContinue = selected !== 'FOLD';
  return (
    <section
      className={`animate-rise rounded-2xl border p-4 shadow-[var(--shadow-card)] sm:p-6 ${
        correct
          ? 'border-[#c99b48]/45 bg-[#13291e]'
          : 'border-[#d87561]/45 bg-[#2a1a17]'
      }`}
      data-testid="feedback-preflop"
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            correct
              ? 'bg-[#d5a850] text-[#182419]'
              : 'bg-[#d87561] text-[#2a1714]'
          }`}
        >
          {correct ? <Check size={17} /> : <X size={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-[#f4e8ca]">
            {correct ? 'Bonne lecture du spot.' : 'Décision à revoir.'}
          </p>
          <p className="mt-1 text-sm leading-5 text-[#a8b9a5]">
            {spot.preflop.explanation}
          </p>
        </div>
        <span
          className={`mono rounded px-2 py-1 text-[10px] font-bold ${
            correct
              ? 'bg-[#d5a850]/15 text-[#e6ba63]'
              : 'bg-[#d87561]/15 text-[#e69b8e]'
          }`}
        >
          {correct ? 'JUSTE' : 'ERREUR'}
        </span>
      </div>
      <div className="my-5 grid gap-4 border-y border-white/8 py-4 sm:grid-cols-[1fr_1.25fr]">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.16em] text-[#759386]">
            Solution
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-.05em] text-[#f3dfaa]">
            {spot.preflop.frequency}%{' '}
            <span className="text-sm font-normal text-[#8aa394]">
              {actionName(spot.preflop.action)}
            </span>
          </p>
          <p className="mt-1 text-xs text-[#8ca396]">
            Fréquence cible · {spot.preflop.rangeLabel}
          </p>
        </div>
        <RangeMatrix spot={spot} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {canContinue && (
          <button
            onClick={onContinue}
            className="group flex items-center justify-center gap-2 rounded-lg bg-[#d5a850] px-4 py-2.5 text-sm font-semibold text-[#142117]"
          >
            Jouer le postflop <ChevronRight size={16} />
          </button>
        )}
        <button
          onClick={onNext}
          className="rounded-lg border border-[#3a5d4b] px-4 py-2.5 text-sm font-semibold text-[#d3dfd0] hover:bg-[#1b382b]"
        >
          {canContinue ? 'Passer la main' : 'Main suivante'}
        </button>
      </div>
    </section>
  );
}

function PostflopPanel({
  spot,
  street,
  onAction,
  actionTaken,
}: {
  spot: Spot;
  street: Street;
  onAction: (action: PostAction | 'NEXT') => void;
  actionTaken: PostAction | null;
}) {
  const solution = spot.post[street];
  const board = visibleBoard(spot, street);

  if (actionTaken) {
    const correct = actionTaken === solution.action;
    return (
      <div
        className={`animate-rise rounded-2xl border p-4 sm:p-6 ${
          correct
            ? 'border-[#c99b48]/40 bg-[#13291e]'
            : 'border-[#d87561]/40 bg-[#2a1a17]'
        }`}
        data-testid="feedback-postflop"
      >
        <div className="flex gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              correct
                ? 'bg-[#d5a850] text-[#182419]'
                : 'bg-[#d87561] text-[#2a1714]'
            }`}
          >
            {correct ? <Check size={17} /> : <X size={17} />}
          </div>
          <div>
            <p className="font-semibold text-[#f4e8ca]">
              {correct ? 'Ligne cohérente.' : 'Ligne alternative à étudier.'}
            </p>
            <p className="mt-1 text-sm leading-5 text-[#a8b9a5]">
              {solution.reason}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 border-t border-white/8 pt-4 sm:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="mono text-[10px] uppercase tracking-[.16em] text-[#759386]">
              Fréquence cible
            </p>
            <p className="mt-2 text-xl font-semibold text-[#e8bc62]">
              {solution.frequency}% {solution.action}
            </p>
            <p className="mt-1 text-xs text-[#8ca396]">{solution.sizing}</p>
          </div>
          <OddsPanel hole={spot.hole} board={board} compact />
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={() => onAction('NEXT')}
            className="flex items-center gap-2 rounded-lg bg-[#d5a850] px-4 py-2.5 text-sm font-semibold text-[#142117]"
          >
            {street === 'RIVER'
              ? 'Terminer la main'
              : `Voir la ${street === 'FLOP' ? 'turn' : 'river'}`}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.16em] text-[#759386]">
            Votre action · {street}
          </p>
          <p className="mt-1 text-sm text-[#a8b9a5]">
            Choisissez aussi le sizing, pas seulement la direction.
          </p>
        </div>
        <div className="rounded-full border border-[#c99b48]/30 bg-[#c99b48]/10 px-3 py-1 text-xs text-[#e5bb65]">
          {spot.line}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {solution.options.map((action) => (
          <button
            key={action}
            onClick={() => onAction(action)}
            className="group rounded-xl border border-[#2a5040] bg-[#10271f] px-2 py-3 text-xs font-bold tracking-[.08em] text-[#d9e4d5] transition-all hover:-translate-y-1 hover:border-[#d5a850] hover:bg-[#17372a] active:translate-y-0 sm:py-4"
          >
            <span className="block text-[#e5ba60]">
              {action === 'CHECK'
                ? 'Checker'
                : action === 'FOLD'
                  ? 'Abandonner'
                  : action === 'CALL'
                    ? 'Payer'
                    : action === 'RAISE'
                      ? 'Relancer'
                      : `Miser ${action.replace('BET ', '')}`}
            </span>
            <span className="mono mt-1 block text-[9px] font-normal tracking-normal text-[#6f8e7f]">
              {action}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <OddsPanel hole={spot.hole} board={board} compact />
      </div>
    </div>
  );
}

function TrainerPage() {
  const [table, setTable] = useState<TableSize>(() =>
    Number(localStorage.getItem('poker-table-size')) === 9 ? 9 : 6,
  );
  const [difficulty, setDifficulty] = useState<Difficulty>(
    () => (localStorage.getItem('poker-difficulty') as Difficulty) || 'Tous',
  );
  const [spot, setSpot] = useState<Spot>(() => pickSpot(6));
  const [phase, setPhase] = useState<'preflop' | 'postflop'>('preflop');
  const [street, setStreet] = useState<Street>('FLOP');
  const [selected, setSelected] = useState<PreflopAction | null>(null);
  const [postAction, setPostAction] = useState<PostAction | null>(null);
  const [history, setHistory] = useState<HandLog[]>(readHistory);
  const [streak, setStreak] = useState(0);
  const allowedPositions = table === 6 ? SIX_MAX : NINE_MAX;
  const tableLabel = table === 6 ? '6-max' : '9-max';

  useEffect(() => {
    localStorage.setItem('poker-table-size', String(table));
    setSpot(pickSpot(table, undefined, difficulty));
    setPhase('preflop');
    setSelected(null);
    setPostAction(null);
    setStreet('FLOP');
  }, [table, difficulty]);

  useEffect(() => {
    localStorage.setItem('poker-difficulty', difficulty);
  }, [difficulty]);

  const accuracy = history.length
    ? Math.round(
        (history.filter((item) => item.correct).length / history.length) * 100,
      )
    : 0;
  const progress = Math.min(100, (history.length % 10) * 10);

  const log = (
    decision: string,
    recommended: string,
    correct: boolean,
    currentStreet: HandLog['street'],
  ) => {
    const item: HandLog = {
      id: `${Date.now()}-${Math.random()}`,
      hand: handLabel(spot.hole),
      position: spot.heroPosition,
      street: currentStreet,
      correct,
      decision,
      recommended,
      category: spot.category,
      difficulty: spot.difficulty,
      stack: spot.effectiveStack,
      timestamp: Date.now(),
    };
    setHistory((current) => {
      const next = [...current, item];
      saveHistory(next);
      return next;
    });
    setStreak((current) => (correct ? current + 1 : 0));
  };

  const nextHand = () => {
    setSpot(pickSpot(table, spot.id, difficulty));
    setPhase('preflop');
    setSelected(null);
    setPostAction(null);
    setStreet('FLOP');
  };

  const choosePreflop = (action: PreflopAction) => {
    setSelected(action);
    log(action, spot.preflop.action, action === spot.preflop.action, 'Préflop');
  };

  const choosePostflop = (action: PostAction | 'NEXT') => {
    if (action === 'NEXT') {
      if (street === 'FLOP') setStreet('TURN');
      else if (street === 'TURN') setStreet('RIVER');
      else nextHand();
      setPostAction(null);
      return;
    }
    setPostAction(action);
    log(action, spot.post[street].action, action === spot.post[street].action, street);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="animate-rise">
          <p className="mono mb-2 text-[10px] uppercase tracking-[.25em] text-[#d5a850]">
            V2 · précision progressive
          </p>
          <h2 className="max-w-xl text-3xl font-semibold leading-[1.05] tracking-[-.07em] text-[#f3e9ce] sm:text-5xl">
            Le prochain spot
            <br />
            <span className="text-[#d5a850]">est déjà là.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[#8ea699]">
            Des ranges par position, des stacks qui changent la décision et un
            calcul d’outs intégré à chaque street.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TableToggle table={table} setTable={setTable} />
          <DifficultyToggle
            difficulty={difficulty}
            setDifficulty={setDifficulty}
          />
          <Link
            href="/stats"
            className="flex items-center gap-2 rounded-lg border border-[#244538] px-3 py-2 text-xs text-[#8da89a] hover:border-[#c99b48]/60 hover:text-[#f0c46f]"
          >
            <TrendingUp size={14} /> Revue
          </Link>
        </div>
      </div>

      <div className="mb-7 grid gap-3 sm:grid-cols-3">
        {[
          ['Décisions', history.length.toString().padStart(2, '0'), 'réponses', Zap],
          ['Précision', history.length ? `${accuracy}%` : '—', 'cette session', Target],
          ['Série actuelle', streak.toString().padStart(2, '0'), 'justes', Layers3],
        ].map(([label, value, caption, Icon]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-[#1d3b31] bg-[#0c2119] p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[.16em] text-[#668475]">
                {String(label)}
              </span>
              <Icon
                size={15}
                className="text-[#d5a850]"
              />
            </div>
            <p className="mono text-xl text-[#eecb79]">
              {String(value)}{' '}
              <span className="text-xs text-[#718e7f]">{String(caption)}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="mb-7 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#173126]">
          <div
            className="h-full rounded-full bg-[#d5a850] transition-all duration-500"
            style={{ width: `${progress || 5}%` }}
          />
        </div>
        <span className="mono text-[10px] text-[#708d7e]">
          {tableLabel} · {allowedPositions.length} positions ·{' '}
          {difficulty === 'Tous' ? 'tous niveaux' : difficulty}
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="felt-grid min-h-[520px] rounded-2xl border border-[#27513f] bg-[#0d241b] p-4 shadow-[var(--shadow-card)] sm:p-7">
          <div className="mb-7 flex items-center justify-between border-b border-[#234536] pb-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  phase === 'preflop' ? 'bg-[#d5a850]' : 'bg-[#d87561]'
                }`}
              />
              <span className="mono text-[10px] uppercase tracking-[.2em] text-[#8da89a]">
                {phase === 'preflop'
                  ? 'Décision préflop'
                  : `Suivi postflop · ${street}`}
              </span>
            </div>
            <span className="mono text-[10px] text-[#5d796c]">
              {spot.category.toUpperCase()}
            </span>
          </div>

          {phase === 'preflop' ? (
            <div className="animate-rise">
              <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className="mono inline-flex rounded border border-[#c99b48]/30 bg-[#c99b48]/10 px-2 py-1 text-[10px] font-bold tracking-[.15em] text-[#e6b961]">
                      {spot.heroPosition}
                    </span>
                    <span className="mono inline-flex rounded border border-[#315846] bg-[#10271f] px-2 py-1 text-[10px] tracking-[.12em] text-[#91aa9c]">
                      {difficultyName(spot.difficulty)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-[#90a99b]">
                    {spot.line} · {spot.effectiveStack} BB effectives
                  </p>
                  <p className="mt-1 text-xs text-[#658274]">
                    {spot.villainPosition === '—'
                      ? 'Vous êtes first in'
                      : `Vous êtes face à ${spot.villainPosition}`}{' '}
                    · {spot.preflop.rangeLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="mono text-[10px] uppercase tracking-[.16em] text-[#668475]">
                    Pot estimé
                  </p>
                  <p className="mono mt-1 text-lg text-[#e8c36e]">
                    {spot.pot.toFixed(1)} bb
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center py-2 sm:py-5">
                <HoleCards cards={spot.hole} />
                <p className="mt-5 text-center text-xs text-[#839d8e]">
                  Votre main · {spot.handClass}
                </p>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-2 sm:mt-10 sm:grid-cols-3">
                {spot.preflop.options.map((action) => (
                  <button
                    key={action}
                    onClick={() => choosePreflop(action)}
                    disabled={!!selected}
                    className={`group rounded-xl border px-3 py-4 text-sm font-bold tracking-[.06em] transition-transform hover:-translate-y-1 disabled:cursor-default disabled:opacity-70 sm:py-5 ${
                      action === 'OPEN' ||
                      action === '3BET' ||
                      action === '4BET'
                        ? 'border-[#d5a850]/60 bg-[#d5a850] text-[#162218] hover:shadow-[0_5px_0_#805b2e]'
                        : action === 'CALL'
                          ? 'border-[#7fae8d]/50 bg-[#193b2b] text-[#d6e7d5] hover:border-[#d5a850]'
                          : 'border-[#476756] bg-[#112a20] text-[#d6e1d4] hover:border-[#d87561]/70'
                    }`}
                  >
                    <span className="block text-lg tracking-[-.04em]">
                      {actionName(action)}
                    </span>
                    <span className="mt-1 block text-[10px] font-normal opacity-70">
                      {action === 'OPEN'
                        ? 'Relancer'
                        : action === 'FOLD'
                          ? 'Abandonner'
                          : action === 'CALL'
                            ? 'Payer'
                            : 'Relancer davantage'}
                    </span>
                  </button>
                ))}
              </div>
              {selected && (
                <div className="mt-5">
                  <FeedbackPreflop
                    spot={spot}
                    selected={selected}
                    onNext={nextHand}
                    onContinue={() => {
                      setPhase('postflop');
                      setStreet('FLOP');
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="mono inline-flex rounded border border-[#c99b48]/30 bg-[#c99b48]/10 px-2 py-1 text-[10px] font-bold tracking-[.15em]">
                      {spot.heroPosition} · {spot.category}
                    </span>
                    <p className="mt-3 text-sm text-[#90a99b]">
                      Stack effectif · {spot.effectiveStack} BB
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="mono text-[10px] uppercase tracking-[.16em] text-[#668475]">
                      Pot
                    </p>
                    <p className="mono mt-1 text-lg text-[#e8c36e]">
                      {spot.pot.toFixed(1)} bb
                    </p>
                  </div>
                </div>
                <div className="mt-8 flex flex-col items-center">
                  <Board cards={visibleBoard(spot, street)} />
                  <p className="mt-3 text-xs text-[#839d8e]">
                    {spot.texture} · runout sans doublon
                  </p>
                  <HoleCards cards={spot.hole} />
                  <p className="mt-3 text-xs text-[#839d8e]">
                    Votre main · {spot.handClass}
                  </p>
                </div>
              </div>
              <PostflopPanel
                spot={spot}
                street={street}
                onAction={choosePostflop}
                actionTaken={postAction}
              />
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[#1d3b31] bg-[#0c2119] p-5">
            <div className="mb-4 flex items-center gap-2 text-[#e5bd67]">
              <Sparkles size={16} />
              <p className="mono text-[10px] uppercase tracking-[.18em]">
                Repère mental
              </p>
            </div>
            <p className="text-sm leading-6 text-[#a5b8a5]">
              La décision dépend souvent de la position, du stack effectif et
              du SPR. Ne mémorisez pas une main seule : mémorisez la range qui
              l’entoure.
            </p>
            <div className="mt-4 border-t border-[#214235] pt-4">
              <p className="text-xs leading-5 text-[#718e7f]">
                Après chaque réponse, lisez l’explication puis reformulez le
                pourquoi en une phrase.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-[#1d3b31] bg-[#0c2119] p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="mono text-[10px] uppercase tracking-[.18em] text-[#759386]">
                Dernières décisions
              </p>
              <History size={15} className="text-[#5e7e6e]" />
            </div>
            {history.length === 0 ? (
              <p className="text-xs leading-5 text-[#718e7f]">
                Votre historique apparaîtra ici après le premier spot.
              </p>
            ) : (
              <div className="space-y-2">
                {history
                  .slice(-4)
                  .reverse()
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between border-b border-[#1a382c] pb-2 text-xs last:border-0 last:pb-0"
                    >
                      <span className="mono text-[#d2dfce]">
                        {item.hand}{' '}
                        <i className="not-italic text-[#779688]">
                          · {item.position}
                        </i>
                      </span>
                      <span
                        className={
                          item.correct
                            ? 'text-[#d6b05f]'
                            : 'text-[#d87561]'
                        }
                      >
                        {item.correct ? 'juste' : 'à revoir'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatsPage() {
  const [history] = useState<HandLog[]>(readHistory);
  const [mistakesOnly, setMistakesOnly] = useState(false);
  const [position, setPosition] = useState<'Toutes' | string>('Toutes');
  const [category, setCategory] = useState<'Toutes' | string>('Toutes');
  const filtered = useMemo(
    () =>
      history.filter(
        (item) =>
          (!mistakesOnly || !item.correct) &&
          (position === 'Toutes' || item.position === position) &&
          (category === 'Toutes' || item.category === category),
      ),
    [history, mistakesOnly, position, category],
  );
  const total = history.length;
  const correct = history.filter((item) => item.correct).length;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const preflop = history.filter((item) => item.street === 'Préflop');
  const postflop = history.filter((item) => item.street !== 'Préflop');
  const mistakeByStreet = (street: HandLog['street']) =>
    history.filter((item) => item.street === street && !item.correct).length;
  const positions = Array.from(new Set(history.map((item) => item.position)));
  const categories = Array.from(new Set(history.map((item) => item.category)));
  const streetList: HandLog['street'][] = [
    'Préflop',
    'FLOP',
    'TURN',
    'RIVER',
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="animate-rise">
          <p className="mono mb-2 text-[10px] uppercase tracking-[.25em] text-[#d5a850]">
            Revue V2
          </p>
          <h2 className="text-3xl font-semibold tracking-[-.07em] text-[#f3e9ce] sm:text-5xl">
            Les chiffres parlent
            <br />
            <span className="text-[#d5a850]">après la session.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[#8ea699]">
            Isolez les erreurs par street, position, stack et type de situation.
          </p>
        </div>
        <Link
          href="/"
          className="flex w-fit items-center gap-2 rounded-lg border border-[#25483a] px-3 py-2 text-xs text-[#8da89a] hover:border-[#d5a850]/60 hover:text-[#f0c46f]"
        >
          <BookOpen size={14} /> Reprendre l’entraînement
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Décisions', total ? String(total).padStart(2, '0') : '—', 'toutes streets'],
          ['Précision globale', total ? `${accuracy}%` : '—', 'préflop + postflop'],
          [
            'Préflop',
            preflop.length
              ? `${Math.round((preflop.filter((item) => item.correct).length / preflop.length) * 100)}%`
              : '—',
            `${preflop.length} décisions`,
          ],
          [
            'Postflop',
            postflop.length
              ? `${Math.round((postflop.filter((item) => item.correct).length / postflop.length) * 100)}%`
              : '—',
            `${postflop.length} décisions`,
          ],
        ].map(([label, value, caption]) => (
          <div
            key={label}
            className="rounded-xl border border-[#1d3b31] bg-[#0c2119] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[.16em] text-[#668475]">
                {label}
              </span>
              <BarChart3 size={15} className="text-[#5e7e6e]" />
            </div>
            <p className="mono text-2xl text-[#eecb79]">{value}</p>
            <p className="mt-1 text-xs text-[#718e7f]">{caption}</p>
          </div>
        ))}
      </div>

      {history.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#315643] bg-[#0c2119] px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#c99b48]/30 bg-[#c99b48]/10 text-[#d5a850]">
            <Target size={20} />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-[#eee1c2]">
            La table est encore vierge.
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#829d8d]">
            Jouez quelques spots depuis l’entraînement.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#d5a850] px-4 py-2.5 text-sm font-semibold text-[#162218]"
          >
            Commencer une session <ChevronRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <section className="rounded-2xl border border-[#1d3b31] bg-[#0c2119] p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.18em] text-[#759386]">
                  Où ça casse
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[#eee1c2]">
                  Erreurs par street
                </h3>
              </div>
              <SlidersHorizontal size={17} className="text-[#5e7e6e]" />
            </div>
            <div className="space-y-4">
              {streetList.map((street) => {
                const count = mistakeByStreet(street);
                const max = Math.max(1, ...streetList.map(mistakeByStreet));
                return (
                  <div key={street} className="flex items-center gap-3">
                    <span className="mono w-14 text-[10px] text-[#799687]">
                      {street}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#183326]">
                      <div
                        className={`h-full rounded-full ${
                          count ? 'bg-[#d87561]' : 'bg-[#315b46]'
                        }`}
                        style={{
                          width: `${count ? Math.max(12, (count / max) * 100) : 4}%`,
                        }}
                      />
                    </div>
                    <span className="mono w-5 text-right text-[11px] text-[#d4dfd1]">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 border-t border-[#214235] pt-5">
              <p className="mono mb-4 text-[10px] uppercase tracking-[.18em] text-[#759386]">
                Par position
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {(positions.length ? positions : SIX_MAX).map((pos) => (
                  <div
                    key={pos}
                    className="rounded-lg border border-[#244538] bg-[#10271f] p-2 text-center"
                  >
                    <p className="mono text-[10px] text-[#829d8d]">{pos}</p>
                    <p className="mono mt-1 text-sm text-[#e4bd68]">
                      {history.filter(
                        (item) => item.position === pos && !item.correct,
                      ).length}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#1d3b31] bg-[#0c2119] p-5 sm:p-6">
            <div className="mb-5">
              <p className="mono text-[10px] uppercase tracking-[.18em] text-[#759386]">
                Historique filtrable
              </p>
              <h3 className="mt-1 text-lg font-semibold text-[#eee1c2]">
                Dernières décisions
              </h3>
            </div>
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                onClick={() => setMistakesOnly((value) => !value)}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                  mistakesOnly
                    ? 'border-[#d87561]/60 bg-[#d87561]/10 text-[#e6a093]'
                    : 'border-[#2a4e3e] text-[#829d8d] hover:text-[#d5a850]'
                }`}
              >
                Erreurs seulement
              </button>
              <select
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                className="rounded-lg border border-[#2a4e3e] bg-[#10271f] px-3 py-2 text-xs text-[#a8b8a4] outline-none"
              >
                <option value="Toutes">Toutes positions</option>
                {NINE_MAX.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="rounded-lg border border-[#2a4e3e] bg-[#10271f] px-3 py-2 text-xs text-[#a8b8a4] outline-none"
              >
                <option value="Toutes">Toutes situations</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#315643] p-8 text-center">
                <p className="text-sm text-[#9bb09f]">
                  Aucune décision avec ces filtres.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filtered
                  .slice(-10)
                  .reverse()
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[#10271f]"
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          item.correct
                            ? 'bg-[#d5a850]/15 text-[#d5a850]'
                            : 'bg-[#d87561]/15 text-[#d87561]'
                        }`}
                      >
                        {item.correct ? <Check size={14} /> : <X size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="mono text-xs text-[#e0e5d5]">
                          {item.hand}{' '}
                          <span className="text-[#718e7f]">
                            · {item.position} · {item.stack}bb
                          </span>
                        </p>
                        <p className="mt-1 text-[10px] text-[#718e7f]">
                          {item.street} · {actionName(item.decision)} /{' '}
                          {actionName(item.recommended)} · {item.category}
                        </p>
                      </div>
                      <span
                        className={`mono text-[10px] ${
                          item.correct ? 'text-[#d5a850]' : 'text-[#d87561]'
                        }`}
                      >
                        {item.correct ? 'JUSTE' : 'ERREUR'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function OddsPage() {
  const [table, setTable] = useState<TableSize>(6);
  const [spot, setSpot] = useState<Spot>(() => pickSpot(6));
  const [street, setStreet] = useState<Street>('FLOP');
  const board = visibleBoard(spot, street);
  const stats = calculateDrawStats(spot.hole, board);

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mono mb-2 text-[10px] uppercase tracking-[.25em] text-[#d5a850]">
            Laboratoire de calcul
          </p>
          <h2 className="text-3xl font-semibold tracking-[-.07em] text-[#f3e9ce] sm:text-5xl">
            Apprendre les outs,
            <br />
            <span className="text-[#d5a850]">pas les deviner.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-[#8ea699]">
            Chaque calcul retire les cartes déjà visibles. Comparez la prochaine
            carte et la probabilité d’améliorer d’ici la river.
          </p>
        </div>
        <button
          onClick={() => {
            setSpot(pickSpot(table, spot.id));
            setStreet('FLOP');
          }}
          className="flex w-fit items-center gap-2 rounded-lg bg-[#d5a850] px-4 py-2.5 text-sm font-semibold text-[#162218]"
        >
          <Sparkles size={15} /> Nouveau tirage
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="felt-grid rounded-2xl border border-[#27513f] bg-[#0d241b] p-5 shadow-[var(--shadow-card)] sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#234536] pb-5">
            <div>
              <span className="mono inline-flex rounded border border-[#c99b48]/30 bg-[#c99b48]/10 px-2 py-1 text-[10px] font-bold tracking-[.15em]">
                {spot.category}
              </span>
              <p className="mt-3 text-sm text-[#90a99b]">
                {spot.line} · {spot.effectiveStack} BB
              </p>
            </div>
            <div className="flex gap-1 rounded-lg border border-[#244538] bg-[#0c2119] p-1">
              {(['FLOP', 'TURN', 'RIVER'] as Street[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setStreet(value)}
                  className={`rounded-md px-3 py-1.5 text-[10px] font-semibold ${
                    street === value
                      ? 'bg-[#d5a850] text-[#132118]'
                      : 'text-[#85a293]'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-center py-12">
            <Board cards={board} />
            <p className="mt-4 text-xs text-[#839d8e]">{spot.texture}</p>
            <HoleCards cards={spot.hole} />
            <p className="mt-4 text-xs text-[#839d8e]">
              Main réelle · {spot.handClass}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.name}
                className="rounded-xl border border-[#315846] bg-[#10271f] p-4"
              >
                <p className="text-sm font-semibold text-[#e8ddbd]">
                  {stat.name}
                </p>
                <p className="mono mt-3 text-2xl text-[#e4b65e]">
                  {formatPercent(stat.river)}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[.12em] text-[#6e8b7d]">
                  d’ici la river
                </p>
                <div className="mt-3 border-t border-[#244538] pt-3 text-xs text-[#8aa394]">
                  <span className="mono text-[#d8ae5d]">{stat.outs} outs</span>{' '}
                  · {formatPercent(stat.next)} au prochain tirage
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside>
          <OddsPanel hole={spot.hole} board={board} />
          <div className="mt-4 rounded-2xl border border-[#1d3b31] bg-[#0c2119] p-5">
            <div className="mb-3 flex items-center gap-2 text-[#e5bd67]">
              <CircleHelp size={16} />
              <p className="mono text-[10px] uppercase tracking-[.18em]">
                La formule
              </p>
            </div>
            <p className="text-sm leading-6 text-[#a5b8a5]">
              Au flop, le paquet comporte 47 cartes inconnues. Un tirage à 9
              outs touche au turn dans 9/47 des cas, puis d’ici la river dans 1
              − (38/47 × 37/46) des cas.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <IconMark />
      <h2 className="mt-6 text-3xl font-semibold text-[#f3e9ce]">
        Cette table n’existe pas.
      </h2>
      <p className="mt-3 text-sm text-[#8ea699]">Revenez au bureau d’étude.</p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-lg bg-[#d5a850] px-4 py-2.5 text-sm font-semibold text-[#162218]"
      >
        Retour à l’entraînement
      </Link>
    </div>
  );
}

function App() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={TrainerPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/odds" component={OddsPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

export default App;