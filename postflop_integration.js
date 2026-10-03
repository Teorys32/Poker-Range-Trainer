/* ============================================================================
 * postflop_integration.js — ADAPTATEUR EXPÉRIMENTAL builder -> spot existant du trainer.
 * FICHIER SÉPARÉ : index.html n'est pas modifié et ne charge pas ce fichier. Il se charge APRÈS index.html
 * (balise <script> ou injection de test) et n'ajoute qu'un seul nom global : PostflopBuilderIntegration.
 * Il n'écrase, ne remplace et n'enveloppe aucune fonction existante ; l'ancien générateur n'est pas appelé ici.
 *
 * Chemin : requête -> builder (validate/plan/construct/verify) -> conversion des cartes -> spot au format de
 * generatePostflopSpot -> validateGeneratedSpot (moteur) -> vérification moteur de la classification demandée.
 * Tout écart => REFUS explicite (ok:false + raison), jamais un spot approximatif.
 *
 * Réutilise tel quel (sans copie de logique) : synthesizePreflopSkeletonWithPotType, resolveEffectiveStack,
 * resolveAnte, handLabel, computeDynamicFlopPost, computeDynamicStreetPost, basePost, validateGeneratedSpot,
 * applyVillainProfile, generateTableStacks, heroActsFirstPostflop, computeStrategicFamily,
 * generatedStrategicSignature, ensureVillainHandForPlay, simulateReferenceLine, generateEvolvedCard, pickWeighted,
 * et, pour le filtre de cohérence préflop (réalisme des cartes vs scénario) : les données de range
 * existantes OPEN_RANGES, GTO_RFI_6MAX/gtoRfiFrequency6Max, CHEN_RANKED_HANDS, estimateDefendFrequency —
 * en LECTURE SEULE, aucune de ces données ni la logique de synthesizePreflopSkeleton/synthesizeThreeBetSkeleton
 * n'est modifiée ou dupliquée ; seule la main de Hero est vérifiée contre ces ranges déjà existantes.
 * Écart DÉLIBÉRÉ (isolation) : aucune des fonctions record*() n'est appelée -> les fenêtres anti-répétition
 * state._recent* ne sont jamais modifiées par ce chemin.
 * ========================================================================== */
