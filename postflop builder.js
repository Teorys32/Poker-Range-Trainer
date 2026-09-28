/* ============================================================================
 * postflop_builder.js — PROTOTYPE AUTONOME de construction de spots postflop pilotée par requête.
 * Aucune dépendance à index.html ni au moteur : le noyau de classification est réimplémenté ici en pur
 * calcul (cartes = rang*4 + couleur ; rang 0..12 = 2..A ; couleur 0..3 = ♠♥♦♣).
 * Source de vérité : contrat_tableau_v2.json (934 tuples faisables, 802 impossibles) + construction_index.json
 * (graines compatibles compilées depuis la même énumération exhaustive). Le flop vient du contrat v1.
 *
 * API : create({contract,index,contractV1}) -> { validate, plan, construct, verify, build }
 *   validate(query) -> { status: OK | UNSATISFIABLE | UNRESOLVED | INVALID_QUERY, violations, unresolved, errors }
 *   plan(query)     -> { status, options:[{joint, derived}], ... }
 *   construct(plan, rng) -> { status, spot, stats }
 *   verify(spot, query)  -> { ok, mismatches, computed }
 * Construction : requête -> cellule(s) cible(s) -> transition (événements, rôle, historique) -> contraintes sur
 * la dernière carte -> cartes compatibles -> spot. Le hasard ne choisit QUE parmi des cartes dont la
 * compatibilité vient d'être calculée exactement. Aucun spot entier n'est tiré puis rejeté.
 * ========================================================================== */
