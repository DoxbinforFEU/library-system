/* ==================================================================
   DATA LAYER — in-memory cache filled from the PHP/MySQL API
   Theme + recently-viewed remain in localStorage (client UI state only).
   ================================================================== */
const API_BASE = "api";

async function api(path, options = {}) {
  const opts = Object.assign({
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  }, options);
  const res = await fetch(`${API_BASE}/${path}`, opts);
  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

function mapBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    category: row.category,
    isbn: row.isbn,
    year: row.year == null || row.year === "" ? null : Number(row.year),
    location: row.location,
    status: row.status,
    borrowedBy: row.borrowedBy ?? row.borrowed_by ?? null,
    issueDate: row.issueDate ?? row.issue_date ?? null,
    dueDate: row.dueDate ?? row.due_date ?? null,
    description: row.description,
    format: row.format,
    cover: row.cover ?? row.cover_url ?? null,
  };
}
function mapUser(row) {
  const lastName = row.lastName ?? row.last_name ?? "";
  const firstName = row.firstName ?? row.first_name ?? "";
  const middleInitial = row.middleInitial ?? row.middle_initial ?? "";
  return {
    id: row.id,
    lastName, firstName, middleInitial,
    name: row.name || formatUserName(lastName, firstName, middleInitial),
    program: row.program,
    yearLevel: row.yearLevel ?? row.year_level,
    contact: row.contact,
    status: row.status,
    borrowedBookIds: Array.isArray(row.borrowedBookIds) ? row.borrowedBookIds : (row.borrowed_book_ids || []),
  };
}
function mapTx(row) {
  return {
    id: row.id,
    type: row.type,
    bookId: row.bookId ?? row.book_id ?? null,
    bookTitle: row.bookTitle ?? row.book_title,
    userId: row.userId ?? row.user_id ?? null,
    userName: row.userName ?? row.user_name,
    issueDate: row.issueDate ?? row.issue_date,
    dueDate: row.dueDate ?? row.due_date,
    returnDate: row.returnDate ?? row.return_date ?? null,
    fine: Number(row.fine || 0),
    status: row.status,
  };
}

async function refreshBooks() {
  const data = await api("books.php");
  BOOKS = (data.books || []).map(mapBook);
  syncIdCounters();
}
async function refreshUsers() {
  const data = await api("users.php");
  USERS = (data.users || []).map(mapUser);
  syncIdCounters();
}
async function refreshTransactions() {
  const data = await api("transactions.php");
  TRANSACTIONS = (data.transactions || []).map(mapTx);
  syncIdCounters();
}
async function refreshCatalog() {
  await Promise.all([refreshBooks(), refreshUsers(), refreshTransactions()]);
}
async function bootstrapFromApi() {
  const [books, users, txs, settings, account, notifs] = await Promise.all([
    api("books.php"),
    api("users.php"),
    api("transactions.php"),
    api("settings.php"),
    api("account.php"),
    api("notifs.php"),
  ]);
  BOOKS = (books.books || []).map(mapBook);
  USERS = (users.users || []).map(mapUser);
  TRANSACTIONS = (txs.transactions || []).map(mapTx);
  if (settings.settings) Object.assign(CONFIG, settings.settings);
  if (account.account) Object.assign(ACCOUNT, account.account);
  const prefs = notifs.notifPrefs || notifs.prefs;
  if (prefs) Object.assign(NOTIF_PREFS, prefs);
  syncIdCounters();
}
function syncIdCounters() {
  let maxBook = 0, maxUser = 0, maxTx = 0;
  BOOKS.forEach(b => { const n = parseInt(String(b.id).replace(/\D/g, ""), 10); if (n > maxBook) maxBook = n; });
  USERS.forEach(u => { const n = parseInt(String(u.id).split("-").pop(), 10); if (n > maxUser) maxUser = n; });
  TRANSACTIONS.forEach(t => { const n = parseInt(String(t.id).replace(/\D/g, ""), 10); if (n > maxTx) maxTx = n; });
  nextBookId = maxBook + 1;
  nextUserId = maxUser + 1;
  nextTxId = maxTx + 1;
}
const DEFAULT_CONFIG = {
  finePerDay: 10,
  loanDays: 7,
  maxBooksPerUser: 5,
  maxRenewals: 2,
  gracePeriodDays: 1,
  overdueFinesEnabled: true,
  defaultBookStatus: "Available",
  dateFormat: "short",
  timeFormat: "12h",
  pageSize: 25,
  language: "en",
  confirmDeletes: true,
  landingPage: "dashboard",
  density: "comfortable",
  libraryName: "FEU Roosevelt Library",
  libraryEmail: "library@feuroosevelt.edu.ph",
  libraryPhone: "(02) 8373-0701",
  libraryAddress: "Circumferential Road, Cainta, Rizal",
};

const CONFIG = Object.assign({}, DEFAULT_CONFIG);

const DEFAULT_ACCOUNT = {
  displayName: "Library Administrator",
  username: "admin",
  email: "admin@library.local",
  role: "admin",
  status: "Active",
  avatarDataUrl: null,
  avatarPreset: null,
  lastLogin: null,
};

const ACCOUNT = Object.assign({}, DEFAULT_ACCOUNT);

const DEFAULT_NOTIFS = {
  due: true,
  overdue: true,
  newUser: false,
  returns: true,
  system: true,
};

const NOTIF_PREFS = Object.assign({}, DEFAULT_NOTIFS);

const STORAGE = {
  theme: "feu-theme",
};

async function persistConfig(){
  const saved = await api("settings.php", { method: "PUT", body: JSON.stringify(CONFIG) });
  if (saved.settings) Object.assign(CONFIG, saved.settings);
}
async function persistAccount(){
  const payload = {
    displayName: ACCOUNT.displayName,
    username: ACCOUNT.username,
    email: ACCOUNT.email,
    role: ACCOUNT.role,
    status: ACCOUNT.status,
    avatarDataUrl: ACCOUNT.avatarDataUrl,
    avatarPreset: ACCOUNT.avatarPreset,
    lastLogin: ACCOUNT.lastLogin,
  };
  try {
    const saved = await api("account.php", { method: "PUT", body: JSON.stringify(payload) });
    if (saved.account) Object.assign(ACCOUNT, saved.account);
  } catch (e) {
    showToast(e.message || "Could not save the account. Try a smaller photo.", {kind:"error"});
    throw e;
  }
}
async function persistNotifs(){
  const saved = await api("notifs.php", { method: "PUT", body: JSON.stringify(NOTIF_PREFS) });
  const prefs = saved.notifPrefs || saved.prefs;
  if (prefs) Object.assign(NOTIF_PREFS, prefs);
}

const CATEGORIES = ["Literature","Science","History","Philosophy","Technology","Psychology","Arts","Business"];

let nextBookId = 1;
let nextUserId = 1;
let nextTxId = 1;

function makeBookId(){ return "BK-" + String(nextBookId++).padStart(4,"0"); }
function makeUserId(){ const y = 2025; return y + "-" + String(nextUserId++).padStart(3,"0"); }
function makeTxId(){ return "TX-" + String(nextTxId++).padStart(4,"0"); }

const APP_TZ = "Asia/Manila";
/* Today's calendar date in Philippine time (YYYY-MM-DD), independent of the browser's timezone. */
function manilaToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:APP_TZ, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
}
function addDaysISO(iso, n){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d+n)).toISOString().slice(0,10);
}
function isoDaysAgo(n){ return addDaysISO(manilaToday(), -n); }
function isoDaysFromNow(n){ return addDaysISO(manilaToday(), n); }
function fmtDate(iso){
  if(!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if(CONFIG.dateFormat==="iso") return iso;
  if(CONFIG.dateFormat==="long") return d.toLocaleDateString("en-US",{weekday:"long", month:"long", day:"numeric", year:"numeric"});
  return d.toLocaleDateString("en-US",{month:"short", day:"numeric", year:"numeric"});
}
function fmtDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US",{month:"short", day:"numeric", year:"numeric"});
  const time = d.toLocaleTimeString("en-US",{hour:"numeric", minute:"2-digit", hour12: CONFIG.timeFormat!=="24h"});
  return date + " · " + time;
}
function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function daysBetween(a,b){
  const A = new Date(a+"T00:00:00"), B = new Date(b+"T00:00:00");
  return Math.round((B-A) / 86400000);
}

const BOOK_SEED = [
  ["The Great Gatsby","F. Scott Fitzgerald","Literature","9780743273565",1925,"A-12"],
  ["Clean Code","Robert C. Martin","Technology","9780132350884",2008,"B-04"],
  ["Atomic Habits","James Clear","Psychology","9780735211292",2018,"C-07"],
  ["A Brief History of Time","Stephen Hawking","Science","9780553380163",1988,"D-19"],
  ["Sapiens","Yuval Noah Harari","History","9780062316097",2011,"D-02"],
  ["Meditations","Marcus Aurelius","Philosophy","9780140449334",180,"E-11"],
  ["Leaves of Grass","Walt Whitman","Literature","9781593080834",1855,"F-03"],
  ["The Design of Everyday Things","Don Norman","Arts","9780465050659",2013,"B-18"],
  ["1984","George Orwell","Literature","9780451524935",1949,"A-01"],
  ["The Pragmatic Programmer","Andrew Hunt","Technology","9780135957059",2019,"B-09"],
  ["Deep Work","Cal Newport","Business","9781455586691",2016,"C-14"],
  ["Cosmos","Carl Sagan","Science","9780345539434",1980,"D-06"],
  ["Guns, Germs, and Steel","Jared Diamond","History","9780393317558",1997,"D-22"],
  ["The Republic","Plato","Philosophy","9780140449140",-380,"E-02"],
  ["Ariel","Sylvia Plath","Literature","9780061148518",1965,"F-08"],
  ["Don't Make Me Think","Steve Krug","Arts","9780321965516",2000,"B-21"],
  ["To Kill a Mockingbird","Harper Lee","Literature","9780061120084",1960,"A-07"],
  ["Refactoring","Martin Fowler","Technology","9780134757599",1999,"B-13"],
  ["The Power of Habit","Charles Duhigg","Business","9780812981605",2012,"C-03"],
  ["Astrophysics for People in a Hurry","Neil deGrasse Tyson","Science","9780393609394",2017,"D-25"],
  ["The Silk Roads","Peter Frankopan","History","9781101912379",2015,"D-11"],
  ["Beyond Good and Evil","Friedrich Nietzsche","Philosophy","9780486298689",1886,"E-17"],
  ["The Waste Land","T.S. Eliot","Literature","9780156948777",1922,"F-14"],
  ["Emotional Design","Don Norman","Arts","9780465051366",2004,"B-25"],
  ["Brave New World","Aldous Huxley","Literature","9780060850524",1932,"A-15"],
  ["Design Patterns","Erich Gamma","Technology","9780201633610",1994,"B-01"],
  ["Educated","Tara Westover","Psychology","9780399590504",2018,"C-19"],
  ["The Selfish Gene","Richard Dawkins","Science","9780198788607",1976,"D-14"],
];

/* ---- Discovery metadata: short original blurbs + format, keyed by title.
   Written for this prototype (not sourced from jacket copy). ---- */
const BOOK_BLURBS = {
  "The Great Gatsby":"A glittering, doomed summer on Long Island, and a man who reinvents himself for a love that's already gone.",
  "Clean Code":"A practical field guide to writing software that's easy to read, change, and trust a year from now.",
  "Atomic Habits":"A clear framework for building good habits and breaking bad ones through small, compounding changes.",
  "A Brief History of Time":"An accessible tour of cosmology — from the Big Bang to black holes — for readers without a physics background.",
  "Sapiens":"A sweeping look at how Homo sapiens came to dominate the planet, told through myths, money, and empires.",
  "Meditations":"The private notebook of a Roman emperor, working out how to stay calm, fair, and useful.",
  "Leaves of Grass":"An expansive, restless collection that helped define the sound of American poetry.",
  "The Design of Everyday Things":"Why so many everyday objects confuse us, and what good design owes the people who use it.",
  "1984":"A totalitarian future where language itself is rewritten to make dissent unthinkable.",
  "The Pragmatic Programmer":"Field-tested habits and principles for writing adaptable, well-crafted software.",
  "Deep Work":"An argument for protecting long stretches of undistracted focus in an economy built to fragment it.",
  "Cosmos":"A warm, wide-eyed guided tour of the universe and our small, remarkable place in it.",
  "Guns, Germs, and Steel":"An attempt to explain why history's advantages fell to some societies and not others.",
  "The Republic":"A dialogue on justice, the soul, and what an ideal city would actually require.",
  "Ariel":"Intense, precise poems written in a final, prolific burst near the end of the poet's life.",
  "Don't Make Me Think":"A short, practical case for usability: if people have to stop and think, the design has failed.",
  "To Kill a Mockingbird":"A small Southern town, a wrongful trial, and a child's early lessons in conscience.",
  "Refactoring":"A catalog of small, safe steps for improving the structure of existing code.",
  "The Power of Habit":"How habits form, why they're hard to break, and how organizations use that to their advantage.",
  "Astrophysics for People in a Hurry":"Big cosmic ideas delivered in short, digestible chapters for a busy reader.",
  "The Silk Roads":"A retelling of world history centered on the trade routes linking East and West.",
  "Beyond Good and Evil":"A provocation aimed at the moral assumptions philosophy usually leaves unquestioned.",
  "The Waste Land":"A fragmented, allusive modernist poem written in the shadow of a broken postwar world.",
  "Emotional Design":"On why we love — or hate — the objects we use, and what feeling has to do with function.",
  "Brave New World":"A society engineered for comfort and stability, at the quiet cost of everything else.",
  "Design Patterns":"Reusable solutions to recurring problems in object-oriented software design.",
  "Educated":"A memoir of growing up off the grid, and the long, disorienting road to a formal education.",
  "The Selfish Gene":"A gene's-eye view of evolution that reframed how a generation thought about natural selection.",
};
const FORMATS = ["Hardcover","Paperback","E-book","Audiobook"];
function formatForBook(i){ return FORMATS[i % FORMATS.length]; }

/* ---- Patron names are stored as three fields (last, first, middle initial)
   and shown as "Last, First M." — e.g. "Dela Cruz, Juan D." ---- */
function formatUserName(lastName, firstName, middleInitial){
  const mi = middleInitial ? " " + middleInitial + "." : "";
  return `${lastName}, ${firstName}${mi}`;
}

