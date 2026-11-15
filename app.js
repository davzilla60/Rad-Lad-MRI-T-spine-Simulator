(function(){
"use strict";
/* ---------------------------------------------------------------
   MR-I READY — MRI THORACIC SPINE planning simulator (demonstration)
   Set-up (supine, head first, on the spine array) → 3-plane localiser acquired line by line in k-space → protocol →
   SAGITTAL first (along the spine, C7 to L1) → the large-FOV COUNTING localiser that reaches C2, so the thoracic levels
   can be numbered → drag the sagittal onto the sagittal panel → TILT the AXIAL block square to the canal through the
   requested levels → images → debrief.
   Everything lives in DICOM patient space (LPS, mm): +x patient left, +y posterior, +z superior. Each panel shows an
   image with its real IPP / IOP, and plan boxes are projected onto it, so they line up on localisers and series alike.
   --------------------------------------------------------------- */
var BASE = "./assets/";
var C = window.MRS_CALIB, LN = C.loc.n, SER = C.ser, LM = C.lm, HH = LM.conf, LV = C.lv, LVC = C.lvc, DISC = C.disc;
var ASSETS = window.SCG_ASSETS || null, LOCIMG = window.MRS_LOCIMG || {};
var PNG = { logo_full:1, logo_mark:1, loc_sag:1, loc_cor:1, loc_ax:1 };
/* the localisers also ship as data URIs in calib.js, so the k-space step works when the page is opened from disk */
function url(n){ return ASSETS ? ASSETS[n] : (n.indexOf("loc_")===0 && LOCIMG[n.slice(4)]) ? LOCIMG[n.slice(4)] : BASE + n + (PNG[n] ? ".png" : ".jpg"); }
function pad2(n){ return (n<10?"0":"")+n; }
function imgName(id, k){ return id+"_"+pad2(k); }
var $ = function(id){ return document.getElementById(id); };
var stage=$("scgStage"), vp=$("scgViewport"), grid=$("mreGrid"), viewEl=$("mreView"), viewCv=$("mreViewCv"),
    acqEl=$("scgAcq"), acqTitle=$("scgAcqTitle"), acqNum=$("scgAcqNum"),
    vpTL=$("scgVpTL"), vpBL=$("scgVpBL"), vpBR=$("scgVpBR"),
    railTitle=$("scgRailTitle"), railDesc=$("scgRailDesc"), railBody=$("scgRailBody"),
    cmds=$("scgCmds"), cliForm=$("scgCliForm"), cli=$("scgCli"), logEl=$("scgLog"), phaseChip=$("scgPhaseChip"),
    titleEl=$("scgTitle"), resultEl=$("scgResult"), room=$("scgRoom"), info=$("mreInfo"),
    stackUI=$("scgStackUI"), stackSlider=$("scgStackSlider"), winBtns=$("scgWinBtns"), achWrap=$("scgAch");
var CELL = {};
Array.prototype.forEach.call(grid.querySelectorAll(".mre-cell"), function(c){
  CELL[c.dataset.p] = { el:c, sq:c.querySelector(".mre-sq"), cv:c.querySelector("canvas"), img:c.querySelector("img"),
                        svg:c.querySelector("svg"), lab:c.querySelector(".mre-lab"), lab2:c.querySelector(".mre-lab2") };
});

$("scgMarkMini").innerHTML = '<img class="scg-mark-ic" src="'+url("logo_mark")+'" alt="Rad-Lad">'+
  '<div class="scg-mark-tx"><b>MR-I&nbsp;READY&nbsp;·&nbsp;THORACIC&nbsp;SPINE</b><span>Rad-Lad&nbsp;·&nbsp;Illuminate&nbsp;the&nbsp;Invisible</span></div>';
$("scgLogoBig").src = url("logo_full"); $("scgAchLogo").src = url("logo_mark");
$("scgT1").src = url("loc_sag"); $("scgT2").src = url("loc_cor"); $("scgT3").src = url("loc_ax");
["sag","cor","ax"].forEach(function(p){ CELL[p].img.src = url("loc_"+p); });
function playAchievement(){ achWrap.classList.remove("is-playing"); void achWrap.offsetWidth; achWrap.classList.add("is-playing"); }
$("scgAchReplay").addEventListener("click", playAchievement);

/* ---- small vector kit (3-vectors as arrays) ---- */
function add(a,b){ return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function sub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function mul(a,s){ return [a[0]*s, a[1]*s, a[2]*s]; }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function axpy(a,b,s){ return [a[0]+b[0]*s, a[1]+b[1]*s, a[2]+b[2]*s]; }
var DEG = 180/Math.PI;

/* =============================================================
   ANATOMY + PROTOCOL DATA
   ============================================================= */
var TASKS = ["sag","cnt","ax"], PANELS = ["sag","cor","ax"];
var TYPE = { sag:"sag", cnt:"sag", ax:"ax" };                 // the counting localiser is a second sagittal stack
var COLORS = { sag:"#f0a35e", cnt:"#6fc3ff", ax:"#5fe08a" };
var NAME = { sag:"SAG", cor:"COR", ax:"AX", cnt:"COUNT" };
var REF = C.real.axtilt;                                      // the axial block's tilt on the sagittal, as acquired
var TOL = 5, TOLS = 6;                                        // degrees: axial tilt · "straight along the spine"
var X0 = HH[0], BODY_Y = 58;                                  // mid-line of the spine · depth of the vertebral bodies
var MAT = { sag:320, cnt:416, ax:320 };
var LIM = { sag: { nmax:31, tmin:2, tmax:5, fmin:240, fmax:420, coarse:400, narrow:0,   over:110 },
            cnt: { nmax:21, tmin:2, tmax:6, fmin:300, fmax:500, coarse:1e9, narrow:0,   over:70 },
            ax:  { nmax:50, tmin:2, tmax:6, fmin:140, fmax:320, coarse:260, narrow:150, over:175 } };
var SEQ = {
  sag: { name:"SAGITTAL", dirName:"right", ideal:"sag_t2", fov:340,
         start:{ c:[30,70,-170], ang:90, n:11, thk:3, gap:1, fov:300 },
         key:[["c7","C7 at the top of the FOV"],["t6","T6 · the middle of the thoracic spine"],["l1","L1 at the bottom of the FOV"],
              ["fr","Right edge of the vertebrae (right foramina)"],["fl","Left edge of the vertebrae (left foramina)"],
              ["ant","Front of the vertebral bodies"],["sp","Spinous processes"]],
         hint:"Sagittal first. On the coronal and axial localisers, centre the stack on the spine and keep it running straight along it; add slices until it covers the vertebrae edge to edge (foramen to foramen). On the sagittal localiser, size and slide the FOV so it holds C7 at the top and L1 at the bottom (≈ 340 mm) — the cord ends about L1, and you need both junctions.",
         seqs:[
           { id:"t2",   name:"T2", why:"the cord, the CSF around it and the discs: compression, cord signal change", have:"sag_t2" },
           { id:"t1",   name:"T1", why:"marrow fat: a replaced or fractured vertebra is dark against bright fatty marrow", have:"sag_t1" },
           { id:"stir", name:"STIR", why:"fat nulled: marrow oedema and marrow lesions light up, with uniform fat suppression over a long FOV", have:"sag_stir" },
           { id:"gad",  name:"T1 FS + gadolinium", why:"tumour, infection, leptomeningeal disease — only when the request or the first images call for it" } ] },
  cnt: { name:"COUNTING LOCALISER", dirName:"right", ideal:"cnt_t1", fov:480,
         start:{ c:[-5,70,-170], ang:90, n:9, thk:3, gap:1, fov:400 },
         key:[["dens","C2 · the dens (where the count starts)"],["c7","C7"],["t1","T1"],["t6","T6 (overlaps the T-spine sagittal)"]],
         hint:"The T-spine FOV shows neither C2 nor the sacrum, so nobody can say which vertebra is which. Run a fast, large-FOV (≈ 480 mm) mid-line sagittal that reaches from C2 down into the thoracic spine: slide the box up — its top leaves the localiser, so watch <b>Levels in the FOV</b> and the preview — until it starts at the skull base and holds the dens, and keep the lower edge well inside your T-spine sagittal so the two overlap.",
         seqs:[
           { id:"t1",    name:"T1 (large FOV, low resolution)", why:"a 1-minute mid-line sagittal from C2 into the thoracic spine: count down from C2 and number every level", have:"cnt_t1" },
           { id:"whole", name:"Whole-spine composed localiser", why:"the alternative on some scanners: two or three table positions stitched into one image for counting" } ] },
  ax:  { name:"AXIAL", dirName:"superior", ideal:"ax_t2", fov:200,
         start:{ c:[-5,70,-190], ang:0, n:16, thk:4, gap:1, fov:240 },
         key:[["t5","T5 · the top of the requested block"],["t9","T9 · the bottom of the requested block"],["ant","Front of the vertebral body"],
              ["cord","Spinal cord"],["sp","Spinous process"],["fr","Right foramen"],["fl","Left foramen"]],
         hint:"Axial block through the requested levels, T5 to T9. On your sagittal, tilt the stack so the slices lie square to the spinal canal (parallel to the discs) across the block — the thoracic spine leans back as it goes down, so a straight stack cuts the cord obliquely. Cover T5 to T9, with a FOV of about 200 mm centred on the canal.",
         seqs:[
           { id:"t2",  name:"T2", why:"the cord in cross-section, the CSF space, the foramina and any compression", have:"ax_t2" },
           { id:"t1",  name:"T1", why:"marrow of the body, pedicles and ribs; paraspinal and epidural soft tissue", have:"ax_t1" },
           { id:"gre", name:"T2* GRE (MERGE / MEDIC)", why:"better grey–white contrast in the cord and less CSF flow artefact than FSE T2" },
           { id:"gad", name:"T1 FS + gadolinium", why:"epidural or paraspinal extension of tumour or infection — after the sagittals have been reviewed" } ] }
};
var POS = {
  bolster: { label:"ARMS BY THE SIDES · KNEES OVER A BOLSTER", desc:"Supine, head first, arms resting on pads beside the body, a bolster under the knees.",
          cap:"SUPINE · HEAD FIRST · KNEE BOLSTER", sub:"arms by the sides, knees supported", short:"arms by the sides, knee bolster",
          fit:"<b>Arms by the sides</b> on pads, <b>bolster under the knees</b> · lying straight down the middle of the table",
          note:"The bolster takes the strain off the lower back, so the patient lies flat on the spine array and stays still for 25 minutes. Arms by the sides keep the hands out of the chest and clear of each other.",
          cls:"ok" },
  flat: { label:"LEGS FLAT · NO KNEE SUPPORT", desc:"Supine, head first, legs straight out on the table with nothing under the knees.",
          cap:"SUPINE · HEAD FIRST · LEGS FLAT", sub:"no support under the knees", short:"legs flat, no knee support",
          fit:"Arms by the sides, legs flat on the table (no bolster)",
          note:"Flat legs arch the lower back off the table. A patient with back pain can't hold that for long: they shift, and every movement blurs a whole sequence. Put a bolster under the knees.",
          cls:"warn" },
  arms: { label:"HANDS CLASPED ON THE CHEST", desc:"Supine, head first, knees over a bolster, hands folded together on the chest.",
          cap:"SUPINE · HEAD FIRST · HANDS ON THE CHEST", sub:"hands clasped on the chest", short:"hands clasped on the chest",
          fit:"Knees over a bolster, hands clasped on the chest",
          note:"Hands on the chest rise and fall with every breath, right in front of the thoracic spine — ghosting across the cord — and clasped hands make a skin-to-skin loop that can heat up. Arms by the sides, hands apart.",
          cls:"warn" }
};
function coverage(pl){ return pl.n*pl.thk + (pl.n-1)*pl.gap; }
/* vertebral level at height z (the discs are stored top to bottom) */
function levelAt(z){
  if(z > DISC[0][1]) return "skull base";
  for(var i=0;i<LV.length;i++) if(z > DISC[i+1][1]) return LV[i][0];
  return "L2";
}
/* height at which a plane (point P, normal n) crosses the column of vertebral bodies */
function bodyZ(P, n){ return Math.abs(n[2]) < 0.2 ? P[2] : P[2] - (n[0]*(X0-P[0]) + n[1]*(BODY_Y-P[1]))/n[2]; }
function sideName(x){
  var s=x-X0, a=Math.abs(s), w = s>0 ? "left" : "right";
  return a<=6 ? "mid-line · cord" : a<=22 ? w+" of the mid-line · "+w+" pedicles + foramina" : w+" costovertebral joints · ribs";
}
/* plane frame: u = screen-right, v = screen-down, n = slice direction (u × v) */
function frameOf(q, ang){
  if(TYPE[q]==="ax") return { u:[1,0,0], v:[0,1,0], n:[0,0,1] };
  var t=ang*Math.PI/180;
  return { u:[Math.cos(t), Math.sin(t), 0], v:[0,0,-1], n:[-Math.sin(t), Math.cos(t), 0] };
}
function frame(q){ return S.plan[q].f; }
function rotV(a, k, c, s){ var kd=dot(k,a), kx=cross(k,a); return [a[0]*c+kx[0]*s+k[0]*kd*(1-c), a[1]*c+kx[1]*s+k[1]*kd*(1-c), a[2]*c+kx[2]*s+k[2]*kd*(1-c)]; }
/* rotate frame f by deg about axis k, then keep it reading the right way round on screen */
function rotFrame(q, f, k, deg){
  var L=Math.hypot(k[0],k[1],k[2]); k=mul(k, 1/L);
  var t=deg*Math.PI/180, c=Math.cos(t), s=Math.sin(t), g={ u:rotV(f.u,k,c,s), v:rotV(f.v,k,c,s), n:rotV(f.n,k,c,s) };
  if(TYPE[q]==="ax"){ if(g.u[0]<0){ g.u=mul(g.u,-1); g.v=mul(g.v,-1); } }
  else {
    if(g.u[1] < 0){ g.u=mul(g.u,-1); g.n=mul(g.n,-1); }
    if(g.v[2] > 0){ g.v=mul(g.v,-1); g.n=mul(g.n,-1); }
  }
  return g;
}
/* angles. Axial: tilt on the sagittal (+ = the back of the slices lifted, square to a spine that leans back as it descends)
   and on the coronal. Sagittal stacks: rotation on the axial (90 = straight) and lean on the coronal. */
function nUp(q){ var n=S.plan[q].f.n; return n[2]<0 ? mul(n,-1) : n; }
function axTilt(q){ var n=nUp(q); return Math.atan2(-n[1], n[2])*DEG; }
function axCor(q){ var n=nUp(q); return Math.atan2(n[0], n[2])*DEG; }
function sagRot(q){ var n=S.plan[q].f.n, a=Math.atan2(-n[0], n[1])*DEG; while(a>=180) a-=180; while(a<0) a+=180; return a-90; }
function sagLean(q){ var n=S.plan[q].f.n; return Math.asin(Math.max(-1, Math.min(1, n[0]<0 ? -n[2] : n[2])))*DEG; }
function tiltNow(q){ return TYPE[q]==="ax" ? axTilt(q) : sagLean(q); }
function edges(q){ var pl=S.plan[q], s=dot(sub(pl.c, HH), frame(q).n), h=coverage(pl)/2; return [s-h, s+h]; }
function needsAngle(q){ return q==="ax"; }                    // the angle that is set on a completed series
function angErr(q){ return TYPE[q]==="ax" ? axTilt(q)-REF : sagRot(q); }
function angOK(q){
  return TYPE[q]==="ax" ? Math.abs(axTilt(q)-REF) <= TOL && Math.abs(axCor(q)) <= TOLS
                        : Math.abs(sagRot(q)) <= TOLS && Math.abs(sagLean(q)) <= TOLS;
}
function inBox(q, P){
  var F=frame(q), pl=S.plan[q], d=sub(P, pl.c);
  return Math.abs(dot(d,F.n)) <= coverage(pl)/2 + 1.5 && Math.abs(dot(d,F.u)) <= pl.fov/2 && Math.abs(dot(d,F.v)) <= pl.fov/2;
}
/* what the plan holds: axial = the vertebral levels of its first and last slice; sagittal = the levels at the top and bottom of the FOV */
function span(q){
  var F=frame(q), pl=S.plan[q], a, b;
  if(TYPE[q]==="ax"){ var n=nUp(q), h=coverage(pl)/2; a=bodyZ(axpy(pl.c,n,h), n); b=bodyZ(axpy(pl.c,n,-h), n); }
  else { a=pl.c[2]+Math.abs(F.v[2])*pl.fov/2; b=pl.c[2]-Math.abs(F.v[2])*pl.fov/2; }
  return [levelAt(a), levelAt(b)];
}
function spanText(q){ var s=span(q); return s[0]+" → "+s[1]; }
function analyse(q){
  var pl=S.plan[q], e=edges(q), L=LIM[q], key=SEQ[q].key.map(function(k){ return { id:k[0], name:k[1], ok:inBox(q, LM[k[0]]) }; });
  return { key:key, all:key.every(function(k){ return k.ok; }), cov:coverage(pl), lo:e[0], hi:e[1], res:pl.fov/MAT[q],
           coarse:pl.fov > L.coarse, narrow:pl.fov < L.narrow, ang:angErr(q), angOK:angOK(q), over:coverage(pl) > L.over };
}
function planOK(q){ var a=analyse(q); return a.all && !a.coarse && !a.narrow && a.angOK; }
function canScan(q){ return !needsAngle(q) || angOK(q); }
function imaged(q){                                     // series ids this plan will produce
  var ids=SEQ[q].seqs.filter(function(s){ return s.have && S.chosen[q][s.id]; }).map(function(s){ return s.have; });
  return ids.length ? ids : [SEQ[q].seqs.filter(function(s){ return s.have; })[0].have];
}
function scanTime(id){ var s=SER[id], pl=S.plan[s.task]; return Math.round(30 + pl.n*s.spl); }
function mmss(s){ return Math.floor(s/60)+":"+pad2(s%60); }
function sgn(v){ return (v>=0?"+":"−")+Math.abs(v).toFixed(0); }
function deg1(v){ return (v<0?"−":"")+Math.abs(v).toFixed(0)+"°"; }

/* =============================================================
   STATE
   ============================================================= */
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function startPlan(q){ var p=clone(SEQ[q].start); p.f=frameOf(q, p.ang); delete p.ang; return p; }
function freshState(){
  return { phase:"title", pos:null, loaded:false, loading:false, locDone:false,
           plan:{ sag:startPlan("sag"), cnt:startPlan("cnt"), ax:startPlan("ax") },
           done:{}, ids:{}, acq:{}, swap:{}, chosen:{ sag:{t2:1, t1:1, stir:1}, cnt:{t1:1}, ax:{t2:1, t1:1} },
           cur:null, viewId:null, viewK:0, list:[], lv:true, counted:false };
}
var S = freshState();

/* =============================================================
   SERIES GEOMETRY + IMAGES
   ============================================================= */
function sliceCentre(id, k){ var s=SER[id]; return axpy(axpy(s.ipp[k], s.row, s.ps*s.cols/2), s.col, s.ps*s.rows/2); }
function seriesCentre(id){ var s=SER[id]; return mul(add(sliceCentre(id,0), sliceCentre(id,s.n-1)), 0.5); }
function coveredSlices(id){
  var s=SER[id], q=s.task, F=frame(q), pl=S.plan[q], h=coverage(pl)/2 + s.sp/2, out=[];
  for(var k=0;k<s.n;k++){
    var c=sliceCentre(id,k);
    var P = TYPE[q]==="ax" ? [X0, BODY_Y, bodyZ(c, s.nrm)] : c;      // an axial slice counts where it crosses the vertebral bodies
    if(Math.abs(dot(sub(P, pl.c), F.n)) > h) continue;
    out.push(k);
  }
  return out;
}
function nearestSlice(id, P){
  var s=SER[id], b=0, bd=1e9;
  for(var k=0;k<s.n;k++){ var d=Math.abs(dot(sub(P, s.ipp[k]), s.nrm)); if(d<bd){ bd=d; b=k; } }
  return b;
}
var imgCache = {};
function getImg(name, cb){
  if(imgCache[name] && imgCache[name].complete){ cb(imgCache[name]); return; }
  var im = imgCache[name] || new Image();
  im.addEventListener("load", function(){ cb(im); }, { once:true });
  if(!imgCache[name]){ imgCache[name]=im; im.src=url(name); }
}
/* the crop used to show series slice k inside plan q's FOV (series' own orientation, centred on the plan) */
function cropOf(id, k, N, pl){
  var s=SER[id], d=sub(pl.c, s.ipp[k]);
  return { ic:dot(d,s.row)/s.ps, jc:dot(d,s.col)/s.ps, sc:N/(pl.fov/s.ps), N:N };
}
function cropPt(id, k, cr, P){ var s=SER[id], d=sub(P, s.ipp[k]); return [(dot(d,s.row)/s.ps - cr.ic)*cr.sc + cr.N/2, (dot(d,s.col)/s.ps - cr.jc)*cr.sc + cr.N/2]; }
function renderSeries(id, k, cv, pl, cb){
  var g=cv.getContext("2d"), N=cv.width;
  pl = pl || S.plan[SER[id].task];
  getImg(imgName(id,k), function(im){
    var cr=cropOf(id, k, N, pl);
    g.setTransform(1,0,0,1,0,0); g.globalAlpha=1; g.fillStyle="#000"; g.fillRect(0,0,N,N);
    g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high";
    g.setTransform(cr.sc,0,0,cr.sc, N/2-cr.ic*cr.sc, N/2-cr.jc*cr.sc); g.drawImage(im, -0.5, -0.5);
    g.setTransform(1,0,0,1,0,0);
    if(cb) cb(cr);
  });
}
/* vertebral level labels on a sagittal image. They are numbered only once the counting localiser has shown C2. */
function levelLabels(cv, id, k, cr){
  var s=SER[id]; if(s.plane!=="sag") return false;
  if(Math.abs(s.ipp[k][0]-X0) > 11) return false;                  // only near the mid-line, where the bodies are in the slice
  var g=cv.getContext("2d"), N=cv.width, list = s.task==="cnt" ? LVC : LV, known = s.task==="cnt" ? S.counted : S.counted;
  g.save(); g.font=Math.max(10, Math.round(N/46))+"px ui-monospace,Consolas,monospace"; g.textBaseline="middle"; g.textAlign="right";
  list.forEach(function(l){
    var p=cropPt(id, k, cr, l[1]); if(p[0]<24 || p[1]<8 || p[0]>N-4 || p[1]>N-8) return;
    var x=p[0]-N*0.045, tx = known ? l[0] : "?";
    g.strokeStyle="rgba(255,224,138,.85)"; g.lineWidth=1; g.beginPath(); g.moveTo(x+3, p[1]); g.lineTo(p[0]-2, p[1]); g.stroke();
    g.lineWidth=3; g.strokeStyle="rgba(0,0,0,.85)"; g.strokeText(tx, x, p[1]); g.fillStyle="#ffe08a"; g.fillText(tx, x, p[1]);
  });
  g.restore();
  return true;
}

/* =============================================================
   K-SPACE (the localiser is acquired line by line)
   ============================================================= */
function fft1(re, im, inv){
  var n=re.length, i, j, k, m;
  for(i=1, j=0; i<n; i++){ var bit=n>>1; for(; j&bit; bit>>=1) j^=bit; j^=bit; if(i<j){ var t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(m=2; m<=n; m<<=1){
    var ang=(inv?2:-2)*Math.PI/m, wr=Math.cos(ang), wi=Math.sin(ang);
    for(i=0; i<n; i+=m){ var cr=1, ci=0;
      for(k=0; k<m/2; k++){
        var a=i+k, b=a+m/2, tr=re[b]*cr-im[b]*ci, ti=re[b]*ci+im[b]*cr;
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
        var nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr;
      }
    }
  }
}
function fft2(re, im, n, inv){
  var r=new Float64Array(n), i2=new Float64Array(n), x, y;
  for(y=0;y<n;y++){ for(x=0;x<n;x++){ r[x]=re[y*n+x]; i2[x]=im[y*n+x]; } fft1(r,i2,inv); for(x=0;x<n;x++){ re[y*n+x]=r[x]; im[y*n+x]=i2[x]; } }
  for(x=0;x<n;x++){ for(y=0;y<n;y++){ r[y]=re[y*n+x]; i2[y]=im[y*n+x]; } fft1(r,i2,inv); for(y=0;y<n;y++){ re[y*n+x]=r[y]; im[y*n+x]=i2[y]; } }
}
var KS = {};
function prepK(p, cb){
  if(KS[p]){ cb(KS[p]); return; }
  getImg("loc_"+p, function(im){
    var n=LN, c=document.createElement("canvas"); c.width=c.height=n;
    var g=c.getContext("2d", { willReadFrequently:true }); g.drawImage(im,0,0,n,n);
    var d;
    try{ d=g.getImageData(0,0,n,n).data; }catch(e){ KS[p]=null; cb(null); return; }     // blocked (file:// without the inlined localisers)
    var re=new Float64Array(n*n), imv=new Float64Array(n*n), i;
    for(i=0;i<n*n;i++) re[i]=d[i*4];
    fft2(re, imv, n, false);
    var mag=new Float64Array(n*n), mx=0;
    for(i=0;i<n*n;i++){ mag[i]=Math.log(1+Math.hypot(re[i],imv[i])); if(mag[i]>mx) mx=mag[i]; }
    var kc=document.createElement("canvas"); kc.width=kc.height=n;
    var kg=kc.getContext("2d"), id=kg.createImageData(n,n);
    for(var y=0;y<n;y++) for(var x=0;x<n;x++){
      var v=Math.pow(mag[((y+n/2)%n)*n+((x+n/2)%n)]/mx, 2.2)*255, j=(y*n+x)*4;
      id.data[j]=v*0.7; id.data[j+1]=v; id.data[j+2]=v*0.8; id.data[j+3]=255;
    }
    kg.putImageData(id,0,0);
    KS[p]={ re:re, im:imv, kc:kc };
    cb(KS[p]);
  });
}
function partialRecon(p, lines, cv){
  var K=KS[p], n=LN, re=new Float64Array(n*n), im=new Float64Array(n*n), y, x;
  for(var r=0;r<lines;r++){ y=(r+n/2)%n; for(x=0;x<n;x++){ re[y*n+x]=K.re[y*n+x]; im[y*n+x]=K.im[y*n+x]; } }
  fft2(re, im, n, true);
  var g=cv.getContext("2d"), id=g.createImageData(n,n), d=id.data;
  for(var i=0;i<n*n;i++){ var v=Math.hypot(re[i],im[i])/(n*n); v=v>255?255:v; d[i*4]=d[i*4+1]=d[i*4+2]=v; d[i*4+3]=255; }
  g.putImageData(id,0,0);
}

/* =============================================================
   LAYOUT + LOG
   ============================================================= */
function layoutGrid(){
  Object.keys(CELL).forEach(function(p){
    var c=CELL[p], w=c.el.clientWidth, h=c.el.clientHeight, s=Math.max(10, Math.min(w, h));
    c.sq.style.width=s+"px"; c.sq.style.height=s+"px";
  });
}
window.addEventListener("resize", layoutGrid);
if(typeof ResizeObserver!=="undefined") new ResizeObserver(layoutGrid).observe(vp);
function log(msg, cls){
  var d=document.createElement("div");
  if(cls) d.innerHTML='<span class="scg-l-'+cls+'">'+msg+'</span>'; else d.textContent=msg;
  logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight;
}
function logCmd(c){ log("$ "+c,"cmd"); }

/* =============================================================
   PLANNING OVERLAYS — boxes projected onto each panel's real image plane (SVG units: 256 across the image)
   ============================================================= */
function panelGeo(p){
  var sw=S.swap[p];
  if(sw){ var s=SER[sw.id], k=S.acq[sw.id][sw.i]; return { ipp:s.ipp[k], row:s.row, col:s.col, mmu:s.ps*s.cols/256 }; }
  var L=C.loc[p]; return { ipp:L.ipp, row:L.row, col:L.col, mmu:L.ps*L.cols/256 };
}
function proj(G, P){ var d=sub(P, G.ipp); return [dot(d,G.row)/G.mmu, dot(d,G.col)/G.mmu]; }
function projDir(G, d){ return [dot(d,G.row)/G.mmu, dot(d,G.col)/G.mmu]; }
function unproj(G, x, y){ return axpy(axpy(G.ipp, G.row, x*G.mmu), G.col, y*G.mmu); }
function f1(v){ return v.toFixed(1); }
/* the axial tilt is set on a completed sagittal series, not on the coarse localiser */
function canRotate(p, q){ return !(p==="sag" && needsAngle(q) && !S.swap.sag); }
/* the drawable shape of plan q on panel p */
function shapeOf(p, q){
  var G=panelGeo(p), F=frame(q), pl=S.plan[q], N=cross(G.row, G.col), t=Math.abs(dot(F.n, N)), half=pl.fov/2, cov=coverage(pl);
  var sh={ G:G, F:F, parallel:t>0.6, edges:[], lines:[] }, c=pl.c;
  function P2(P){ return proj(G, P); }
  if(sh.parallel){                                   // the square FOV of the centre slice
    sh.corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(function(s){ return P2(axpy(axpy(c, F.u, s[0]*half), F.v, s[1]*half)); });
    sh.edges=[["v","lo"],["u","hi"],["v","hi"],["u","lo"]];
  } else {                                           // a stack: slices seen edge-on, along the in-plane axis this panel shows
    var a = Math.abs(dot(F.u,N)) < Math.abs(dot(F.v,N)) ? "u" : "v", A=F[a];
    sh.corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(function(s){ return P2(axpy(axpy(c, F.n, s[0]*cov/2), A, s[1]*half)); });
    sh.edges=[[a,"lo"],["n","hi"],[a,"hi"],["n","lo"]];
    var step=pl.thk+pl.gap, every=Math.max(1, Math.ceil(pl.n/40));
    for(var i=0;i<pl.n;i+=every){ var m=axpy(c, F.n, -cov/2+pl.thk/2+i*step); sh.lines.push([P2(axpy(m,A,-half)), P2(axpy(m,A,half))]); }
    sh.a=a;
  }
  var RA = sh.parallel ? F.u : F[sh.a];
  sh.rot={ c:P2(c), h:[P2(axpy(c, RA, -(half+8))), P2(axpy(c, RA, half+8))], lock:!canRotate(p, q) };
  return sh;
}
function rotLabel(p, q){
  if(TYPE[q]==="ax") return p==="sag" ? "tilt "+deg1(axTilt(q)) : p==="cor" ? "tilt "+deg1(axCor(q)) : "in-plane";
  return p==="ax" ? "rotation "+deg1(sagRot(q)) : p==="cor" ? "lean "+deg1(sagLean(q)) : "in-plane";
}
function svgBox(p, q, mode){
  var sh=shapeOf(p, q), plan=mode==="plan", off=plan && !planOK(q), cls=off?" is-off":"", pl=S.plan[q], K=sh.corners, out="";
  var poly=K.map(function(k){ return f1(k[0])+" "+f1(k[1]); });
  if(plan) out+='<path class="mre-mask" fill-rule="evenodd" d="M-400 -400H656V656H-400Z M'+poly.join("L")+'Z"/>';
  var st = plan ? "" : ' style="stroke:'+COLORS[q]+';fill:'+COLORS[q]+'14"';
  out+='<path class="mre-box'+cls+(sh.parallel?" is-fov":"")+'" data-q="'+q+'" data-h="body" d="M'+poly.join("L")+'Z"'+st+(plan?"":' pointer-events="none"')+'/>';
  sh.lines.forEach(function(l){ out+='<line class="mre-sl'+cls+'" x1="'+f1(l[0][0])+'" y1="'+f1(l[0][1])+'" x2="'+f1(l[1][0])+'" y2="'+f1(l[1][1])+'"'+(plan?"":' style="stroke:'+COLORS[q]+'88"')+'/>'; });
  if(plan){
    sh.edges.forEach(function(e, i){
      var a=K[i], b=K[(i+1)%4], mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
      out+='<line class="mre-hd" style="cursor:'+(e[0]==="n"?"col-resize":"nwse-resize")+'" data-h="'+e[0]+'|'+e[1]+'" x1="'+f1(a[0])+'" y1="'+f1(a[1])+'" x2="'+f1(b[0])+'" y2="'+f1(b[1])+'"/>'+
           '<circle class="mre-hgrip'+cls+'" cx="'+f1(mx)+'" cy="'+f1(my)+'" r="2.6"/>';
    });
    var rc = sh.rot.lock ? " is-lock" : cls, H=sh.rot.h;
    out+='<line class="mre-rotline'+rc+'" x1="'+f1(H[0][0])+'" y1="'+f1(H[0][1])+'" x2="'+f1(H[1][0])+'" y2="'+f1(H[1][1])+'"/>';
    H.forEach(function(h, i){
      out+='<circle class="mre-rot'+rc+'" data-h="rot|'+(i?1:-1)+'" cx="'+f1(h[0])+'" cy="'+f1(h[1])+'" r="8"/>'+
           '<text class="mre-tx'+rc+'" style="font-size:9px" text-anchor="middle" x="'+f1(h[0])+'" y="'+f1(h[1]+3.2)+'" pointer-events="none">'+(sh.rot.lock?"🔒":"⟳")+'</text>';
    });
    out+='<text class="mre-tx'+rc+'" x="'+f1(Math.max(2, Math.min(190, H[0][0]-10)))+'" y="'+f1(Math.max(18, Math.min(250, H[0][1]-11)))+'">'+(sh.rot.lock?"tilt locked":rotLabel(p, q))+'</text>';
    var top=K.reduce(function(m,k){ return k[1]<m[1]?k:m; }, K[0]);
    var tx = sh.parallel ? "FOV "+pl.fov+" mm" : pl.n+" sl · "+pl.thk+" mm · "+coverage(pl).toFixed(0)+" mm";
    out+='<text class="mre-tx'+cls+'" x="'+f1(Math.max(2, Math.min(150, top[0]+2)))+'" y="'+f1(Math.max(9, Math.min(250, top[1]-3)))+'">'+NAME[q]+' · '+tx+'</text>';
  } else {
    var tp=K.reduce(function(m,k){ return k[1]<m[1]?k:m; }, K[0]);
    out+='<text class="mre-tx" style="fill:'+COLORS[q]+'" x="'+f1(Math.max(2, Math.min(220, tp[0]+2)))+'" y="'+f1(Math.max(9, Math.min(250, tp[1]-3)))+'">'+NAME[q]+'</text>';
  }
  return out;
}
function drawOverlays(){
  PANELS.forEach(function(p){
    var svg=CELL[p].svg, out="";
    if(S.phase==="plan") out=svgBox(p, S.cur, "plan");
    else if(S.phase==="dash" || S.phase==="result") Object.keys(S.done).forEach(function(q){ out+=svgBox(p, q, "dash"); });
    svg.innerHTML=out;
    var lab2="";
    if(S.phase==="plan"){
      var q=S.cur;
      if(!canRotate(p, q)) lab2="🔒 tilt: drop the sagittal series here first";
      else lab2 = "⟳ = angle · box = move · edges = "+(shapeOf(p, q).parallel ? "FOV" : "coverage / FOV");
    }
    CELL[p].lab2.textContent=lab2;
    var want = S.phase==="plan" && p==="sag" && needsAngle(S.cur) && !S.swap.sag, tag=CELL[p].el.querySelector(".mre-want");
    CELL[p].lab2.style.color = want ? "var(--warn)" : "";
    CELL[p].el.classList.toggle("is-want", want);
    if(want && !tag){ tag=document.createElement("div"); tag.className="mre-want"; tag.textContent="⬇ DROP THE SAGITTAL HERE TO TILT"; CELL[p].el.appendChild(tag); }
    if(!want && tag) tag.remove();
  });
}
/* dragging */
var drag=null;
function svgPt(svg, e){ var r=svg.getBoundingClientRect(); return [(e.clientX-r.left)/r.width*256, (e.clientY-r.top)/r.height*256]; }
function along(G, c, d, m){ var c2=proj(G, c), d2=projDir(G, d), L=d2[0]*d2[0]+d2[1]*d2[1]; return L<1e-9 ? 0 : ((m[0]-c2[0])*d2[0]+(m[1]-c2[1])*d2[1])/L; }
function angLog(q){ log(TYPE[q]==="ax" ? "axial tilt: square to the canal through the block ✓" : "the "+SEQ[q].name.toLowerCase()+" runs straight along the spine again ✓","ok"); }
PANELS.forEach(function(p){
  var svg=CELL[p].svg;
  svg.addEventListener("pointerdown", function(e){
    if(S.phase!=="plan") return;
    var t=e.target, h=t.getAttribute && t.getAttribute("data-h");
    if(!h) return;
    e.preventDefault();
    var q=S.cur;
    drag={ p:p, h:h, q:q, start:svgPt(svg, e), G:panelGeo(p), pl0:clone(S.plan[q]), F0:frame(q) };
    if(h.indexOf("rot")===0){ var c2=proj(drag.G, S.plan[q].c); drag.c2=c2; drag.a0=Math.atan2(drag.start[1]-c2[1], drag.start[0]-c2[0]); drag.wasOK=angOK(q); }
    try{ svg.setPointerCapture(e.pointerId); }catch(_){}
    CELL[p].el.classList.add("is-active");
  });
  svg.addEventListener("pointermove", function(e){
    if(!drag || drag.p!==p) return;
    var m=svgPt(svg, e), q=drag.q, pl=S.plan[q], G=drag.G, p0=drag.pl0, F=drag.F0, L=LIM[q];
    if(drag.h==="body"){
      var d=unproj(G, m[0], m[1]), d0=unproj(G, drag.start[0], drag.start[1]);
      pl.c=add(p0.c, sub(d, d0));
    } else if(drag.h.indexOf("rot")===0){
      if(!canRotate(p, q)){ if(!drag.warned){ drag.warned=true; log("the tilt unlocks on your real sagittal images — drag a sagittal from the tray onto the SAG panel first.","warn"); } return; }
      var a1=Math.atan2(m[1]-drag.c2[1], m[0]-drag.c2[0]), dd=(a1-drag.a0)*180/Math.PI;
      pl.f=rotFrame(q, drag.F0, cross(G.row, G.col), dd);
      if(angOK(q) && !drag.wasOK){ drag.wasOK=true; angLog(q); }
      if(!angOK(q)) drag.wasOK=false;
    } else {
      var ax=drag.h.split("|")[0], side=drag.h.split("|")[1], s=along(G, p0.c, F[ax], m);
      if(ax==="n"){
        var cov0=coverage(p0), fixed = side==="hi" ? -cov0/2 : cov0/2;
        var n=Math.round((Math.abs(s-fixed)+p0.gap)/(p0.thk+p0.gap));
        pl.n=Math.max(3, Math.min(L.nmax, n));
        var cov=coverage(pl); pl.c=axpy(p0.c, F.n, side==="hi" ? fixed+cov/2 : fixed-cov/2);
      } else {
        pl.fov=Math.max(L.fmin, Math.min(L.fmax, Math.round(2*Math.abs(s)/5)*5));
      }
    }
    clampPlan(q); drawOverlays(); schedulePreview(); renderRail(); renderCmds();
  });
  function end(){ if(drag && drag.p===p){ CELL[p].el.classList.remove("is-active"); drag=null; render(); } }
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
});
/* set the axial tilt on the sagittal to a (degrees) */
function setAngle(q, a, quiet){
  if(!needsAngle(q)) return;
  var was=angOK(q);
  a=Math.max(-40, Math.min(40, a));
  S.plan[q].f=rotFrame(q, S.plan[q].f, [1,0,0], a-axTilt(q));
  if(!quiet){ afterPlan(); }
  if(angOK(q) && !was) angLog(q);
}
function straighten(q){ var pl=S.plan[q]; pl.f=frameOf(q, 90); afterPlan(); log(SEQ[q].name.toLowerCase()+" reset to a straight sagittal.","sys"); }
function clampPlan(q){
  var pl=S.plan[q];
  pl.c=pl.c.map(function(v, i){ return Math.round(Math.max(HH[i]-(i===2?330:200), Math.min(HH[i]+(i===2?330:200), v))*2)/2; });
}
var prevT=0;
function schedulePreview(){ if(prevT) return; prevT=requestAnimationFrame(function(){ prevT=0; drawPreview(); }); }
var PREV = { sag:"sag_t2", cnt:"cnt_t1", ax:"ax_t2" };
function drawPreview(){
  if(S.phase!=="plan") return;
  var q=S.cur, pl=S.plan[q], X=CELL.x, a=analyse(q), id=PREV[q], k=nearestSlice(id, pl.c);
  renderSeries(id, k, X.cv, pl);
  X.lab.textContent="PREVIEW · "+SEQ[q].name+" "+SER[id].seq+"\nnearest slice to the box centre · FOV "+pl.fov+" mm";
  X.lab2.textContent = a.narrow ? "FOV too small: wrap-around" : a.coarse ? "FOV too big for the matrix" : "matrix "+MAT[q]+" · "+a.res.toFixed(2)+" mm px";
  X.lab2.style.color = a.narrow || a.coarse ? "var(--warn)" : "";
}

/* =============================================================
   PHASES
   ============================================================= */
var PHASE_LABEL = { title:"STANDBY", setup:"PATIENT SET-UP", loc:"LOCALISER", dash:"PROTOCOL", plan:"PLANNING", acquire:"ACQUIRING", view:"IMAGES", result:"REVIEW" };
function setPhase(p){
  S.phase=p;
  phaseChip.textContent=PHASE_LABEL[p]||p;
  room.classList.toggle("scg-hidden", p!=="setup");
  grid.classList.toggle("scg-hidden", !(p==="loc"||p==="dash"||p==="plan"));
  viewEl.classList.toggle("scg-hidden", !(p==="view"||p==="result"));
  acqEl.classList.add("scg-hidden");
  stackUI.classList.toggle("scg-hidden", !(p==="view"||p==="result"));
  winBtns.classList.toggle("scg-hidden", !(p==="view"||p==="result"));
  info.classList.toggle("scg-hidden", p!=="dash");
  CELL.x.cv.style.display = (p==="dash") ? "none" : "";
  vpTL.textContent=""; vpBL.textContent=""; vpBR.textContent="";
  requestAnimationFrame(layoutGrid);
  render();
}

/* =============================================================
   COMMANDS
   ============================================================= */
var COMMANDS = [
  { id:"load", label:"LOAD PATIENT · HEAD FIRST", key:"load", phases:["setup"], needs:"canLoad", primary:true, run:function(){ loadPatient(); } },
  { id:"loc",  label:"RUN 3-PLANE LOCALISER", key:"loc", phases:["setup"], needs:"loaded", primary:true, run:function(){ runLocaliser(); } },
  { id:"auto", label:"AUTO-PLAN (coverage + FOV only)", key:"auto", phases:["plan"], run:function(){ autoPlan(); } },
  { id:"scan", label:"▶ SCAN THIS SEQUENCE", key:"scan", phases:["plan"], needs:"canScan", primary:true, run:function(){ scanSeq(); } },
  { id:"cancel", label:"◀ BACK TO PROTOCOL", key:"back", phases:["plan","view"], run:function(){ gotoDash(); } },
  { id:"finish", label:"FINISH · DEBRIEF", key:"finish", phases:["dash","view"], needs:"allDone", primary:true, run:function(){ showResult(); } },
  { id:"reset", label:"RESET", key:"reset", phases:["dash","plan","view","result"], run:function(){ resetAll(); } }
];
function cmdEnabled(c){
  if(c.phases.indexOf(S.phase)<0) return false;
  if(c.needs==="canLoad") return !!S.pos && !S.loaded && !S.loading;
  if(c.needs==="loaded") return !!S.loaded && !locRunning;
  if(c.needs==="canScan") return !!S.cur && canScan(S.cur);
  if(c.needs==="allDone") return TASKS.every(function(q){ return S.done[q]; });
  return true;
}
function scanBlockReason(q){ return !canScan(q) ? "set the tilt on the sagittal first" : ""; }
function renderCmds(){
  cmds.innerHTML="";
  COMMANDS.forEach(function(c){
    if(c.phases.indexOf(S.phase)<0) return;
    if(c.id==="load" && S.loaded) return;
    if(c.id==="loc" && !S.loaded) return;
    var b=document.createElement("button"), en=cmdEnabled(c);
    var pulse=(c.id==="load"&&S.pos)||(c.id==="loc"&&S.loaded)||(c.id==="scan"&&S.cur&&planOK(S.cur)&&canScan(S.cur))||(c.id==="finish"&&en);
    b.className="scg-btn"+(c.primary?" is-primary":"")+(pulse?" is-pulse":"");
    b.disabled=!en;
    b.innerHTML='<span>'+(c.id==="scan" && S.cur && !canScan(S.cur) ? "▶ SCAN · "+scanBlockReason(S.cur) : c.label)+'</span><span class="scg-key">'+c.key+'</span>';
    b.onclick=function(){ logCmd(c.key); c.run(); };
    cmds.appendChild(b);
  });
}
function parseCommand(raw){
  var t=raw.trim().toLowerCase(); if(!t) return;
  logCmd(t);
  var w=t.split(/\s+/);
  if(w[0]==="count") w[0]="cnt"; if(w[1]==="count") w[1]="cnt";
  if(t==="help"){
    log("commands here: "+COMMANDS.filter(function(c){ return c.phases.indexOf(S.phase)>=0; }).map(function(c){ return c.key; }).join(", ")+", help","sys");
    log("workflow: choose the position (bolster | flat | arms) → load → loc → plan sag → scan → plan count → scan → use sag_t2 → plan ax → tilt → scan → finish.","sys");
    log("while planning: slices <n> · thick <mm> · gap <mm> · fov <mm> · tilt <deg> (axial, once a sagittal is on the SAG panel) · straight (sagittal stacks) · auto · scan · back","sys");
    log("after a scan: use <series> (e.g. use sag_t2) puts it in place of its localiser · restore <sag|cor|ax> brings the localiser back · levels toggles the level labels","sys");
    return;
  }
  if(S.phase==="setup" && POS[w[0]]){ choosePos(w[0]); return; }
  if(w[0]==="levels" && (S.phase==="view"||S.phase==="result")){ toggleLevels(); return; }
  if(w[0]==="use" && (S.phase==="dash"||S.phase==="plan")){
    var id = SER[w[1]] ? w[1] : (SEQ[w[1]] ? Object.keys(S.acq).filter(function(i){ return SER[i].task===w[1]; })[0] : null);
    if(id && S.acq[id]) useSeries(id); else log("nothing acquired for '"+(w[1]||"")+"' yet.","warn");
    return;
  }
  if(w[0]==="restore" && CELL[w[1]] && w[1]!=="x" && (S.phase==="dash"||S.phase==="plan")){ restoreLoc(w[1]); return; }
  if(w[0]==="plan" && SEQ[w[1]] && (S.phase==="dash"||S.phase==="view"||S.phase==="plan")){ gotoPlan(w[1]); return; }
  if(S.phase==="plan" && w[0]==="straight"){
    if(TYPE[S.cur]==="ax") log("'straight' resets a sagittal stack — tilt the axial with: tilt <deg>.","warn"); else straighten(S.cur);
    return;
  }
  if(S.phase==="plan" && (w[0]==="tilt"||w[0]==="angle") && !isNaN(parseFloat(w[1]))){
    if(!needsAngle(S.cur)) log("the sagittal stacks stay straight along the spine — drag ⟳ on the coronal or axial panel if you need to turn one, or type: straight.","warn");
    else if(!S.swap.sag) log("drag a completed sagittal onto the SAG panel first — you set the tilt on the real sagittal images.","warn");
    else setAngle(S.cur, parseFloat(w[1]));
    return;
  }
  if(S.phase==="plan" && (w[0]==="slices"||w[0]==="thick"||w[0]==="gap"||w[0]==="fov") && !isNaN(parseFloat(w[1]))){
    var v=parseFloat(w[1]);
    if(w[0]==="slices") setN(S.cur, Math.round(v)); else if(w[0]==="thick") setThk(S.cur, v); else if(w[0]==="gap") setGap(S.cur, v); else setFov(S.cur, v);
    return;
  }
  var c=COMMANDS.filter(function(c){ return c.key===t || c.id===t; })[0];
  if(!c){ log("unknown command: "+t+"  (try: help)","warn"); return; }
  if(c.phases.indexOf(S.phase)<0){ log("'"+t+"' is not available here.","warn"); return; }
  if(!cmdEnabled(c)){ log(c.id==="scan" ? scanBlockReason(S.cur)+"." : "'"+t+"' is locked right now.","warn"); return; }
  c.run();
}
cliForm.addEventListener("submit", function(e){ e.preventDefault(); var v=cli.value; cli.value=""; parseCommand(v); });

/* =============================================================
   RAIL
   ============================================================= */
function kvBlock(rows){ return '<div>'+rows.map(function(r){ return '<div class="scg-kv"><span>'+r[0]+'</span><span>'+r[1]+'</span></div>'; }).join('')+'</div>'; }
function checks(){
  var P=POS[S.pos||"bolster"];
  return [ "Request checked: <b>MRI thoracic spine</b> — 6 weeks of mid-thoracic back pain, worse at night; sagittals C7 to L1, axials through T5–T9 · MR safety questionnaire done, metal removed",
           "Supine, <b>head first</b>, lying straight on the <b>spine array</b> built into the table — thoracic elements switched on",
           P.fit,
           "<b>Skin marker</b> (oil capsule) taped on the back over the tender point",
           "Ear protection + call bell · “breathe gently, and try not to cough or swallow hard during the noise”",
           "Landmark laser on the <b>mid-sternum</b> (about T6–T7)",
           "Landmark sent to isocentre" ];
}
function seqList(q){
  return '<div class="mre-seqs">'+SEQ[q].seqs.map(function(s){
    var on=!!S.chosen[q][s.id];
    return '<label class="'+(on?"is-on":"")+'"><input type="checkbox" data-q="'+q+'" data-s="'+s.id+'"'+(on?" checked":"")+'><span><b>'+s.name+'</b>'+
      (s.have?'<em>IMAGES IN THIS DEMO</em>':(s.rec?'<em>RECOMMENDED</em>':''))+'<br>'+s.why+'</span></label>';
  }).join('')+'</div>';
}
function bindSeqList(){
  Array.prototype.forEach.call(railBody.querySelectorAll(".mre-seqs input"), function(cb){
    cb.onchange=function(){ var q=cb.dataset.q, s=cb.dataset.s; if(cb.checked) S.chosen[q][s]=1; else delete S.chosen[q][s]; renderRail(); };
  });
}
function angText(q, ok){
  return TYPE[q]==="ax" ? (ok ? "Tilt: square to the canal through the block" : "Tilt: not yet square to the canal")
                        : (ok ? "Stack runs straight along the spine" : "Stack is turned off the line of the spine");
}
function covBlock(q){
  var a=analyse(q);
  return '<div class="mre-cov">'+a.key.map(function(k){ return '<div class="'+(k.ok?"ok":"miss")+'"><i>'+(k.ok?"✓":"✗")+'</i><span>'+k.name+'</span></div>'; }).join('')+
    '<div class="'+(a.angOK?"ok":"miss")+'"><i>'+(a.angOK?"✓":"!")+'</i><span>'+angText(q, a.angOK)+'</span></div>'+
    (a.coarse?'<div class="miss"><i>!</i><span>FOV over '+LIM[q].coarse+' mm — pixels '+a.res.toFixed(2)+' mm, too coarse for '+(q==="ax"?"the cord and foramina":"the cord and endplates")+'</span></div>':'')+
    (a.narrow?'<div class="miss"><i>!</i><span>FOV under '+LIM[q].narrow+' mm — the chest and back wrap into the image</span></div>':'')+
    (a.over?'<div class="miss"><i>·</i><span>More slices than needed — extra coverage adds scan time</span></div>':'')+'</div>';
}
function angleBlock(q){
  if(!needsAngle(q)){
    var ok=angOK(q);
    return '<div class="mre-angbox '+(ok?"is-ok":"is-bad")+'"><b class="t">LINE OF THE SPINE</b><div class="scg-hint '+(ok?"is-ok":"is-warn")+'">'+
      (ok ? "✓ Straight along the spine (rotation "+deg1(sagRot(q))+" on the axial, lean "+deg1(sagLean(q))+" on the coronal). This spine is straight; with a scoliosis you would turn the stack to follow the curve."
          : "The stack is turned "+deg1(sagRot(q))+" on the axial and leans "+deg1(sagLean(q))+" on the coronal — this spine runs straight, so the slices now cut across it. Drag ⟳ back, or type <b>straight</b>.")+'</div></div>';
  }
  var a=analyse(q), sw=!!S.swap.sag;
  if(!sw){
    var ids=Object.keys(S.acq).filter(function(id){ return SER[id].task==="sag"; });
    return '<div class="mre-angbox is-bad"><b class="t">AXIAL TILT ON THE SAGITTAL · 🔒 LOCKED</b>'+
      '<div class="mre-ang"><span>TILT</span><button type="button" class="is-lock" data-d="-5">−5°</button><button type="button" class="is-lock" data-d="-1">−1°</button><output>'+deg1(axTilt(q))+'</output><button type="button" class="is-lock" data-d="1">+1°</button><button type="button" class="is-lock" data-d="5">+5°</button></div>'+
      '<div class="scg-hint is-warn">To unlock the tilt, drag a sagittal below onto the <b>SAG</b> panel (top left) — or tap it. You angle the axials on the diagnostic sagittal, where the discs and canal are sharp.</div>'+
      '<div class="mre-tray">'+ids.map(function(id){ return '<button type="button" class="mre-thumb" data-id="'+id+'" title="Drag onto the SAG localiser"><canvas width="152" height="152"></canvas><span>SAG · '+SER[id].seq+'</span></button>'; }).join('')+'</div></div>';
  }
  return '<div class="mre-angbox '+(a.angOK?"is-ok":"is-bad")+'"><b class="t">AXIAL TILT ON THE SAGITTAL</b>'+
    '<div class="mre-ang"><span>TILT</span><button type="button" data-d="-5">−5°</button><button type="button" data-d="-1">−1°</button><output>'+deg1(axTilt(q))+'</output><button type="button" data-d="1">+1°</button><button type="button" data-d="5">+5°</button></div>'+
    '<div class="scg-hint '+(a.angOK?"is-ok":"is-warn")+'">'+(a.angOK ? "✓ Square to the canal across T5–T9 — each slice cuts the cord in true cross-section."
      : Math.abs(axCor(q)) > TOLS ? "The block leans "+deg1(axCor(q))+" on the coronal — keep it level side to side; only the sagittal tilt is needed here."
      : "On the SAG panel, drag ⟳ until the slice lines cross the canal at right angles through T5–T9 (parallel to the discs there). The spine leans back as it goes down, so the back of each slice has to lift.")+'</div></div>';
}
function renderRail(){
  var p=S.phase;
  if(p==="setup"){
    railTitle.textContent="Patient set-up"; railDesc.textContent="Thoracic spine · spine array, head first";
    var CH=checks(), done=S.loaded ? CH.length : (S.loading ? S.checkN||1 : 1);
    railBody.innerHTML=(S.loaded||S.loading ? "" :
      '<div class="scg-hint">How should the patient lie for a 25-minute scan of the thoracic spine? Pick a position to see it — you can change it until you load.</div>'+
      '<div class="scg-choice">'+Object.keys(POS).map(function(k){ return '<button type="button" data-p="'+k+'" class="'+(S.pos===k?"is-on":"")+'"><b>'+POS[k].label+'</b><span>'+POS[k].desc+'</span></button>'; }).join('')+'</div>')+
      (S.pos ? '<div class="scg-hint '+(POS[S.pos].cls==="ok"?"is-ok":"is-warn")+'">'+POS[S.pos].note+'</div>'+
        '<div class="scg-check">'+CH.map(function(c,i){ return '<div class="'+(i<done?"is-done":"")+'"><i>'+(i<done?"✓":"○")+'</i><span>'+c+'</span></div>'; }).join('')+'</div>'+
        '<div class="scg-hint">'+(S.loaded?"Mid-sternum at isocentre. Command: <b>loc</b> — 3-plane localiser.":S.loading?"Table moving…":"Command: <b>load</b> — the table moves head first and the landmark is sent to isocentre.")+'</div>' : "");
    Array.prototype.forEach.call(railBody.querySelectorAll(".scg-choice button"), function(b){ b.onclick=function(){ logCmd(b.dataset.p); choosePos(b.dataset.p); }; });
  }
  else if(p==="loc"){
    railTitle.textContent="Localiser"; railDesc.textContent="3-plane gradient echo · "+C.loc.fov.toFixed(0)+" mm FOV";
    railBody.innerHTML=kvBlock([["Sequence","fast GRE · sagittal + coronal + axial"],["FOV",C.loc.fov.toFixed(0)+" mm · 256 matrix · 5 mm"],["Position",POS[S.pos].short]])+
      '<div class="scg-hint">Each image is built line by line: every phase-encode step fills one row of <b>k-space</b> (bottom right). The centre rows carry the contrast, the outer rows the fine detail — watch the image appear, then sharpen.</div>'+
      '<div class="scg-hint">These are the study\'s own scout images. Notice what a '+C.loc.fov.toFixed(0)+' mm scout of the chest does <b>not</b> show: the skull base and C2 above, the sacrum below — nothing to count the vertebrae from.</div>';
  }
  else if(p==="dash"){
    railTitle.textContent="Protocol"; railDesc.textContent="Sagittal first — then count the levels and angle the axials";
    railBody.innerHTML='<div class="mre-cards">'+TASKS.map(function(q){
      var d=S.done[q], ok=d && planOK(q), locked=q!=="sag" && !S.done.sag,
          names=SEQ[q].seqs.filter(function(s){ return S.chosen[q][s.id]; }).map(function(s){ return s.name; });
      return '<div class="mre-card'+(d?" is-done":"")+(locked?" is-locked":"")+'"><div class="mre-card-h"><i class="mre-sw" style="background:'+COLORS[q]+'"></i><b>'+SEQ[q].name+'</b>'+
        '<span class="mre-chip '+(d?(ok?"ok":"warn"):"")+'">'+(d?(ok?"✓ SCANNED":"⚠ SCANNED · GAPS"):(locked?"🔒 AFTER THE SAGITTAL":"○ NOT PLANNED"))+'</span></div>'+
        '<p>'+(names.length?names.join(" · "):"no sequence chosen")+'</p>'+
        (d?'<p>'+spanText(q)+' · '+S.plan[q].n+' slices'+(needsAngle(q)?' · tilt '+deg1(axTilt(q)):'')+'</p>':
          (locked?'<p>'+(q==="ax"?"Scan the sagittal first — the axial block is tilted on those images.":"Scan the sagittal first — the counting localiser has to overlap it.")+'</p>':''))+
        '<button class="scg-btn'+(d||locked?"":" is-primary")+'" type="button" data-q="'+q+'"'+(locked?" disabled":"")+'><span>'+(d?"RE-PLAN":"PLAN")+' '+SEQ[q].name+'</span><span class="scg-key">plan '+(q==="cnt"?"count":q)+'</span></button></div>';
    }).join('')+'</div><div class="scg-hint">The localisers on the left show every stack you have scanned so far, in its colour.</div>'+trayBlock();
    Array.prototype.forEach.call(railBody.querySelectorAll(".mre-card button"), function(b){ b.onclick=function(){ logCmd("plan "+(b.dataset.q==="cnt"?"count":b.dataset.q)); gotoPlan(b.dataset.q); }; });
    bindTray();
  }
  else if(p==="plan"){
    var q=S.cur, pl=S.plan[q], a=analyse(q), ok=planOK(q), ids=imaged(q);
    railTitle.textContent="Plan · "+SEQ[q].name; railDesc.textContent= needsAngle(q) ? "Tilt on the sagittal · size on any panel" : "Drag the box on any panel — all three stay linked";
    railBody.innerHTML='<div class="scg-hint '+(ok?"is-ok":"is-warn")+'">'+(ok?(q==="sag"?"C7 to L1, edge to edge, straight along the spine.":q==="cnt"?"C2 is in the FOV and the stack overlaps the T-spine sagittal.":"T5 to T9 covered, square to the canal.")+" Command: <b>scan</b>":SEQ[q].hint)+'</div>'+
      angleBlock(q)+
      kvBlock([[TYPE[q]==="ax"?"Levels":"Levels in the FOV",'<b style="color:'+(a.all?"var(--accent)":"var(--warn)")+'">'+spanText(q)+'</b>'],
               ["Coverage",a.cov.toFixed(0)+" mm "+(TYPE[q]==="ax"?"along the spine":"side to side")],
               ["FOV / matrix",pl.fov+" mm · "+MAT[q]+" · "+a.res.toFixed(2)+" mm px"],
               ["Est. scan time","≈ "+mmss(ids.reduce(function(t,id){ return t+scanTime(id); },0))+" ("+ids.map(function(id){ return SER[id].seq; }).join(" + ")+")"]])+
      '<div class="mre-step"><span>SLICES</span><button type="button" data-a="n" data-d="-1">−</button><output>'+pl.n+'</output><button type="button" data-a="n" data-d="1">+</button></div>'+
      '<div class="mre-step"><span>THICK</span><button type="button" data-a="thk" data-d="-0.5">−</button><output>'+pl.thk+' mm</output><button type="button" data-a="thk" data-d="0.5">+</button></div>'+
      '<div class="mre-step"><span>GAP</span><button type="button" data-a="gap" data-d="-0.5">−</button><output>'+pl.gap.toFixed(1)+' mm</output><button type="button" data-a="gap" data-d="0.5">+</button></div>'+
      '<div class="mre-step"><span>FOV</span><button type="button" data-a="fov" data-d="-10">−</button><output>'+pl.fov+' mm</output><button type="button" data-a="fov" data-d="10">+</button></div>'+
      '<div class="scg-hint">Anatomy in this stack:</div>'+covBlock(q)+
      trayBlock()+
      '<div class="scg-hint">Sequences to run with this plan (tick what you would acquire):</div>'+seqList(q);
    Array.prototype.forEach.call(railBody.querySelectorAll(".mre-step button"), function(b){
      b.onclick=function(){ var d=parseFloat(b.dataset.d), pl=S.plan[S.cur];
        if(b.dataset.a==="n") setN(S.cur, pl.n+d); else if(b.dataset.a==="thk") setThk(S.cur, pl.thk+d); else if(b.dataset.a==="gap") setGap(S.cur, pl.gap+d); else setFov(S.cur, pl.fov+d); };
    });
    Array.prototype.forEach.call(railBody.querySelectorAll(".mre-ang button"), function(b){
      b.onclick=function(){ var d=parseFloat(b.dataset.d), a=Math.round(axTilt(S.cur))+d; logCmd("tilt "+a);
        if(!S.swap.sag){ log("drag a completed sagittal onto the SAG panel first — you set the tilt on the real sagittal images.","warn"); return; }
        setAngle(S.cur, a); };
    });
    bindSeqList(); bindTray();
  }
  else if(p==="acquire"){
    var cq=S.cur;
    railTitle.textContent="Acquiring · "+SEQ[cq].name; railDesc.textContent=imaged(cq).map(function(id){ return SER[id].seq; }).join(" + ");
    railBody.innerHTML=kvBlock([["Slices",S.plan[cq].n+" × "+S.plan[cq].thk+" mm"],["Est. time","≈ "+mmss(imaged(cq).reduce(function(t,id){ return t+scanTime(id); },0))+" (shown faster)"],
      ["Patient","“breathe gently and keep still — this one is noisy”"]]);
  }
  else if(p==="view"){
    var v=S.viewId, vq=SER[v].task, an=analyse(vq);
    railTitle.textContent=SEQ[vq].name+" · images"; railDesc.textContent="Scroll the slices your plan covers";
    railBody.innerHTML=kvBlock([["Series",SER[v].seq+" · "+SER[v].params],["Images",S.list.length+" of "+SER[v].n+" slices"],[TYPE[vq]==="ax"?"Levels":"Levels in the FOV",spanText(vq)],["Navigate","wheel / drag / ↑ ↓"]])+
      covBlock(vq)+'<div class="scg-hint">'+(an.all?"Everything you need from this plan is in the stack.":"Anything ticked ✗ was outside your stack or FOV — it would need another scan.")+
      (vq==="sag" ? (S.counted ? ' The levels are numbered from your counting localiser.' : ' The vertebrae are marked <b>?</b> — nothing in this FOV says which is which. Next: <b>back</b>, then the <b>counting localiser</b>; for the axials, drag a sagittal onto the <b>SAG</b> panel to set the tilt.')
        : vq==="cnt" ? (S.counted ? ' C2 is in the image: count down from it — every thoracic level now has a number, here and on the sagittals.' : ' C2 is not in this image, so the levels still can\'t be numbered. Re-plan it higher.')
        : ' <b>back</b> returns to the protocol.')+'</div>';
  }
  else if(p==="result"){
    railTitle.textContent="Review"; railDesc.textContent="Every series you acquired · scroll each stack";
    railBody.innerHTML=kvBlock(TASKS.map(function(q){ return [SEQ[q].name, S.plan[q].n+" sl"+(needsAngle(q)?" · tilt "+deg1(axTilt(q)):"")+" · "+(planOK(q)?"✓":"⚠")]; }).concat([["POSITION",POS[S.pos].short+" · "+(POS[S.pos].cls==="ok"?"✓":"⚠")]]))+
      '<div class="scg-hint">Switch series with the buttons on the image. The full debrief, sequences to consider and credits are below.</div>';
  }
  else { railTitle.textContent="Console"; railDesc.textContent="Awaiting operator"; railBody.innerHTML=""; }
}
function setN(q, n){ var pl=S.plan[q], F=frame(q), lo=edges(q)[0]-dot(sub(pl.c,HH),F.n); pl.n=Math.max(3, Math.min(LIM[q].nmax, Math.round(n))); pl.c=axpy(pl.c, F.n, lo+coverage(pl)/2); afterPlan(); }
function setThk(q, t){ var L=LIM[q]; S.plan[q].thk=Math.max(L.tmin, Math.min(L.tmax, Math.round(t*2)/2)); afterPlan(); }
function setGap(q, g){ S.plan[q].gap = Math.max(0, Math.min(5, Math.round(g*10)/10)); afterPlan(); }
function setFov(q, f){ var L=LIM[q]; S.plan[q].fov=Math.max(L.fmin, Math.min(L.fmax, Math.round(f/5)*5)); afterPlan(); }
function afterPlan(){ clampPlan(S.cur); drawOverlays(); schedulePreview(); render(); }
function render(){ renderCmds(); renderRail(); if(S.phase==="dash"||S.phase==="plan"||S.phase==="result") drawOverlays(); if(S.phase==="dash") renderInfo(); }
function renderInfo(){
  CELL.x.lab.textContent=""; CELL.x.lab2.textContent="";
  info.innerHTML='<b>PROTOCOL · THORACIC SPINE</b><div>Position: '+POS[S.pos].short+' · head first · spine array</div>'+
    TASKS.map(function(q){ var d=S.done[q];
      return '<div class="mre-row"><i class="mre-sw" style="background:'+COLORS[q]+'"></i><span><b>'+SEQ[q].name+'</b> · '+(d?(S.plan[q].n+" slices · "+spanText(q)+" · "+(planOK(q)?"✓":"⚠")):(q!=="sag"&&!S.done.sag?"after the sagittal":"not planned yet"))+'</span></div>'; }).join('')+
    '<div style="margin-top:6px">Order matters: the <b>sagittal</b> goes first, straight along the spine from C7 to L1. The <b>counting localiser</b> then reaches up to C2 so the thoracic levels can be numbered. The <b>axial</b> block is tilted on your real sagittal images — square to the canal through the requested levels, T5 to T9.</div>'+
    (Object.keys(S.acq).length?'<div>Completed series can replace the localiser of the same plane — drag them in from the tray on the right.</div>':'');
}

/* =============================================================
   SET-UP
   ============================================================= */
function choosePos(p){
  if(S.loaded || S.loading || S.pos===p) return;
  S.pos=p;
  log(POS[p].note, POS[p].cls==="ok"?"ok":"warn");
  if(room3d) room3d.setPose(p);
  setRoomCaption(); render();
  log("Command: <b>load</b>","sys");
}
function setRoomCaption(){
  room.querySelector(".scg-roomcap b").textContent = S.pos ? POS[S.pos].cap : "PATIENT ON THE TABLE";
  $("scgRoomStep").textContent = S.pos ? POS[S.pos].sub+" · on the spine array" : "supine, head first, on the spine array — choose how the patient lies";
}
var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
var room3d=null, room3dTried=false;
window.__room=function(){ return room3d; };
function init3D(){
  if(room3dTried){ if(room3d){ room3d.setPose(S.pos||"bolster"); room3d.reset(); room3d.start(); } return; }
  room3dTried=true;
  if(!window.SCG_ROOM3D) return;
  import(THREE_URL).then(function(THREE){
    try{
      room3d=window.SCG_ROOM3D(THREE, $("scgRoom3d"));
      room3d.setPose(S.pos||"bolster");
      room.classList.add("is-3d"); room3d.start();
      if(S.loading) room3d.finish();
    }catch(e){ room3d=null; room.classList.remove("is-3d"); if(window.console) console.error(e); }
  }).catch(function(){ room3d=null; });
}
function gotoSetup(){
  setPhase("setup"); setRoomCaption(); init3D();
  log("MRI thoracic spine requested — 6 weeks of mid-thoracic back pain, worse at night. Sagittals from C7 to L1, axials through T5–T9. The patient is on the table, supine, head first, lying on the spine array.","sys");
}
function loadPatient(){
  if(S.loaded||S.loading||!S.pos) return;
  S.loading=true; S.checkN=3; render();
  var stepTx=$("scgRoomStep");
  function finishLoad(){ S.checkN=checks().length; S.loading=false; S.loaded=true;
    stepTx.textContent="mid-sternum at isocentre";
    log("landmark at isocentre. Command: <b>loc</b>","ok"); render(); }
  if(room3d){
    log("table moving — head first toward the magnet…","sys");
    room3d.play(function(step){
      if(step===1){ S.checkN=5; stepTx.textContent="table moving head first"; }
      if(step===2){ S.checkN=6; stepTx.textContent="landmark laser on the mid-sternum"; log("laser on — mid-sternum landmarked (about T6–T7).","sys"); }
      if(step===3){ stepTx.textContent="sending the landmark to isocentre"; }
      if(step===4){ stepTx.textContent="in the bore: the mid-thoracic spine sits at isocentre"; }
      render();
    }, finishLoad);
    return;
  }
  var iv=setInterval(function(){ S.checkN++; render(); if(S.checkN>=checks().length){ clearInterval(iv); finishLoad(); } }, 700);
}

/* =============================================================
   LOCALISER (k-space fill of the 3-plane localiser)
   ============================================================= */
var locRunning=false;
function runLocaliser(){
  if(locRunning||!S.loaded) return;
  locRunning=true;
  if(room3d) room3d.stop();
  setPhase("loc");
  PANELS.forEach(function(p){ var c=CELL[p]; c.img.style.display="none"; c.svg.innerHTML=""; c.cv.width=c.cv.height=256; c.el.classList.add("is-wait"); c.lab.textContent=NAME[p]+" LOCALISER\nwaiting"; c.lab2.textContent=""; });
  CELL.x.cv.width=CELL.x.cv.height=256; CELL.x.lab.textContent="K-SPACE"; CELL.x.lab2.textContent="";
  log("3-plane localiser: fast gradient echo, "+C.loc.fov.toFixed(0)+" mm FOV — “keep still, about 20 seconds”.","sys");
  var order=["sag","cor","ax"], i=0;
  (function next(){
    if(S.phase!=="loc") return;
    if(i>=order.length){ locRunning=false; S.locDone=true; log("localiser complete — 3 images stored.","ok"); gotoDash(); return; }
    var p=order[i++];
    prepK(p, function(){ acquireLoc(p, next); });
  })();
}
function acquireLoc(p, done){
  var c=CELL[p], K=KS[p], kg=CELL.x.cv.getContext("2d"), dur=2300, t0=performance.now(), last=-1;
  c.el.classList.remove("is-wait"); c.el.classList.add("is-active");
  var bar=document.createElement("i"); bar.className="mre-acqbar"; c.el.appendChild(bar);
  function frame(now){
    if(S.phase!=="loc"){ bar.remove(); return; }
    var f=Math.min(1,(now-t0)/dur), lines=Math.round(f*LN);
    if(lines-last>=6 || f>=1){
      last=lines;
      if(K){
        partialRecon(p, lines, c.cv);
        kg.fillStyle="#000"; kg.fillRect(0,0,256,256);
        if(lines>0) kg.drawImage(K.kc, 0, 0, 256, lines, 0, 0, 256, lines);
        kg.fillStyle="rgba(95,224,138,.9)"; kg.fillRect(0, Math.min(255,lines), 256, 1.5);
      }
      c.lab.textContent=NAME[p]+" LOCALISER\nphase-encode "+lines+" / 256";
      CELL.x.lab.textContent="K-SPACE · "+NAME[p]+"\nline "+lines+" / 256";
      bar.style.width=(f*100)+"%";
    }
    if(f<1){ requestAnimationFrame(frame); return; }
    bar.remove(); c.el.classList.remove("is-active");
    c.img.style.display=""; c.lab.textContent=NAME[p]+" LOCALISER\nGRE · 5 mm";
    setTimeout(done, 250);
  }
  requestAnimationFrame(frame);
}

/* =============================================================
   PROTOCOL DASHBOARD + PLANNING
   ============================================================= */
function gotoDash(){
  setPhase("dash");
  refreshCells();
  render();
  if(!Object.keys(S.done).length) log("start with the <b>sagittal</b> (<b>plan sag</b>). The counting localiser and the axial unlock once it is scanned.","sys");
}
function gotoPlan(q){
  if(q!=="sag" && !S.done.sag){ log("scan the sagittal first — "+(q==="ax"?"the axial block is tilted on those images.":"the counting localiser has to overlap it."),"warn"); return; }
  S.cur=q;
  CELL.x.cv.width=CELL.x.cv.height=384;
  setPhase("plan");
  refreshCells();
  drawPreview();
  log("planning the <b>"+SEQ[q].name.toLowerCase()+"</b>: "+SEQ[q].hint,"sys");
  if(needsAngle(q) && !S.swap.sag) log("drag a sagittal from the tray onto the <b>SAG</b> panel to unlock the tilt handle.","warn");
}
/* ---- completed series can replace the localiser of the same plane ---- */
function cellLabel(p){
  var base=NAME[p]+" LOCALISER";
  if(!S.swap[p]) return base;
  var sw=S.swap[p], s=SER[sw.id], list=S.acq[sw.id];
  return NAME[p]+" · "+(s.task==="cnt"?"COUNT ":"")+s.seq+" (series)\nIM "+(sw.i+1)+"/"+list.length+" · scroll";
}
function refreshCells(){
  PANELS.forEach(function(p){
    var c=CELL[p], on=!!S.swap[p];
    c.el.classList.toggle("is-series", on);
    c.img.style.display = on ? "none" : "";
    var rb=c.el.querySelector(".mre-restore"), sc=c.el.querySelector(".mre-scroll");
    if(on && !rb){
      rb=document.createElement("button"); rb.type="button"; rb.className="mre-restore"; rb.textContent="↺ LOC";
      rb.onclick=function(){ logCmd("restore "+p); restoreLoc(p); }; c.el.appendChild(rb);
      sc=document.createElement("div"); sc.className="mre-scroll";
      sc.innerHTML='<button type="button" aria-label="previous slice">▲</button><button type="button" aria-label="next slice">▼</button>';
      sc.children[0].onclick=function(){ scrollCell(p, -1); }; sc.children[1].onclick=function(){ scrollCell(p, 1); };
      c.el.appendChild(sc);
    }
    if(!on && rb){ rb.remove(); if(sc) sc.remove(); }
    if(on) drawCellSeries(p); else { if(c.cv.width!==256){ c.cv.width=c.cv.height=256; } c.cv.getContext("2d").clearRect(0,0,256,256); }
    c.lab.textContent=cellLabel(p);
  });
}
function drawCellSeries(p){
  var c=CELL[p], cv=c.cv, sw=S.swap[p], k=S.acq[sw.id][sw.i];
  if(cv.width!==512){ cv.width=cv.height=512; }
  getImg(imgName(sw.id, k), function(im){
    if(!S.swap[p] || S.acq[S.swap[p].id][S.swap[p].i]!==k) return;
    var g=cv.getContext("2d"); g.setTransform(1,0,0,1,0,0); g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high";
    g.drawImage(im, 0, 0, 512, 512);
  });
}
var MID = [X0, LM.t7[1], LM.t7[2]];                            // mid-line at T7: where a series opens
function closestIn(id, list, P){ var b=0; list.forEach(function(k, j){ if(Math.abs(dot(sub(P, SER[id].ipp[k]), SER[id].nrm)) < Math.abs(dot(sub(P, SER[id].ipp[list[b]]), SER[id].nrm))) b=j; }); return b; }
function useSeries(id){
  if(!S.acq[id]) return;
  var p=SER[id].plane, list=S.acq[id];
  S.swap[p]={ id:id, i:closestIn(id, list, MID) };
  log((SER[id].task==="cnt"?"counting ":"")+SER[id].seq+" now replaces the "+NAME[p]+" localiser"+(p==="sag"?" — opened on the mid-line. Tilt the axial block so its slices cross the canal at right angles.":" — sharper anatomy to plan on."),"ok");
  refreshCells(); render(); schedulePreview();
}
function restoreLoc(p){ delete S.swap[p]; log(NAME[p]+" localiser restored.","sys"); refreshCells(); render(); schedulePreview(); }
function scrollCell(p, d){
  var sw=S.swap[p]; if(!sw) return;
  var i=Math.max(0, Math.min(S.acq[sw.id].length-1, sw.i+d)); if(i===sw.i) return;
  sw.i=i; drawCellSeries(p); CELL[p].lab.textContent=cellLabel(p); drawOverlays();
}
PANELS.forEach(function(p){
  CELL[p].el.addEventListener("wheel", function(e){ if(!S.swap[p] || !(S.phase==="plan"||S.phase==="dash")) return; e.preventDefault(); scrollCell(p, e.deltaY>0?1:-1); }, { passive:false });
});
function thumbName(id){ return (SER[id].task==="cnt" ? "COUNT" : NAME[SER[id].plane])+' · '+SER[id].seq; }
function trayBlock(){
  var ids=Object.keys(S.acq);
  if(!ids.length) return "";
  return '<div class="scg-hint">Completed series — <b>drag one onto its localiser</b> (or tap it) to plan on the real images:</div><div class="mre-tray">'+
    ids.map(function(id){ var p=SER[id].plane; return '<button type="button" class="mre-thumb'+(S.swap[p]&&S.swap[p].id===id?" is-used":"")+'" data-id="'+id+'" title="Drag onto the '+NAME[p]+' localiser"><canvas width="152" height="152"></canvas><span>'+thumbName(id)+'</span></button>'; }).join('')+'</div>';
}
var tdrag=null;
function bindTray(){
  Array.prototype.forEach.call(railBody.querySelectorAll(".mre-thumb"), function(b){
    var id=b.dataset.id, p=SER[id].plane, cv=b.querySelector("canvas"), list=S.acq[id];
    renderSeries(id, list[closestIn(id, list, MID)], cv);
    b.addEventListener("pointerdown", function(e){
      e.preventDefault();
      tdrag={ id:id, p:p, x:e.clientX, y:e.clientY, moved:false, ghost:null, src:cv };
      try{ b.setPointerCapture(e.pointerId); }catch(_){}
    });
    b.addEventListener("pointermove", function(e){
      if(!tdrag) return;
      if(!tdrag.moved && Math.hypot(e.clientX-tdrag.x, e.clientY-tdrag.y) < 6) return;
      if(!tdrag.moved){
        tdrag.moved=true;
        var g=document.createElement("canvas"); g.className="mre-ghost"; g.width=g.height=76;
        try{ g.getContext("2d").drawImage(tdrag.src, 0, 0, 76, 76); }catch(_){}
        document.body.appendChild(g); tdrag.ghost=g;
        PANELS.forEach(function(q){ CELL[q].el.classList.toggle("is-nodrop", q!==tdrag.p); });
      }
      tdrag.ghost.style.left=e.clientX+"px"; tdrag.ghost.style.top=e.clientY+"px";
      CELL[tdrag.p].el.classList.toggle("is-drop", dropCell(e.clientX, e.clientY)===tdrag.p);
    });
    function end(e){
      if(!tdrag) return;
      var d=tdrag; tdrag=null;
      if(d.ghost) d.ghost.remove();
      PANELS.forEach(function(q){ CELL[q].el.classList.remove("is-drop","is-nodrop"); });
      if(!d.moved){ if(e.type==="pointerup"){ logCmd("use "+d.id); useSeries(d.id); } return; }
      var over=e.type==="pointerup" ? dropCell(e.clientX, e.clientY) : null;
      if(!over) return;
      logCmd("use "+d.id);
      if(over!==d.p) log("the "+SER[d.id].seq+" images are "+NAME[d.p]+" slices — they can only replace the "+NAME[d.p]+" localiser.","warn");
      else useSeries(d.id);
    }
    b.addEventListener("pointerup", end); b.addEventListener("pointercancel", end);
  });
}
function dropCell(x, y){
  var el=document.elementFromPoint(x, y), cell=el && el.closest ? el.closest(".mre-cell") : null;
  return cell && cell.dataset.p!=="x" ? cell.dataset.p : null;
}
function autoPlan(){
  var q=S.cur, id=SEQ[q].ideal, s=SER[id], pl=S.plan[q];
  pl.c=seriesCentre(id).map(function(v){ return Math.round(v*2)/2; });
  pl.n=s.n; pl.thk=s.thk; pl.gap=Math.round((s.sp-s.thk)*10)/10;
  pl.fov=SEQ[q].fov;
  log("auto-plan: the coverage and FOV the radiographer used for the "+SEQ[q].name.toLowerCase()+(needsAngle(q)?" — the tilt is still yours to set.":"."),"sys");
  afterPlan();
}

/* =============================================================
   ACQUIRE + VIEW
   ============================================================= */
function scanSeq(){
  var q=S.cur, a=analyse(q);
  if(!canScan(q)){ log(scanBlockReason(q)+".","warn"); return; }
  if(!a.all) log("scanning with gaps: "+a.key.filter(function(k){ return !k.ok; }).map(function(k){ return k.name.toLowerCase(); }).join("; ")+" not covered.","warn");
  var ids=imaged(q);
  if(!SEQ[q].seqs.some(function(s){ return s.have && S.chosen[q][s.id]; })) log("no imaged sequence ticked — acquiring "+SER[ids[0]].seq+" so there is something to look at.","sys");
  setPhase("acquire");
  acqEl.classList.remove("scg-hidden"); acqTitle.textContent="ACQUIRING · "+SEQ[q].name;
  var t0=performance.now(), dur=2400*ids.length, total=ids.reduce(function(t,id){ return t+scanTime(id); },0);
  (function tick(now){
    if(S.phase!=="acquire") return;
    var f=Math.max(0, Math.min(1,((now||performance.now())-t0)/dur)), cur=ids[Math.min(ids.length-1, Math.floor(f*ids.length))];
    acqNum.textContent=SER[cur].seq+" · "+S.plan[q].n+" slices · "+mmss(Math.round(total*(1-f)))+" remaining";
    if(f<1){ requestAnimationFrame(tick); return; }
    S.done[q]=true;
    Object.keys(S.acq).forEach(function(id){ if(SER[id].task===q) delete S.acq[id]; });
    ids.forEach(function(id){ var l=coveredSlices(id); S.acq[id]= l.length ? l : [nearestSlice(id, S.plan[q].c)]; });
    S.ids[q]=ids;
    Object.keys(S.swap).forEach(function(p){ var sw=S.swap[p]; if(!S.acq[sw.id]) delete S.swap[p]; else sw.i=Math.min(sw.i, S.acq[sw.id].length-1); });
    if(q==="cnt"){
      S.counted = inBox("cnt", LM.dens) && inBox("cnt", LM.t1);
      log(S.counted ? "C2 is in the image — count down from it: the thoracic levels are numbered from here on." : "C2 is not in the counting localiser — the levels still can't be numbered.", S.counted?"ok":"warn");
    }
    if(q==="sag") log("tip: for the axials, drag a sagittal onto the SAG panel — that is where you set their tilt. And nothing here says which vertebra is which: plan the counting localiser.","sys");
    log(SEQ[q].name.toLowerCase()+" acquired — "+ids.map(function(id){ return SER[id].seq+" "+S.acq[id].length+" images"; }).join(", ")+".", planOK(q)?"ok":"warn");
    showSeries(ids[0], "view");
  })();
}
function viewIds(){ return S.phase==="result" ? Object.keys(S.acq) : (S.ids[SER[S.viewId].task]||[S.viewId]); }
function toggleLevels(){ S.lv=!S.lv; showButtons(); drawView(); }
function showButtons(){
  var id=S.viewId;
  winBtns.innerHTML=viewIds().map(function(i){ return '<button type="button" data-id="'+i+'" class="'+(i===id?"is-on":"")+'">'+(SER[i].task==="cnt"?"COUNT":NAME[SER[i].task])+' '+SER[i].seq+'</button>'; }).join('')+
    (SER[id].plane==="sag" ? '<button type="button" class="scg-pebtn'+(S.lv?" is-on":"")+'" data-lv="1">LEVELS</button>' : '');
  Array.prototype.forEach.call(winBtns.querySelectorAll("button"), function(b){
    b.onclick=function(){ if(b.dataset.lv){ logCmd("levels"); toggleLevels(); } else showSeries(b.dataset.id, null); };
  });
}
function showSeries(id, phase){
  S.viewId=id; S.list=S.acq[id];
  if(phase) setPhase(phase);
  stackSlider.max=S.list.length-1; S.viewK=closestIn(id, S.list, MID); stackSlider.value=S.viewK;
  showButtons();
  drawView(); render();
}
function drawView(){
  var id=S.viewId, s=SER[id], q=s.task, k=S.list[S.viewK], c=sliceCentre(id,k), where, pos, drew=false;
  renderSeries(id, k, viewCv, null, function(cr){ if(S.lv && S.viewId===id && S.list[S.viewK]===k) levelLabels(viewCv, id, k, cr); });
  if(TYPE[q]==="ax"){ var z=bodyZ(c, s.nrm); where=levelAt(z); pos="z "+sgn(z-HH[2])+" mm from the landmark"; }
  else { where=sideName(c[0]); pos=(c[0]-X0>=0?"left ":"right ")+Math.abs(c[0]-X0).toFixed(0)+" mm"; }
  vpTL.textContent=SEQ[q].name+" · "+s.seq+"\nIM "+(S.viewK+1)+" / "+S.list.length+"  ·  "+pos+
    (s.plane==="sag" && S.lv ? (Math.abs(s.ipp[k][0]-X0) > 11 ? "\nlevel labels: mid-line slices only" : S.counted ? "\nlevels counted down from C2" : "\nlevels not numbered — no C2 in view yet") : "");
  vpBL.textContent=where;
  vpBR.textContent="FOV "+S.plan[q].fov+" mm\nT-SPINE · 1.5 T";
}
stackSlider.addEventListener("input", function(){ S.viewK=+stackSlider.value; drawView(); });
viewEl.addEventListener("wheel", function(e){ if(!(S.phase==="view"||S.phase==="result")) return; e.preventDefault(); stepView(e.deltaY>0?1:-1); }, { passive:false });
var vdrag=null;
viewEl.addEventListener("pointerdown", function(e){ vdrag={ y:e.clientY, k:S.viewK }; try{ viewEl.setPointerCapture(e.pointerId); }catch(_){} });
viewEl.addEventListener("pointermove", function(e){ if(!vdrag) return; var k=vdrag.k+Math.round((e.clientY-vdrag.y)/12); k=Math.max(0, Math.min(S.list.length-1, k)); if(k!==S.viewK){ S.viewK=k; stackSlider.value=k; drawView(); } });
viewEl.addEventListener("pointerup", function(){ vdrag=null; });
function stepView(d){ var k=Math.max(0, Math.min(S.list.length-1, S.viewK+d)); if(k!==S.viewK){ S.viewK=k; stackSlider.value=k; drawView(); } }
document.addEventListener("keydown", function(e){
  if(!(S.phase==="view"||S.phase==="result") || document.activeElement===cli) return;
  if(e.key==="ArrowDown"||e.key==="ArrowRight"){ e.preventDefault(); stepView(1); }
  if(e.key==="ArrowUp"||e.key==="ArrowLeft"){ e.preventDefault(); stepView(-1); }
});

/* =============================================================
   RESULT
   ============================================================= */
function showResult(){
  var planes=TASKS.every(planOK), posOK=POS[S.pos].cls==="ok", all=planes && posOK;
  setPhase("result");
  showSeries(S.ids.sag[0], null);
  var rows=TASKS.map(function(q){
    var a=analyse(q), ok=planOK(q), A=needsAngle(q);
    return '<div class="scg-drow"><i class="scg-d-'+(ok?"ok":"warn")+'">'+(ok?"✓":"⚠")+'</i><div><b>'+SEQ[q].name+'</b><em>'+S.plan[q].n+' × '+S.plan[q].thk+' mm · FOV '+S.plan[q].fov+(A?' · tilt '+deg1(axTilt(q)):'')+'</em>'+
      '<p>'+(TYPE[q]==="ax"?"Slices from ":"FOV from ")+spanText(q)+' ('+a.cov.toFixed(0)+' mm '+(TYPE[q]==="ax"?"along the spine":"side to side")+'). '+
      (A ? (a.angOK ? "Tilt within "+Math.abs(a.ang).toFixed(0)+"° of the block as it was acquired ("+REF.toFixed(0)+"°). " : "Tilt "+Math.abs(a.ang).toFixed(0)+"° away from square to the canal. ")
         : (a.angOK ? "Straight along the spine. " : "Turned "+deg1(sagRot(q))+" / leaning "+deg1(sagLean(q))+" off the line of the spine. "))+
      (q==="cnt" ? (S.counted ? "C2 is in the image, so every level can be counted. " : "C2 is not in the image — the levels can't be numbered. ") : "")+
      (a.all?"All key structures covered.":"Missed: "+a.key.filter(function(k){ return !k.ok; }).map(function(k){ return k.name; }).join("; ")+".")+
      (a.narrow?" FOV too small: wrap-around.":"")+(a.coarse?" FOV too coarse.":"")+
      (a.over?" More slices than needed — extra coverage adds scan time.":"")+'</p></div></div>';
  }).join('');
  var seqRows=TASKS.map(function(q){
    return SEQ[q].seqs.map(function(s, i){
      var on=!!S.chosen[q][s.id];
      return '<tr class="'+(on?"is-on":"")+'"><td>'+(i===0?'<b>'+SEQ[q].name+'</b>':'')+'</td><td><b>'+s.name+'</b>'+(s.have?" ·&nbsp;shown here":"")+'</td><td>'+s.why+'</td><td>'+(on?"✓ in your protocol":(s.rec?"recommended":"optional"))+'</td></tr>';
    }).join('');
  }).join('');
  var heroLab={ sag:"your axial block", cnt:S.counted?"counted from C2":"no C2 — levels unknown", ax:SER[S.ids.ax[0]].seq+" · mid-block" };
  resultEl.innerHTML=
    '<div><h2'+(all?'':' class="is-bad"')+'>'+(all?"C7 to L1, counted from C2, square to the canal":"Planning debrief")+'</h2>'+
    '<div class="scg-cap">Demonstration only: how much of the thoracic spine your plans cover, whether the levels can be numbered, and how well the axial block is tilted. Position: <b>'+POS[S.pos].short+'</b> — '+POS[S.pos].note+'</div>'+
    '<div class="mre-heroes">'+TASKS.map(function(q){ return '<div class="scg-hero"><canvas width="320" height="320" data-q="'+q+'"></canvas><div class="scg-hero-lab">'+SEQ[q].name+'\n'+heroLab[q]+'</div></div>'; }).join('')+'</div>'+
    '<div class="scg-cap" style="margin-top:6px">On the sagittal: the top and bottom of your axial block (green), with the tilt the block was acquired at dashed. On the counting localiser: the levels, numbered down from C2. On the axial: one slice from the middle of your block.</div>'+
    '<h2 style="margin-top:16px">Sequences to consider</h2><div class="scg-cap">A routine thoracic spine MRI pairs sagittal T1 and T2 with a fat-suppressed fluid-sensitive sagittal (STIR), plus axials through the levels in question; a counting localiser (or whole-spine scout) fixes the level numbering; gadolinium for tumour, infection or leptomeningeal disease. Highlighted rows are the ones you ticked.</div>'+
    '<table class="mre-tbl"><tr><th>Plan</th><th>Sequence</th><th>Shows</th><th></th></tr>'+seqRows+'</table></div>'+
    '<div class="scg-debrief">'+rows+
    '<div class="scg-drow"><i class="scg-d-'+(posOK?"ok":"warn")+'">'+(posOK?"✓":"⚠")+'</i><div><b>Position</b><p>'+POS[S.pos].note+(posOK?"":" The marker needs the arms by the sides and a bolster under the knees.")+'</p></div></div>'+
    '<button class="scg-again" type="button" id="mreAgain">↺ Plan again</button></div>'+
    '<div class="scg-credits">'+CREDITS+'</div>';
  TASKS.forEach(function(q){
    var cv=resultEl.querySelector('canvas[data-q="'+q+'"]'), id=S.ids[q][0], list=S.acq[id], pl=clone(S.plan[q]), k;
    if(q==="sag"){ k=list[closestIn(id, list, MID)]; pl.c=[X0, 85, -194]; pl.fov=340; renderSeries(id, k, cv, pl, function(cr){ heroLines(cv, id, k, cr); }); }
    else if(q==="cnt"){ k=list[closestIn(id, list, MID)]; pl.c=seriesCentre(id); pl.fov=480; renderSeries(id, k, cv, pl, function(cr){ levelLabels(cv, id, k, cr); }); }
    else { k=list[Math.floor(list.length/2)]; var cc=sliceCentre(id, k); pl.c=[X0, 78, cc[2]]; pl.fov=200; renderSeries(id, k, cv, pl); }
  });
  $("mreAgain").onclick=function(){ logCmd("plan again"); S.done={}; S.ids={}; S.acq={}; S.swap={}; S.counted=false; resultEl.classList.add("scg-hidden"); achWrap.classList.add("scg-hidden"); gotoDash(); };
  resultEl.classList.remove("scg-hidden");
  achWrap.classList.toggle("scg-hidden", !all);
  if(all) playAchievement();
  log(all?"C7 to L1 on the sagittals, levels counted from C2, axials square to the canal — marker unlocked.":"debrief ready — "+(planes?"the planning is right; the patient position is not.":"some plans have gaps, the levels aren't counted or the tilt is off."), all?"ok":"warn");
  drawOverlays();
}
var CREDITS = '<b>Imaging:</b> adapted from Cancer Moonshot Biobank (2022), <i>Cancer Moonshot Biobank – Multiple Myeloma Collection (CMB-MML)</i> (Version 11) [dataset], The Cancer Imaging Archive, '+
  '<a href="https://doi.org/10.7937/szkb-sw39" target="_blank" rel="noopener">doi:10.7937/szkb-sw39</a> (CC BY 4.0). Data used in this publication were generated by the National Cancer Institute\'s Cancer Moonshot Biobank. One de-identified research participant, thoracic spine MRI at 1.5 T: '+
  '3-plane scout, sagittal T1 / T2 / STIR, axial T2 / T1 and a large-FOV sagittal T1 counting localiser. The clinical request shown in the simulator is fictional, and nothing here describes or interprets what the images show. '+
  '<b>Changes made:</b> pixel values windowed to 8-bit JPEG / PNG (axials resampled to 384 px); one image per plane of the scout is used as the localiser; the counting localiser was acquired at a second table position and has been <b>rigidly registered</b> onto the T-spine sagittals (the patient lies slightly differently, so it matches to a few millimetres); '+
  'vertebral levels were counted down from C2 on the counting localiser and marked by hand (± 5 mm) — <b>not yet checked by a radiologist</b>; the post-contrast series of the study are not used. Each scan shows the acquired slices that fall inside your stack, cropped to your FOV; your tilt doesn\'t re-slice the images — it is graded against the tilt the block was acquired at (± '+TOL+'°). The patient position doesn\'t change the images. The 3-D room shows a generic closed-bore magnet. '+
  'Sequences without images are listed for teaching only. Educational simulation — not a medical device.';
/* your axial block (solid: its top and bottom slices) and the acquired tilt (dashed), on the sagittal hero image */
function heroLines(cv, id, k, cr){
  if(!S.done.ax) return;
  var g=cv.getContext("2d"), L=70, pl=S.plan.ax, n=nUp("ax"), h=coverage(pl)/2, t=REF*Math.PI/180;
  function line(c, u, col, dash){
    var a=cropPt(id, k, cr, axpy(c,u,-L)), b=cropPt(id, k, cr, axpy(c,u,L));
    g.save(); g.strokeStyle=col; g.lineWidth=dash?1.5:2.2; g.setLineDash(dash?[6,5]:[]); g.globalAlpha=dash?0.9:1;
    g.beginPath(); g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); g.stroke(); g.restore();
  }
  var c=[X0, pl.c[1], pl.c[2]], u=cross(n, [1,0,0]);                        // the block's in-plane direction on the sagittal
  u=mul(u, 1/Math.hypot(u[0],u[1],u[2]));
  line(c, [0, Math.cos(t), Math.sin(t)], "#ffffff", true);
  line(axpy(c, n, h), u, COLORS.ax, false);
  line(axpy(c, n, -h), u, COLORS.ax, false);
}
function resetAll(){
  S=freshState();
  resultEl.classList.add("scg-hidden"); achWrap.classList.add("scg-hidden");
  logEl.innerHTML=""; gotoSetup();
}

/* =============================================================
   BOOT
   ============================================================= */
$("scgStart").onclick=function(){ titleEl.classList.add("scg-hidden"); gotoSetup(); };
window.__mrs={ S:function(){ return S; }, parse:parseCommand, useSeries:useSeries, analyse:analyse, planOK:planOK, gotoPlan:gotoPlan,
               autoPlan:autoPlan, setAngle:setAngle, angErr:angErr, axTilt:axTilt, shapeOf:shapeOf, REF:REF, scanSeq:scanSeq, showResult:showResult };
setPhase("title");
})();