(function(root, factory){ if(typeof module==='object' && module.exports) module.exports = factory(); else root.PostflopBuilder = factory(); })(typeof self!=='undefined'?self:this, function(){
'use strict';
const RANKS='23456789TJQKA', SUITS=['♠','♥','♦','♣'];
const CATN=['AIR','OVERCARDS','PAIR','TWO_PAIR','TRIPS','STRAIGHT','FLUSH','FULL_HOUSE','QUADS'];
const CELL_NAMES=['AIR','OVERCARDS','PAIR/OVERPAIR','PAIR/UNDERPAIR','PAIR/TOP_PAIR','PAIR/SECOND_PAIR','PAIR/MIDDLE_PAIR','PAIR/BOTTOM_PAIR','PAIR/BOARD_PAIR',
 'TWO_PAIR/HERO_BOTH','TWO_PAIR/BOARD_PAIR/OVER','TWO_PAIR/BOARD_PAIR/UNDER','TWO_PAIR/BOARD_PAIR/TOP','TWO_PAIR/BOARD_PAIR/SECOND','TWO_PAIR/BOARD_TWO_PAIR',
 'TRIPS/SET','TRIPS/TRIPS','TRIPS/BOARD_TRIPS','STRAIGHT/H','STRAIGHT/B','FLUSH/H','FLUSH/H/SF','FLUSH/B','FLUSH/B/SF','FULL_HOUSE/H','FULL_HOUSE/B','QUADS/H','QUADS/B'];
const CELL_ID={}; CELL_NAMES.forEach((n,i)=>CELL_ID[n]=i);
const CELL_CATRANK=[1,2,3,3,3,3,3,3,3, 4,4,4,4,4,4, 5,5,5, 6,6, 7,7,7,7, 8,8, 9,9];
const HEV=['IMPROVES','DRAW_GAINED','DRAW_MISSES','NONE'];
const LIVE=['NONE','FLUSH','STRAIGHT','COMBO'];
const BEV=['FLUSH_CARD','STRAIGHT_CARD','FLUSH_DRAW_BOARD','OVERCARD','BLANK'];
const TAGSETS=['NEUTRAL','HERO_MATCH','BOARD_MATCH','COMPLETES_HAND','HERO_MATCH+COMPLETES_HAND','BOARD_MATCH+COMPLETES_HAND'];
const TAGBITS=[0,1,2,4,5,6], TAGIDX={0:0,1:1,2:2,4:3,5:4,6:5};
const TAGS=['HERO_MATCH','BOARD_MATCH','COMPLETES_HAND','NEUTRAL'];
const NCELL=28;
const cellCat = n => n.split('/')[0];
const cellHeroPart = n => !(n==='AIR'||n==='OVERCARDS'||n==='PAIR/BOARD_PAIR'||n==='TWO_PAIR/BOARD_TWO_PAIR'||n==='TRIPS/BOARD_TRIPS'||/\/B(\/SF)?$/.test(n));
const cardStr = c => RANKS[c>>2]+SUITS[c&3];
const parseCard = s => { const r=RANKS.indexOf(s[0]), su=SUITS.indexOf(s.slice(1)); if(r<0||su<0) throw new Error('carte invalide: '+s); return r*4+su; };
// ---------------------------------------------------------------- RNG reproductible
function hashSeed(str){ let h=2166136261>>>0; str=String(str); for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h>>>0; }
function makeRng(seed){ let a=(typeof seed==='number'?seed:hashSeed(seed))>>>0; const next=()=>{ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
  return { next, int:n=>Math.floor(next()*n), pick:arr=>arr[Math.floor(next()*arr.length)], shuffle:arr=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(next()*(i+1)); const t=arr[i]; arr[i]=arr[j]; arr[j]=t; } return arr; } }; }
// ---------------------------------------------------------------- noyau de classification (pur calcul)
const POP=new Uint8Array(8192); for(let m=1;m<8192;m++) POP[m]=POP[m>>1]+(m&1);
const STRV=new Uint8Array(8192);
{ const bitOf=v=>v===1?12:v-2; for(let m=0;m<8192;m++){ let hv=0; for(let hi=14;hi>=5;hi--){ let ok=true; for(let k=0;k<5;k++){ if(!(m&(1<<bitOf(hi-k)))){ok=false;break;} } if(ok){hv=hi;break;} } STRV[m]=hv; } }
const top5=m=>{ let c=0,o=0; for(let b=12;b>=0&&c<5;b--){ if(m&(1<<b)){ o|=1<<b; c++; } } return o; };
function straightHeavy(mask){ const nums=[]; for(let r=0;r<13;r++) if(mask&(1<<r)) nums.push(r+2); for(let i=0;i+2<nums.length;i++) if(nums[i+2]-nums[i]<=4) return true; return false; }
function longestRun(mask){ let best=0,cur=0,prev=-9; for(let r=0;r<13;r++){ if(mask&(1<<r)){ cur=(r===prev+1)?cur+1:1; if(cur>best) best=cur; prev=r; } } return best; }
// « la nouvelle carte crée une évolution significative de la texture quinte du board » (sans couleurs)
function straightFlagPure(mask, rn){ const m2=mask|(1<<rn); const mb=STRV[mask]>0, ma=STRV[m2]>0, hb=straightHeavy(mask), ha=straightHeavy(m2);
  return (ma&&!mb) || (ha&&!hb) || (longestRun(m2)>longestRun(mask) && hb); }
const SFT=new Uint8Array(8192*13);
for(let m=1;m<8192;m++){ if(POP[m]>4) continue; for(let rn=0;rn<13;rn++) SFT[m*13+rn]=straightFlagPure(m,rn)?1:0; }
function comboOf(cards,n,rc,sm,res){
  rc.fill(0); sm[0]=0; sm[1]=0; sm[2]=0; sm[3]=0; let rmask=0;
  for(let i=0;i<n;i++){ const c=cards[i], r=c>>2, s=c&3; rc[r]++; sm[s]|=(1<<r); rmask|=(1<<r); }
  res[3]=rmask;
  let fs=-1; for(let s=0;s<4;s++) if(POP[sm[s]]>=5) fs=s;
  if(fs>=0){ const sf=STRV[sm[fs]]; if(sf){ res[0]=8; res[1]=sf; res[2]=0; return; } }
  let q=-1,t=-1; for(let r=12;r>=0;r--){ const c=rc[r]; if(c>=4&&q<0) q=r; if(c>=3&&t<0) t=r; }
  if(q>=0){ res[0]=7; res[1]=q; res[2]=0; return; }
  if(t>=0){ let p=-1; for(let r=12;r>=0;r--){ if(r!==t&&rc[r]>=2){ p=r; break; } } if(p>=0){ res[0]=6; res[1]=t; res[2]=p; return; } }
  if(fs>=0){ res[0]=5; res[1]=top5(sm[fs]); res[2]=0; return; }
  const sh=STRV[rmask]; if(sh){ res[0]=4; res[1]=sh; res[2]=0; return; }
  if(t>=0){ res[0]=3; res[1]=t; res[2]=0; return; }
  let pa=-1,pb=-1; for(let r=12;r>=0;r--){ if(rc[r]>=2){ if(pa<0) pa=r; else { pb=r; break; } } }
  if(pb>=0){ res[0]=2; res[1]=pa; res[2]=pb; return; }
  if(pa>=0){ res[0]=1; res[1]=pa; res[2]=0; return; }
  res[0]=0; res[1]=0; res[2]=0;
}
const rcA=new Int8Array(13), smA=new Int16Array(4), rcB=new Int8Array(13), smB=new Int16Array(4), resA=new Int32Array(4), resB=new Int32Array(4);
const INT2RANK=[1,3,4,5,6,7,8,9,7];
let oPart=0,oCatRank=0,oCatInt=0;
function cellOf(hr0,hr1,bmax,rmBoard){
  const cat=resA[0], d1=resA[1], d2=resA[2]; oCatInt=cat;
  oPart=(cat>0&&(cat!==resB[0]||d1!==resB[1]||d2!==resB[2]))?1:0;
  if(cat===0){ const oc=(bmax>=0&&hr0>bmax&&hr1>bmax); oCatRank=oc?2:1; oPart=0; return oc?1:0; }
  oCatRank=INT2RANK[cat];
  switch(cat){
    case 1:{ const pr=d1; if(hr0!==pr&&hr1!==pr) return 8; if(hr0===hr1) return pr>bmax?2:3; const above=POP[rmBoard>>(pr+1)], below=POP[rmBoard&((1<<pr)-1)]; return above===0?4:(below===0?7:(above===1?5:6)); }
    case 2:{ const in1=(hr0===d1||hr1===d1), in2=(hr0===d2||hr1===d2); if(in1&&in2) return 9; if(!(in1||in2)) return 14; if(hr0===hr1) return hr0>bmax?10:11; let mx=-1; if(hr0===d1||hr0===d2) mx=hr0; if((hr1===d1||hr1===d2)&&hr1>mx) mx=hr1; return mx===bmax?12:13; }
    case 3:{ const k=(hr0===d1?1:0)+(hr1===d1?1:0); return k>=2?15:(k===1?16:17); }
    case 4: return oPart?18:19; case 5: return oPart?20:22; case 8: return oPart?21:23; case 6: return oPart?24:25; default: return oPart?26:27;
  }
}
function liveFast(hs0,hs1,hr0,hr1,rmaskBoard){
  const rmAll=resA[3]; let hasFlush=false, flushDraw=false;
  for(let s=0;s<4;s++){ const p=POP[smA[s]]; if(p>=5) hasFlush=true; else if(p===4&&(hs0===s||hs1===s)) flushDraw=true; }
  const hasStraight=STRV[rmAll]>0; let straightDraw=false;
  if(!hasStraight){ for(let r=0;r<13;r++){ if(rcA[r]<4 && STRV[rmAll|(1<<r)]>STRV[rmaskBoard|(1<<r)]){ straightDraw=true; break; } } }
  if(!flushDraw&&!straightDraw) return 0;
  let ge4=false,ge3=false,n2=0; for(let r=0;r<13;r++){ const c=rcA[r]; if(c>=4) ge4=true; if(c>=3) ge3=true; if(c>=2) n2++; }
  const fq=(ge4||(ge3&&n2>=2)) && (rcA[hr0]>=2||rcA[hr1]>=2);
  const ge8=fq||hasFlush, ge7=ge8||hasStraight;
  if(flushDraw&&straightDraw) return ge7?0:3; if(flushDraw) return ge8?0:1; return ge7?0:2;
}
const bc=new Int8Array(7), ac=new Int8Array(7), bCnt=new Int8Array(13), bSuit=new Int8Array(4);
let H0=0,H1=0,HR0=0,HR1=0,HS0=0,HS1=0,NB=0,bCell=0,bCatRank=0,bLive=0,bRmask=0,bMax=-1;
function prepBefore(h0,h1,board,nb){
  H0=h0;H1=h1;HR0=h0>>2;HR1=h1>>2;HS0=h0&3;HS1=h1&3;NB=nb;
  for(let i=0;i<nb;i++) bc[i]=board[i];
  bCnt.fill(0); bSuit.fill(0); let rm=0,mx=-1;
  for(let i=0;i<nb;i++){ const r=board[i]>>2; bCnt[r]++; bSuit[board[i]&3]++; rm|=(1<<r); if(r>mx) mx=r; }
  bRmask=rm; bMax=mx;
  comboOf(bc,nb,rcB,smB,resB); ac[0]=h0; ac[1]=h1; for(let i=0;i<nb;i++) ac[2+i]=board[i]; comboOf(ac,nb+2,rcA,smA,resA);
  bCell=cellOf(HR0,HR1,mx,rm); bCatRank=oCatRank; bLive=nb<=4?liveFast(HS0,HS1,HR0,HR1,rm):0;
}
let xCell=0,xLive=0,xBev=0,xPairs=0,xHev=0,xTag=0;
function evalAfter(newCard){
  const rn=newCard>>2, sn=newCard&3, nb=NB, turn=(nb===3);
  const suitBefore=bSuit[sn], pairs=bCnt[rn]>0?1:0;
  let bev; if(suitBefore>=2) bev=0; else if(SFT[bRmask*13+rn]===1) bev=1; else if(turn&&suitBefore===1) bev=2; else if(rn>bMax) bev=3; else bev=4;
  bc[nb]=newCard; ac[2+nb]=newCard; comboOf(bc,nb+1,rcB,smB,resB); comboOf(ac,nb+3,rcA,smA,resA);
  const mxA=rn>bMax?rn:bMax, rmA=bRmask|(1<<rn);
  const cell=cellOf(HR0,HR1,mxA,rmA); const catRank=oCatRank, part=oPart, catInt=oCatInt;
  let live=0; if(turn) live=liveFast(HS0,HS1,HR0,HR1,rmA);
  const improves=(catRank>bCatRank&&part===1); let hev;
  if(improves) hev=0; else if(turn&&bLive===0&&live!==0) hev=1; else if(bLive!==0) hev=2; else hev=3;
  const mH=(rn===HR0||rn===HR1), mB=(!mH&&bCnt[rn]>0);
  const comp=(part===1&&catRank>bCatRank&&(catInt===4||catInt===5||catInt===8));
  const tag=TAGIDX[(mH?1:0)|(mB?2:0)|(comp?4:0)];
  xCell=cell;xLive=live;xBev=bev;xPairs=pairs;xHev=hev;xTag=tag;
  return ((((((turn?0:1)*NCELL+cell)*4+hev)*4+live)*5+bev)*2+pairs)*6+tag;
}
// ---------------------------------------------------------------- évaluation d'un état / d'une transition (noms lisibles)
function checkCards(cards){ const seen=new Set(); for(const c of cards){ if(!(c>=0&&c<52&&Number.isInteger(c))) return 'carte hors domaine: '+c; if(seen.has(c)) return 'carte dupliquée: '+cardStr(c); seen.add(c); } return null; }
function evalFlop(hole,flop){ prepBefore(hole[0],hole[1],flop,3); return {cell:CELL_NAMES[bCell],cellId:bCell,live:LIVE[bLive],liveId:bLive,catRank:bCatRank}; }
function evalTransition(hole,before,card){
  prepBefore(hole[0],hole[1],before,before.length); const prevCell=bCell, prevCat=bCatRank, prevLive=bLive;
  const key=evalAfter(card);
  return {key, street:before.length===3?'TURN':'RIVER', cell:CELL_NAMES[xCell], cellId:xCell, heroEvent:HEV[xHev], liveDraw:LIVE[xLive], boardEvent:BEV[xBev], pairs:xPairs, lastCardRole:TAGSETS[xTag],
    prevCategory:CATN[prevCat-1], drawBefore:LIVE[prevLive], prevCell:CELL_NAMES[prevCell], joint:key*36+(prevCat-1)*4+prevLive}; }
function computeSpot(spot){
    const cs=spot.cards||{hole:spot.hole.map(parseCard),flop:spot.flop.map(parseCard),turn:spot.turn?parseCard(spot.turn):null,river:spot.river?parseCard(spot.river):null};
    const all=[...cs.hole,...cs.flop]; if(cs.turn!==null&&cs.turn!==undefined) all.push(cs.turn); if(cs.river!==null&&cs.river!==undefined) all.push(cs.river);
    const S=spot.street; const expect=S==='FLOP'?5:S==='TURN'?6:7; const err=all.length!==expect?('nombre de cartes '+all.length+' au lieu de '+expect+' pour '+S):checkCards(all);
    if(err) return {error:err};
    if(S==='FLOP'){ const f=evalFlop(cs.hole,cs.flop); return {street:S,cell:f.cell,liveDraw:f.live,tuple:'FLOP|'+f.cell+'|'+f.live,joint:f.cellId*4+f.liveId}; }
    const before=S==='TURN'?cs.flop.slice():[...cs.flop,cs.turn]; const card=S==='TURN'?cs.turn:cs.river;
    const t=evalTransition(cs.hole,before,card); t.tuple=[S,t.cell,t.heroEvent,t.liveDraw,t.boardEvent,t.pairs].join('|'); return t; }
// ---------------------------------------------------------------- catalogue de règles nommées (explications lisibles)
const cellsAll=(p,fn)=>Array.isArray(p.cells)&&p.cells.length>0&&p.cells.every(fn);
const RULES=[
 ['RS2','À la river, aucun tirage ne peut rester vivant (liveDraw = NONE)',(s,p)=>s==='RIVER'&&p.live!==undefined&&p.live!=='NONE'],
 ['RS3','FLUSH_DRAW_BOARD n\'existe qu\'au turn',(s,p)=>p.bev==='FLUSH_DRAW_BOARD'&&s!=='TURN'],
 ['RS4','DRAW_GAINED n\'existe qu\'au turn',(s,p)=>p.hev==='DRAW_GAINED'&&s!=='TURN'],
 ['RH1','IMPROVES exige une cellule où Hero participe, de catégorie ≥ PAIR, hors OVERPAIR/UNDERPAIR',(s,p)=>p.hev==='IMPROVES'&&cellsAll(p,c=>!cellHeroPart(c)||CELL_CATRANK[CELL_ID[c]]<3||c==='PAIR/OVERPAIR'||c==='PAIR/UNDERPAIR')],
 ['RH2','DRAW_GAINED exige un tirage vivant après la carte',(s,p)=>p.hev==='DRAW_GAINED'&&p.live==='NONE'],
 ['RH2b','DRAW_GAINED exige l\'absence de tirage avant la carte (drawBefore = NONE)',(s,p)=>p.hev==='DRAW_GAINED'&&p.prevLive!==undefined&&p.prevLive!=='NONE'],
 ['RH3','Au turn, heroEvent NONE implique aucun tirage après la carte',(s,p)=>s==='TURN'&&p.hev==='NONE'&&p.live!==undefined&&p.live!=='NONE'],
 ['RH3b','heroEvent NONE implique aucun tirage avant la carte',(s,p)=>p.hev==='NONE'&&p.prevLive!==undefined&&p.prevLive!=='NONE'],
 ['RH4','DRAW_MISSES exige un tirage vivant avant la carte (drawBefore ≠ NONE)',(s,p)=>p.hev==='DRAW_MISSES'&&p.prevLive==='NONE'],
 ['RH6','DRAW_MISSES avec participation de Hero exige une catégorie ≤ STRAIGHT',(s,p)=>p.hev==='DRAW_MISSES'&&cellsAll(p,c=>cellHeroPart(c)&&CELL_CATRANK[CELL_ID[c]]>=7)],
 ['RL1','Un tirage couleur ou combo exige une catégorie ≤ STRAIGHT',(s,p)=>(p.live==='FLUSH'||p.live==='COMBO')&&cellsAll(p,c=>CELL_CATRANK[CELL_ID[c]]>=7)],
 ['RL2','Un tirage quinte ou combo exige une catégorie ≤ TRIPS',(s,p)=>(p.live==='STRAIGHT'||p.live==='COMBO')&&cellsAll(p,c=>CELL_CATRANK[CELL_ID[c]]>=6)],
 ['RL3','Au flop, TWO_PAIR et TRIPS n\'ont aucun tirage (5 cartes)',(s,p)=>s==='FLOP'&&p.live!==undefined&&p.live!=='NONE'&&cellsAll(p,c=>cellCat(c)==='TWO_PAIR'||cellCat(c)==='TRIPS')],
 ['RB1','pairs = 1 est incompatible avec STRAIGHT_CARD et OVERCARD',(s,p)=>p.pairs===1&&(p.bev==='STRAIGHT_CARD'||p.bev==='OVERCARD')],
 ['RB4','Au turn, une cellule FLUSH est incompatible avec FLUSH_DRAW_BOARD',(s,p)=>s==='TURN'&&p.bev==='FLUSH_DRAW_BOARD'&&cellsAll(p,c=>cellCat(c)==='FLUSH')],
 ['RB6','pairs = 1 implique au moins une double paire chez Hero qui participe ou un board apparié : AIR, OVERCARDS et paires de Hero sont exclus',(s,p)=>p.pairs===1&&cellsAll(p,c=>c==='AIR'||c==='OVERCARDS'||(cellCat(c)==='PAIR'&&c!=='PAIR/BOARD_PAIR'))],
 ['RC7','IMPROVES vers FLUSH exige boardEvent = FLUSH_CARD',(s,p)=>p.hev==='IMPROVES'&&p.bev!==undefined&&p.bev!=='FLUSH_CARD'&&cellsAll(p,c=>c==='FLUSH/H'||c==='FLUSH/H/SF')],
 ['RR1','COMPLETES_HAND implique heroEvent = IMPROVES',(s,p)=>p.role&&p.role.includes('COMPLETES_HAND')&&p.hev!==undefined&&p.hev!=='IMPROVES'],
 ['RR2','IMPROVES exclut le rôle NEUTRAL',(s,p)=>p.hev==='IMPROVES'&&p.role&&p.role.length===1&&p.role[0]==='NEUTRAL'],
 ['RR3','Le rôle NEUTRAL exclut pairs = 1',(s,p)=>p.pairs===1&&p.role&&p.role.length===1&&p.role[0]==='NEUTRAL'],
 ['RR4','BOARD_MATCH implique pairs = 1',(s,p)=>p.pairs===0&&p.role&&p.role.includes('BOARD_MATCH')],
 ['RR5','Au turn, HERO_MATCH + COMPLETES_HAND exclut pairs = 1',(s,p)=>s==='TURN'&&p.pairs===1&&p.role&&p.role.includes('HERO_MATCH')&&p.role.includes('COMPLETES_HAND')],
];
const DIM_LABEL={cells:'cell',hev:'heroEvent',live:'liveDraw',bev:'boardEvent',pairs:'pairs',role:'lastCardRole',prevCat:'prevCategory',prevLive:'drawBefore'};
// ---------------------------------------------------------------- module
function create(opts){
  const C=opts.contract, IDX=opts.index, C1=opts.contractV1||null;
  const cfg=Object.assign({sweeps:2},opts.config||{});
  // ---- enregistrements faisables (joint = tuple+rôle+historique), depuis l'index compilé
  const recs={TURN:[],RIVER:[],FLOP:[]}; const seedsByJoint=new Map(); const jointKeyToRec=new Map();
  for(const jk of Object.keys(IDX.joint)){
    const [S,cell,hev,live,bev,pairs,tags,pc,pl]=jk.split('|'); const st=S==='TURN'?0:1;
    const key=((((((st*NCELL+CELL_ID[cell])*4+HEV.indexOf(hev))*4+LIVE.indexOf(live))*5+BEV.indexOf(bev))*2+Number(pairs))*6+TAGSETS.indexOf(tags));
    const joint=key*36+CATN.indexOf(pc)*4+LIVE.indexOf(pl);
    const rec={street:S,cell,cellId:CELL_ID[cell],hev,live,bev,pairs:Number(pairs),tags,tagIdx:TAGSETS.indexOf(tags),prevCat:pc,prevLive:pl,joint,jointKey:jk,base:[S,cell,hev,live,bev,pairs].join('|')};
    recs[S].push(rec); seedsByJoint.set(joint,IDX.joint[jk]); jointKeyToRec.set(joint,rec);
  }
  const flopSeeds=new Map();
  for(const fk of Object.keys(IDX.flop)){ const [S,cell,live]=fk.split('|'); const joint=CELL_ID[cell]*4+LIVE.indexOf(live);
    const rec={street:'FLOP',cell,cellId:CELL_ID[cell],live,joint,jointKey:fk,base:fk}; recs.FLOP.push(rec); flopSeeds.set(joint,IDX.flop[fk]); jointKeyToRec.set('F'+joint,rec); }
  // ---- cohérence index <-> contrat v2 (source de vérité)
  const contractBase=new Map(); let nTuples=0;
  for(const S of ['TURN','RIVER']) for(const e of C.feasibleTuples[S]){ contractBase.set([S,e.cell,e.heroEvent,e.liveDraw,e.boardEvent,e.pairs].join('|'),e); nTuples++; }
  const idxBase=new Map(); for(const S of ['TURN','RIVER']) for(const r of recs[S]){ if(!idxBase.has(r.base)) idxBase.set(r.base,{roles:new Set(),prevCat:new Set(),prevLive:new Set()}); const o=idxBase.get(r.base); o.roles.add(r.tags); o.prevCat.add(r.prevCat); o.prevLive.add(r.prevLive); }
  const mism=[];
  if(idxBase.size!==contractBase.size) mism.push('nombre de tuples: index '+idxBase.size+' / contrat '+contractBase.size);
  for(const [b,e] of contractBase){ const o=idxBase.get(b); if(!o){ mism.push('tuple absent de l\'index: '+b); continue; }
    const cr=Object.keys(e.roles).sort().join(','), ir=[...o.roles].sort().join(','); if(cr!==ir) mism.push('rôles différents: '+b);
    if([...e.prevCategory].sort().join()!==[...o.prevCat].sort().join()) mism.push('prevCategory différent: '+b);
    if([...e.drawBefore].sort().join()!==[...o.prevLive].sort().join()) mism.push('drawBefore différent: '+b); }
  if(C1){ const fl=new Set(); for(const c of Object.values(C1.cells)) if(c.street==='FLOP') for(const l of Object.keys(c.support.liveDraw)) fl.add(c.cell+'|'+l);
    const ix=new Set(recs.FLOP.map(r=>r.cell+'|'+r.live)); if(fl.size!==ix.size||[...fl].some(x=>!ix.has(x))) mism.push('flop: index différent du contrat v1'); }
  for(const S of ['TURN','RIVER']) for(const r of recs[S]) if(!seedsByJoint.get(r.joint)||seedsByJoint.get(r.joint).length===0) mism.push('aucune graine: '+r.jointKey);
  if(mism.length) throw new Error('INDEX_CONTRACT_MISMATCH: '+mism.slice(0,5).join(' ; '));
  const impossibleByTuple=new Map(); for(const t of C.impossibleTuples) impossibleByTuple.set([t.street,t.cell,t.heroEvent,t.liveDraw,t.boardEvent,t.pairs].join('|'),t);
  const stats={feasibleTuples:nTuples,jointTuples:recs.TURN.length+recs.RIVER.length,flopTuples:recs.FLOP.length,impossibleTuples:C.impossibleTuples.length};
  // ---- normalisation de la requête
  const KNOWN=['street','category','meta','participation','cell','heroEvent','liveDraw','boardEvent','pairs','lastCardRole','history','context','seed','count'];
  const LIVE_DETAIL=['FLUSH_DRAW','NUT_FLUSH_DRAW','GUTSHOT','OESD','DOUBLE_GUTSHOT','COMBO_DRAW'];
  function resolveCells(q,errors){
    if(q.cell!==undefined){ if(CELL_ID[q.cell]===undefined){ errors.push({rule:'CELL_UNKNOWN',message:'cellule inconnue: '+q.cell}); return null; } return [q.cell]; }
    const cat=q.category; if(cat===undefined){ errors.push({rule:'CATEGORY_REQUIRED',message:'category (ou cell) est requis'}); return null; }
    if(!CATN.includes(cat)){ errors.push({rule:'CATEGORY_UNKNOWN',message:'catégorie inconnue: '+cat}); return null; }
    const m=q.meta||{}, part=q.participation; const partVal=(part===true||part==='H')?true:(part===false||part==='B')?false:undefined;
    const bad=(rule,message)=>{ errors.push({rule,message}); return null; };
    if(cat==='AIR'||cat==='OVERCARDS'){ if(partVal===true) return bad('PARTICIPATION_INCONSISTENT',cat+' : Hero ne participe jamais'); if(Object.keys(m).length) return bad('META_NOT_APPLICABLE',cat+' n\'a pas de méta'); return [cat]; }
    if(cat==='PAIR'){ const PT=['OVERPAIR','UNDERPAIR','TOP_PAIR','SECOND_PAIR','MIDDLE_PAIR','BOTTOM_PAIR','BOARD_PAIR']; if(!m.pairType) return bad('META_REQUIRED','PAIR exige meta.pairType'); if(!PT.includes(m.pairType)) return bad('META_UNKNOWN','pairType inconnu: '+m.pairType);
      if(partVal!==undefined&&partVal!==(m.pairType!=='BOARD_PAIR')) return bad('PARTICIPATION_INCONSISTENT','participation incohérente avec pairType '+m.pairType); return ['PAIR/'+m.pairType]; }
    if(cat==='TWO_PAIR'){ const TT=['HERO_BOTH','BOARD_PAIR','BOARD_TWO_PAIR']; if(!m.twoPairType) return bad('META_REQUIRED','TWO_PAIR exige meta.twoPairType'); if(!TT.includes(m.twoPairType)) return bad('META_UNKNOWN','twoPairType inconnu: '+m.twoPairType);
      if(partVal!==undefined&&partVal!==(m.twoPairType!=='BOARD_TWO_PAIR')) return bad('PARTICIPATION_INCONSISTENT','participation incohérente avec twoPairType '+m.twoPairType);
      if(m.twoPairType==='BOARD_PAIR'){ if(!['OVER','UNDER','TOP','SECOND'].includes(m.twoPairBoardTag)) return bad('META_REQUIRED','BOARD_PAIR exige meta.twoPairBoardTag ∈ OVER, UNDER, TOP, SECOND'); return ['TWO_PAIR/BOARD_PAIR/'+m.twoPairBoardTag]; }
      if(m.twoPairBoardTag!==undefined) return bad('META_NOT_APPLICABLE','twoPairBoardTag n\'existe que pour BOARD_PAIR'); return ['TWO_PAIR/'+m.twoPairType]; }
    if(cat==='TRIPS'){ const TR=['SET','TRIPS','BOARD_TRIPS']; if(!m.tripsType) return bad('META_REQUIRED','TRIPS exige meta.tripsType'); if(!TR.includes(m.tripsType)) return bad('META_UNKNOWN','tripsType inconnu: '+m.tripsType);
      if(partVal!==undefined&&partVal!==(m.tripsType!=='BOARD_TRIPS')) return bad('PARTICIPATION_INCONSISTENT','participation incohérente avec tripsType '+m.tripsType); return ['TRIPS/'+m.tripsType]; }
    // STRAIGHT, FLUSH, FULL_HOUSE, QUADS : participation indépendante
    if(partVal===undefined) return bad('PARTICIPATION_REQUIRED',cat+' exige participation (true = Hero participe)');
    const p=partVal?'H':'B';
    if(cat==='FLUSH'){ if(m.straightFlush===true) return [partVal?'FLUSH/H/SF':'FLUSH/B/SF']; if(m.straightFlush===false) return ['FLUSH/'+p]; return partVal?['FLUSH/H','FLUSH/H/SF']:['FLUSH/B','FLUSH/B/SF']; }
    if(m.straightFlush!==undefined) return bad('META_NOT_APPLICABLE','straightFlush ne s\'applique qu\'à FLUSH');
    if(Object.keys(m).length) return bad('META_NOT_APPLICABLE',cat+' n\'a pas de méta'); return [cat+'/'+p];
  }
  function normalize(query){
    const errors=[], unresolved=[]; const q=query||{}; const spec={};
    for(const k of Object.keys(q)) if(!KNOWN.includes(k)) errors.push({rule:'UNKNOWN_FIELD',message:'champ inconnu: '+k});
    if(!['FLOP','TURN','RIVER'].includes(q.street)){ errors.push({rule:'STREET_REQUIRED',message:'street ∈ FLOP, TURN, RIVER est requis'}); return {errors,unresolved,spec:null}; }
    spec.street=q.street; spec.cells=resolveCells(q,errors);
    if(q.heroEvent!==undefined){ if(!HEV.includes(q.heroEvent)) errors.push({rule:'VALUE_UNKNOWN',message:'heroEvent inconnu: '+q.heroEvent}); else spec.hev=q.heroEvent; }
    if(q.liveDraw!==undefined){ if(LIVE_DETAIL.includes(q.liveDraw)) unresolved.push({rule:'LIVEDRAW_DETAIL_NOT_SUPPORTED',message:'liveDraw détaillé ('+q.liveDraw+') : le contrat v2 est au niveau des 4 classes NONE/FLUSH/STRAIGHT/COMBO'});
      else if(!LIVE.includes(q.liveDraw)) errors.push({rule:'VALUE_UNKNOWN',message:'liveDraw inconnu: '+q.liveDraw}); else spec.live=q.liveDraw; }
    if(q.boardEvent!==undefined){ if(!BEV.includes(q.boardEvent)) errors.push({rule:'VALUE_UNKNOWN',message:'boardEvent inconnu: '+q.boardEvent}); else spec.bev=q.boardEvent; }
    if(q.pairs!==undefined){ if(q.pairs===true||q.pairs===1) spec.pairs=1; else if(q.pairs===false||q.pairs===0) spec.pairs=0; else errors.push({rule:'VALUE_UNKNOWN',message:'pairs doit être booléen ou 0/1'}); }
    if(q.lastCardRole!==undefined){ let tags=Array.isArray(q.lastCardRole)?q.lastCardRole.slice():String(q.lastCardRole).split('+'); tags=[...new Set(tags)];
      if(!tags.every(t=>TAGS.includes(t))) errors.push({rule:'VALUE_UNKNOWN',message:'lastCardRole inconnu: '+tags.join('+')});
      else if(tags.includes('NEUTRAL')&&tags.length>1) errors.push({rule:'RR0',message:'NEUTRAL (ensemble vide) ne se combine avec aucun autre tag'});
      else if(tags.includes('HERO_MATCH')&&tags.includes('BOARD_MATCH')) errors.push({rule:'RR0b',message:'HERO_MATCH et BOARD_MATCH sont exclusifs par définition'});
      else spec.role=tags; }
    if(q.history!==undefined){ const h=q.history||{}; for(const k of Object.keys(h)) if(!['prevCategory','drawBefore','flopTexture'].includes(k)) errors.push({rule:'UNKNOWN_FIELD',message:'champ inconnu: history.'+k});
      if(h.prevCategory!==undefined){ if(!CATN.includes(h.prevCategory)) errors.push({rule:'VALUE_UNKNOWN',message:'prevCategory inconnu: '+h.prevCategory}); else spec.prevCat=h.prevCategory; }
      if(h.drawBefore!==undefined){ if(!LIVE.includes(h.drawBefore)) errors.push({rule:'VALUE_UNKNOWN',message:'drawBefore inconnu: '+h.drawBefore}); else spec.prevLive=h.drawBefore; }
      if(h.flopTexture!==undefined) unresolved.push({rule:'FLOP_TEXTURE_NOT_SUPPORTED',message:'history.flopTexture : dimension non prise en charge par ce prototype'}); }
    if(q.context!==undefined&&q.context!==null&&!(typeof q.context==='object'&&Object.keys(q.context).length===0)) unresolved.push({rule:'CONTEXT_NOT_SUPPORTED',message:'context (position, pot, stack, SPR, actions, sizing, multiway) : dimension non prise en charge par ce prototype'});
    return {errors,unresolved,spec};
  }
  const roleOk=(tagset,req)=>req===undefined||(req.length===1&&req[0]==='NEUTRAL'?tagset==='NEUTRAL':req.every(t=>tagset.split('+').includes(t)));
  function matches(street,spec){
    const out=[]; for(const r of recs[street]){
      if(spec.cells&&!spec.cells.includes(r.cell)) continue;
      if(street==='FLOP'){ if(spec.live!==undefined&&spec.live!==r.live) continue; out.push(r); continue; }
      if(spec.hev!==undefined&&spec.hev!==r.hev) continue; if(spec.live!==undefined&&spec.live!==r.live) continue;
      if(spec.bev!==undefined&&spec.bev!==r.bev) continue; if(spec.pairs!==undefined&&spec.pairs!==r.pairs) continue;
      if(!roleOk(r.tags,spec.role)) continue; if(spec.prevCat!==undefined&&spec.prevCat!==r.prevCat) continue; if(spec.prevLive!==undefined&&spec.prevLive!==r.prevLive) continue;
      out.push(r); }
    return out; }
  function specDims(spec){ const d=[]; if(spec.cells) d.push('cells'); if(spec.hev!==undefined) d.push('hev'); if(spec.live!==undefined) d.push('live'); if(spec.bev!==undefined) d.push('bev'); if(spec.pairs!==undefined) d.push('pairs');
    if(spec.role!==undefined) d.push('role'); if(spec.prevCat!==undefined) d.push('prevCat'); if(spec.prevLive!==undefined) d.push('prevLive'); return d; }
  function restrict(spec,dims){ const s={street:spec.street}; for(const d of dims) s[d]=spec[d]; return s; }
  function explain(spec){
    const dims=specDims(spec); const n=dims.length; const minimal=[];
    const subsets=[]; for(let m=1;m<(1<<n);m++){ const sub=[]; for(let i=0;i<n;i++) if(m&(1<<i)) sub.push(dims[i]); subsets.push(sub); }
    subsets.sort((a,b)=>a.length-b.length);
    for(const sub of subsets){ if(minimal.some(mm=>mm.every(d=>sub.includes(d)))) continue; if(matches(spec.street,restrict(spec,sub)).length===0) minimal.push(sub); }
    return minimal.slice(0,8).map(sub=>{ const p={}; for(const d of sub) p[d]=spec[d]; const pat={}; for(const d of sub) pat[DIM_LABEL[d]]=(d==='cells'&&Array.isArray(spec.cells)&&spec.cells.length===1)?spec.cells[0]:spec[d];
      const rule=RULES.find(r=>{ try{ return r[2](spec.street,p); }catch(e){ return false; } });
      return {rule:rule?rule[0]:'CONTRACT_FORBIDDEN_PATTERN',message:rule?rule[1]:'aucun état de l\'espace exhaustif ne satisfait ce motif (contrat v2)',pattern:pat,source:rule?'HARD_RULE':'CONTRACT_PATTERN'}; }); }
  // ---------------------------------------------------------------- validate
  function validate(query){
    const {errors,unresolved,spec}=normalize(query);
    if(errors.length) return {status:'INVALID_QUERY',violations:[],unresolved,errors};
    const violations=[]; const S=spec.street;
    if(S==='FLOP'){ for(const [f,label] of [['hev','heroEvent'],['bev','boardEvent'],['pairs','pairs'],['role','lastCardRole'],['prevCat','history.prevCategory'],['prevLive','history.drawBefore']]) if(spec[f]!==undefined) violations.push({rule:'RS1',message:label+' n\'existe pas au FLOP (aucune transition)',pattern:{[label]:spec[f]},source:'HARD_RULE'}); }
    if(!violations.length){
      const m=matches(S,spec);
      if(m.length===0){ const ex=explain(spec); violations.push(...(ex.length?ex:[{rule:'CONTRACT_FORBIDDEN_PATTERN',message:'aucun tuple faisable ne correspond',pattern:{},source:'CONTRACT_PATTERN'}]));
        if(S!=='FLOP'&&spec.cells&&spec.cells.length===1&&spec.hev!==undefined&&spec.live!==undefined&&spec.bev!==undefined&&spec.pairs!==undefined){ const k=[S,spec.cells[0],spec.hev,spec.live,spec.bev,spec.pairs].join('|'); const t=impossibleByTuple.get(k);
          if(t) violations.unshift({rule:'CONTRACT_IMPOSSIBLE_TUPLE',message:'tuple impossible du catalogue v2 (famille '+t.family+', ordre de règle '+t.ruleOrder+')',pattern:{cell:t.cell,heroEvent:t.heroEvent,liveDraw:t.liveDraw,boardEvent:t.boardEvent,pairs:t.pairs},contractPatterns:t.minimalForbiddenPatterns,source:'CONTRACT_IMPOSSIBLE_TUPLE'}); } } }
    if(violations.length) return {status:'UNSATISFIABLE',violations,unresolved,errors:[],note:unresolved.length?'les dimensions non prises en charge ne peuvent que restreindre davantage : la requête reste impossible':undefined};
    if(unresolved.length) return {status:'UNRESOLVED',violations:[],unresolved,errors:[]};
    return {status:'OK',violations:[],unresolved:[],errors:[],spec};
  }
  // ---------------------------------------------------------------- contraintes dérivées sur la dernière carte
  function deriveLastCard(rec){
    const turn=rec.street==='TURN'; const d={pairs:rec.pairs,bev:rec.bev,turn};
    const has=t=>rec.tags.split('+').includes(t);
    d.rank = has('HERO_MATCH')?'HERO':has('BOARD_MATCH')?'BOARD_ONLY':'NEITHER';       // relation du rang de la carte à Hero / au board
    d.suit = rec.bev==='FLUSH_CARD'?'>=2':rec.bev==='FLUSH_DRAW_BOARD'?'==1':(rec.bev==='STRAIGHT_CARD'?'<=1':(turn?'==0':'<=1'));
    d.straightFlag = rec.bev==='STRAIGHT_CARD'?1:(rec.bev==='FLUSH_CARD'?-1:0);
    d.overcard = rec.bev==='OVERCARD'?1:(rec.bev==='BLANK'?0:-1);
    d.transition={heroEvent:rec.hev,prevCategory:rec.prevCat,drawBefore:rec.prevLive,role:rec.tags};
    return d; }
  function lastCardFeatures(c){ const rn=c>>2, sn=c&3; const mH=(rn===HR0||rn===HR1); return {pairs:bCnt[rn]>0?1:0,mH,mB:(!mH&&bCnt[rn]>0),suit:bSuit[sn],sflag:SFT[bRmask*13+rn],over:rn>bMax?1:0}; }
  function featuresSatisfy(f,d){
    if(f.pairs!==d.pairs) return false;
    if(d.rank==='HERO'){ if(!f.mH) return false; } else if(d.rank==='BOARD_ONLY'){ if(!f.mB) return false; } else { if(f.mH||f.mB) return false; }
    const s=f.suit; if(d.suit==='>=2'){ if(s<2) return false; } else if(d.suit==='==1'){ if(s!==1) return false; } else if(d.suit==='==0'){ if(s!==0) return false; } else if(s>1) return false;
    if(d.straightFlag===1&&f.sflag!==1) return false; if(d.straightFlag===0&&f.sflag===1) return false;
    if(d.overcard===1&&f.over!==1) return false; if(d.overcard===0&&f.over===1) return false;
    return true; }
  // ---------------------------------------------------------------- plan
  function plan(query){
    const v=validate(query); if(v.status!=='OK') return {status:v.status,validation:v};
    const spec=v.spec; const S=spec.street; const options=matches(S,spec).map(r=>({joint:r.joint,jointKey:r.jointKey,tuple:r.base,role:r.tags,prevCategory:r.prevCat,drawBefore:r.prevLive,derived:S==='FLOP'?null:deriveLastCard(r)}));
    const distinctTuples=new Set(options.map(o=>o.tuple)).size;
    return {status:'OK',street:S,spec,options,summary:{options:options.length,distinctTuples,slots:S==='FLOP'?['hole0','hole1','flop0','flop1','flop2']:S==='TURN'?['hole0','hole1','flop0','flop1','flop2','turn']:['hole0','hole1','board0','board1','board2','board3','river'],
      steps:S==='FLOP'?['cellule cible','tirage cible','cartes compatibles']:['cellule cible','transition (événement Hero, rôle, historique)','contraintes sur la dernière carte (rang, couleur, quinte, carte haute)','cartes compatibles','spot']}}; }
  // ---------------------------------------------------------------- construction
  const SUITPERMS=[]; { const p=[0,1,2,3]; const rec=(a,k)=>{ if(k===a.length){ SUITPERMS.push(a.slice()); return; } for(let i=k;i<a.length;i++){ [a[k],a[i]]=[a[i],a[k]]; rec(a,k+1); [a[k],a[i]]=[a[i],a[k]]; } }; rec(p,0); }
  function construct(pl,rng){
    if(!pl||pl.status!=='OK') return {status:pl?pl.status:'INVALID_QUERY',plan:pl};
    const S=pl.street, options=pl.options; const st={localEvaluations:0,prefilterSkipped:0,duplicateSkipped:0,moves:0,identityMoves:0,wholeSpotRejections:0,cardsChanged:0};
    const opt=rng.pick(options); const seeds=S==='FLOP'?flopSeeds.get(opt.joint):seedsByJoint.get(opt.joint);
    if(!seeds||seeds.length===0) return {status:'UNRESOLVED',reason:'NO_SEED_FOR_OPTION',option:opt.jointKey};
    const seed=rng.pick(seeds); const perm=rng.pick(SUITPERMS); const cards=seed.slice(1).map(c=>(c>>2)*4+perm[c&3]); const startCards=cards.slice();
    const nslots=cards.length; const allowed=new Set(options.map(o=>o.joint)); const derivedList=S==='FLOP'?null:(()=>{ const m=new Map(); for(const o of options){ const k=JSON.stringify(o.derived); if(!m.has(k)) m.set(k,o.derived); } return [...m.values()]; })();
    const nbBefore=S==='TURN'?3:4; const bdBuf=new Int8Array(5);
    const jointOfCards=cs=>{ if(S==='FLOP'){ bdBuf[0]=cs[2];bdBuf[1]=cs[3];bdBuf[2]=cs[4]; prepBefore(cs[0],cs[1],bdBuf,3); return bCell*4+bLive; }
      for(let i=0;i<nbBefore;i++) bdBuf[i]=cs[2+i]; prepBefore(cs[0],cs[1],bdBuf,nbBefore); const key=evalAfter(cs[2+nbBefore]); return key*36+(bCatRank-1)*4+bLive; };
    const lastSlot=S==='FLOP'?-1:nslots-1;
    for(let sweep=0;sweep<cfg.sweeps;sweep++){
      const order=rng.shuffle(Array.from({length:nslots},(_,i)=>i));
      for(const slot of order){
        const used=new Set(); for(let i=0;i<nslots;i++) if(i!==slot) used.add(cards[i]);
        const cur=cards[slot]; const compat=[]; st.duplicateSkipped+=used.size;
        if(slot===lastSlot){ for(let i=0;i<nbBefore;i++) bdBuf[i]=cards[2+i]; prepBefore(cards[0],cards[1],bdBuf,nbBefore);
          for(let c=0;c<52;c++){ if(used.has(c)) continue; const f=lastCardFeatures(c); let ok=false; for(const d of derivedList){ if(featuresSatisfy(f,d)){ ok=true; break; } } if(!ok){ st.prefilterSkipped++; continue; }
            st.localEvaluations++; const key=evalAfter(c); const j=key*36+(bCatRank-1)*4+bLive; if(allowed.has(j)) compat.push(c); } }
        else { for(let c=0;c<52;c++){ if(used.has(c)) continue; cards[slot]=c; st.localEvaluations++; const j=jointOfCards(cards); if(allowed.has(j)) compat.push(c); } cards[slot]=cur; }
        st.moves++;
        if(compat.length===0){ // ne doit jamais arriver : la carte actuelle est compatible par construction
          return {status:'UNRESOLVED',reason:'NO_COMPATIBLE_CARD_AT_SLOT',slot,option:opt.jointKey}; }
        const pick=rng.pick(compat); if(pick===cur) st.identityMoves++; cards[slot]=pick; } }
    for(let i=0;i<nslots;i++) if(cards[i]!==startCards[i]) st.cardsChanged++;
    // présentation : ordre des cartes du flop / assignation flop-turn aléatoires (sans effet sur la classification)
    const hole=rng.shuffle([cards[0],cards[1]]); let flop,turn=null,river=null;
    if(S==='FLOP'){ flop=rng.shuffle([cards[2],cards[3],cards[4]]); }
    else if(S==='TURN'){ flop=rng.shuffle([cards[2],cards[3],cards[4]]); turn=cards[5]; }
    else { const b=rng.shuffle([cards[2],cards[3],cards[4],cards[5]]); flop=b.slice(0,3); turn=b[3]; river=cards[6]; }
    const spot={street:S,cards:{hole,flop,turn,river},hole:hole.map(cardStr),flop:flop.map(cardStr),turn:turn===null?null:cardStr(turn),river:river===null?null:cardStr(river)};
    const seedClass=seed[0];
    return {status:'OK',spot,stats:st,provenance:{option:opt.jointKey,optionsConsidered:options.length,seedClass,suitPermutation:perm.join(''),sweeps:cfg.sweeps,startCards:startCards.map(cardStr)}};
  }
  // ---------------------------------------------------------------- verify
  function verify(spot,query){
    const n=normalize(query); const mismatches=[];
    if(n.errors.length) return {ok:false,mismatches:[{field:'query',expected:'requête valide',got:n.errors.map(e=>e.rule).join(',')}],computed:null};
    const comp=computeSpot(spot); if(comp.error) return {ok:false,mismatches:[{field:'spot',expected:'spot valide',got:comp.error}],computed:null};
    const spec=n.spec; if(spec.street!==spot.street) mismatches.push({field:'street',expected:spec.street,got:spot.street});
    if(spec.cells&&!spec.cells.includes(comp.cell)) mismatches.push({field:'cell',expected:spec.cells.join('|'),got:comp.cell});
    if(spot.street==='FLOP'){ if(spec.live!==undefined&&spec.live!==comp.liveDraw) mismatches.push({field:'liveDraw',expected:spec.live,got:comp.liveDraw}); }
    else { if(spec.hev!==undefined&&spec.hev!==comp.heroEvent) mismatches.push({field:'heroEvent',expected:spec.hev,got:comp.heroEvent});
      if(spec.live!==undefined&&spec.live!==comp.liveDraw) mismatches.push({field:'liveDraw',expected:spec.live,got:comp.liveDraw});
      if(spec.bev!==undefined&&spec.bev!==comp.boardEvent) mismatches.push({field:'boardEvent',expected:spec.bev,got:comp.boardEvent});
      if(spec.pairs!==undefined&&spec.pairs!==comp.pairs) mismatches.push({field:'pairs',expected:spec.pairs,got:comp.pairs});
      if(!roleOk(comp.lastCardRole,spec.role)) mismatches.push({field:'lastCardRole',expected:spec.role.join('+'),got:comp.lastCardRole});
      if(spec.prevCat!==undefined&&spec.prevCat!==comp.prevCategory) mismatches.push({field:'prevCategory',expected:spec.prevCat,got:comp.prevCategory});
      if(spec.prevLive!==undefined&&spec.prevLive!==comp.drawBefore) mismatches.push({field:'drawBefore',expected:spec.prevLive,got:comp.drawBefore}); }
    const inContract = spot.street==='FLOP' ? recs.FLOP.some(r=>r.joint===comp.joint) : jointKeyToRec.has(comp.joint);
    if(!inContract) mismatches.push({field:'contrat',expected:'tuple faisable du contrat v2',got:comp.tuple});
    return {ok:mismatches.length===0,mismatches,computed:comp}; }
  function build(query,seed){ const rng=makeRng(seed===undefined?(query&&query.seed!==undefined?query.seed:1):seed); const pl=plan(query); if(pl.status!=='OK') return pl; const r=construct(pl,rng); if(r.status!=='OK') return r; r.verification=verify(r.spot,query); return r; }
  return {validate,plan,construct,verify,build,stats,_recs:recs,_matches:matches,_explain:explain,_seeds:{joint:seedsByJoint,flop:flopSeeds},_deriveLastCard:deriveLastCard,_features:{prepBefore,lastCardFeatures,featuresSatisfy,evalAfter,bCell:()=>bCell}};
}
return {create,makeRng,hashSeed,cardStr,parseCard,constants:{RANKS,SUITS,CATN,CELL_NAMES,HEV,LIVE,BEV,TAGSETS,RULES:RULES.map(r=>({id:r[0],text:r[1]}))},_internals:{straightFlagPure,STRV,POP,SFT,evalTransition,evalFlop,computeSpot,comboOf,cellOf,liveFast}};
});