// [lastName, firstName, middleInitial, program, yearLevel, contact]
const STUDENT_SEED = [
  ["Dela Cruz","Juan","","BSIT",2,"juan.delacruz@feuroosevelt.edu"],
  ["Santos","Maria","","BSIT",2,"maria.santos@feuroosevelt.edu"],
  ["Bonifacio Jr.","Andres","","BS Architecture",3,"andres.b@feuroosevelt.edu"],
  ["Reyes","Liza","","BS Psychology",1,"liza.reyes@feuroosevelt.edu"],
  ["Mendoza","Carlo","","BS Civil Engineering",4,"carlo.mendoza@feuroosevelt.edu"],
  ["Villanueva","Bea","","BS Nursing",2,"bea.villanueva@feuroosevelt.edu"],
  ["Torres","Miguel","","BSIT",3,"miguel.torres@feuroosevelt.edu"],
  ["Ramos","Sofia","","BS Biology",1,"sofia.ramos@feuroosevelt.edu"],
  ["Cruz","Nathaniel","","BS Accountancy",4,"nathaniel.cruz@feuroosevelt.edu"],
  ["Garcia","Isabel","","BS Architecture",2,"isabel.garcia@feuroosevelt.edu"],
  ["Aquino","Rafael","","BSIT",1,"rafael.aquino@feuroosevelt.edu"],
  ["Ocampo","Camille","","BS Psychology",3,"camille.ocampo@feuroosevelt.edu"],
  ["Fernandez","Diego","","BS Civil Engineering",2,"diego.fernandez@feuroosevelt.edu"],
  ["Lim","Patricia","","BS Nursing",4,"patricia.lim@feuroosevelt.edu"],
];

/* ---- A few seed ISBNs don't resolve to a cover image on Open Library,
   so those three titles fall back to a plain color block instead of a
   real photo. This maps just those titles to a working cover image. ---- */
const COVER_OVERRIDES = {
  "Leaves of Grass": "https://covers.openlibrary.org/b/id/13323903-L.jpg",
  "The Republic": "https://covers.openlibrary.org/b/id/2324117-L.jpg",
  "Ariel": "https://covers.openlibrary.org/b/id/33280-L.jpg",
};

let BOOKS = [];
let USERS = [];
let TRANSACTIONS = [];

/* ---- 7-day activity series (issued vs returned), demo counts ---- */
const ACTIVITY_SERIES = {
  labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
  issued:   [6, 9, 5, 11, 8, 4, 7],
  returned: [4, 6, 8, 7, 9, 3, 5],
};

const MOST_BORROWED = [
  {title:"Atomic Habits", count:41},
  {title:"Clean Code", count:33},
  {title:"1984", count:29},
  {title:"Sapiens", count:24},
  {title:"Deep Work", count:19},
];


/* ==================================================================
   ANIMATIONS.JS — reusable GSAP helpers
   ================================================================== */
gsap.defaults({ease:"power2.out"});

function animateCounters(container){
  const nodes = container.querySelectorAll("[data-count]");
  nodes.forEach(node=>{
    const target = parseFloat(node.getAttribute("data-count"));
    const obj = {val:0};
    gsap.to(obj,{
      val:target, duration:1.4, ease:"power3.out", delay:0.1,
      onUpdate:()=>{ node.textContent = Math.round(obj.val).toLocaleString(); },
    });
  });
}

/* Stagger a set of elements up-and-in */
function revealStagger(els, opts={}){
  return gsap.from(els,{
    opacity:0, y:opts.y ?? 16, duration:opts.duration ?? 0.5,
    stagger:opts.stagger ?? 0.05, ease:"power2.out", delay:opts.delay ?? 0,
  });
}

/* View / page transition: exit old, enter new */
function transitionView(oldEl, newEl, onSwapped){
  const tl = gsap.timeline();
  if(oldEl){
    tl.to(oldEl,{opacity:0, y:-8, duration:0.22, ease:"power1.in", onComplete:()=>{
      oldEl.classList.remove("active");
      gsap.set(oldEl,{clearProps:"opacity,transform"});
    }});
  }
  tl.call(()=>{
    newEl.classList.add("active");
    if(onSwapped) onSwapped();
  });
  tl.fromTo(newEl,
    {opacity:0, y:14, clipPath:"inset(6% 0% 0% 0% round 8px)"},
    {opacity:1, y:0, clipPath:"inset(0% 0% 0% 0% round 0px)", duration:0.5, ease:"power2.out"}
  );
  const staggerTargets = newEl.querySelectorAll(".stat-card, .panel, .card, .table-card, .card-list, .wizard");
  if(staggerTargets.length){
    tl.from(staggerTargets,{opacity:0, y:16, duration:0.45, stagger:0.045, ease:"power2.out"},"-=0.32");
  }
  return tl;
}

/* Modal open/close timelines */
function openModalEl(backdropEl, modalEl){
  gsap.set(backdropEl,{display:"flex"});
  const tl = gsap.timeline();
  tl.to(backdropEl,{opacity:1, visibility:"visible", duration:0.25, ease:"power1.out"});
  tl.to(modalEl,{opacity:1, scale:1, y:0, duration:0.38, ease:"back.out(1.6)"},"-=0.1");
  const fields = modalEl.querySelectorAll(".field, .catalog-card, .pick-row, .wizard-rail .wizard-step");
  if(fields.length){
    tl.from(fields,{opacity:0, y:10, duration:0.32, stagger:0.03, ease:"power2.out"},"-=0.22");
  }
  return tl;
}
function closeModalEl(backdropEl, modalEl, onDone){
  const tl = gsap.timeline({onComplete:()=>{
    gsap.set(backdropEl,{display:"none"});
    if(onDone) onDone();
  }});
  tl.to(modalEl,{opacity:0, scale:0.95, y:8, duration:0.22, ease:"power1.in"});
  tl.to(backdropEl,{opacity:0, duration:0.18, ease:"power1.in"},"-=0.1");
  tl.set(backdropEl,{visibility:"hidden"});
  return tl;
}

/* Toast notification */
function showToast(message, opts={}){
  const region = document.getElementById("toast-region");
  const el = document.createElement("div");
  const kind = opts.kind || (opts.warn ? "warn" : "success");
  el.className = "toast toast-" + kind;
  el.setAttribute("role","status");
  const iconSvg = kind==="error" || kind==="warn"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18.3A1.6 1.6 0 0 0 3.3 20.7h17.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-3.4 0z"/></svg>'
    : kind==="info"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
  el.innerHTML = `<span class="t-ic">${iconSvg}</span><span>${message}</span>`;
  region.appendChild(el);
  const tl = gsap.timeline({onComplete:()=>{
    gsap.to(el,{opacity:0, x:30, duration:0.3, delay:opts.hold ?? 2.6, ease:"power1.in",
      onComplete:()=> el.remove()});
  }});
  tl.to(el,{opacity:1, x:0, duration:0.4, ease:"back.out(1.7)"});
}

/* Stamp animation (issue / return confirmation) */
function playStamp(stampEl){
  gsap.set(stampEl,{scale:0, opacity:0, rotate:-8});
  const tl = gsap.timeline();
  tl.to(stampEl,{scale:1.15, opacity:1, duration:0.16, ease:"power1.in"});
  tl.to(stampEl,{scale:1, duration:0.28, ease:"elastic.out(1,0.5)"});
  return tl;
}

/* Animate a numeric field (fine amount) from-to */
function animateNumber(el, from, to, opts={}){
  const obj={v:from};
  gsap.to(obj,{
    v:to, duration:opts.duration ?? 0.8, ease:opts.ease ?? "power2.out",
    onUpdate:()=>{ el.textContent = "₱" + obj.v.toFixed(2).replace(/\.00$/,""); },
  });
}

/* Focus micro-interaction for inputs: animated underline */
function wireFieldFocus(root){
  root.querySelectorAll(".field input, .field select, .field textarea").forEach(input=>{
    input.addEventListener("focus",()=>{
      gsap.to(input,{borderColor:"var(--green)", duration:0.2});
    });
    input.addEventListener("blur",()=>{
      gsap.to(input,{borderColor:"var(--line-strong)", duration:0.2});
    });
  });
}

/* Magnetic hover for primary buttons (subtle) */
function wireMagnetic(root){
  root.querySelectorAll(".btn-primary").forEach(btn=>{
    btn.addEventListener("mousemove", e=>{
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width/2) * 0.18;
      const y = (e.clientY - r.top - r.height/2) * 0.35;
      gsap.to(btn,{x,y,duration:0.3,ease:"power2.out"});
    });
    btn.addEventListener("mouseleave",()=>{
      gsap.to(btn,{x:0,y:0,duration:0.4,ease:"elastic.out(1,0.4)"});
    });
  });
}

/* Draw-in for SVG paths (line charts) */
function drawPath(pathEl, opts={}){
  const len = pathEl.getTotalLength();
  gsap.set(pathEl,{strokeDasharray:len, strokeDashoffset:len});
  gsap.to(pathEl,{strokeDashoffset:0, duration:opts.duration ?? 1.2, ease:"power2.inOut", delay:opts.delay ?? 0});
}

/* Animate SVG circle stroke (donut segments) */
function drawCircle(circleEl, targetOffset, opts={}){
  gsap.to(circleEl,{strokeDashoffset:targetOffset, duration:opts.duration ?? 1, ease:"power2.out", delay:opts.delay ?? 0});
}


/* ==================================================================
   APP.JS — state, rendering, navigation, wiring
   ================================================================== */
const state = {
  currentView:"dashboard",
  books:{
    search:"", category:"all", sort:"featured", editingId:null,
    filters:{ subjects:[], authors:[], availability:[], years:[], formats:[] },
  },
  users:{ search:"", filter:"all", sort:"name-asc", editingId:null },
  issue:{ step:1, studentId:null, bookId:null },
  ret:{ step:1, txId:null, returnDate:null },
  selectedBookId:null,
};

/* ---- Discovery: saved / reserved / recently viewed / recent searches.
   All mock/local — saved items and recent searches persist to localStorage
   so the "premium library" feeling survives a refresh; reservations are a
   pure in-session mock since there's no backend to hold them against. ---- */
const DISCOVERY_STORAGE = { saved:"feu-saved-books", recent:"feu-recently-viewed", searches:"feu-recent-searches" };
function loadIdList(key){ try{ return JSON.parse(localStorage.getItem(key) || "[]"); }catch(e){ return []; } }
function saveIdList(key, list){ try{ localStorage.setItem(key, JSON.stringify(list)); }catch(e){} }

let savedBookIds = new Set(loadIdList(DISCOVERY_STORAGE.saved));
let reservedBookIds = new Set();
let recentlyViewedIds = loadIdList(DISCOVERY_STORAGE.recent);
let recentSearches = loadIdList(DISCOVERY_STORAGE.searches);

function toggleSavedBook(id){
  const wasSaved = savedBookIds.has(id);
  wasSaved ? savedBookIds.delete(id) : savedBookIds.add(id);
  saveIdList(DISCOVERY_STORAGE.saved, Array.from(savedBookIds));
  return !wasSaved;
}
function pushRecentlyViewed(id){
  recentlyViewedIds = [id, ...recentlyViewedIds.filter(x=>x!==id)].slice(0,8);
  saveIdList(DISCOVERY_STORAGE.recent, recentlyViewedIds);
}
function pushRecentSearch(q){
  q = q.trim();
  if(!q) return;
  recentSearches = [q, ...recentSearches.filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,5);
  saveIdList(DISCOVERY_STORAGE.searches, recentSearches);
}

const VIEW_META = {
  dashboard:{title:"Dashboard", crumb:"Overview"},
  books:{title:"Books", crumb:"Module 01 · Catalog"},
  users:{title:"Users", crumb:"Module 02 · Patrons"},
  issue:{title:"Issue Book", crumb:"Module 03 · Transactions"},
  return:{title:"Return Book", crumb:"Module 04 · Transactions"},
  reports:{title:"Reports", crumb:"Ledger"},
  settings:{title:"Settings", crumb:"Preferences"},
  "book-details":{title:"Book", crumb:"Module 01 · Catalog"},
};

function $(sel,root=document){ return root.querySelector(sel); }
function $all(sel,root=document){ return Array.from(root.querySelectorAll(sel)); }
function esc(str){
  return String(str ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initialsOf(name){
  // "Last, First M." -> first initial + last initial (e.g. "Dela Cruz, Juan D." -> "JD")
  if(name.includes(",")){
    const [last, rest] = name.split(",");
    const first = rest.trim().split(" ")[0] || "";
    return ((first[0] || "") + (last.trim()[0] || "")).toUpperCase();
  }
  return name.split(" ").map(p=>p[0]).slice(0,2).join("").toUpperCase();
}
// Matches a patron by "Last, First M." or by the natural order "First Last"
function userNameMatches(u, q){
  if(!u) return false;
  const natural = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return u.name.toLowerCase().includes(q) || natural.toLowerCase().includes(q);
}
function badgeClassFor(status){
  return {Available:"badge-available", Borrowed:"badge-borrowed", Overdue:"badge-overdue",
          Active:"badge-active", Inactive:"badge-inactive"}[status] || "badge-inactive";
}
function findBook(id){ return BOOKS.find(b=>b.id===id); }
function findUser(id){ return USERS.find(u=>u.id===id); }

/* ---------------- Navigation ---------------- */
function goToView(viewName, opts={}){
  if(viewName === state.currentView && !opts.force) {
    if(opts.settingsPane) showSettingsPane(opts.settingsPane);
    if(opts.booksTab==="add") openBookModal(null);
    if(opts.usersTab==="add") openUserModal(null);
    if(opts.report) renderReports(opts.report);
    return;
  }
  const oldEl = document.getElementById("view-" + state.currentView);
  const newEl = document.getElementById("view-" + viewName);
  if(!newEl) return;

  const navHighlight = viewName === "book-details" ? "books" : viewName;
  $all(".menu-link[data-view]").forEach(n=>{
    const matches = n.dataset.view === navHighlight;
    n.classList.toggle("active", matches);
    if(matches) n.setAttribute("aria-current","page"); else n.removeAttribute("aria-current");
  });
  const groupFor = {books:"books", users:"users", issue:"transactions", return:"transactions", reports:"reports"};
  $all(".menu-drop").forEach(drop=>{
    drop.querySelector(".menu-link")?.classList.toggle("active", groupFor[viewName]===drop.dataset.navGroup);
  });

  const meta = VIEW_META[viewName];
  transitionView(oldEl, newEl, ()=>{
    state.currentView = viewName;
    if(viewName === "books") renderBooks();
    if(viewName === "book-details") renderBookDetails(state.selectedBookId);
    if(viewName === "users") renderUsers();
    if(viewName === "issue") resetIssueWizard();
    if(viewName === "return") resetReturnWizard();
    if(viewName === "reports") renderReports(opts.report || "borrowing");
    if(viewName === "dashboard") { renderDashboard(); }
    if(viewName === "settings") {
      showSettingsPane(opts.settingsPane || "profile");
      hydrateSettings();
    }
  });
  closeMobileNav();
  closeAllPopovers();
  if(opts.booksTab==="add") setTimeout(()=>openBookModal(null), 420);
  if(opts.usersTab==="add") setTimeout(()=>openUserModal(null), 420);
}

$all("[data-view]").forEach(btn=>{
  if(btn.closest(".settings-nav")) return;
  btn.addEventListener("click", ()=>{
    const view = btn.dataset.view;
    if(!view) return;
    goToView(view, {
      booksTab:btn.dataset.booksTab, usersTab:btn.dataset.usersTab, report:btn.dataset.report,
    });
  });
});

/* ---------- Homepage explore chips: route straight into the Collection,
   pre-filtered to the chosen subject. ---------- */
$all("#explore-categories .explore-chip[data-category]").forEach(chip=>{
  chip.addEventListener("click", ()=>{
    state.books.search = "";
    state.books.category = chip.dataset.category;
    goToView("books", {force:true});
  });
});

/* ---------------- Header menus + mobile nav ---------------- */
const menubarEl = document.getElementById("menubar");
const overlayEl = document.getElementById("nav-overlay");
function openMobileNav(){
  menubarEl.classList.add("open");
  overlayEl.classList.add("show");
  gsap.fromTo(menubarEl,{x:-24},{x:0,duration:0.28,ease:"power3.out"});
  gsap.to(overlayEl,{opacity:1,duration:0.22});
  $("#hamburger-btn").setAttribute("aria-expanded","true");
}
function closeMobileNav(){
  if(!menubarEl.classList.contains("open")) return;
  gsap.to(overlayEl,{opacity:0,duration:0.18, onComplete:()=>overlayEl.classList.remove("show")});
  menubarEl.classList.remove("open");
  $("#hamburger-btn").setAttribute("aria-expanded","false");
}
$("#hamburger-btn").addEventListener("click", ()=>{
  menubarEl.classList.contains("open") ? closeMobileNav() : openMobileNav();
});
overlayEl.addEventListener("click", ()=>{ closeMobileNav(); closeAllPopovers(); });
$("#menubar-close-btn")?.addEventListener("click", closeMobileNav);

/* Mobile search toggle: reveals the header search field inline since the
   full-width field is hidden on small screens (see .search-global rules). */
$("#search-toggle-btn")?.addEventListener("click", ()=>{
  const field = $("#global-search")?.closest(".search-global");
  if(!field) return;
  const open = field.classList.toggle("mobile-open");
  $("#search-toggle-btn").setAttribute("aria-expanded", String(open));
  if(open) setTimeout(()=> $("#global-search")?.focus(), 60);
});

/* In-page anchors (Services / About) live on the homepage. From any other
   view, navigate home first, then smooth-scroll once the transition settles. */
$all("[data-anchor]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.anchor;
    const jump = ()=> document.getElementById(id)?.scrollIntoView({behavior:"smooth", block:"start"});
    if(state.currentView !== "dashboard"){
      goToView("dashboard");
      setTimeout(jump, 460);
    } else {
      jump();
    }
    closeMobileNav();
  });
});