(function(root){
'use strict';
if(root.PostflopBuilderIntegration) return;
const VERSION='0.1-experimental';
let PB=null, builder=null;
const now=()=>(root.performance&&root.performance.now)?root.performance.now():Date.now();
// ------------------------------------------------------------------ conversion des cartes
// builder : entier rang*4+couleur ; moteur : {rank:'K', suit:'♥'} (RANKS/SUITS du moteur, mêmes ordres).
function assertEncoding(){
  const c=PB.constants;
  if(RANKS.join('')!==c.RANKS) throw new Error('ENCODAGE: RANKS du moteur différent du builder');
  if(SUITS.join('')!==c.SUITS.join('')) throw new Error('ENCODAGE: SUITS du moteur différent du builder');
}
const cardToEngine=c=>({rank:RANKS[c>>2],suit:SUITS[c&3]});
const cardFromEngine=o=>RANKS.indexOf(o.rank)*4+SUITS.indexOf(o.suit);
// ------------------------------------------------------------------ FLOP v2 : échantillonneur de tuples (texture d'abord, puis cellule)
// P(tuple) = mix[classe] x N(tuple)^alpha / somme_{t' de la classe} N(t')^alpha, où
//  - classe = suit x rank du flop (9 classes) ; mix[classe] = distribution EXACTE du générateur de textures du moteur
//    (generateFlopByTexture : catégorie tirée selon FLOP_TEXTURE_WEIGHTS, puis flop uniforme parmi ceux qui satisfont boardMatchesFlopTexture) ;
//  - N(tuple) = effectif naturel (combinaisons de mains x flops) issu de l'énumération exhaustive ; alpha = 1 réalisme pur, 0 uniforme.
function makeFlopV2Sampler(data,alpha,weights){
  if(!data||!data.tuples||!data.classes) throw new Error('FLOPV2: données invalides');
  if(!Array.isArray(weights)||!weights.length) throw new Error('FLOPV2: poids de texture manquants');
  const wOf={}; let wsum=0; for(const [c,w] of weights){ wOf[c]=w; wsum+=w; }
  const catFlops={}; for(const cl of Object.keys(data.classes)) for(const c of data.classes[cl].cats) catFlops[c]=(catFlops[c]||0)+data.classes[cl].flops;
  const mix={}; for(const cl of Object.keys(data.classes)){ let m=0; for(const c of data.classes[cl].cats) m+=((wOf[c]||0)/wsum)*data.classes[cl].flops/catFlops[c]; mix[cl]=m; }
  const byClass={}; for(const key of Object.keys(data.tuples)){ const cl=key.split('|').slice(3,5).join('|'); (byClass[cl]=byClass[cl]||[]).push(key); }
  const keys=[], probs=[];
  for(const cl of Object.keys(byClass)){ if(!(mix[cl]>0)) continue; const den=byClass[cl].reduce((a,k)=>a+Math.pow(data.tuples[k].n,alpha),0);
    for(const k of byClass[cl]){ keys.push(k); probs.push(mix[cl]*Math.pow(data.tuples[k].n,alpha)/den); } }
  const tot=probs.reduce((a,b)=>a+b,0); for(let i=0;i<probs.length;i++) probs[i]/=tot;
  const cum=[]; let acc=0; for(const p of probs){ acc+=p; cum.push(acc); }
  return { alpha, keys, probs, mix,
    pick(rand){ const x=(rand||Math.random)(); let lo=0,hi=cum.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(cum[m]>=x) hi=m; else lo=m+1; } return keys[lo]; } };
}
let flopSampler=null, flopData=null;
function init(opts){
  PB=opts.PostflopBuilder||root.PostflopBuilder; if(!PB) throw new Error('PostflopBuilder introuvable');
  // Le flop v2 est le SEUL générateur de flop : sans données valides, init() lève (aucun repli vers un autre générateur de flop) et le
  // builder reste indisponible (l'appelant — index.html — retombe alors sur generatePostflopSpot pour tous les spots).
  builder=null; flopSampler=null; flopData=null;
  if(!opts.flopV2||!opts.flopV2.data) throw new Error('FLOPV2: données du flop v2 absentes');
  const d=opts.flopV2.data; const alpha=opts.flopV2.alpha===undefined?0.5:opts.flopV2.alpha;
  const b=PB.create({contract:opts.contract,index:opts.index,contractV1:opts.contractV1,flopV2:d});
  const sm=makeFlopV2Sampler(d,alpha,opts.flopV2.textureWeights);
  builder=b; assertEncoding(); flopSampler=sm; flopData=d;
  return {ok:true,version:VERSION,builderStats:builder.stats,alpha};
}
function pickFlopV2Tuple(rand){ return flopSampler?flopSampler.pick(rand):null; }
// ------------------------------------------------------------------ requête à partir d'un tuple canonique
function cellToQuery(cell){
  const p=cell.split('/'), cat=p[0];
  if(cat==='AIR'||cat==='OVERCARDS') return {category:cat};
  if(cat==='PAIR') return {category:'PAIR',meta:{pairType:p[1]}};
  if(cat==='TWO_PAIR') return p[1]==='BOARD_PAIR'?{category:'TWO_PAIR',meta:{twoPairType:'BOARD_PAIR',twoPairBoardTag:p[2]}}:{category:'TWO_PAIR',meta:{twoPairType:p[1]}};
  if(cat==='TRIPS') return {category:'TRIPS',meta:{tripsType:p[1]}};
  if(cat==='FLUSH') return {category:'FLUSH',participation:p[1]==='H',meta:{straightFlush:p[2]==='SF'}};
  return {category:cat,participation:p[1]==='H'};
}
// tuple "TURN|cell|heroEvent|liveDraw|boardEvent|pairs" ou "FLOP|cell|liveDraw" -> requête du builder
function queryFromTuple(tuple){
  const t=tuple.split('|');
  if(t[0]==='FLOP'){ const q=Object.assign({street:'FLOP'},cellToQuery(t[1]),{liveDraw:t[2]}); q.flopSuit=t[3]; q.flopRank=t[4]; return q; } // tuple FLOP v2 : FLOP|cellule|tirage|suit|rank (suit/rank absents = texture libre)
  return Object.assign({street:t[0]},cellToQuery(t[1]),{heroEvent:t[2],liveDraw:t[3],boardEvent:t[4],pairs:Number(t[5])});
}
// ------------------------------------------------------------------ classification par le MOTEUR RÉEL (pour vérifier)
const LIVE_CLASS=l=>l==='NONE'?'NONE':(l==='FLUSH_DRAW'||l==='NUT_FLUSH_DRAW')?'FLUSH':l==='COMBO_DRAW'?'COMBO':'STRAIGHT';
function canonicalCellKey(c){
  const cat=c.category; if(cat==='AIR'||cat==='OVERCARDS') return cat; if(cat==='PAIR') return 'PAIR/'+c.pairType;
  if(cat==='TWO_PAIR') return 'TWO_PAIR/'+c.twoPairType+(c.twoPairBoardTag?('/'+c.twoPairBoardTag):''); if(cat==='TRIPS') return 'TRIPS/'+c.tripsType;
  const p=c.heroParticipates?'H':'B'; if(cat==='FLUSH') return 'FLUSH/'+p+(c.straightFlush?'/SF':''); return cat+'/'+p;
}
const CATN=['AIR','OVERCARDS','PAIR','TWO_PAIR','TRIPS','STRAIGHT','FLUSH','FULL_HOUSE','QUADS'];
// rôle de la dernière carte : définition d'AUDIT du contrat v2 (pas une fonction du moteur), calculée à partir des
// sorties canoniques du moteur (avant/après) et des rangs.
function roleFromEngine(hole,boardBefore,card,cb,ca){
  const mH=hole.some(h=>h.rank===card.rank), mB=!mH&&boardBefore.some(b=>b.rank===card.rank);
  const comp=ca.heroParticipates===true&&ca.categoryRank>cb.categoryRank&&(ca.category==='STRAIGHT'||ca.category==='FLUSH');
  return ({0:'NEUTRAL',1:'HERO_MATCH',2:'BOARD_MATCH',4:'COMPLETES_HAND',5:'HERO_MATCH+COMPLETES_HAND',6:'BOARD_MATCH+COMPLETES_HAND'})[(mH?1:0)|(mB?2:0)|(comp?4:0)];
}
function engineClassification(hole,runout,street){
  if(street==='FLOP'){ const b=runout.slice(0,3); const tx=computeBoardTexture(b); const rk=b.map(c=>numericRank(c.rank)).sort((x,y)=>y-x);
    const flopSuit=tx.suitMax>=3?'MONO':(tx.suitMax===2?'TWO':'RAIN'); const flopRank=tx.maxRankCount>=3?'TRIPS':(tx.paired?'PAIRED':((rk[0]-rk[2])<=4?'CONN':'DRY')); // texture lue par le MOTEUR (computeBoardTexture)
    return {cell:canonicalCellKey(classifyCanonicalHand(hole,b)),liveDraw:LIVE_CLASS(computeLiveDraws(hole,b)),flopSuit,flopRank}; }
  const n=street==='TURN'?4:5, board=runout.slice(0,n), before=runout.slice(0,n-1), card=runout[n-1];
  const cb=classifyCanonicalHand(hole,before), ca=classifyCanonicalHand(hole,board), det=computeHeroStreetEventDetail(hole,board), be=computeBoardStreetEvents(board);
  return {cell:canonicalCellKey(ca),heroEvent:det.event,liveDraw:street==='TURN'?LIVE_CLASS(computeLiveDraws(hole,board)):'NONE',boardEvent:street==='TURN'?be.turnBoard:be.riverBoard,
    pairs:(street==='TURN'?be.turnPairs:be.riverPairs)?1:0,lastCardRole:roleFromEngine(hole,before,card,cb,ca),prevCategory:CATN[cb.categoryRank-1],drawBefore:LIVE_CLASS(computeLiveDraws(hole,before))};
}
const roleOk=(ts,req)=>req===undefined||req===null||(req.length===1&&req[0]==='NEUTRAL'?ts==='NEUTRAL':req.every(t=>ts.split('+').includes(t)));
// Vérifie le spot FINAL (objet du trainer) : structure, cartes, puis classification du moteur réel contre la requête
// et contre la classification calculée par le builder. Retourne { ok, errors[], engine }.
function verifyAgainstEngine(spot,query,builderComputed){
  const errors=[]; const add=(check,expected,got)=>errors.push({check,expected,got});
  const v=builder.validate(query); if(v.status!=='OK'){ add('query','requête valide',v.status); return {ok:false,errors,engine:null}; }
  const spec=v.spec, S=spec.street;
  if(!spot||!Array.isArray(spot.hole)||!Array.isArray(spot.runout)){ add('structure','hole/runout','absent'); return {ok:false,errors,engine:null}; }
  if(spot.hole.length!==2) add('structure','2 cartes Hero',spot.hole.length);
  if(spot.runout.length!==5) add('structure','runout de 5 cartes',spot.runout.length);
  const keys=[...spot.hole,...spot.runout].map(cardKey); if(new Set(keys).size!==keys.length) add('cartes','aucune carte dupliquée','doublon');
  if(errors.length) return {ok:false,errors,engine:null};
  if(JSON.stringify(spot.flop)!==JSON.stringify(spot.runout.slice(0,3).map(cardLabel))) add('structure','spot.flop = 3 premières cartes du runout','différent');
  let eng; try{ eng=engineClassification(spot.hole,spot.runout,S); }catch(e){ add('moteur','classification sans erreur',String(e&&e.message||e)); return {ok:false,errors,engine:null}; }
  if(!spec.cells.includes(eng.cell)) add('cell',spec.cells.join('|'),eng.cell);
  if(spec.live!==undefined&&spec.live!==eng.liveDraw) add('liveDraw',spec.live,eng.liveDraw);
  if(S==='FLOP'){ if(spec.fsuit!==undefined&&spec.fsuit!==eng.flopSuit) add('flopSuit',spec.fsuit,eng.flopSuit); if(spec.frank!==undefined&&spec.frank!==eng.flopRank) add('flopRank',spec.frank,eng.flopRank); }
  if(S!=='FLOP'){
    if(spec.hev!==undefined&&spec.hev!==eng.heroEvent) add('heroEvent',spec.hev,eng.heroEvent);
    if(spec.bev!==undefined&&spec.bev!==eng.boardEvent) add('boardEvent',spec.bev,eng.boardEvent);
    if(spec.pairs!==undefined&&spec.pairs!==eng.pairs) add('pairs',spec.pairs,eng.pairs);
    if(!roleOk(eng.lastCardRole,spec.role)) add('lastCardRole',(spec.role||[]).join('+'),eng.lastCardRole);
    if(spec.prevCat!==undefined&&spec.prevCat!==eng.prevCategory) add('prevCategory',spec.prevCat,eng.prevCategory);
    if(spec.prevLive!==undefined&&spec.prevLive!==eng.drawBefore) add('drawBefore',spec.prevLive,eng.drawBefore); }
  if(builderComputed){ const bc=builderComputed; const pairs=[['cell',bc.cell,eng.cell],['liveDraw',bc.liveDraw,eng.liveDraw]]; if(S==='FLOP'&&bc.flopSuit!==undefined) pairs.push(['flopSuit',bc.flopSuit,eng.flopSuit],['flopRank',bc.flopRank,eng.flopRank]);
    if(S!=='FLOP') pairs.push(['heroEvent',bc.heroEvent,eng.heroEvent],['boardEvent',bc.boardEvent,eng.boardEvent],['pairs',bc.pairs,eng.pairs],['lastCardRole',bc.lastCardRole,eng.lastCardRole],['prevCategory',bc.prevCategory,eng.prevCategory],['drawBefore',bc.drawBefore,eng.drawBefore]);
    for(const [k,a,b] of pairs) if(a!==b) add('builder_vs_moteur:'+k,a,b); }
  return {ok:errors.length===0,errors,engine:eng};
}
// ------------------------------------------------------------------ génération expérimentale
const refuse=(status,reason,extra)=>Object.assign({ok:false,status,reason},extra||{});
function labelsMatching(list,fn){ const out=[]; for(const [label] of list){ try{ if(fn(label)) out.push(label); }catch(e){} } return out; }
// ------------------------------------------------------------------ texture de board (RÉALISME — descriptive, jamais null par ambiguïté)
// spot.texture était dérivé de labelsMatching(FLOP_TEXTURE_WEIGHTS, boardMatchesFlopTexture) — cette
// fonction EXISTANTE (index.html, non modifiée) teste chaque catégorie indépendamment, et plusieurs se
// chevauchent PAR CONSTRUCTION (ex. un board two-tone à rangs proches satisfait à la fois TWO_TONE et
// CONNECTED) : dès que 2+ catégories matchaient, spot.texture tombait à null, même quand le board a une
// texture parfaitement descriptible. describeFlopTexture calcule directement UNE étiquette parmi les 5
// catégories déjà existantes (DRY/CONNECTED/TWO_TONE/PAIRED/MONOTONE — aucune nouvelle catégorie), à
// partir des MÊMES signaux déjà utilisés par boardMatchesFlopTexture/computeBoardTexture (suitMax, paired,
// écart de rangs — toutes deux fonctions existantes d'index.html, en LECTURE SEULE), avec une priorité
// fixe et non arbitraire reflétant la salience réelle des textures au poker : une couleur possible prime
// sur un simple appariement, qui prime sur la seule connectivité de rangs — MONOTONE > PAIRED > TWO_TONE >
// CONNECTED > DRY. Chaque branche reste dans les seuils exacts de boardMatchesFlopTexture (aucun nouveau
// seuil inventé) ; jamais null pour un flop réellement présent (3 cartes).
function describeFlopTexture(flop){
  if(!flop||flop.length<3) return null;
  const tex=computeBoardTexture(flop);
  const ranksDesc=flop.map(c=>numericRank(c.rank)).sort((a,b)=>b-a);
  const spread=ranksDesc[0]-ranksDesc[2];
  if(tex.suitMax>=3) return 'MONOTONE';
  if(tex.paired) return 'PAIRED';
  if(tex.suitMax===2) return 'TWO_TONE';
  return spread<=4 ? 'CONNECTED' : 'DRY';
}
// ------------------------------------------------------------------ cohérence préflop (RÉALISME)
// Les cartes de Hero viennent du builder (contraintes canoniques : catégorie, événements, tirage...),
// indépendamment de tout scénario préflop. Ici, une fois la main réellement distribuée connue
// (actualHandClass), on choisit un scénario préflop (position, ouverture/défense/3-bet) dans lequel
// cette main précise est réellement jouée — RÉUTILISE tel quel synthesizePreflopSkeletonWithPotType()
// (donc pickDynamicSkeleton, pickOpenHandClass, synthesizeThreeBetSkeleton...), jamais une nouvelle
// génération de squelette : seul le FILTRE de cohérence est ajouté ici, avec les MÊMES données de range
// déjà utilisées par ces fonctions (OPEN_RANGES, GTO_RFI_6MAX/gtoRfiFrequency6Max, CHEN_RANKED_HANDS) —
// aucune nouvelle donnée de range inventée. Un scénario est retiré (jamais forcé) quand la main n'y est
// pas jouable ; si aucun scénario cohérent n'apparaît dans le budget de tentatives, generate() refuse
// (REFUSED_PREFLOP_INCOHERENT) et l'appelant retombe sur generatePostflopSpot (ancien générateur).
const PREFLOP_SKELETON_ATTEMPTS=24;
// Anti-répétition LÉGÈRE (best-effort, non calibrée) : évite de renvoyer coup sur coup le même scénario
// préflop (position × rôle × type de pot) sur ce chemin — fenêtre locale au module, distincte de
// state._recent* (le chemin builder ne touche toujours aucune fenêtre de l'ancien générateur).
const RECENT_PREFLOP_WINDOW=5;
let recentPreflopSignatures=[];
function recentPreflopSignatureCount(sig){ return recentPreflopSignatures.filter(s=>s===sig).length; }
function recordPreflopSignature(sig){ recentPreflopSignatures.push(sig); if(recentPreflopSignatures.length>RECENT_PREFLOP_WINDOW) recentPreflopSignatures.shift(); }
function preflopSkeletonSignature(sk){ return [sk.potType, sk.heroIsAggressor?'AGG':'DEF', sk.heroPosition, sk.villainPosition].join('|'); }
// Teste si `handClass` (ex. 'AJs', 'QQ', '76s') est jouable dans le scénario `sk` — mêmes seuils/pools que
// ceux utilisés par synthesizePreflopSkeleton/synthesizeThreeBetSkeleton pour TIRER sk.heroHandClass au
// départ (RFI 6-max pondéré par gtoRfiFrequency6Max, OPEN_RANGES en 9-max, top 140 Chen pour la défense
// BB, top 35/90 pour un 3-bet Hero, top 55 pour un call face à une 3-bet) — jamais une nouvelle règle.
function preflopRangeContainsHand(sk,table,handClass){
  if(sk.potType==='THREEBET'){
    const idx=CHEN_RANKED_HANDS.indexOf(handClass); if(idx<0) return false;
    if(sk.heroIsAggressor) return idx<35 || (idx<90 && /[AK]/.test(handClass)); // value ou bluff à blocker
    return idx<55; // sous-ensemble haut de la range d'open, cohérent avec un call face à une 3-bet
  }
  if(sk.heroIsAggressor){
    if(table===6 && typeof GTO_RFI_6MAX!=='undefined' && GTO_RFI_6MAX[sk.heroPosition]) return (gtoRfiFrequency6Max(sk.heroPosition,handClass)||0)>0;
    const pool=(typeof OPEN_RANGES!=='undefined' && OPEN_RANGES[sk.heroPosition] && OPEN_RANGES[sk.heroPosition].length) ? OPEN_RANGES[sk.heroPosition] : CHEN_RANKED_HANDS.slice(0,25);
    return pool.includes(handClass);
  }
  const idx=CHEN_RANKED_HANDS.indexOf(handClass); return idx>=0 && idx<140; // pool de défense BB
}
// Resynchronise le texte/la fréquence préflop sur la main RÉELLEMENT distribuée (déjà vérifiée cohérente
// avec ce scénario par preflopRangeContainsHand) — remplace la mention de sk.heroHandClass par handClass
// dans l'explication déjà écrite par le squelette, et recalcule la fréquence avec les MÊMES fonctions
// (gtoRfiFrequency6Max/estimateDefendFrequency) que synthesizePreflopSkeleton ; les fréquences 3-bet sont
// des constantes indépendantes de la main (65/48, voir synthesizeThreeBetSkeleton) — rien à recalculer.
function resyncPreflopExplanation(sk,table,handClass){
  const p=sk.preflop; let frequency=p.frequency;
  if(sk.potType!=='THREEBET') frequency = sk.heroIsAggressor ? (table===6 ? Math.round((gtoRfiFrequency6Max(sk.heroPosition,handClass)??0.9)*100) : 92) : estimateDefendFrequency(handClass);
  const explanation=(typeof p.explanation==='string' && sk.heroHandClass) ? p.explanation.split(sk.heroHandClass).join(handClass) : p.explanation;
  return Object.assign({},p,{frequency,explanation});
}
// ------------------------------------------------------------------ pondération des mains candidates (RÉALISME — fréquences DU SCÉNARIO)
// CORRECTIF (le scénario est maintenant choisi D'ABORD — voir pickScenarioThenHand ci-dessous) : le poids
// d'une main candidate doit correspondre au scénario RETENU, pas à "la meilleure fréquence toutes
// positions confondues" (bug précédent : une défense BB ou un 3-bet pouvaient être pondérés avec une
// fréquence d'OUVERTURE 6-max sans rapport avec ce scénario). Ici, `sk` est déjà fixé :
// - Open 6-max (sk.potType==='SRP' && sk.heroIsAggressor && table===6, poste présent dans GTO_RFI_6MAX) :
//   poids = gtoRfiFrequency6Max(sk.heroPosition, handClass), la fréquence RÉELLE de CETTE position précise.
// - Toute autre range (défense BB, open 9-max via OPEN_RANGES, pools de 3-bet) : aucune fréquence par main
//   n'existe dans le trainer pour ces cas — poids plat inchangé (comportement d'avant ce correctif), la
//   seule chose vérifiée est l'éligibilité via preflopRangeContainsHand (fonction existante, inchangée).
function scenarioHandWeight(sk,table,handClass){
  if(!preflopRangeContainsHand(sk,table,handClass)) return {weight:0,weighted:false};
  if(sk.potType==='SRP' && sk.heroIsAggressor && table===6 && typeof GTO_RFI_6MAX!=='undefined' && GTO_RFI_6MAX[sk.heroPosition]){
    const f=gtoRfiFrequency6Max(sk.heroPosition,handClass)||0;
    if(f>0) return {weight:f,weighted:true};
  }
  return {weight:1,weighted:false}; // éligible, mais pas de fréquence par main disponible pour ce scénario précis
}
const CARD_CANDIDATE_ATTEMPTS=6;
// Construit plusieurs mains candidates pour le MÊME plan (donc les MÊMES contraintes canoniques à chaque
// tentative — jamais un relâchement des contraintes du builder), via des graines dérivées déterministes de
// la graine de base (reproductible). Aucun filtre de range ici : l'éligibilité dépend du scénario, choisi
// ensuite par pickScenarioThenHand.
function buildCandidateHoleOptions(pl,baseSeed){
  const candidates=[];
  for(let i=0;i<CARD_CANDIDATE_ATTEMPTS;i++){
    const rng=PB.makeRng(baseSeed+'#h'+i);
    const rc=builder.construct(pl,rng);
    if(!rc||rc.status!=='OK') continue;
    candidates.push({result:rc,handClass:handLabel(rc.spot.cards.hole.map(cardToEngine))});
  }
  return candidates;
}
// Tirage PONDÉRÉ parmi les candidats — même principe (roulette pondérée) que pickWeighted, déjà utilisé
// partout ailleurs dans le trainer pour ce même genre de tirage, mais avec une graine (rng du builder,
// PB.makeRng) plutôt que Math.random() : pickWeighted n'est PAS réutilisée directement ici car elle
// tire sur Math.random(), ce qui casserait la reproductibilité "même requête + même graine -> même main"
// pour la partie sous notre contrôle (voir la limite documentée plus bas concernant le scénario lui-même).
function pickWeightedCandidate(cands,rng){
  const total=cands.reduce((s,c)=>s+c.weight,0);
  let r=rng.next()*total;
  for(const c of cands){ r-=c.weight; if(r<=0) return c; }
  return cands[cands.length-1];
}
// Choisit le scénario préflop D'ABORD (point demandé), PARMI ceux compatibles avec au moins une des mains
// candidates déjà construites (mêmes tirages de squelette, même anti-répétition que l'ancienne
// pickCoherentPreflopSkeleton qu'elle remplace) — puis pondère les candidates compatibles avec CE scénario
// (scenarioHandWeight) et en tire une par roulette graine. Retourne {sk, chosen} ou null si aucun scénario
// n'admet aucune candidate dans le budget de tentatives (main hors de toute range connue -> fallback).
// LIMITE (voir aussi le résumé de livraison) : synthesizePreflopSkeletonWithPotType() tire la POSITION via
// Math.random(), non seedé (fonction existante d'index.html, non modifiée) — la reproductibilité "même
// requête + même graine" reste donc garantie pour l'ensemble des mains candidates construites (étape 1,
// entièrement seedée), mais PAS pour le scénario retenu ni, par conséquent, pour la main précise si
// plusieurs scénarios aux poids différents sont compatibles selon l'ordre de tirage. C'était déjà vrai
// pour le scénario seul avant ce correctif ; pondérer par le scénario propage cette limite à la main.
function pickScenarioThenHand(table,candidates,seed){
  const rng=PB.makeRng(seed+'#pick');
  let fallback=null;
  for(let i=0;i<PREFLOP_SKELETON_ATTEMPTS;i++){
    const sk=synthesizePreflopSkeletonWithPotType(table);
    const weighted=[];
    for(const c of candidates){ const w=scenarioHandWeight(sk,table,c.handClass); if(w.weight>0) weighted.push(Object.assign({},c,w)); }
    if(!weighted.length) continue;
    if(!fallback) fallback={sk,weighted};
    if(recentPreflopSignatureCount(preflopSkeletonSignature(sk))===0) return {sk,chosen:weighted.length===1?weighted[0]:pickWeightedCandidate(weighted,rng)};
  }
  if(!fallback) return null;
  return {sk:fallback.sk, chosen:fallback.weighted.length===1?fallback.weighted[0]:pickWeightedCandidate(fallback.weighted,rng)};
}
// ------------------------------------------------------------------ FLOP : choix du scénario SANS biais d'acceptation
// Défaut corrigé (audit du 02/10/2026) : pickScenarioThenHand accepte un scénario si AU MOINS UNE des 6 mains candidates est dans sa range. La probabilité
// d'acceptation A(s)=1-(1-q)^6 (q = part des mains du tuple jouables dans le scénario) favorise donc les ranges LARGES (défense BB) au détriment des
// ranges serrées, ce qui déforme la fréquence des scénarios par rapport à l'a priori de synthesizePreflopSkeletonWithPotType (défense BB : 25,5 % -> 32 % en
// 6-max, 25,4 % -> 39 % en 9-max ; indépendant de alpha). Ici, un scénario est écarté UNIQUEMENT s'il est réellement inatteignable pour le tuple (aucune main
// du tuple n'est dans sa range, d'après les graines du fichier flop v2) ; s'il est atteignable mais qu'aucune des 6 premières candidates n'est jouable, on
// construit des candidates supplémentaires (mêmes graines dérivées, même builder) jusqu'à en trouver une. Ranges, poids de mains (scenarioHandWeight),
// anti-répétition et tirage pondéré : inchangés. Réservé au flop : la fonction partagée pickScenarioThenHand (turn/river) n'est PAS modifiée.
const FLOP_CANDIDATE_CAP=200; // nombre total maximal de candidates construites pour un spot (6 de base + extensions)
function flopHandSupport(pl){
  const labs=new Set();
  for(const o of pl.options){ const t=flopData&&flopData.tuples[o.jointKey]; if(!t) continue; for(const s of t.seeds) labs.add(handLabel([cardToEngine(s[1]),cardToEngine(s[2])])); }
  return [...labs];
}
function pickScenarioThenHandFlop(table,candidates,seed,pl){
  const rng=PB.makeRng(seed+'#pick'); const support=flopHandSupport(pl);
  const extra=[]; let nextIdx=CARD_CANDIDATE_ATTEMPTS;
  const firstPlayableBeyond=sk=>{
    for(const c of extra){ const w=scenarioHandWeight(sk,table,c.handClass); if(w.weight>0) return Object.assign({},c,w); }
    while(nextIdx<FLOP_CANDIDATE_CAP){
      const rc=builder.construct(pl,PB.makeRng(seed+'#h'+(nextIdx++))); if(!rc||rc.status!=='OK') continue;
      const c={result:rc,handClass:handLabel(rc.spot.cards.hole.map(cardToEngine))}; extra.push(c);
      const w=scenarioHandWeight(sk,table,c.handClass); if(w.weight>0) return Object.assign({},c,w);
    }
    return null;
  };
  let fallback=null;
  for(let i=0;i<PREFLOP_SKELETON_ATTEMPTS;i++){
    const sk=synthesizePreflopSkeletonWithPotType(table);
    if(!support.some(l=>scenarioHandWeight(sk,table,l).weight>0)) continue; // scénario inatteignable pour ce tuple
    let weighted=[];
    for(const c of candidates){ const w=scenarioHandWeight(sk,table,c.handClass); if(w.weight>0) weighted.push(Object.assign({},c,w)); }
    if(!weighted.length){ const c=firstPlayableBeyond(sk); if(!c) continue; weighted=[c]; }
    if(!fallback) fallback={sk,weighted};
    if(recentPreflopSignatureCount(preflopSkeletonSignature(sk))===0) return {sk,chosen:weighted.length===1?weighted[0]:pickWeightedCandidate(weighted,rng)};
  }
  if(!fallback) return null;
  return {sk:fallback.sk, chosen:fallback.weighted.length===1?fallback.weighted[0]:pickWeightedCandidate(fallback.weighted,rng)};
}
// ------------------------------------------------------------------ diversité du CONTEXTE D'ACTION postflop (RÉALISME)
// Le contexte d'action (c-bet flop, check-back → delayed c-bet, second barrel, river après check/check,
// value/bluff/bluff-catcher, tirage manqué...) est déterminé par computeStrategicFamily(spot) — fonction
// EXISTANTE, inchangée, déjà appelée par l'ancien générateur. Jusqu'ici le chemin builder l'utilisait pour
// ÉTIQUETER le spot (spot.strategicFamily/turnFamily/riverFamily) mais ne vérifiait jamais si ce contexte
// revenait trop souvent. Ici, on construit PLUSIEURS candidats de spot COMPLET (main + scénario + board +
// décisions du moteur, donc le contexte d'action est déjà connu pour chacun) via des graines dérivées de
// la graine de base (reproductible), et on préfère celui dont le contexte n'a pas été servi récemment sur
// CE chemin — jamais un contexte forcé : si tous les candidats retombent sur un contexte déjà vu, on garde
// simplement le dernier construit (même philosophie "on retire plutôt que de forcer" que le reste du
// fichier). Fenêtre LOCALE au module (comme recentPreflopSignatures) : ne touche à aucune fenêtre
// state._recent* existante — l'isolation du chemin builder reste inchangée.
const ACTION_CONTEXT_ATTEMPTS=4;
const RECENT_ACTION_CONTEXT_WINDOW=8;
let recentActionContexts=[];
function recentActionContextCount(sig){ return recentActionContexts.filter(s=>s===sig).length; }
function recordActionContext(sig){ recentActionContexts.push(sig); if(recentActionContexts.length>RECENT_ACTION_CONTEXT_WINDOW) recentActionContexts.shift(); }
// Signature du contexte d'action : street, IP/OOP, SRP/3-bet, texture de board, et les trois familles
// (flop/turn/river — c-bet/check-back/lead, second-barrel/delayed-cbet/probe/giveup, triple-barrel/value/
// bluff/bluff-catcher/tirage manqué/check-back) — toutes déjà calculées par computeStrategicFamily/
// describeFlopTexture, rien de nouveau. heroEvent/boardEvent/liveDraw de la requête sont inclus pour
// distinguer aussi les situations de tirage/amélioration demandées par la requête elle-même.
function actionContextSignature(query,spot,family){
  return [query.street,spot.heroIsIP?'IP':'OOP',spot.potType,spot.texture||'?',query.heroEvent||'-',query.boardEvent||'-',query.liveDraw||'-',family.flopTag,family.turnTag,family.riverTag].join('|');
}
// Construit UN candidat complet (main + scénario + board + décisions du moteur) pour la requête, avec une
// graine dérivée déterministe — reprend EXACTEMENT la logique déjà en place (aucune règle nouvelle),
// simplement extraite pour être appelée plusieurs fois par generate() avec des graines différentes.
function attemptBuilderSpot(query,pl,table,difficulty,mode,subSeed){
  let t=now();
  const candidates=buildCandidateHoleOptions(pl,subSeed);
  if(!candidates.length) return {ok:false,refusal:refuse('REFUSED_BUILDER','NO_CANDIDATE',{detail:'le builder n\'a produit aucun spot valide pour cette requête'})};
  const picked=query.street==='FLOP' ? pickScenarioThenHandFlop(table,candidates,subSeed,pl) : pickScenarioThenHand(table,candidates,subSeed);
  if(!picked) return {ok:false,refusal:refuse('REFUSED_PREFLOP_INCOHERENT','aucun scénario préflop compatible avec les mains candidates après '+PREFLOP_SKELETON_ATTEMPTS+' tentatives',{})};
  const sk=picked.sk,chosen=picked.chosen;
  const r=chosen.result;
  const bver=builder.verify(r.spot,query); if(!bver.ok) return {ok:false,refusal:refuse('REFUSED_BUILDER_SELF_VERIFY','verify() du builder en écart',{mismatches:bver.mismatches})};
  const T={builder:now()-t}; t=now();
  // 2. conversion des cartes + contrôle aller-retour
  const cs=r.spot.cards, S=r.spot.street;
  const hole=cs.hole.map(cardToEngine); const flop=cs.flop.map(cardToEngine);
  const turnB=cs.turn===null?null:cardToEngine(cs.turn), riverB=cs.river===null?null:cardToEngine(cs.river);
  const back=[...hole,...flop,...(turnB?[turnB]:[]),...(riverB?[riverB]:[])].map(cardFromEngine), orig=[...cs.hole,...cs.flop,...(cs.turn===null?[]:[cs.turn]),...(cs.river===null?[]:[cs.river])];
  if(JSON.stringify(back)!==JSON.stringify(orig)||back.some(x=>x<0)) return {ok:false,refusal:refuse('REFUSED_CONVERSION','aller-retour des cartes en écart',{orig,back})};
  // 3. rues non fixées par le builder : complétées par les routines EXISTANTES du moteur (mêmes appels que l'ancien chemin)
  const completed=[]; let turnCard=turnB, riverCard=riverB, turnEvolution, riverEvolution;
  if(!turnCard){ turnEvolution=pickWeighted(EVOLUTION_WEIGHTS); turnCard=generateEvolvedCard(flop,[...flop,...hole],turnEvolution); completed.push('TURN'); }
  if(!riverCard){ riverEvolution=pickWeighted(EVOLUTION_WEIGHTS); riverCard=generateEvolvedCard([...flop,turnCard],[...flop,turnCard,...hole],riverEvolution); completed.push('RIVER'); }
  const runout=[...flop,turnCard,riverCard];
  const textureMatches=labelsMatching(FLOP_TEXTURE_WEIGHTS,l=>boardMatchesFlopTexture(flop,l)); // diagnostic (peut contenir plusieurs catégories qui matchent au sens strict — voir describeFlopTexture)
  const texture=describeFlopTexture(flop); // étiquette descriptive UNIQUE du board réel, jamais null
  const turnMatches=turnB?labelsMatching(EVOLUTION_WEIGHTS,l=>cardMatchesEvolution(turnCard,flop,l)):null;
  const riverMatches=riverB?labelsMatching(EVOLUTION_WEIGHTS,l=>cardMatchesEvolution(riverCard,[...flop,turnCard],l)):null;
  if(turnMatches) turnEvolution=turnMatches.length===1?turnMatches[0]:null;
  if(riverMatches) riverEvolution=riverMatches.length===1?riverMatches[0]:null;
  // 4. squelette préflop déjà choisi (avec la main) — reste juste la resynchro du texte/de la fréquence
  // sur la main RÉELLEMENT distribuée + assemblage au format de generatePostflopSpot
  const actualHandClass=handLabel(hole);
  const mismatch=actualHandClass!==sk.heroHandClass;
  const syncedPreflop=mismatch?resyncPreflopExplanation(sk,table,actualHandClass):sk.preflop;
  const effectiveStack=resolveEffectiveStack({effectiveStack:100},state.stackMode), ante=resolveAnte(state);
  const flopPost=computeDynamicFlopPost(hole,flop,sk.heroIsAggressor);
  let spot={
    id:`bld-${Date.now()}-${Math.floor(Math.random()*1e6)}`, generated:true, source:'builder-experimental',
    heroPosition:sk.heroPosition, villainPosition:sk.villainPosition,
    effectiveStack, pot:Math.round((sk.pot+ante)*10)/10, ante,
    line:sk.heroIsAggressor?`${sk.villainPosition} paie votre open`:`${sk.villainPosition} ouvre, vous payez`,
    actions:sk.actions, category:`Généré · ${sk.potType==='THREEBET'?'3-bet · ':''}constructeur`,
    difficulty:difficulty==='Débutant'?1:difficulty==='Avancé'?3:2,
    handClass:actualHandClass, hole, runout,
    flop:flop.map(cardLabel), texture, turnEvolution, riverEvolution,
    potType:sk.potType, heroIsAggressor:sk.heroIsAggressor,
    preflop:syncedPreflop,
    post:{FLOP:flopPost,TURN:basePost('CHECK',58,'placeholder','Check').TURN,RIVER:basePost('CHECK',58,'placeholder','Check').RIVER},
    table,
  };
  T.adapter=now()-t; t=now();
  // 5. validation moteur du spot (même fonction que l'ancien chemin) — refus explicite
  const validation=validateGeneratedSpot(spot,table);
  if(!validation.ok) return {ok:false,refusal:refuse('REFUSED_ENGINE_VALIDATION','validateGeneratedSpot',{errors:validation.errors})};
  // 6. suite identique à l'ancien chemin (fonctions existantes), SANS record*() : fenêtres anti-répétition intactes
  {const dyn=computeDynamicStreetPost(spot); spot.post={FLOP:flopPost,TURN:dyn.TURN,RIVER:dyn.RIVER};}
  spot=applyVillainProfile(spot,mode);
  spot.tableStacks=generateTableStacks(table===6?SIX_MAX:NINE_MAX,spot.heroPosition);
  spot._heroActsFirstPostflop=heroActsFirstPostflop(spot,table);
  spot.heroIsIP=!spot._heroActsFirstPostflop;
  const family=computeStrategicFamily(spot); // <- le CONTEXTE D'ACTION postflop est connu ici (voir actionContextSignature)
  spot.strategicFamily=family.primary; spot.turnFamily=family.turnTag; spot.riverFamily=family.riverTag;
  spot._strategicSignature=generatedStrategicSignature(spot,family);
  ensureVillainHandForPlay(spot);
  spot._referenceLine=simulateReferenceLine(spot,table);
  spot._srsReview=false;
  T.engineSteps=now()-t; t=now();
  // 7. vérification du spot FINAL par le moteur réel : classification demandée, événements Hero/Board, contre le builder
  const ver=verifyAgainstEngine(spot,query,bver.computed);
  T.verify=now()-t;
  if(!ver.ok) return {ok:false,refusal:refuse('REFUSED_ENGINE_CLASSIFICATION','écart de classification (moteur réel)',{errors:ver.errors})};
  return {ok:true,spot,family,sk,chosen,r,bver,T,completed,textureMatches,turnMatches,riverMatches,actualHandClass,mismatch,candidateCount:candidates.length,engineClassification:ver.engine};
}
function generate(query,opts){
  opts=opts||{}; const table=opts.table===9?9:6, difficulty=opts.difficulty||'Tous', mode=opts.villainProfileMode||'random';
  if(!builder) return refuse('NOT_INITIALIZED','init() non appelé');
  const seed=opts.seed===undefined?('bld-'+Date.now()+'-'+Math.random()):opts.seed;
  try{
    const v=builder.validate(query);
    if(v.status!=='OK') return refuse('REFUSED_BUILDER',v.status,{violations:v.violations,unresolved:v.unresolved,errors:v.errors});
    const pl=builder.plan(query);
    // Plusieurs spots candidats COMPLETS (mêmes contraintes canoniques à chaque fois), pour préférer celui
    // dont le CONTEXTE D'ACTION postflop (c-bet/barrel/check-back/river..., IP/OOP, SRP/3-bet, texture)
    // n'a pas été servi récemment sur ce chemin (voir plus haut) — jamais un contexte forcé.
    let best=null, lastRefusal=null;
    for(let i=0;i<ACTION_CONTEXT_ATTEMPTS;i++){
      const attempt=attemptBuilderSpot(query,pl,table,difficulty,mode,seed+'#a'+i);
      if(!attempt.ok){ lastRefusal=attempt.refusal; continue; }
      const sig=actionContextSignature(query,attempt.spot,attempt.family);
      best=Object.assign({sig},attempt);
      if(recentActionContextCount(sig)===0) break; // contexte pas récemment servi : on s'arrête là, jamais de tentative en trop
    }
    if(!best) return lastRefusal||refuse('REFUSED_PREFLOP_INCOHERENT','aucun spot construit après '+ACTION_CONTEXT_ATTEMPTS+' tentatives',{});
    recordActionContext(best.sig);
    recordPreflopSignature(preflopSkeletonSignature(best.sk)); // seulement une fois le spot accepté (mêmes conventions que record*() dans index.html)
    const {spot,sk,chosen,r,bver,T,completed,textureMatches,turnMatches,riverMatches,actualHandClass,mismatch,candidateCount,engineClassification}=best;
    spot._builder={version:VERSION,query,seed,tuple:bver.computed.tuple,street:r.spot.street,completedStreets:completed,preflopHandMismatch:mismatch,requestedPreflopHandClass:sk.heroHandClass,
      preflopRangeCoherent:true,handWeighted:chosen.weighted,handWeight:chosen.weight,candidateCount,actionContext:best.sig,
      textureMatches,turnEvolutionMatches:turnMatches,riverEvolutionMatches:riverMatches,builderStats:r.stats,engineClassification};
    if(bver.computed.tuple2) spot._builder.tupleV2=bver.computed.tuple2; // tuple FLOP v2 réalisé (absent des spots turn/river)
    return {ok:true,status:'OK',spot,report:{tuple:bver.computed.tuple,street:r.spot.street,ms:T,completedStreets:completed,preflopHandMismatch:mismatch,textureMatches,turnMatches,riverMatches,actionContext:best.sig}};
  }catch(e){ return refuse('REFUSED_EXCEPTION',String(e&&e.message||e),{stack:String(e&&e.stack||'').split('\n').slice(0,3).join(' | ')}); }
}
root.PostflopBuilderIntegration={version:VERSION,init,generate,pickFlopV2Tuple,makeFlopV2Sampler,verifyAgainstEngine,engineClassification,cardToEngine,cardFromEngine,queryFromTuple,cellToQuery};
})(typeof self!=='undefined'?self:this);