/* Hero search on the homepage mirrors the header's global search field and
   routes into the Collection view with that query applied. */
$("#hero-search-form")?.addEventListener("submit", e=>{
  e.preventDefault();
  const q = $("#hero-search-input")?.value || "";
  state.books.search = q;
  state.books.category = "all";
  state.books.filters = emptyFilters();
  if(q.trim()) pushRecentSearch(q);
  goToView("books", {force:true});
  setTimeout(()=>{ const f = $("#books-search"); if(f) f.value = q; }, 420);
});

$all(".menu-drop > .menu-link").forEach(btn=>{
  btn.addEventListener("click", e=>{
    e.stopPropagation();
    const drop = btn.parentElement;
    const willOpen = !drop.classList.contains("open");
    $all(".menu-drop").forEach(d=> d.classList.remove("open"));
    if(willOpen) drop.classList.add("open");
  });
});

function closeAllPopovers(){
  $all(".header-pop .dropdown-panel").forEach(p=> p.hidden = true);
  $("#notif-btn")?.setAttribute("aria-expanded","false");
  $("#avatar-btn")?.setAttribute("aria-expanded","false");
  $all(".menu-drop").forEach(d=> d.classList.remove("open"));
}
function togglePopover(btn, panel){
  const open = panel.hidden;
  closeAllPopovers();
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}
$("#notif-btn").addEventListener("click", e=>{
  e.stopPropagation();
  togglePopover($("#notif-btn"), $("#notif-menu"));
});
$("#avatar-btn").addEventListener("click", e=>{
  e.stopPropagation();
  togglePopover($("#avatar-btn"), $("#profile-menu"));
});
document.addEventListener("click", closeAllPopovers);
$("#profile-menu").addEventListener("click", e=> e.stopPropagation());
$("#notif-menu").addEventListener("click", e=> e.stopPropagation());

async function signOutCurrentSession(){
  try {
    await api("auth.php", {method:"POST", body:JSON.stringify({action:"logout"})});
    window.location.reload();
  } catch (err) {
    showToast(err.message, {kind:"error"});
  }
}

$all("[data-go]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const pane = btn.dataset.go === "settings" ? "profile" : "profile";
    goToView("settings", {force:true, settingsPane: pane});
    closeAllPopovers();
  });
});
$("#menu-help").addEventListener("click", ()=>{
  closeAllPopovers();
  showToast("Help desk is a prototype. Contact the librarian for catalog questions.");
});
$("#menu-logout").addEventListener("click", ()=>{
  closeAllPopovers();
  renderConfirm({
    title:"Sign out?",
    body:"Your current staff session will be ended.",
    confirmLabel:"Sign out",
    onConfirm:signOutCurrentSession,
  });
});
$("#menu-theme-toggle").addEventListener("click", ()=>{
  const next = document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark";
  applyTheme(next);
  closeAllPopovers();
});

function applyTheme(pref, persist=true){
  const resolved = pref==="dark" || (pref==="system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-pref", pref);
  if(persist) localStorage.setItem(STORAGE.theme, pref);
  $all(".theme-card").forEach(c=> c.classList.toggle("active", c.dataset.themePref===pref));
  const toggle = $("#menu-theme-toggle");
  if(toggle) toggle.textContent = resolved==="dark" ? "Light Mode" : "Dark Mode";
  if(typeof renderDashboard==="function" && state.currentView==="dashboard") renderDashboard();
  if(state.currentView==="reports") renderReports("borrowing");
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{
  if((localStorage.getItem(STORAGE.theme)||"light")==="system") applyTheme("system", false);
});

/* ==================================================================
   HOMEPAGE RENDERING (editorial homepage — Phase 1)
   ================================================================== */
const BOOK_CARD_COLORS = ["var(--green)","var(--green-deep)","var(--oxblood)","var(--brass)","var(--navy-badge)"];
function colorForBook(book, i){
  return BOOK_CARD_COLORS[i % BOOK_CARD_COLORS.length];
}
function bookInitial(book){
  return book.title.replace(/^(the|a|an)\s+/i,"").trim()[0].toUpperCase();
}
/* A book's patron-facing availability, folding the mock "reserved" local
   state in ahead of its underlying catalog status. */
function availabilityBucket(book){
  if(reservedBookIds.has(book.id)) return "Reserved";
  return book.status==="Available" ? "Available" : "Borrowed";
}
function availabilityBadgeClass(bucket){
  return {Available:"badge-available", Borrowed:"badge-borrowed", Reserved:"badge-active"}[bucket] || "badge-inactive";
}

/* ---------- BookCard — the one reusable card used on the homepage,
   the collection grid, related books, and recently viewed. ---------- */
function bookCardHTML(book, i, opts={}){
  const bucket = availabilityBucket(book);
  return `
    <div class="book-card${opts.featured ? " book-card-featured" : ""}" data-book-id="${book.id}" tabindex="0" role="button" aria-label="View ${esc(book.title)} by ${esc(book.author)}">
      <div class="book-card-face" style="--book-color:${colorForBook(book,i)}">
        <div class="book-card-initial">${esc(bookInitial(book))}</div>
        ${book.cover ? `<img class="book-card-cover" src="${esc(book.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
        ${opts.hideAvailability ? "" : `<span class="book-card-availability-pill ${availabilityBadgeClass(bucket)}">${esc(bucket)}</span>`}
        <span class="book-card-hover-cta">View book
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </span>
      </div>
      <div class="book-card-body">
        <div class="book-card-top-row">
          <span class="book-card-cat">${esc(book.category)}</span>
          ${opts.hideAvailability ? "" : `<span class="book-card-dot ${availabilityBadgeClass(bucket)}" title="${bucket}"></span>`}
        </div>
        <div class="book-card-title">${esc(book.title)}</div>
        <div class="book-card-author">${esc(book.author)}</div>
      </div>
    </div>`;
}
function wireBookCards(root){
  $all(".book-card", root).forEach(card=>{
    const go = ()=> openBookDetails(card.dataset.bookId);
    card.addEventListener("click", go);
    card.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
}
function renderBookRow(containerId, books){
  const row = document.getElementById(containerId);
  if(!row) return;
  row.innerHTML = books.map((b,i)=> bookCardHTML(b,i)).join("");
  revealStagger($all(".book-card", row),{y:10, stagger:0.04});
  wireBookCards(row);
}
function renderHomepage(){
  // Featured: a hand-spread sample across categories, for variety.
  // Kept to five titles, editorial-style, so the row reads as a curated
  // pick rather than another long scrolling shelf.
  const seenCats = new Set();
  const featured = [];
  for(const b of BOOKS){
    if(!seenCats.has(b.category)){ seenCats.add(b.category); featured.push(b); }
    if(featured.length>=5) break;
  }
  renderBookRow("featured-collection-grid", featured);

  // New to the collection: most recently published, newest first.
  const newArrivals = BOOKS.slice().sort((a,b)=> b.year - a.year).slice(0,10);
  renderBookRow("new-arrivals-grid", newArrivals);

  const yr = $("#footer-year");
  if(yr) yr.textContent = String(new Date().getFullYear());
}
function renderDashboard(){
  renderHomepage();
}

function renderActivityChart(targetId){
  const wrap = document.getElementById(targetId || "activity-chart-wrap");
  const W=560,H=200,pad=28;
  const {labels,issued,returned} = ACTIVITY_SERIES;
  const maxV = Math.max(...issued,...returned) * 1.15;
  const stepX = (W - pad*2) / (labels.length-1);
  const toXY = (arr,i) => [pad + stepX*i, H - pad - (arr[i]/maxV)*(H-pad*2)];
  const pathFrom = arr => arr.map((_,i)=>{
    const [x,y]=toXY(arr,i); return (i===0?"M":"L") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  let gridLines = "";
  for(let i=0;i<=3;i++){
    const y = pad + (H-pad*2)*(i/3);
    gridLines += `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${W-pad}" y2="${y.toFixed(1)}" stroke="${cssVar("--paper-2")}" stroke-width="1"/>`;
  }
  let xLabels = labels.map((l,i)=>{
    const [x] = toXY(issued,i);
    return `<text x="${x}" y="${H-6}" font-family="IBM Plex Mono" font-size="10" fill="${cssVar("--ink-soft")}" text-anchor="middle">${l}</text>`;
  }).join("");
  const green = cssVar("--green") || "#237A43";
  const brass = cssVar("--brass") || "#EBB134";
  let dotsIssued = issued.map((v,i)=>{const[x,y]=toXY(issued,i); return `<circle cx="${x}" cy="${y}" r="3" fill="${green}"/>`;}).join("");
  let dotsReturned = returned.map((v,i)=>{const[x,y]=toXY(returned,i); return `<circle cx="${x}" cy="${y}" r="3" fill="${brass}"/>`;}).join("");

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${gridLines}
    <path class="js-path-issued" d="${pathFrom(issued)}" fill="none" stroke="${green}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="js-path-returned" d="${pathFrom(returned)}" fill="none" stroke="${brass}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dotsIssued}${dotsReturned}
    ${xLabels}
  </svg>`;
  requestAnimationFrame(()=>{
    drawPath(wrap.querySelector(".js-path-issued"),{duration:1.1});
    drawPath(wrap.querySelector(".js-path-returned"),{duration:1.1, delay:0.15});
    gsap.from(wrap.querySelectorAll("circle"),{opacity:0, scale:0, duration:0.4, stagger:0.03, delay:0.9, ease:"back.out(3)"});
  });
}

function renderShelfBar(){
  const bar = $("#shelf-bar");
  const total = 1248, available=936, borrowed=288, overdue=24;
  const segments = [
    {label:"Available", value:available, color: cssVar("--green") || "#237A43"},
    {label:"Borrowed", value:borrowed, color: cssVar("--brass") || "#EBB134"},
    {label:"Overdue", value:overdue, color: cssVar("--oxblood") || "#7A2E2E"},
  ];
  bar.innerHTML = segments.map(s=>
    `<div class="shelf-bar-seg" data-w="${(s.value/total*100).toFixed(2)}" style="background:${s.color}"></div>`
  ).join("");
  requestAnimationFrame(()=>{
    $all(".shelf-bar-seg", bar).forEach((el,i)=>{
      gsap.to(el,{width:el.dataset.w+"%", duration:0.9, delay:0.1*i, ease:"power2.out"});
    });
  });
  $("#shelf-bar-stats").innerHTML = segments.map(s=>
    `<div class="sbs-item">
      <div class="sbs-label"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</div>
      <div class="sbs-value">${s.value.toLocaleString()}</div>
    </div>`
  ).join("");
}

function renderMostBorrowed(){
  const list = $("#most-borrowed-list");
  const max = Math.max(...MOST_BORROWED.map(b=>b.count));
  list.innerHTML = MOST_BORROWED.map((b,i)=>`
    <div class="rank-row">
      <div class="rn">${String(i+1).padStart(2,"0")}</div>
      <div class="rank-main">
        <div class="bar-row-top"><span class="t">${esc(b.title)}</span><span class="n">${b.count}</span></div>
        <div class="bar-track"><div class="bar-fill" data-w="${(b.count/max*100).toFixed(0)}"></div></div>
      </div>
    </div>`).join("");
  requestAnimationFrame(()=>{
    $all(".bar-fill", list).forEach((el,i)=>{
      gsap.to(el,{width:el.dataset.w+"%", duration:0.9, delay:0.06*i, ease:"power2.out"});
    });
  });
}

function renderRecentTransactions(){
  const list = $("#recent-tx-list");
  const recent = TRANSACTIONS.slice(-6).reverse();
  $("#recent-tx-note").textContent = recent.length + " latest";
  list.innerHTML = recent.map(tx=>{
    const label = tx.type==="issue" ? "Issued to" : "Returned by";
    const who = tx.userName || (findUser(tx.userId)||{}).name || "—";
    const when = tx.type==="issue" ? tx.issueDate : tx.returnDate;
    return `<div class="mini-row">
      <div class="mini-avatar">${initialsOf(who)}</div>
      <div class="mini-main">
        <div class="mini-title">${esc(tx.bookTitle)}</div>
        <div class="mini-sub">${label} ${esc(who)}</div>
      </div>
      <div class="mini-stamp">${fmtDate(when)}</div>
    </div>`;
  }).join("") || `<div class="mini-row"><div class="mini-main"><div class="mini-sub">No activity yet.</div></div></div>`;
  revealStagger($all(".mini-row", list),{y:8, stagger:0.04});
}

function renderOverdueList(){
  const list = $("#overdue-list");
  const overdue = BOOKS.filter(b=>b.status==="Overdue");
  const maxDaysLate = Math.max(...overdue.map(b=>daysBetween(b.dueDate, isoDaysAgo(0))), 1);
  list.innerHTML = overdue.map(b=>{
    const u = findUser(b.borrowedBy);
    const days = daysBetween(b.dueDate, isoDaysAgo(0));
    return `<div class="overdue-item">
      <div class="overdue-row">
        <div class="overdue-main">
          <div class="overdue-title">${esc(b.title)}</div>
          <div class="overdue-sub">${u?esc(u.name):"Unknown"} &middot; due ${fmtDate(b.dueDate)}</div>
        </div>
        <span class="overdue-days" aria-label="${days} days late">${days}d</span>
      </div>
      <div class="overdue-track" role="progressbar" aria-label="${days} days late" aria-valuemin="0" aria-valuemax="${maxDaysLate}" aria-valuenow="${days}">
        <div class="overdue-fill" data-w="${(days/maxDaysLate*100).toFixed(0)}%"></div>
      </div>
    </div>`;
  }).join("") || `<div class="mini-row"><div class="mini-main"><div class="mini-sub">Nothing overdue. Well kept shelves.</div></div></div>`;
  revealStagger($all(".overdue-item, .mini-row", list),{y:8, stagger:0.04});
  requestAnimationFrame(()=>{
    $all(".overdue-fill", list).forEach((el,i)=>{
      gsap.to(el,{width:el.dataset.w, duration:0.7, delay:0.08*i, ease:"power2.out"});
    });
  });
}

function renderRecentUsers(){
  const list = $("#recent-users-list");
  const recent = USERS.slice(-5).reverse();
  list.innerHTML = recent.map(u=>`
    <div class="mini-row">
      <div class="mini-avatar">${initialsOf(u.name)}</div>
      <div class="mini-main">
        <div class="mini-title">${esc(u.name)}</div>
        <div class="mini-sub">${esc(u.program)} &middot; Yr ${u.yearLevel}</div>
      </div>
      <div class="mini-stamp">${u.id}</div>
    </div>`).join("");
  revealStagger($all(".mini-row", list),{y:8, stagger:0.04});
}


/* ==================================================================
   COLLECTION / DISCOVERY MODULE
   ================================================================== */
const YEAR_BUCKETS = [
  {id:"pre1950", label:"Before 1950", test:y=> y<1950},
  {id:"1950-1999", label:"1950–1999", test:y=> y>=1950 && y<2000},
  {id:"2000-2015", label:"2000–2015", test:y=> y>=2000 && y<=2015},
  {id:"2016-now", label:"2016–Present", test:y=> y>2015},
];
const SUGGESTED_SEARCHES = ["Books about Philippine history","Psychology","Computer Science","Literature"];

function emptyFilters(){ return { subjects:[], authors:[], availability:[], years:[], formats:[] }; }
function filtersActiveCount(){
  return Object.values(state.books.filters).reduce((n,a)=>n+a.length, 0);
}
function hasActiveDiscovery(){
  return state.books.search.trim().length>0 || state.books.category!=="all" || filtersActiveCount()>0;
}

function getFilteredBooks(){
  const {search, category, filters, sort} = state.books;
  const q = search.trim().toLowerCase();
  let list = BOOKS.filter(b=>{
    const matchesSearch = !q || [b.title,b.author,b.isbn,b.category].some(v=>String(v).toLowerCase().includes(q));
    const matchesCategory = category==="all" || b.category===category;
    const matchesSubject = !filters.subjects.length || filters.subjects.includes(b.category);
    const matchesAuthor = !filters.authors.length || filters.authors.includes(b.author);
    const matchesAvailability = !filters.availability.length || filters.availability.includes(availabilityBucket(b));
    const matchesFormat = !filters.formats.length || filters.formats.includes(b.format);
    const matchesYear = !filters.years.length || filters.years.some(yid=>{
      const bucket = YEAR_BUCKETS.find(yb=>yb.id===yid);
      return bucket && bucket.test(b.year);
    });
    return matchesSearch && matchesCategory && matchesSubject && matchesAuthor && matchesAvailability && matchesFormat && matchesYear;
  });
  const popularityOf = title => (MOST_BORROWED.find(m=>m.title===title) || {count:0}).count;
  list.sort((a,b)=>{
    if(sort==="newest") return b.year - a.year;
    if(sort==="title") return a.title.localeCompare(b.title);
    if(sort==="author") return a.author.localeCompare(b.author);
    if(sort==="popular") return popularityOf(b.title) - popularityOf(a.title);
    return 0; /* featured: curated catalog order */
  });
  return list;
}

function renderBooks(){
  const filtered = getFilteredBooks();
  const hasQuery = state.books.search.trim().length>0;
  const active = hasActiveDiscovery();

  const heading = $("#books-hero-heading");
  const sub = $("#books-hero-sub");
  if(hasQuery){
    heading.innerHTML = `Search results for <span class="collection-hero-query">&ldquo;${esc(state.books.search.trim())}&rdquo;</span>`;
    sub.textContent = `${filtered.length} book${filtered.length===1?"":"s"} found.`;
  } else {
    heading.textContent = "Explore the collection";
    sub.textContent = "Find stories, ideas, and perspectives across the FEU Roosevelt Library.";
  }
  $("#books-count-sub").textContent = active
    ? `${filtered.length} of ${BOOKS.length} volumes`
    : `${BOOKS.length} volumes in the collection`;

  $all("#books-category-list [data-category]").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.category === state.books.category);
  });
  syncFiltersPanel();

  const grid = $("#books-grid");
  const empty = $("#books-empty");
  if(filtered.length===0){
    grid.innerHTML = ""; grid.hidden = true; empty.hidden = false;
    return;
  }
  grid.hidden = false; empty.hidden = true;

  const showFeatured = !active && state.books.sort==="featured";
  grid.innerHTML = filtered.map((b,i)=> bookCardHTML(b, i, {featured: showFeatured && i===0})).join("");
  revealStagger($all(".book-card", grid),{y:12, stagger:0.03});
  wireBookCards(grid);
}

/* ---------- Category quick list ---------- */
$all("#books-category-list [data-category]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.books.category = btn.dataset.category;
    renderBooks();
  });
});

/* ---------- Search field: expand-on-focus + suggestions ---------- */
const collectionSearchWrap = $("#collection-search-wrap");
const booksSearchInput = $("#books-search");
const booksSuggestions = $("#books-search-suggestions");

function toggleSearchClear(){
  const btn = $("#books-search-clear");
  if(btn) btn.hidden = !booksSearchInput.value;
}
function renderSearchSuggestions(){
  if(!booksSuggestions) return;
  booksSuggestions.innerHTML = `
    ${recentSearches.length ? `
    <div class="suggestions-group">
      <div class="suggestions-label">Recent searches</div>
      ${recentSearches.map(q=>`<button type="button" class="suggestion-item" data-q="${esc(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>
        ${esc(q)}</button>`).join("")}
    </div>` : ""}
    <div class="suggestions-group">
      <div class="suggestions-label">Suggested</div>
      ${SUGGESTED_SEARCHES.map(q=>`<button type="button" class="suggestion-item" data-q="${esc(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        ${esc(q)}</button>`).join("")}
    </div>
    <div class="suggestions-group">
      <div class="suggestions-label">Popular subjects</div>
      <div class="suggestion-chips">
        ${CATEGORIES.map(c=>`<button type="button" class="suggestion-chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
    </div>`;
  booksSuggestions.querySelectorAll(".suggestion-item").forEach(btn=>{
    btn.addEventListener("mousedown", e=>{ e.preventDefault(); commitSearch(btn.dataset.q); });
  });
  booksSuggestions.querySelectorAll(".suggestion-chip").forEach(btn=>{
    btn.addEventListener("mousedown", e=>{
      e.preventDefault();
      state.books.search = ""; booksSearchInput.value = ""; toggleSearchClear();
      state.books.category = btn.dataset.category;
      closeSuggestions();
      renderBooks();
    });
  });
}
function commitSearch(q){
  state.books.search = q;
  booksSearchInput.value = q;
  toggleSearchClear();
  pushRecentSearch(q);
  closeSuggestions();
  renderBooks();
}
function openSuggestions(){ renderSearchSuggestions(); booksSuggestions.hidden = false; collectionSearchWrap?.classList.add("is-focused"); }
function closeSuggestions(){ if(booksSuggestions) booksSuggestions.hidden = true; collectionSearchWrap?.classList.remove("is-focused"); }

booksSearchInput?.addEventListener("focus", openSuggestions);
booksSearchInput?.addEventListener("input", e=>{ state.books.search = e.target.value; toggleSearchClear(); renderBooks(); });
booksSearchInput?.addEventListener("keydown", e=>{
  if(e.key==="Enter"){ e.preventDefault(); commitSearch(booksSearchInput.value); booksSearchInput.blur(); }
  if(e.key==="Escape"){ closeSuggestions(); booksSearchInput.blur(); }
});
document.addEventListener("click", e=>{
  if(collectionSearchWrap && !collectionSearchWrap.contains(e.target)) closeSuggestions();
});
$("#books-search-clear")?.addEventListener("click", ()=>{ commitSearch(""); booksSearchInput.focus(); });

/* ---------- Filters: subject / author / availability / year / format.
   One panel, reused as an inline dropdown on desktop and a bottom sheet
   on mobile — see .filters-panel responsive rules in style.css. ---------- */
function clearAllFilters(){
  state.books.search = ""; state.books.category = "all"; state.books.filters = emptyFilters();
  if(booksSearchInput){ booksSearchInput.value = ""; toggleSearchClear(); }
  $all("#books-filters-panel input[type=checkbox]").forEach(cb=> cb.checked=false);
  renderBooks();
}
function openFiltersSheet(){
  $("#books-filters-panel")?.classList.add("open");
  $("#books-filters-backdrop")?.classList.add("show");
}
function closeFiltersSheet(){
  $("#books-filters-panel")?.classList.remove("open");
  $("#books-filters-backdrop")?.classList.remove("show");
}
function buildFiltersPanel(){
  const panel = $("#books-filters-panel");
  if(!panel) return;
  const authors = Array.from(new Set(BOOKS.map(b=>b.author))).sort((a,b)=>a.localeCompare(b));
  const group = (title, key, options, labelFn=o=>o, valueFn=o=>o) => `
    <div class="filter-group">
      <div class="filter-group-title">${title}</div>
      <div class="filter-options${key==="authors" ? " filter-options-scroll" : ""}">
        ${options.map(o=>`
          <label class="filter-option">
            <input type="checkbox" data-filter-key="${key}" value="${esc(valueFn(o))}">
            <span>${esc(labelFn(o))}</span>
          </label>`).join("")}
      </div>
    </div>`;
  panel.innerHTML = `
    <div class="filters-panel-head">
      <span>Filters</span>
      <button type="button" class="filters-clear" id="filters-clear-btn">Clear all</button>
      <button type="button" class="modal-close filters-sheet-close" id="filters-sheet-close" aria-label="Close filters">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="filters-panel-body">
      ${group("Subject","subjects",CATEGORIES)}
      ${group("Availability","availability",["Available","Borrowed","Reserved"])}
      ${group("Format","formats",FORMATS)}
      ${group("Year","years",YEAR_BUCKETS,o=>o.label,o=>o.id)}
      ${group("Author","authors",authors)}
    </div>
    <div class="filters-panel-foot">
      <button type="button" class="btn btn-primary btn-block" id="filters-apply-btn">Show results</button>
    </div>`;
  panel.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const arr = state.books.filters[cb.dataset.filterKey];
      if(cb.checked){ if(!arr.includes(cb.value)) arr.push(cb.value); }
      else { state.books.filters[cb.dataset.filterKey] = arr.filter(v=>v!==cb.value); }
      renderBooks();
    });
  });
  $("#filters-clear-btn").addEventListener("click", clearAllFilters);
  $("#filters-apply-btn").addEventListener("click", closeFiltersSheet);
  $("#filters-sheet-close").addEventListener("click", closeFiltersSheet);
  panel.dataset.built = "1";
}
function syncFiltersPanel(){
  const panel = $("#books-filters-panel");
  if(!panel || !panel.dataset.built) return;
  panel.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.checked = (state.books.filters[cb.dataset.filterKey] || []).includes(cb.value);
  });
  const toggle = $("#books-filter-toggle");
  toggle?.querySelector(".filter-count")?.remove();
  const count = filtersActiveCount();
  if(toggle && count>0) toggle.insertAdjacentHTML("beforeend", `<span class="filter-count">${count}</span>`);
}
buildFiltersPanel();
$("#books-filter-toggle")?.addEventListener("click", ()=>{
  $("#books-filters-panel")?.classList.contains("open") ? closeFiltersSheet() : openFiltersSheet();
});
$("#books-filters-backdrop")?.addEventListener("click", closeFiltersSheet);
$("#books-empty-clear")?.addEventListener("click", clearAllFilters);

/* ---------- Sort ---------- */
$("#books-sort")?.addEventListener("change", e=>{ state.books.sort = e.target.value; renderBooks(); });

/* ---------- Staff / catalog admin: kept, but tucked away as a quiet
   secondary action so the page reads as a patron collection, not a
   database console. ---------- */
$("#collection-admin-add-book")?.addEventListener("click", ()=>openBookModal(null));


/* ==================================================================
   BOOK DETAILS PAGE
   ================================================================== */
function openBookDetails(id){
  state.selectedBookId = id;
  pushRecentlyViewed(id);
  goToView("book-details", {force:true});
}
function borrowBookMock(book){
  book.status = "Borrowed";
  book.issueDate = isoDaysAgo(0);
  book.dueDate = isoDaysFromNow(CONFIG.loanDays);
  showToast(`You've borrowed “${esc(book.title)}.” Due back ${fmtDate(book.dueDate)}.`);
  renderBookDetails(book.id);
}
function reserveBookMock(book){
  reservedBookIds.add(book.id);
  showToast(`You're on the list for “${esc(book.title)}.” We'll notify you when it's back.`, {kind:"info"});
  renderBookDetails(book.id);
}
function renderBookDetails(id){
  const root = $("#view-book-details");
  const book = findBook(id);
  if(!book){
    $("#bd-content", root).hidden = true;
    $("#bd-notfound", root).hidden = false;
    return;
  }
  $("#bd-content", root).hidden = false;
  $("#bd-notfound", root).hidden = true;

  const i = BOOKS.indexOf(book);
  const bucket = availabilityBucket(book);
  const isSaved = savedBookIds.has(book.id);

  const bdCoverEl = $("#bd-cover");
  bdCoverEl.style.setProperty("--book-color", colorForBook(book, i));
  $("#bd-cover-initial").textContent = bookInitial(book);
  const existingBdImg = $(".bd-cover-img", bdCoverEl);
  if(existingBdImg) existingBdImg.remove();
  if(book.cover){
    const bdImg = document.createElement("img");
    bdImg.className = "bd-cover-img";
    bdImg.src = book.cover;
    bdImg.alt = "";
    bdImg.loading = "lazy";
    bdImg.onerror = ()=> bdImg.remove();
    bdCoverEl.prepend(bdImg);
  }
  $("#bd-category").textContent = book.category;
  $("#bd-title").textContent = book.title;
  $("#bd-author").textContent = "by " + book.author;
  $("#bd-description").textContent = book.description;

  const availEl = $("#bd-availability");
  if(bucket==="Available"){
    availEl.innerHTML = `<span class="badge badge-available">Available</span><span class="bd-avail-note">Ready to borrow from the FEU Roosevelt Library.</span>`;
  } else if(bucket==="Reserved"){
    availEl.innerHTML = `<span class="badge badge-active">Reserved</span><span class="bd-avail-note">We'll hold this for you the moment it's returned.</span>`;
  } else {
    const back = book.dueDate ? fmtDate(book.dueDate) : "soon";
    availEl.innerHTML = `<span class="badge badge-borrowed">Currently borrowed</span><span class="bd-avail-note">Expected back around ${back}.</span>`;
  }

  const primaryBtn = $("#bd-primary-action");
  primaryBtn.disabled = false;
  if(bucket==="Available"){
    primaryBtn.textContent = "Borrow book";
    primaryBtn.onclick = ()=> borrowBookMock(book);
  } else if(bucket==="Reserved"){
    primaryBtn.textContent = "Reserved";
    primaryBtn.disabled = true;
    primaryBtn.onclick = null;
  } else {
    primaryBtn.textContent = "Reserve this book";
    primaryBtn.onclick = ()=> reserveBookMock(book);
  }

  const saveBtn = $("#bd-save-action");
  saveBtn.textContent = isSaved ? "Saved to your collection" : "Save to collection";
  saveBtn.classList.toggle("is-saved", isSaved);
  saveBtn.onclick = ()=>{
    const nowSaved = toggleSavedBook(book.id);
    showToast(nowSaved ? `Saved “${esc(book.title)}” to your collection.` : `Removed “${esc(book.title)}” from your collection.`, {kind:"info"});
    renderBookDetails(book.id);
  };

  $("#bd-meta").innerHTML = `
    <div class="bd-meta-item"><span class="bd-meta-k">Publication year</span><span class="bd-meta-v">${book.year<0 ? Math.abs(book.year)+" BC" : book.year}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">ISBN</span><span class="bd-meta-v cell-mono">${esc(book.isbn)}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Category</span><span class="bd-meta-v">${esc(book.category)}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Format</span><span class="bd-meta-v">${esc(book.format)}</span></div>`;

  $("#bd-edit-link").onclick = ()=> openBookModal(book.id);
  $("#bd-remove-link").onclick = ()=> confirmDeleteBook(book.id);

  const related = BOOKS.filter(b=> b.id!==book.id && b.category===book.category);
  const relatedList = (related.length ? related : BOOKS.filter(b=>b.id!==book.id)).slice(0,6);
  $("#bd-related-section").hidden = relatedList.length===0;
  renderBookRow("bd-related-grid", relatedList);

  const rv = recentlyViewedIds.filter(x=>x!==book.id).map(findBook).filter(Boolean).slice(0,6);
  $("#bd-recent-section").hidden = rv.length===0;
  renderBookRow("bd-recent-grid", rv);

  revealStagger($all(".book-details-layout, .related-books-section, .recently-viewed-section", root),{y:14, stagger:0.06});
  root.scrollIntoView ? window.scrollTo({top:0, behavior:"instant"}) : null;
}

function wireRowActions(root, kind){
  root.querySelectorAll("[data-act]").forEach(btn=>{
    btn.addEventListener("click", e=>{
      e.stopPropagation();
      const id = btn.closest("[data-id]").dataset.id;
      const act = btn.dataset.act;
      if(kind==="book"){
        if(act==="view") openBookModal(id, {readonly:true});
        if(act==="edit") openBookModal(id);
        if(act==="delete") confirmDeleteBook(id);
      } else {
        if(act==="view") openUserModal(id, {readonly:true});
        if(act==="edit") openUserModal(id);
        if(act==="delete") confirmDeleteUser(id);
      }
    });
  });
  root.querySelectorAll("[data-id]").forEach(row=>{
    const id = row.dataset.id;
    row.addEventListener("click", ()=>{
      kind==="book" ? openBookModal(id,{readonly:true}) : openUserModal(id,{readonly:true});
    });
    row.addEventListener("keypress", e=>{
      if(e.key==="Enter"){ kind==="book" ? openBookModal(id,{readonly:true}) : openUserModal(id,{readonly:true}); }
    });
  });
}

/* ---------- Book modal (add / edit / view) ---------- */
function bookFormTemplate(book, readonly){
  const b = book || {title:"",author:"",category:CATEGORIES[0],isbn:"",year:new Date().getFullYear(),location:""};
  const dis = readonly ? "disabled" : "";
  return `
    <div class="form-grid">
      <div class="field full"><label for="f-title">Title</label><input id="f-title" type="text" value="${esc(b.title)}" ${dis} required></div>
      <div class="field"><label for="f-author">Author</label><input id="f-author" type="text" value="${esc(b.author)}" ${dis} required></div>
      <div class="field"><label for="f-category">Category</label>
        <select id="f-category" ${dis}>${CATEGORIES.map(c=>`<option ${c===b.category?"selected":""}>${c}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-isbn">ISBN</label><input id="f-isbn" type="text" value="${esc(b.isbn)}" ${dis} required></div>
      <div class="field"><label for="f-year">Publication Year</label><input id="f-year" type="number" value="${b.year}" ${dis} required></div>
      <div class="field full"><label for="f-location">Shelf / Location</label><input id="f-location" type="text" value="${esc(b.location)}" placeholder="e.g. A-12" ${dis} required></div>
      ${book ? `<div class="field"><label>Status</label><input type="text" value="${book.status}" disabled></div>
      <div class="field"><label>Book ID</label><input type="text" value="${book.id}" disabled></div>` : ""}
    </div>`;
}

function openBookModal(id, opts={}){
  const book = id ? findBook(id) : null;
  const readonly = !!opts.readonly;
  const title = readonly ? "Book Details" : (book ? "Edit Book" : "Add Book");
  const eyebrow = readonly ? "Catalog Record" : (book ? "Module 01 · Edit" : "Module 01 · New Entry");
  const bodyHtml = bookFormTemplate(book, readonly);
  const footHtml = readonly
    ? `<button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" id="modal-to-edit">Edit This Record</button>`
    : `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="modal-save-book">${book?"Save Changes":"Add Book"}</button>`;

  renderModal({title, eyebrow, bodyHtml, footHtml, size:"" , onMount:(modalEl)=>{
    wireFieldFocus(modalEl);
    if(readonly){
      $("#modal-to-edit", modalEl).addEventListener("click", ()=>{
        closeModal(()=> openBookModal(id));
      });
    } else {
      $("#modal-save-book", modalEl).addEventListener("click", ()=> saveBookForm(modalEl, book));
    }
  }});
}

async function saveBookForm(modalEl, existing){
  const vals = {
    title: $("#f-title",modalEl).value.trim(),
    author: $("#f-author",modalEl).value.trim(),
    category: $("#f-category",modalEl).value,
    isbn: $("#f-isbn",modalEl).value.trim(),
    year: parseInt($("#f-year",modalEl).value,10),
    location: $("#f-location",modalEl).value.trim(),
  };
  if (!Number.isFinite(vals.year)) vals.year = null;
  let missing=false;
  [["f-title",vals.title],["f-author",vals.author],["f-isbn",vals.isbn],["f-location",vals.location]].forEach(([id,v])=>{
    const field = document.getElementById(id).closest(".field");
    if(!v){ field.classList.add("invalid"); missing=true; } else { field.classList.remove("invalid"); }
  });
  if(missing || !vals.title){ shakeModal(modalEl); return; }

  try {
    if(existing){
      await api("books.php?id=" + encodeURIComponent(existing.id), {
        method:"PUT",
        body: JSON.stringify({
          ...vals,
          description: existing.description,
          format: existing.format,
          cover: existing.cover,
        }),
      });
      showToast(`“${esc(vals.title)}” updated successfully.`);
    } else {
      await api("books.php", {
        method:"POST",
        body: JSON.stringify({
          ...vals,
          status:"Available",
          description: BOOK_BLURBS[vals.title] || `A ${(vals.category||"general").toLowerCase()} title held in the FEU Roosevelt Library collection.`,
          format: FORMATS[BOOKS.length % FORMATS.length],
          cover: COVER_OVERRIDES[vals.title] || (vals.isbn ? `https://covers.openlibrary.org/b/isbn/${vals.isbn}-L.jpg` : null),
        }),
      });
      showToast("Book added successfully.");
    }
    await refreshCatalog();
    closeModal(()=>{ renderBooks(); renderDashboard(); });
  } catch (err) {
    showToast(err.message, {kind:"error"});
  }
}

function confirmDeleteBook(id){
  const book = findBook(id);
  const run = async ()=>{
    try {
      await api("books.php?id=" + encodeURIComponent(id), { method:"DELETE" });
      await refreshCatalog();
      if(state.currentView==="book-details" && state.selectedBookId===id){
        goToView("books", {force:true});
      } else {
        renderBooks();
        renderDashboard();
      }
      showToast("Book removed from the catalog.", {warn:true});
    } catch (err) {
      showToast(err.message, {kind:"error"});
    }
  };
  if(!CONFIG.confirmDeletes){ run(); return; }
  renderConfirm({
    title:"Remove this book?",
    body:`Remove “${esc(book.title)}” from the catalog? This cannot be undone.`,
    confirmLabel:"Remove",
    onConfirm:run,
  });
}


/* ==================================================================
   USERS MODULE
   ================================================================== */
function getFilteredUsers(){
  const {search, filter, sort} = state.users;
  let list = USERS.filter(u=>{
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || userNameMatches(u, q) || [u.id,u.program,u.contact].some(v=>String(v).toLowerCase().includes(q));
    const matchesFilter = filter==="all" || u.status===filter;
    return matchesSearch && matchesFilter;
  });
  list.sort((a,b)=>{
    if(sort==="name-asc") return a.name.localeCompare(b.name);
    if(sort==="name-desc") return b.name.localeCompare(a.name);
    if(sort==="books-desc") return b.borrowedBookIds.length - a.borrowedBookIds.length;
    return 0;
  });
  return list;
}

function renderUsers(){
  const filtered = getFilteredUsers();
  const list = filtered.slice(0, CONFIG.pageSize || 25);
  $("#users-count-sub").textContent = `${USERS.length} registered user${USERS.length===1?"":"s"} · ${filtered.length} matching · showing ${list.length}`;
  const tbody = $("#users-tbody");
  const cardList = $("#users-card-list");
  const empty = $("#users-empty");

  if(list.length===0){
    tbody.innerHTML=""; cardList.innerHTML=""; empty.style.display="block";
    return;
  }
  empty.style.display="none";

  tbody.innerHTML = list.map(u=>`
    <tr data-id="${u.id}" tabindex="0">
      <td class="cell-mono">${u.id}</td>
      <td>
        <div class="cell-primary">${esc(u.name)}</div>
        <div class="cell-sub">${esc(u.contact)}</div>
      </td>
      <td>${esc(u.program)}</td>
      <td>${u.yearLevel}</td>
      <td>${u.borrowedBookIds.length}</td>
      <td><span class="badge ${badgeClassFor(u.status)}">${u.status}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-act="view" title="View details" aria-label="View ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn" data-act="edit" title="Edit user" aria-label="Edit ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" data-act="delete" title="Remove user" aria-label="Remove ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("");

  cardList.innerHTML = list.map(u=>`
    <div class="record-card" data-id="${u.id}" tabindex="0">
      <div class="rc-top">
        <div><div class="rc-title">${esc(u.name)}</div><div class="rc-sub">${esc(u.program)} &middot; Yr ${u.yearLevel}</div></div>
        <span class="badge ${badgeClassFor(u.status)}">${u.status}</span>
      </div>
      <div class="rc-meta"><span><b>${u.id}</b></span><span>${u.borrowedBookIds.length} book(s) out</span></div>
      <div class="rc-actions">
        <button class="btn btn-secondary btn-sm" data-act="view">View</button>
        <button class="btn btn-secondary btn-sm" data-act="edit">Edit</button>
        <button class="btn btn-danger btn-sm" data-act="delete">Delete</button>
      </div>
    </div>`).join("");

  gsap.from($all("tbody tr", tbody),{opacity:0, y:10, duration:0.35, stagger:0.03, ease:"power2.out"});
  gsap.from($all(".record-card", cardList),{opacity:0, y:10, duration:0.35, stagger:0.03, ease:"power2.out"});

  wireRowActions(tbody, "user");
  wireRowActions(cardList, "user");
}

$("#users-search").addEventListener("input", e=>{ state.users.search = e.target.value; renderUsers(); });
$("#users-sort").addEventListener("change", e=>{ state.users.sort = e.target.value; renderUsers(); });
$all("#users-filter-chips .chip").forEach(chip=>{
  chip.addEventListener("click", ()=>{
    $all("#users-filter-chips .chip").forEach(c=>c.classList.remove("active"));
    chip.classList.add("active");
    state.users.filter = chip.dataset.filter;
    renderUsers();
  });
});
$("#open-add-user").addEventListener("click", ()=>openUserModal(null));

const PROGRAMS = ["BSIT","BS Architecture","BS Psychology","BS Civil Engineering","BS Nursing","BS Biology","BS Accountancy"];

function userFormTemplate(user, readonly){
  const u = user || {lastName:"",firstName:"",middleInitial:"",program:PROGRAMS[0],yearLevel:1,contact:""};
  const dis = readonly ? "disabled" : "";
  return `
    <div class="form-grid">
      <div class="name-row">
        <div class="field"><label for="f-lastname">Last Name</label><input id="f-lastname" type="text" value="${esc(u.lastName)}" ${dis} required></div>
        <div class="field"><label for="f-firstname">First Name</label><input id="f-firstname" type="text" value="${esc(u.firstName)}" ${dis} required></div>
        <div class="field"><label for="f-middleinitial">Middle Initial</label><input id="f-middleinitial" type="text" value="${esc(u.middleInitial)}" maxlength="1" autocomplete="off" ${dis}></div>
      </div>
      <div class="field"><label for="f-program">Course / Program</label>
        <select id="f-program" ${dis}>${PROGRAMS.map(p=>`<option ${p===u.program?"selected":""}>${p}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-yearlevel">Year Level</label>
        <select id="f-yearlevel" ${dis}>${[1,2,3,4,5].map(y=>`<option value="${y}" ${y===u.yearLevel?"selected":""}>Year ${y}</option>`).join("")}</select>
      </div>
      <div class="field full"><label for="f-contact">Contact Information</label><input id="f-contact" type="email" value="${esc(u.contact)}" placeholder="name@feuroosevelt.edu" ${dis} required></div>
      ${user ? `
      <div class="field"><label for="f-status">Account Status</label>${readonly
        ? `<input type="text" value="${user.status}" disabled>`
        : `<select id="f-status">${["Active","Inactive"].map(st=>`<option ${st===user.status?"selected":""}>${st}</option>`).join("")}</select>`}</div>
      <div class="field"><label>Student ID</label><input type="text" value="${user.id}" disabled></div>
      <div class="field full"><label>Currently Borrowed</label>
        <input type="text" value="${user.borrowedBookIds.length ? user.borrowedBookIds.map(id=>(findBook(id)||{}).title).filter(Boolean).join(', ') : 'None'}" disabled></div>
      ` : ""}
    </div>`;
}

function openUserModal(id, opts={}){
  const user = id ? findUser(id) : null;
  const readonly = !!opts.readonly;
  const title = readonly ? "User Details" : (user ? "Edit User" : "Add User");
  const eyebrow = readonly ? "Patron Record" : (user ? "Module 02 · Edit" : "Module 02 · New Entry");
  const bodyHtml = userFormTemplate(user, readonly);
  const footHtml = readonly
    ? `<button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" id="modal-to-edit">Edit This Record</button>`
    : `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="modal-save-user">${user?"Save Changes":"Register User"}</button>`;

  renderModal({title, eyebrow, bodyHtml, footHtml, onMount:(modalEl)=>{
    wireFieldFocus(modalEl);
    if(readonly){
      $("#modal-to-edit", modalEl).addEventListener("click", ()=>{
        closeModal(()=> openUserModal(id));
      });
    } else {
      $("#modal-save-user", modalEl).addEventListener("click", ()=> saveUserForm(modalEl, user));
    }
  }});
}

async function saveUserForm(modalEl, existing){
  const vals = {
    lastName: $("#f-lastname",modalEl).value.trim().replace(/\s+/g," "),
    firstName: $("#f-firstname",modalEl).value.trim().replace(/\s+/g," "),
    middleInitial: $("#f-middleinitial",modalEl).value.replace(/[^A-Za-z]/g,"").charAt(0).toUpperCase(),
    program: $("#f-program",modalEl).value,
    yearLevel: parseInt($("#f-yearlevel",modalEl).value,10),
    contact: $("#f-contact",modalEl).value.trim(),
  };
  vals.name = formatUserName(vals.lastName, vals.firstName, vals.middleInitial);
  const statusEl = $("#f-status",modalEl);
  if(statusEl) vals.status = statusEl.value;
  let missing=false;
  [["f-lastname",vals.lastName],["f-firstname",vals.firstName],["f-contact",vals.contact]].forEach(([id,v])=>{
    const field = document.getElementById(id).closest(".field");
    if(!v){ field.classList.add("invalid"); missing=true; } else { field.classList.remove("invalid"); }
  });
  if(vals.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.contact)){
    document.getElementById("f-contact").closest(".field").classList.add("invalid");
    missing = true;
  }
  if(missing){ shakeModal(modalEl); return; }

  try {
    if(existing){
      await api("users.php?id=" + encodeURIComponent(existing.id), { method:"PUT", body: JSON.stringify(vals) });
      showToast(`${esc(vals.name)}’s record updated.`);
    } else {
      await api("users.php", { method:"POST", body: JSON.stringify({ ...vals, status:"Active" }) });
      showToast("User registered successfully.");
    }
    await refreshCatalog();
    closeModal(()=>{ renderUsers(); renderDashboard(); });
  } catch (err) {
    showToast(err.message, {kind:"error"});
  }
}

function confirmDeleteUser(id){
  const user = findUser(id);
  if(user.borrowedBookIds.length){
    showToast("Can't remove a patron with active loans.", {warn:true});
    return;
  }
  const run = async ()=>{
    try {
      await api("users.php?id=" + encodeURIComponent(id), { method:"DELETE" });
      await refreshCatalog();
      renderUsers();
      renderDashboard();
      showToast("User removed from records.", {warn:true});
    } catch (err) {
      showToast(err.message, {kind:"error"});
    }
  };
  if(!CONFIG.confirmDeletes){ run(); return; }
  renderConfirm({
    title:"Remove this user?",
    body:`Remove “${esc(user.name)}” from the library records? This cannot be undone.`,
    confirmLabel:"Remove",
    onConfirm:run,
  });
}


/* ==================================================================
   GENERIC MODAL ENGINE
   ================================================================== */
let activeModalCloseFn = null;
let scrollLockCount = 0;
function lockScroll(){ scrollLockCount++; document.body.style.overflow = "hidden"; }
function unlockScroll(){ scrollLockCount = Math.max(0, scrollLockCount-1); if(scrollLockCount===0) document.body.style.overflow = ""; }

function renderModal({title, eyebrow, bodyHtml, footHtml, size, onMount}){
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="active-modal-backdrop">
      <div class="modal ${size||''}" role="dialog" aria-modal="true" aria-labelledby="active-modal-title">
        <div class="modal-head">
          <div>
            ${eyebrow ? `<div class="mh-eyebrow">${esc(eyebrow)}</div>` : ""}
            <h3 id="active-modal-title">${esc(title)}</h3>
          </div>
          <button class="modal-close" data-close aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
      </div>
    </div>`;
  const backdrop = $("#active-modal-backdrop", root);
  const modalEl = $(".modal", backdrop);

  function doClose(after){
    closeModalEl(backdrop, modalEl, ()=>{ root.innerHTML=""; document.removeEventListener("keydown", escHandler); unlockScroll(); if(after) after(); });
  }
  activeModalCloseFn = doClose;

  backdrop.addEventListener("click", e=>{ if(e.target===backdrop) doClose(); });
  $all("[data-close]", backdrop).forEach(b=> b.addEventListener("click", ()=>doClose()));
  function escHandler(e){ if(e.key==="Escape") doClose(); }
  document.addEventListener("keydown", escHandler);

  lockScroll();
  openModalEl(backdrop, modalEl);
  if(onMount) onMount(modalEl);
  const firstInput = modalEl.querySelector("input:not([disabled]), select:not([disabled]), button");
  if(firstInput) setTimeout(()=>firstInput.focus(),380);
}
function closeModal(after){ if(activeModalCloseFn) activeModalCloseFn(after); }
function shakeModal(modalEl){
  gsap.fromTo(modalEl,{x:-8},{x:0, duration:0.06, repeat:5, yoyo:true, ease:"power1.inOut"});
}

/* ---------- Confirmation dialog ---------- */
function renderConfirm({title, body, confirmLabel, onConfirm}){
  const root = $("#confirm-root");
  root.innerHTML = `
    <div class="modal-backdrop confirm-backdrop" id="active-confirm-backdrop">
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-body" style="padding-top:24px;">
          <div class="cm-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18.3A1.6 1.6 0 0 0 3.3 20.7h17.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-3.4 0z"/></svg></div>
          <h3 id="confirm-title" style="font-family:var(--font-display); font-size:18px; margin-bottom:8px;">${esc(title)}</h3>
          <p>${body}</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" data-close>Cancel</button>
          <button class="btn btn-danger-solid" id="confirm-btn">${esc(confirmLabel||"Confirm")}</button>
        </div>
      </div>
    </div>`;
  const backdrop = $("#active-confirm-backdrop", root);
  const modalEl = $(".modal", backdrop);
  function doClose(after){
    closeModalEl(backdrop, modalEl, ()=>{ root.innerHTML=""; document.removeEventListener("keydown", escHandler); unlockScroll(); if(after) after(); });
  }
  backdrop.addEventListener("click", e=>{ if(e.target===backdrop) doClose(); });
  $all("[data-close]", backdrop).forEach(b=> b.addEventListener("click", ()=>doClose()));
  function escHandler(e){ if(e.key==="Escape") doClose(); }
  document.addEventListener("keydown", escHandler);
  $("#confirm-btn", backdrop).addEventListener("click", ()=>{ doClose(); onConfirm(); });
  lockScroll();
  openModalEl(backdrop, modalEl);
  setTimeout(()=> $("#confirm-btn", backdrop).focus(), 380);
}


/* ==================================================================
   ISSUE BOOK WORKFLOW
   ================================================================== */
function resetIssueWizard(){
  state.issue = {step:1, studentId:null, bookId:null};
  const issueInput = $("#issue-date");
  issueInput.value = isoDaysAgo(0);
  issueInput.readOnly = true;
  issueInput.title = "The issue date is always today and is set by the server.";
  const dueInput = $("#issue-due-date");
  dueInput.min = isoDaysAgo(0);
  dueInput.max = isoDaysFromNow(CONFIG.loanDays);
  dueInput.value = dueInput.max;
  $("#issue-student-search").value = "";
  $("#issue-book-search").value = "";
  $("#issue-next-1").disabled = true;
  $("#issue-next-2").disabled = true;
  renderIssueStudentList("");
  renderIssueBookList("");
  goToIssueStep(1, true);
}

function goToIssueStep(n, instant){
  state.issue.step = n;
  $all("#issue-rail .wizard-step").forEach(el=>{
    const s = parseInt(el.dataset.step,10);
    el.classList.toggle("current", s===n);
    el.classList.toggle("done", s<n);
  });
  $all(".wz-stage", $("#view-issue")).forEach(stage=>{
    stage.classList.toggle("active", stage.id === "issue-stage-"+n);
  });
  if(!instant){
    const stage = $("#issue-stage-"+n);
    gsap.fromTo(stage,{opacity:0,x:16},{opacity:1,x:0,duration:0.4,ease:"power2.out"});
  }
}

function renderIssueStudentList(q){
  const list = $("#issue-student-list");
  q = q.trim().toLowerCase();
  const filtered = USERS.filter(u=> u.status==="Active" && (!q || userNameMatches(u, q) || u.id.toLowerCase().includes(q)));
  list.innerHTML = filtered.map(u=>`
    <div class="pick-row ${state.issue.studentId===u.id?'selected':''}" data-id="${u.id}">
      <div class="pr-main"><div class="pr-title">${esc(u.name)}</div><div class="pr-sub">${u.id} &middot; ${esc(u.program)}</div></div>
      <div class="mini-avatar">${initialsOf(u.name)}</div>
    </div>`).join("") || `<div class="empty-state" style="padding:30px;"><div class="s">No matching students.</div></div>`;
  $all(".pick-row", list).forEach(row=>{
    row.addEventListener("click", ()=>{
      state.issue.studentId = row.dataset.id;
      renderIssueStudentList($("#issue-student-search").value);
      $("#issue-next-1").disabled = false;
    });
  });
}
function renderIssueBookList(q){
  const list = $("#issue-book-list");
  q = q.trim().toLowerCase();
  const filtered = BOOKS.filter(b=> b.status==="Available" && (!q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)));
  list.innerHTML = filtered.map(b=>`
    <div class="pick-row ${state.issue.bookId===b.id?'selected':''}" data-id="${b.id}">
      <div class="pr-main"><div class="pr-title">${esc(b.title)}</div><div class="pr-sub">${esc(b.author)} &middot; Shelf ${esc(b.location)}</div></div>
      <span class="badge badge-available">Available</span>
    </div>`).join("") || `<div class="empty-state" style="padding:30px;"><div class="s">No available titles match your search.</div></div>`;
  $all(".pick-row", list).forEach(row=>{
    row.addEventListener("click", ()=>{
      state.issue.bookId = row.dataset.id;
      renderIssueBookList($("#issue-book-search").value);
      $("#issue-next-2").disabled = false;
    });
  });
}

$("#issue-student-search").addEventListener("input", e=> renderIssueStudentList(e.target.value));
$("#issue-book-search").addEventListener("input", e=> renderIssueBookList(e.target.value));
$("#issue-next-1").addEventListener("click", ()=> goToIssueStep(2));
$("#issue-next-2").addEventListener("click", ()=>{
  const student = findUser(state.issue.studentId), book = findBook(state.issue.bookId);
  $("#issue-summary-student").innerHTML = `
    <div class="cc-callno">PATRON RECORD</div>
    <div class="cc-title">${esc(student.name)}</div>
    <div class="cc-row"><span>ID</span><b>${student.id}</b></div>
    <div class="cc-row"><span>Program</span><b>${esc(student.program)}</b></div>
    <div class="cc-row"><span>Year</span><b>${student.yearLevel}</b></div>`;
  $("#issue-summary-book").innerHTML = `
    <div class="cc-callno">CALL NO. ${esc(book.location)}</div>
    <div class="cc-title">${esc(book.title)}</div>
    <div class="cc-row"><span>Author</span><b>${esc(book.author)}</b></div>
    <div class="cc-row"><span>Category</span><b>${esc(book.category)}</b></div>
    <div class="cc-row"><span>ISBN</span><b>${esc(book.isbn)}</b></div>`;
  goToIssueStep(3);
});
$all('#issue-stage-2 [data-back], #issue-stage-3 [data-back]').forEach(b=>{
  b.addEventListener("click", ()=> goToIssueStep(parseInt(b.dataset.back,10)));
});
$("#issue-confirm-btn").addEventListener("click", async ()=>{
  const btn = $("#issue-confirm-btn");
  if(btn.disabled) return; // ignore double clicks while a request is in flight
  const student = findUser(state.issue.studentId), book = findBook(state.issue.bookId);
  if(!student || !book){
    showToast("Select a patron and a book first.", {kind:"error"});
    return;
  }
  if(student.borrowedBookIds.length >= (CONFIG.maxBooksPerUser || 5)){
    showToast(`Loan limit reached (${CONFIG.maxBooksPerUser} books per patron).`, {warn:true});
    return;
  }
  // Only IDs and the requested due date are sent; the server sets the issue date and validates everything.
  const dueDate = $("#issue-due-date").value || undefined;
  btn.disabled = true;
  try {
    const res = await api("transactions.php", {
      method:"POST",
      body: JSON.stringify({ type:"issue", bookId: book.id, userId: student.id, dueDate }),
    });
    const tx = res.transaction || {};
    try { await refreshCatalog(); }
    catch (e) { showToast("Issued, but the lists could not refresh. Reload the page.", {warn:true}); }
    $("#issue-final-caption").innerHTML = `<b>${esc(book.title)}</b> issued to <b>${esc(student.name)}</b>, due ${fmtDate(tx.dueDate || dueDate)}.`;
    goToIssueStep(4);
    playStamp($("#issue-stamp"));
    showToast("Book issued successfully.");
    renderDashboard();
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    btn.disabled = false;
  }
});
$("#issue-restart-btn").addEventListener("click", resetIssueWizard);

/* ==================================================================
   RETURN BOOK WORKFLOW
   ================================================================== */
function resetReturnWizard(){
  state.ret = {step:1, bookId:null};
  $("#return-search").value = "";
  $("#return-confirm-panel").style.display = "flex";
  $("#return-final-panel").style.display = "none";
  renderReturnLoanList("");
  goToReturnStep(1, true);
}
function goToReturnStep(n, instant){
  state.ret.step = n;
  $all("#return-rail .wizard-step").forEach(el=>{
    const s = parseInt(el.dataset.step,10);
    el.classList.toggle("current", s===n);
    el.classList.toggle("done", s<n);
  });
  $all(".wz-stage", $("#view-return")).forEach(stage=>{
    stage.classList.toggle("active", stage.id === "return-stage-"+n);
  });
  if(!instant){
    const stage = $("#return-stage-"+n);
    gsap.fromTo(stage,{opacity:0,x:16},{opacity:1,x:0,duration:0.4,ease:"power2.out"});
  }
}
function renderReturnLoanList(q){
  const list = $("#return-loan-list");
  q = q.trim().toLowerCase();
  const loans = BOOKS.filter(b=> (b.status==="Borrowed"||b.status==="Overdue") &&
    (!q || b.title.toLowerCase().includes(q) || userNameMatches(findUser(b.borrowedBy), q)));
  list.innerHTML = loans.map(b=>{
    const u = findUser(b.borrowedBy);
    return `<div class="pick-row" data-id="${b.id}">
      <div class="pr-main"><div class="pr-title">${esc(b.title)}</div><div class="pr-sub">${esc(u?u.name:"—")} &middot; due ${fmtDate(b.dueDate)}</div></div>
      <span class="badge ${badgeClassFor(b.status)}">${b.status}</span>
    </div>`;
  }).join("") || `<div class="empty-state" style="padding:30px;"><div class="s">No borrowed titles match your search.</div></div>`;
  $all(".pick-row", list).forEach(row=>{
    row.addEventListener("click", ()=>{
      state.ret.bookId = row.dataset.id;
      const b = findBook(state.ret.bookId);
      const u = findUser(b.borrowedBy) || {name:b.borrowedBy || "Unknown patron", id:b.borrowedBy || "—", program:"—"};
      $("#return-summary-book").innerHTML = `
        <div class="cc-callno">CALL NO. ${esc(b.location)}</div>
        <div class="cc-title">${esc(b.title)}</div>
        <div class="cc-row"><span>Author</span><b>${esc(b.author)}</b></div>
        <div class="cc-row"><span>Category</span><b>${esc(b.category)}</b></div>`;
      $("#return-summary-student").innerHTML = `
        <div class="cc-callno">PATRON RECORD</div>
        <div class="cc-title">${esc(u.name)}</div>
        <div class="cc-row"><span>ID</span><b>${u.id}</b></div>
        <div class="cc-row"><span>Program</span><b>${esc(u.program)}</b></div>`;
      $("#return-issue-date-display").value = fmtDate(b.issueDate);
      $("#return-due-date-display").value = fmtDate(b.dueDate);
      const rd = $("#return-date-input");
      rd.max = isoDaysAgo(0);
      rd.min = b.issueDate || "";
      rd.value = isoDaysAgo(0);
      updateReturnCalc();
      goToReturnStep(2);
    });
  });
}
$("#return-search").addEventListener("input", e=> renderReturnLoanList(e.target.value));
$all('#return-stage-2 [data-back], #return-stage-3 [data-back], #return-stage-4 [data-back]').forEach(b=>{
  b.addEventListener("click", ()=> goToReturnStep(parseInt(b.dataset.back,10)));
});
$all('[data-next-return]').forEach(b=>{
  b.addEventListener("click", ()=>{
    const n = parseInt(b.dataset.nextReturn,10);
    if(n===4) updateReturnCalc();
    goToReturnStep(n);
  });
});
function updateReturnCalc(){
  const b = findBook(state.ret.bookId);
  const today = isoDaysAgo(0);
  let returnDate = $("#return-date-input").value || today;
  if(returnDate > today) returnDate = today;
  if(b.issueDate && returnDate < b.issueDate) returnDate = b.issueDate;
  $("#return-date-input").value = returnDate;
  const overdueDays = Math.max(0, daysBetween(b.dueDate, returnDate));
  const grace = CONFIG.gracePeriodDays || 0;
  const billable = CONFIG.overdueFinesEnabled ? Math.max(0, overdueDays - grace) : 0;
  $("#return-days-overdue").value = overdueDays===0 ? "Not overdue" : overdueDays + " day(s)";
  const rate = CONFIG.finePerDay; // saved server setting; the server computes the authoritative fine on return
  const fine = billable * rate;
  $("#return-fine-detail").textContent = !CONFIG.overdueFinesEnabled
    ? "Overdue fines are disabled in Library settings"
    : overdueDays===0
    ? `No overdue days · ₱${rate.toFixed(2)} / day`
    : `${overdueDays} day(s) overdue · ${grace}d grace · ₱${rate.toFixed(2)} / day`;
  const amountEl = $("#return-fine-amount");
  amountEl.classList.toggle("zero", fine===0);
  animateNumber(amountEl, 0, fine, {duration:0.9});
  state.ret.returnDate = returnDate;
  state.ret.fine = fine;
  state.ret.overdueDays = overdueDays;
}
$("#return-date-input").addEventListener("change", updateReturnCalc);
$("#return-confirm-btn").addEventListener("click", async ()=>{
  const btn = $("#return-confirm-btn");
  if(btn.disabled) return; // ignore double clicks while a request is in flight
  const b = findBook(state.ret.bookId);
  if(!b){
    showToast("Select a loan first.", {kind:"error"});
    return;
  }
  btn.disabled = true;
  try {
    // The server computes the fine and ignores any client-supplied amount, status, or names.
    const res = await api("transactions.php", {
      method:"POST",
      body: JSON.stringify({ type:"return", bookId: b.id, userId: b.borrowedBy, returnDate: state.ret.returnDate }),
    });
    const fine = Number(res.fine || 0);
    const who = (res.transaction && res.transaction.userName) || "the patron";
    try { await refreshCatalog(); }
    catch (e) { showToast("Returned, but the lists could not refresh. Reload the page.", {warn:true}); }
    $("#return-final-caption").innerHTML = fine>0
      ? `<b>${esc(b.title)}</b> returned by <b>${esc(who)}</b>. Fine assessed: <b>₱${fine.toFixed(2)}</b>.`
      : `<b>${esc(b.title)}</b> returned by <b>${esc(who)}</b> on time. No fine due.`;
    $("#return-confirm-panel").style.display="none";
    $("#return-final-panel").style.display="flex";
    playStamp($("#return-stamp"));
    showToast(fine>0 ? `Fine assessed: ₱${fine.toFixed(2)}` : "Book returned successfully.", {warn: fine>0});
    renderDashboard();
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    btn.disabled = false;
  }
});
$("#return-restart-btn").addEventListener("click", resetReturnWizard);


/* ==================================================================
   REPORTS
   ================================================================== */
function renderReports(type){
  $all('.nav-item[data-report]').forEach(n=> n.classList.toggle('active', n.dataset.report===type));
  const heading = $("#reports-heading"), sub = $("#reports-sub"), panelTitle = $("#reports-panel-title");
  const chartWrap = $("#reports-chart-wrap");
  const theadRow = $("#reports-thead-row"), tbody = $("#reports-tbody");

  if(type==="overdue"){
    heading.textContent = "Overdue Report";
    sub.textContent = "Every title currently past its due date, with the running fine.";
    panelTitle.textContent = "Overdue volumes by days late";
    const overdue = BOOKS.filter(b=>b.status==="Overdue").map(b=>({
      title:b.title, days:daysBetween(b.dueDate, isoDaysAgo(0)),
    }));
    const max = Math.max(1,...overdue.map(o=>o.days));
    chartWrap.innerHTML = overdue.length ? `<div class="report-overdue-list">${overdue.map(o=>`
      <div class="report-overdue-item">
        <div class="report-overdue-row">
          <span class="report-overdue-title">${esc(o.title)}</span>
          <span class="report-overdue-days" aria-label="${o.days} days late">${o.days}d</span>
        </div>
        <div class="report-overdue-track" role="progressbar" aria-label="${o.days} days late" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${o.days}">
          <div class="report-overdue-fill" style="background:var(--oxblood);" data-w="${(o.days/max*100).toFixed(0)}"></div>
        </div>
      </div>`).join("")}</div>`
      : `<div class="empty-state" style="padding:40px;"><div class="s">Nothing overdue right now.</div></div>`;
    requestAnimationFrame(()=> $all(".report-overdue-fill", chartWrap).forEach((el,i)=> gsap.to(el,{width:el.dataset.w+"%", duration:0.8, delay:0.05*i})));

    theadRow.innerHTML = "<th>Book</th><th>Borrower</th><th>Due Date</th><th>Days Late</th><th>Est. Fine</th>";
    const rate = parseFloat($("#settings-fine-rate").value) || CONFIG.finePerDay;
    tbody.innerHTML = BOOKS.filter(b=>b.status==="Overdue").map(b=>{
      const u = findUser(b.borrowedBy);
      const days = daysBetween(b.dueDate, isoDaysAgo(0));
      return `<tr><td class="cell-primary">${esc(b.title)}</td><td>${esc(u?u.name:"—")}</td><td class="cell-mono">${fmtDate(b.dueDate)}</td>
        <td><span class="badge badge-overdue">${days}d</span></td><td class="cell-mono">₱${(days*rate).toFixed(2)}</td></tr>`;
    }).join("") || `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">No overdue records.</td></tr>`;
  } else {
    heading.textContent = "Borrowing Report";
    sub.textContent = "Issue and return activity across the collection.";
    panelTitle.textContent = "Borrowing over the last 7 days";
    renderActivityChart("reports-chart-wrap");
    theadRow.innerHTML = "<th>Transaction</th><th>Book</th><th>Person</th><th>Date</th><th>Fine</th>";
    tbody.innerHTML = TRANSACTIONS.slice().reverse().slice(0,12).map(t=>`
      <tr><td><span class="badge ${t.type==='issue'?'badge-borrowed':'badge-available'}">${t.type==='issue'?'Issued':'Returned'}</span></td>
      <td class="cell-primary">${esc(t.bookTitle)}</td><td>${esc(t.userName)}</td>
      <td class="cell-mono">${fmtDate(t.type==='issue'?t.issueDate:t.returnDate)}</td>
      <td class="cell-mono">${t.fine ? "₱"+t.fine.toFixed(2) : "—"}</td></tr>`).join("");
  }
}

/* ==================================================================
   SETTINGS — frontend prototype (localStorage only, no backend)
   ================================================================== */
const AVATAR_PRESETS = ["#237A43","#154A28","#EBB134","#2F4A63","#7A2E2E","#3D6B4F"];
let profileEditing = false;
let profileSnapshot = null;

function setFieldError(input, msg){
  const field = input.closest(".field");
  if(!field) return false;
  field.classList.add("invalid");
  const err = field.querySelector(".err");
  if(err) err.textContent = msg || "Please check this field.";
  return false;
}
function clearFieldError(input){
  const field = input?.closest(".field");
  if(!field) return;
  field.classList.remove("invalid");
  const err = field.querySelector(".err");
  if(err) err.textContent = "";
}
function markSaving(btn, on){
  if(!btn) return;
  btn.classList.toggle("is-saving", on);
  btn.disabled = on;
}

function applyDensity(){
  document.documentElement.setAttribute("data-density", CONFIG.density || "comfortable");
}

function paintAvatarEl(el){
  if(!el) return;
  const initials = initialsOf(ACCOUNT.displayName || "AL") || "AL";
  if(ACCOUNT.avatarDataUrl){
    el.classList.add("has-photo");
    el.style.backgroundImage = `url(${ACCOUNT.avatarDataUrl})`;
    el.style.backgroundColor = "";
    el.textContent = "";
  } else {
    el.classList.remove("has-photo");
    el.style.backgroundImage = "";
    el.style.backgroundColor = ACCOUNT.avatarPreset || "";
    el.textContent = initials;
  }
}
function paintAvatars(){
  paintAvatarEl($("#header-avatar"));
  paintAvatarEl($("#menu-avatar"));
  paintAvatarEl($("#profile-avatar"));
  const name = ACCOUNT.displayName || DEFAULT_ACCOUNT.displayName;
  const user = ACCOUNT.username || DEFAULT_ACCOUNT.username;
  if($("#menu-name")) $("#menu-name").textContent = name;
  if($("#menu-user")) $("#menu-user").textContent = "@" + user.replace(/^@/,"");
  if($("#profile-card-name")) $("#profile-card-name").textContent = name;
  if($("#profile-card-handle")) $("#profile-card-handle").textContent = "@" + user.replace(/^@/,"");
  if($("#profile-role-badge")) $("#profile-role-badge").textContent = ACCOUNT.role;
  if($("#profile-status-badge")) $("#profile-status-badge").textContent = ACCOUNT.status;
}

function syncSwitchLabels(){
  $all(".switch-row").forEach(row=>{
    const input = row.querySelector("input[type=checkbox]");
    const tag = row.querySelector(".onoff");
    if(input && tag) tag.textContent = input.checked ? "ON" : "OFF";
  });
}

function showSettingsPane(id){
  const paneId = id || "profile";
  $all(".settings-nav-item").forEach(b=>{
    const on = b.dataset.settings === paneId;
    b.classList.toggle("active", on);
  });
  $all(".settings-pane").forEach(p=>{
    p.classList.toggle("active", p.id === "settings-pane-" + paneId);
  });
  const pane = $("#settings-pane-" + paneId);
  if(pane && window.gsap){
    gsap.fromTo(pane, {opacity:0, y:8}, {opacity:1, y:0, duration:0.28, ease:"power2.out"});
  }
  pane?.scrollIntoView({behavior:"smooth", block:"nearest"});
}

function fillProfileForm(){
  $("#profile-name").value = ACCOUNT.displayName;
  $("#profile-username").value = ACCOUNT.username.replace(/^@/,"");
  $("#profile-email").value = ACCOUNT.email;
  $("#profile-role").value = ACCOUNT.role;
  $("#profile-status").value = ACCOUNT.status;
  $("#profile-password").value = "";
  ["profile-name","profile-username","profile-email","profile-password"].forEach(id=> clearFieldError($("#"+id)));
}

function setProfileEditing(on){
  profileEditing = on;
  ["profile-name","profile-username","profile-email"].forEach(id=>{
    $("#"+id).disabled = !on;
  });
  $("#profile-password").disabled = true;
  $("#profile-form-actions").hidden = !on;
  $("#edit-profile-btn").textContent = on ? "Editing…" : "Edit Profile";
  $("#edit-profile-btn").disabled = on;
  if(on){
    profileSnapshot = {
      displayName: ACCOUNT.displayName,
      username: ACCOUNT.username,
      email: ACCOUNT.email,
    };
    setTimeout(()=> $("#profile-name").focus(), 50);
  }
}

function hydrateSettings(){
  fillProfileForm();
  setProfileEditing(false);
  paintAvatars();
  $("#settings-library-name").value = CONFIG.libraryName;
  $("#settings-library-email").value = CONFIG.libraryEmail;
  $("#settings-library-phone").value = CONFIG.libraryPhone;
  $("#settings-library-address").value = CONFIG.libraryAddress;
  $("#settings-loan-days").value = CONFIG.loanDays;
  $("#settings-max-books").value = CONFIG.maxBooksPerUser;
  $("#settings-fine-rate").value = CONFIG.finePerDay;
  $("#settings-max-renewals").value = CONFIG.maxRenewals;
  $("#settings-fines-enabled").checked = !!CONFIG.overdueFinesEnabled;
  $("#notif-due").checked = !!NOTIF_PREFS.due;
  $("#notif-overdue").checked = !!NOTIF_PREFS.overdue;
  $("#notif-newuser").checked = !!NOTIF_PREFS.newUser;
  $("#notif-returns").checked = !!NOTIF_PREFS.returns;
  $("#notif-system").checked = !!NOTIF_PREFS.system;
  $("#sys-language").value = CONFIG.language;
  $("#sys-date-format").value = CONFIG.dateFormat;
  $("#sys-time-format").value = CONFIG.timeFormat;
  $("#sys-landing").value = CONFIG.landingPage || "dashboard";
  $("#sys-page-size").value = String(CONFIG.pageSize);
  $("#sys-density").value = CONFIG.density || "comfortable";
  $("#sys-confirm-delete").checked = !!CONFIG.confirmDeletes;
  if($("#security-last-login")) $("#security-last-login").textContent = fmtDateTime(ACCOUNT.lastLogin);
  applyTheme(localStorage.getItem(STORAGE.theme) || "light", false);
  applyDensity();
  syncSwitchLabels();
}

$all(".settings-nav-item").forEach(btn=>{
  btn.addEventListener("click", ()=> showSettingsPane(btn.dataset.settings));
});

$("#edit-profile-btn").addEventListener("click", ()=> setProfileEditing(true));
$("#profile-cancel-btn").addEventListener("click", ()=>{
  if(profileSnapshot){
    ACCOUNT.displayName = profileSnapshot.displayName;
    ACCOUNT.username = profileSnapshot.username;
    ACCOUNT.email = profileSnapshot.email;
  }
  fillProfileForm();
  paintAvatars();
  setProfileEditing(false);
  showToast("Profile edits discarded.", {kind:"info"});
});

$("#profile-form").addEventListener("submit", async e=>{
  e.preventDefault();
  if(!profileEditing) { setProfileEditing(true); return; }
  const name = $("#profile-name").value.trim();
  const username = $("#profile-username").value.trim().replace(/^@/,"");
  const email = $("#profile-email").value.trim();
  let ok = true;
  ["profile-name","profile-username","profile-email"].forEach(id=> clearFieldError($("#"+id)));
  if(name.length < 2) ok = setFieldError($("#profile-name"), "Enter a display name.");
  if(!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) ok = setFieldError($("#profile-username"), "Use 3–24 letters, numbers, dots or dashes.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = setFieldError($("#profile-email"), "Enter a valid email.");
  if($("#profile-password").value){
    showToast("Passwords are not stored. Use Security to preview a password change.", {kind:"info"});
    $("#profile-password").value = "";
  }
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#profile-save-btn");
  markSaving(btn, true);
  try {
    ACCOUNT.displayName = name;
    ACCOUNT.username = username;
    ACCOUNT.email = email;
    await persistAccount();
    paintAvatars();
    fillProfileForm();
    setProfileEditing(false);
    showToast("Profile updated successfully.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

function compressImageFile(file, cb){
  const reader = new FileReader();
  reader.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, size, size);
      cb(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function applyAvatarData(dataUrl, preset){
  ACCOUNT.avatarDataUrl = dataUrl;
  ACCOUNT.avatarPreset = preset || null;
  try {
    await persistAccount();
    paintAvatars();
  } catch (err) {
    /* persistAccount already toasts */
  }
}

$("#avatar-edit-btn").addEventListener("click", ()=>{
  renderModal({
    title:"Profile photo",
    eyebrow:"Account",
    size:"modal-sm",
    bodyHtml:`
      <p class="settings-lead" style="margin-bottom:14px;">Upload a photo, pick a color, or return to initials. Saved to the admin account on the server.</p>
      <div class="preset-grid" id="avatar-presets">
        ${AVATAR_PRESETS.map(c=>`<button type="button" class="preset-swatch" data-preset="${c}" style="background:${c}" aria-label="Avatar color ${c}"></button>`).join("")}
      </div>`,
    footHtml:`
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-secondary" type="button" id="avatar-remove">Remove Photo</button>
      <button class="btn btn-primary" type="button" id="avatar-upload">Upload Photo</button>`,
    onMount:(modalEl)=>{
      $all(".preset-swatch", modalEl).forEach(sw=>{
        sw.addEventListener("click", ()=>{
          applyAvatarData(null, sw.dataset.preset);
          closeModal();
          showToast("Avatar updated.");
        });
      });
      $("#avatar-upload", modalEl).addEventListener("click", ()=> $("#avatar-file").click());
      $("#avatar-remove", modalEl).addEventListener("click", ()=>{
        closeModal();
        renderConfirm({
          title:"Remove profile photo?",
          body:"Initials will be shown instead of a photo.",
          confirmLabel:"Remove",
          onConfirm:()=>{
            applyAvatarData(null, null);
            showToast("Profile photo removed.", {kind:"info"});
          },
        });
      });
    },
  });
});

$("#avatar-file").addEventListener("change", e=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!file) return;
  if(!file.type.startsWith("image/")){
    showToast("Please choose an image file.", {kind:"error"});
    return;
  }
  compressImageFile(file, url=>{
    applyAvatarData(url, null);
    closeModal();
    showToast("Profile photo updated.");
  });
});

$all(".theme-card").forEach(card=>{
  card.addEventListener("click", ()=>{
    applyTheme(card.dataset.themePref, true);
    showToast("Appearance preference saved.");
  });
});

$all(".switch-row input[type=checkbox]").forEach(input=>{
  input.addEventListener("change", syncSwitchLabels);
});

$("#settings-save-btn").addEventListener("click", async ()=>{
  const name = $("#settings-library-name").value.trim();
  const email = $("#settings-library-email").value.trim();
  const phone = $("#settings-library-phone").value.trim();
  const address = $("#settings-library-address").value.trim();
  const loanDays = parseInt($("#settings-loan-days").value,10);
  const maxBooks = parseInt($("#settings-max-books").value,10);
  const rate = parseFloat($("#settings-fine-rate").value);
  const renewals = parseInt($("#settings-max-renewals").value,10);
  let ok = true;
  ["settings-library-name","settings-library-email","settings-loan-days","settings-max-books","settings-fine-rate","settings-max-renewals"].forEach(id=> clearFieldError($("#"+id)));
  if(name.length < 2) ok = setFieldError($("#settings-library-name"), "Enter the library name.");
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = setFieldError($("#settings-library-email"), "Enter a valid email.");
  if(!(loanDays>=1)) ok = setFieldError($("#settings-loan-days"), "Must be at least 1 day.");
  if(!(maxBooks>=1)) ok = setFieldError($("#settings-max-books"), "Must be at least 1.");
  if(!(rate>=0)) ok = setFieldError($("#settings-fine-rate"), "Must be 0 or more.");
  if(!(renewals>=0)) ok = setFieldError($("#settings-max-renewals"), "Must be 0 or more.");
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#settings-save-btn");
  markSaving(btn, true);
  try {
    CONFIG.libraryName = name;
    CONFIG.libraryEmail = email;
    CONFIG.libraryPhone = phone;
    CONFIG.libraryAddress = address;
    CONFIG.loanDays = loanDays;
    CONFIG.maxBooksPerUser = maxBooks;
    CONFIG.finePerDay = rate;
    CONFIG.maxRenewals = renewals;
    CONFIG.overdueFinesEnabled = $("#settings-fines-enabled").checked;
    await persistConfig();
    showToast("Library settings saved.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

$("#notif-prefs-save").addEventListener("click", async ()=>{
  NOTIF_PREFS.due = $("#notif-due").checked;
  NOTIF_PREFS.overdue = $("#notif-overdue").checked;
  NOTIF_PREFS.newUser = $("#notif-newuser").checked;
  NOTIF_PREFS.returns = $("#notif-returns").checked;
  NOTIF_PREFS.system = $("#notif-system").checked;
  const btn = $("#notif-prefs-save");
  markSaving(btn, true);
  try {
    await persistNotifs();
    showToast("Notification preferences updated.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

function passwordScore(pw){
  let s = 0;
  if(pw.length >= 8) s++;
  if(/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if(/\d/.test(pw)) s++;
  if(/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
$("#sec-new-pass")?.addEventListener("input", ()=>{
  const pw = $("#sec-new-pass").value;
  const score = passwordScore(pw);
  const bar = $("#pw-meter-bar");
  const label = $("#pw-meter-label");
  if(bar) bar.style.width = (score/4*100) + "%";
  if(bar) bar.dataset.score = String(score);
  if(label) label.textContent = !pw ? "Use 8 or more characters." : ["Weak","Fair","Good","Strong"][Math.max(0,score-1)];
});
$all(".pw-toggle").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const input = $("#"+btn.dataset.pw);
    if(!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
  });
});
$("#sec-change-pass").addEventListener("click", ()=>{
  const cur = $("#sec-current-pass");
  const nw = $("#sec-new-pass");
  const cf = $("#sec-confirm-pass");
  [cur,nw,cf].forEach(clearFieldError);
  let ok = true;
  if(!cur.value) ok = setFieldError(cur, "Enter the current password.");
  if(nw.value.length < 10) ok = setFieldError(nw, "Use at least 10 characters.");
  if(nw.value !== cf.value) ok = setFieldError(cf, "Passwords do not match.");
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#sec-change-pass");
  markSaving(btn, true);
  api("auth.php", {
    method:"POST",
    body:JSON.stringify({
      action:"password",
      currentPassword:cur.value,
      newPassword:nw.value,
      confirmPassword:cf.value,
    }),
  }).then(()=>{
    cur.value = nw.value = cf.value = "";
    if($("#pw-meter-bar")) $("#pw-meter-bar").style.width = "0";
    showToast("Password updated successfully.");
  }).catch(err=>{
    showToast(err.message, {kind:"error"});
  }).finally(()=>{
    markSaving(btn, false);
  });
});
$("#sec-logout-one").addEventListener("click", ()=>{
  renderConfirm({
    title:"Sign out of this device?",
    body:"Your current staff session will be ended.",
    confirmLabel:"Sign out",
    onConfirm:signOutCurrentSession,
  });
});

$("#sys-save-btn").addEventListener("click", async ()=>{
  CONFIG.language = $("#sys-language").value;
  CONFIG.dateFormat = $("#sys-date-format").value;
  CONFIG.timeFormat = $("#sys-time-format").value;
  CONFIG.landingPage = $("#sys-landing").value;
  CONFIG.pageSize = parseInt($("#sys-page-size").value,10) || 25;
  CONFIG.density = $("#sys-density").value;
  CONFIG.confirmDeletes = $("#sys-confirm-delete").checked;
  const btn = $("#sys-save-btn");
  markSaving(btn, true);
  try {
    await persistConfig();
    applyDensity();
    showToast("System preferences saved.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

$("#settings-reset-btn").addEventListener("click", ()=>{
  renderConfirm({
    title:"Reset settings to defaults?",
    body:"Profile, appearance, library, notification, and system preferences on this device will be restored. Books, users, and transactions are not deleted.",
    confirmLabel:"Reset settings",
    onConfirm: async ()=>{
      try {
        Object.assign(CONFIG, DEFAULT_CONFIG);
        Object.assign(ACCOUNT, DEFAULT_ACCOUNT, {lastLogin: ACCOUNT.lastLogin});
        Object.assign(NOTIF_PREFS, DEFAULT_NOTIFS);
        ACCOUNT.avatarDataUrl = null;
        ACCOUNT.avatarPreset = null;
        await persistConfig();
        await persistAccount();
        await persistNotifs();
        localStorage.setItem(STORAGE.theme, "light");
        applyTheme("light", true);
        applyDensity();
        hydrateSettings();
        showToast("Settings restored to defaults.");
      } catch (err) {
        showToast(err.message, {kind:"error"});
      }
    },
  });
});

/* hydrateSettings + paintAvatars run after bootstrapFromApi() */

/* ==================================================================
   GLOBAL SEARCH (topbar) → jumps to Books with the query applied
   ================================================================== */
$("#global-search").addEventListener("keydown", e=>{
  if(e.key==="Enter"){
    const q = e.target.value;
    state.books.category = "all";
    state.books.filters = emptyFilters();
    if(q.trim()) pushRecentSearch(q);
    goToView("books", {force:true});
    setTimeout(()=>{ $("#books-search").value = q; state.books.search = q; toggleSearchClear(); renderBooks(); }, 420);
  }
});

/* ==================================================================
   LOADING SEQUENCE + INIT
   ================================================================== */
function splitToChars(el){
  const text = el.textContent;
  el.innerHTML = text.split("").map(ch => `<span style="display:inline-block;">${ch===" "?"&nbsp;":ch}</span>`).join("");
  return el.querySelectorAll("span");
}

function playLoadingSequence(){
  const line1 = splitToChars($("#loader-line-1 span"));
  const line2 = splitToChars($("#loader-line-2 span"));
  gsap.set([line1, line2], {opacity:0, y:26});

  const tl = gsap.timeline();
  tl.to(line1, {opacity:1, y:0, duration:0.5, stagger:0.028, ease:"power3.out"})
    .to(line2, {opacity:1, y:0, duration:0.5, stagger:0.022, ease:"power3.out"}, "-=0.32")
    .to("#loader-rule", {scaleX:1, duration:0.5, ease:"power2.out"}, "-=0.15")
    .to("#loader-sub", {opacity:1, duration:0.4}, "-=0.2")
    .to("#loading-screen", {duration:0.35}) // brief hold
    .to("#loading-screen", {
      opacity:0, duration:0.55, ease:"power2.inOut",
      onComplete:()=>{ document.getElementById("loading-screen").style.display = "none"; }
    })
    .call(revealApp, [], "-=0.2");
  return tl;
}

function revealApp(){
  const app = $("#app");
  app.style.visibility = "visible";
  gsap.to(app, {opacity:1, duration:0.3});
  paintAvatars();
  applyTheme(localStorage.getItem(STORAGE.theme) || "light", false);
  applyDensity();

  const tl = gsap.timeline();
  // clearProps:"transform" is required: GSAP otherwise leaves an inline
  // transform on .app-header after the tween, which creates a new
  // containing block for its position:fixed descendant (.menubar),
  // breaking the mobile slide-out nav (it collapses to the header's height
  // instead of spanning the viewport).
  tl.from(".app-header", {opacity:0, y:-14, duration:0.4, clearProps:"transform"});
  tl.from(".site-hero-copy", {opacity:0, y:18, duration:0.55, ease:"power2.out"}, "-=0.2");
  tl.from(".site-hero-visual", {opacity:0, y:18, duration:0.55, ease:"power2.out"}, "-=0.4");
  tl.call(()=>{
    renderHomepage();
    const start = CONFIG.landingPage || "dashboard";
    if(start !== "dashboard") goToView(start, {force:true});
  });
  wireMagnetic(document);
}

/* Keyboard: '/' focuses global search when not typing elsewhere */
document.addEventListener("keydown", e=>{
  if(e.key==="/" && document.activeElement.tagName!=="INPUT" && document.activeElement.tagName!=="TEXTAREA"){
    e.preventDefault();
    $("#global-search").focus();
  }
});

/* Boot */
function showLoginScreen(message=""){
  $("#loading-screen").style.display = "none";
  $("#app").style.visibility = "hidden";
  $("#login-screen").hidden = false;
  const error = $("#login-error");
  error.textContent = message;
  error.hidden = !message;
}

$("#login-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const form = e.currentTarget;
  const button = $("#login-submit");
  const error = $("#login-error");
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  error.textContent = "";
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await api("auth.php", {
      method:"POST",
      body:JSON.stringify({action:"login", username, password}),
    });
    await bootstrapFromApi();
    hydrateSettings();
    paintAvatars();
    $("#login-password").value = "";
    $("#login-screen").hidden = true;
    revealApp();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

window.addEventListener("load", async ()=>{
  try {
    const auth = await api("auth.php?action=status");
    if (!auth.authenticated) {
      showLoginScreen();
      return;
    }
    await bootstrapFromApi();
    hydrateSettings();
    paintAvatars();
    $("#login-password").value = "";
    playLoadingSequence();
  } catch (err) {
    console.error(err);
    showLoginScreen(`Could not connect to the library service: ${err.message}`);
  }
});