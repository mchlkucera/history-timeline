// Ported verbatim from prototypes/partA.html — the hand-editable event corpus.
// A TLEvent is a loose tuple; slots 6/7/8 are filled in at runtime by prepareEvents()
// in render/shared.ts once datasets.json has loaded:
//   [0] start  [1] end (0 = a moment)  [2] title  [3] band  [4] importance level
//   [5] tags   [6] category id         [7] type   [8] place [lat, lon, name, scope] | null
// Slot [9] is OPTIONAL and hand-written: the edge sharpness of a span, 0 (a fuzzy
// period that fades into its neighbours) .. 1 (founded on a dated afternoon). It is
// the one classifier slot prepareEvents() does NOT overwrite, so a row whose type
// the curated CATMAP does not yet carry can still say how hard its edges are.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TLEvent = any[];

// ---- EVENTS: [start, end|0, title, band, level, tags] — importance drives the level-of-detail zoom
// bands: CO cosmos · EU Europe · ME MidEast&Africa · AS Asia · AM Americas · MU music · SC science&ideas · MZ Mozart
export const EVENTS: TLEvent[] = [
[-13.8e9,0,"Big Bang","CO",1,"cosmos"],
[-4.54e9,0,"Earth forms","CO",1,"cosmos earth"],
[-3.8e9,0,"First life","CO",1,"life"],
[-2.4e9,0,"Oxygen fills the air","CO",2,"life"],
[-541e6,0,"Cambrian explosion","CO",1,"life"],
[-252e6,0,"Great Dying (worst extinction)","CO",2,"extinction"],
[-66e6,0,"Dinosaurs wiped out","CO",1,"extinction"],
[-300000,0,"Homo sapiens appears","CO",1,"human"],
[-70000,0,"Out of Africa migration","CO",2,"human migration"],
[-10000,0,"Farming begins","CO",1,"agriculture revolution"],
[-3200,0,"Writing invented (Sumer)","CO",1,"writing"],
// The named ages. The Three-Age system (Stone · Bronze · Iron) is OLD-WORLD
// periodisation — it is dated off the Near East and Europe, and the Americas,
// Australia and much of Africa do not run on it; the "old-world" tag says so.
// Bronze Age lives in the LIVES dataset already; these are its neighbours, at
// the same importance so the sequence arrives in one piece. Slot 9 = 0.25 is
// the sharpness `era` gets by default, i.e. what Bronze Age draws at — every
// one of these boundaries is a centuries-long fade, not a date.
[-3300000,-3300,"Stone Age","CO",2,"stone tools flint technology prehistory three-age old-world",null,null,null,0.25],
[-3300000,-10000,"Paleolithic (Old Stone Age)","CO",3,"palaeolithic stone tools hunter-gatherer technology ice-age",null,null,null,0.25],
[-10000,-3300,"Neolithic (New Stone Age)","CO",3,"neolithic farming villages pottery polished-stone technology",null,null,null,0.25],
[-1200,-550,"Iron Age","CO",2,"iron smelting metallurgy technology three-age old-world",null,null,null,0.25],
[-115000,-9700,"Last Glacial Period (the Ice Age)","CO",2,"ice-age glacial climate pleistocene mammoths",null,null,null,0.25],
[-2500,0,"Stonehenge raised","EU",4,"britain megalith"],
[-1600,-1100,"Mycenaean Greece","EU",4,"greece bronze"],
[-776,0,"First Olympic games","EU",4,"greece sport"],
[-753,0,"Rome founded (legend)","EU",3,"rome"],
[-508,0,"Athenian democracy","EU",2,"greece democracy"],
[-490,0,"Battle of Marathon","EU",4,"greece persia war"],
[-431,-404,"Peloponnesian War","EU",4,"greece war"],
[-334,-323,"Alexander conquers the East","EU",2,"greece macedonia conquest"],
[-264,-146,"Punic Wars: Rome vs Carthage","EU",3,"rome carthage war"],
[-44,0,"Caesar assassinated","EU",3,"rome"],
[79,0,"Vesuvius buries Pompeii","EU",5,"rome volcano"],
[117,0,"Roman Empire at maximum","EU",3,"rome peak"],
[313,0,"Christianity legalized","EU",3,"rome christianity religion"],
[476,0,"Western Rome falls","EU",2,"rome fall"],
[793,0,"Viking age begins (Lindisfarne)","EU",3,"viking raid"],
[800,0,"Charlemagne crowned emperor","EU",3,"franks empire"],
[1054,0,"Great Schism east/west","EU",4,"christianity schism"],
[1066,0,"Norman conquest of England","EU",3,"england war"],
[1095,0,"First Crusade launched","EU",3,"crusade religion war"],
[1215,0,"Magna Carta","EU",3,"england law rights"],
[1347,1351,"Black Death kills a third of Europe","EU",2,"plague pandemic"],
[1348,0,"Charles University founded in Prague","EU",5,"prague czech university"],
[1415,0,"Jan Hus burned at Konstanz","EU",4,"czech religion reformation"],
[1453,0,"Constantinople falls to Ottomans","EU",2,"byzantium ottoman war"],
[1492,0,"Columbus reaches the Americas","EU",2,"exploration spain"],
[1517,0,"Luther's 95 theses — Reformation","EU",2,"religion reformation"],
[1588,0,"Spanish Armada defeated","EU",4,"spain england war"],
// IMPORTANCE 2, NOT 3, AND THE REASON IS THE LAYER MODEL. facetOf() gives every
// cat=war mark to its region's Wars facet exclusively, and `eu-war` is a library
// layer — not on the spine. Essentials adopts a region's war SPANS back, but only
// at importance 1–2 (layers.ts, "THE FOUNDER BAR"), so at 3 this was the defining
// event of its own century with no lane on the default board to draw it: stand at
// 1620 on a fresh install and the Thirty Years' War is nowhere. It is not a
// borderline call at that tier either — it killed something like a third of the
// German population and ended in the Westphalia settlement the corpus already
// carries. Nothing else about the row changes; it is still a war, still in Wars.
[1618,1648,"Thirty Years' War","EU",2,"war religion germany"],
[1618,0,"Defenestration of Prague","EU",4,"prague czech war"],
[1642,1651,"English Civil War","EU",4,"england war"],
[1683,0,"Ottomans turned back at Vienna","EU",4,"ottoman austria war"],
[1707,0,"Great Britain formed","EU",4,"britain union"],
[1756,1763,"Seven Years' War — first world war","EU",3,"war britain france prussia"],
[1789,1799,"French Revolution","EU",2,"france revolution"],
[1793,0,"Terror: Louis XVI guillotined","EU",4,"france revolution"],
[1804,0,"Napoleon crowns himself","EU",3,"france napoleon empire"],
[1812,0,"Napoleon freezes in Russia","EU",4,"france russia war napoleon"],
[1815,0,"Waterloo — Napoleon done","EU",3,"france napoleon war"],
[1848,0,"Revolutions sweep Europe","EU",3,"revolution liberalism nationalism"],
[1871,0,"Germany unified","EU",3,"germany empire"],
[1914,1918,"World War I","EU",1,"war"],
[1917,0,"Russian Revolution","EU",3,"russia revolution communism"],
[1922,0,"USSR founded","EU",4,"russia communism"],
[1933,0,"Hitler takes power","EU",3,"germany nazism"],
[1939,1945,"World War II","EU",1,"war"],
[1945,0,"Iron Curtain descends","EU",3,"cold-war communism"],
[1957,0,"Treaty of Rome — EEC born","EU",4,"europe union"],
[1968,0,"Prague Spring crushed","EU",4,"czech communism prague"],
[1989,0,"Berlin Wall falls · Velvet Revolution","EU",2,"communism revolution czech prague"],
[1993,0,"EU founded · Czechoslovakia splits","EU",4,"europe union czech"],
[2022,0,"Russia invades Ukraine","EU",4,"russia ukraine war"],
[-3100,0,"Egypt unified under one crown","ME",2,"egypt"],
[-2560,0,"Great Pyramid built","ME",2,"egypt pyramid"],
[-1792,0,"Hammurabi writes his law code","ME",3,"babylon law"],
[-1274,0,"Battle of Kadesh (first recorded treaty)","ME",4,"egypt hittite war"],
[-586,0,"Babylon destroys Jerusalem's temple","ME",4,"judea babylon religion"],
[-550,0,"Cyrus founds the Persian Empire","ME",2,"persia empire"],
[-332,0,"Alexander takes Egypt","ME",4,"egypt greece"],
[-30,0,"Cleopatra dies — Egypt goes Roman","ME",3,"egypt rome"],
[30,0,"Crucifixion of Jesus","ME",2,"christianity religion"],
[622,0,"The Hijra — Islam begins","ME",2,"islam religion"],
[632,750,"Arab conquests: Spain to Persia","ME",2,"islam conquest"],
[762,0,"Baghdad founded — Islamic golden age","ME",3,"islam baghdad science"],
[1171,0,"Saladin rules Egypt & Syria","ME",4,"islam crusade"],
[1258,0,"Mongols sack Baghdad","ME",3,"mongol islam"],
[1324,0,"Mansa Musa's golden hajj","ME",4,"mali africa gold"],
[1517,0,"Ottomans take Egypt & the caliphate","ME",3,"ottoman egypt"],
[1652,0,"Dutch found Cape Colony","ME",4,"africa colonialism"],
[1798,0,"Napoleon invades Egypt","ME",4,"egypt france napoleon"],
[1869,0,"Suez Canal opens","ME",3,"egypt trade"],
[1884,0,"Berlin Conference carves up Africa","ME",2,"africa colonialism"],
[1948,0,"State of Israel founded","ME",3,"israel"],
[1960,0,"Year of Africa — 17 nations born","ME",2,"africa independence"],
[1994,0,"Mandela elected president","ME",3,"africa south-africa"],
// A LIFE BAR ALREADY HAS TWO END CAPS, and they are the birth and the death.
// "Buddha born" (-563) and "Confucius born" (-551) sat here as moments beside
// the LIVES rows for the same two men, at the same year, in the same band — a
// dot drawn on the left cap of a bar that was already on the board, and two
// rows in the search dropdown for one person. They are gone; the life bars in
// data/lives.json carry the same dates at a STRONGER importance (2 against 3),
// so nothing left the board. A birth or death earns its own row only when it
// says something the bar cannot — "Bach & Handel born" names a second man the
// corpus holds no life for, and "Bach dies — Baroque ends" dates a period.
[-2600,-1900,"Indus Valley Civilisation","AS",3,"india bronze"],
[-1600,-1046,"Shang dynasty — Chinese writing","AS",3,"china bronze writing"],
[-321,-185,"Maurya Empire unites India","AS",3,"india empire"],
[-268,0,"Ashoka turns to Buddhism","AS",3,"india buddhism"],
[-221,0,"Qin unifies China","AS",2,"china empire"],
[-206,220,"Han dynasty","AS",3,"china empire"],
[320,550,"Gupta golden age of India","AS",3,"india science"],
[618,907,"Tang dynasty — cosmopolitan China","AS",3,"china"],
[960,1279,"Song dynasty — paper money, gunpowder","AS",3,"china invention"],
[1192,0,"First shogunate in Japan","AS",4,"japan samurai"],
[1206,0,"Genghis Khan unites the Mongols","AS",2,"mongol empire conquest"],
[1279,0,"Mongols rule all of China","AS",3,"mongol china"],
[1368,0,"Ming dynasty founded","AS",3,"china"],
[1405,1433,"Zheng He's treasure fleets","AS",3,"china exploration"],
[1526,0,"Mughal Empire founded","AS",2,"india empire islam"],
[1600,0,"East India Company chartered","AS",3,"britain india trade"],
[1603,0,"Tokugawa shogunate — Japan closes","AS",4,"japan"],
[1644,0,"Qing dynasty takes China","AS",3,"china manchu"],
[1757,0,"Plassey: British rule in India begins","AS",2,"britain india colonialism"],
[1839,1842,"Opium War humiliates China","AS",2,"china britain war"],
[1853,0,"Perry forces Japan open","AS",3,"japan usa"],
[1868,0,"Meiji Restoration — Japan sprints","AS",2,"japan modernization"],
[1912,0,"Last emperor: Qing falls","AS",3,"china revolution"],
[1947,0,"India independent, partitioned","AS",2,"india independence"],
[1949,0,"People's Republic of China","AS",3,"china communism"],
[1978,0,"Deng opens China","AS",2,"china reform"],
[1991,0,"India liberalizes","AS",4,"india economy"],
[-15000,0,"First peoples reach the Americas","AM",2,"migration"],
[-1500,-400,"Olmec — first American civilization","AM",3,"mexico olmec"],
[250,900,"Maya classic period","AM",3,"maya mexico"],
[1000,0,"Vikings land in Newfoundland","AM",4,"viking exploration"],
[1325,0,"Tenochtitlan founded","AM",4,"aztec mexico"],
[1438,1533,"Inca Empire","AM",3,"inca peru"],
[1519,1521,"Cortés destroys the Aztecs","AM",2,"spain aztec conquest"],
[1532,0,"Pizarro seizes the Inca","AM",3,"spain inca conquest"],
[1607,0,"Jamestown — English America begins","AM",4,"usa colony"],
[1619,0,"First enslaved Africans in Virginia","AM",4,"usa slavery"],
[1620,0,"Mayflower lands","AM",4,"usa colony"],
[1776,0,"Declaration of Independence","AM",2,"usa revolution independence"],
[1783,0,"Treaty of Paris: USA recognized","AM",4,"usa britain"],
[1787,0,"US Constitution written","AM",3,"usa law"],
[1791,1804,"Haitian Revolution","AM",3,"haiti slavery revolution"],
[1810,1826,"Bolívar & Latin American independence","AM",2,"latin-america independence revolution"],
[1861,1865,"US Civil War","AM",3,"usa war slavery"],
[1865,0,"Slavery abolished in the US","AM",3,"usa slavery"],
[1867,0,"Canada confederates","AM",4,"canada"],
[1929,0,"Wall Street crash — Great Depression","AM",3,"usa economy"],
[1945,0,"UN founded · US superpower era","AM",3,"usa un"],
[1959,0,"Cuban Revolution","AM",4,"cuba communism revolution"],
[1962,0,"Cuban Missile Crisis","AM",4,"usa ussr cold-war"],
[1969,0,"Apollo 11: humans on the Moon","AM",2,"usa space"],
[2001,0,"September 11 attacks","AM",3,"usa terrorism"],
[2008,0,"Global financial crisis","AM",4,"usa economy"],
[600,0,"Gregorian chant codified","MU",4,"music church medieval"],
[1030,0,"Guido invents staff notation","MU",4,"music notation"],
[1607,0,"Opera born (Monteverdi's Orfeo)","MU",4,"music opera baroque"],
[1685,0,"Bach & Handel born","MU",3,"music baroque bach"],
[1723,0,"Vivaldi's Four Seasons","MU",5,"music baroque"],
[1750,0,"Bach dies — Baroque ends","MU",4,"music baroque bach"],
[1804,0,"Eroica — Romanticism opens","MU",4,"music beethoven romanticism"],
[1824,0,"Beethoven's Ninth","MU",4,"music beethoven"],
[1874,0,"Smetana begins Má vlast","MU",5,"music czech smetana prague"],
[1877,0,"Recorded sound (phonograph)","MU",4,"music technology"],
[1913,0,"Rite of Spring riot","MU",4,"music stravinsky modernism"],
[1925,0,"Jazz age roars","MU",4,"music jazz"],
[1954,0,"Rock'n'roll breaks out","MU",4,"music rock"],
[1963,0,"Beatlemania","MU",4,"music rock beatles"],
[1973,0,"Hip-hop born in the Bronx","MU",4,"music hip-hop"],
[1981,0,"MTV: video kills the radio star","MU",5,"music tv"],
[-585,0,"Thales predicts an eclipse","SC",4,"science greece"],
[-387,0,"Plato founds the Academy","SC",3,"philosophy greece plato"],
[-300,0,"Euclid's Elements","SC",4,"math greece"],
[-250,0,"Archimedes at work","SC",4,"science greece"],
[105,0,"Paper invented in China","SC",3,"china invention paper"],
[150,0,"Ptolemy maps the cosmos (wrongly)","SC",4,"astronomy"],
[820,0,"Al-Khwarizmi writes the algebra book","SC",3,"math islam algorithm"],
[868,0,"First printed book (Diamond Sutra)","SC",4,"china printing"],
[1088,0,"First university (Bologna)","SC",4,"university education"],
[1439,0,"Gutenberg's printing press","SC",2,"printing revolution information"],
[1543,0,"Copernicus: Earth moves","SC",2,"astronomy revolution science"],
[1609,0,"Galileo points a telescope up","SC",3,"astronomy galileo science"],
[1687,0,"Newton's Principia","SC",2,"physics newton science"],
[1751,0,"The Encyclopédie — Enlightenment engine","SC",4,"enlightenment france philosophy"],
[1776,0,"Watt's steam engine goes commercial","SC",3,"industrial-revolution steam technology"],
[1776,0,"Adam Smith's Wealth of Nations","SC",4,"economics enlightenment"],
[1796,0,"First vaccine (smallpox)","SC",3,"medicine vaccine"],
[1831,0,"Faraday: electricity from motion","SC",4,"physics electricity"],
[1859,0,"Darwin's Origin of Species","SC",2,"biology evolution science"],
[1867,0,"Marx's Das Kapital","SC",4,"communism economics philosophy"],
[1869,0,"Mendeleev's periodic table","SC",4,"chemistry"],
[1876,0,"Telephone","SC",4,"technology communication"],
[1879,0,"Electric light bulb","SC",4,"technology electricity"],
[1885,0,"First automobile","SC",4,"technology car"],
[1903,0,"First powered flight","SC",3,"technology flight usa"],
[1905,0,"Einstein's miracle year","SC",3,"physics einstein relativity"],
[1928,0,"Penicillin discovered","SC",3,"medicine antibiotics"],
[1936,0,"Turing defines computation","SC",4,"computing turing"],
[1945,0,"Atomic bomb","SC",2,"physics war nuclear"],
[1947,0,"Transistor invented","SC",3,"computing electronics"],
[1953,0,"DNA structure solved","SC",3,"biology dna"],
[1957,0,"Sputnik — space age","SC",3,"space ussr"],
[1969,0,"ARPANET: internet's first packet","SC",4,"internet computing"],
[1989,0,"World Wide Web proposed","SC",2,"internet web information"],
[2007,0,"iPhone","SC",3,"technology mobile"],
[2022,0,"AI goes mainstream (ChatGPT)","SC",3,"ai computing"],
[1756,0,"Born in Salzburg, Jan 27","MZ",3,"mozart salzburg"],
[1761,0,"First compositions, age 5","MZ",4,"mozart prodigy"],
[1763,1766,"Grand tour: Munich, Paris, London","MZ",4,"mozart tour prodigy"],
[1770,0,"Transcribes the Vatican's secret Miserere from memory, age 14","MZ",5,"mozart rome"],
[1770,1773,"Three Italian journeys","MZ",5,"mozart italy"],
[1778,0,"Job-hunting in Paris; his mother dies there","MZ",4,"mozart paris"],
[1781,0,"Quits Salzburg, goes freelance in Vienna","MZ",4,"mozart vienna"],
[1782,0,"Marries Constanze · Abduction premieres","MZ",5,"mozart vienna opera"],
[1784,0,"Joins the Freemasons","MZ",5,"mozart freemason"],
[1786,0,"The Marriage of Figaro","MZ",4,"mozart opera figaro"],
[1787,0,"Don Giovanni premieres in Prague — 'my Praguers understand me'","MZ",4,"mozart opera prague"],
[1788,0,"Last three symphonies in six weeks","MZ",4,"mozart symphony"],
[1791,0,"Magic Flute · unfinished Requiem · dies Dec 5","MZ",4,"mozart death requiem"]
];

/* =============================================================================
   NOTES — the one line the card prints under the dates.

   THE GAP THIS FILLS. Every curated dataset in the corpus carries a note and
   fills it: 147 of 147 polities, 20 of 20 spreads, 461 of 461 curated lane
   members. The EVENTS tuple has no note slot at all, and neither does a LIVES
   row (data/lives.json is merged in as six columns), so the card drew a blank
   where the description belongs for all 242 of them — the founder found it on
   Mozart and on "Germany unified", but it was every event and every life.

   KEYED BY TITLE, because that is how this corpus already joins: CATMAP,
   PLACEMAP and overrides.json's rename/recat/retype all key on the title
   string, and describe() has the title in hand. A lane member's own note still
   wins — it is authored beside the row it belongs to.

   THE REGISTER IS THE LANE NOTES', not the map capsules'. Both exist in this
   file, and they are read in different places: a capsule is a paragraph about a
   whole world at one date, and it is prose. This slot is the same slot a lane
   note lands in, on the same card, in the same typeface — so it is a lowercase
   fragment, one fact, no closing full stop, and it never repeats the title.

   NOT A BACKLOG. This is deliberately partial: it holds the rows a reader is
   most likely to stop on, and a row with no entry prints nothing rather than
   printing filler. Adding one is a curatorial act, not a chore.
============================================================================= */
export const NOTES: Record<string, string> = {
// ── lives ──
"Wolfgang Amadeus Mozart":"a touring child prodigy, dead at 35 and in debt, having remade opera, concerto and symphony at once",
"Ludwig van Beethoven":"went deaf in the middle of it and kept writing; the hinge between the Classical and the Romantic",
"Antonín Dvořák":"carried Bohemian tunes into the symphony, and took the argument to New York",
"The Buddha":"renounced a north Indian princedom for the middle way; the dates are traditional and argued over by a century",
"Confucius":"an advisor no ruler would keep, whose pupils' notes became the Chinese state's textbook for two thousand years",
"Laozi":"the Tao Te Ching's traditional author; the man may be a composite of several, and the dates are convention rather than record",
// ── events ──
"Germany unified":"proclaimed at Versailles with the war against France still running: a new great power in the middle of Europe",
"Thirty Years' War":"the last of Europe's wars of religion and the worst of them; a third of Germany's people gone, and Westphalia at the end of it",
"Black Death kills a third of Europe":"plague carried west by Genoese galleys; wages rise for the survivors, and serfdom starts to come apart",
"World War I":"four empires gone, some nine million soldiers dead, and a peace that set the next war's terms",
"World War II":"the deadliest event in human history — around sixty million dead — and the two superpowers that came out of it",
"Writing invented (Sumer)":"clay tablets keeping temple accounts; the first records that outlive the people who made them",
"Farming begins":"the Fertile Crescent trades mobility for surplus, and everything crowded follows — villages, states, plagues",
"Homo sapiens appears":"anatomically modern humans in Africa, sharing the planet with at least four other kinds of human",
"Big Bang":"not an explosion in space but the expansion of space itself, dated by the light still arriving from it",
};

export const CAPSULES: Record<string, string> = {
"-3000":"First cities. Writing is brand new in Sumer, Egypt has just been unified, the Great Pyramid isn't built yet. Almost everyone else on the planet: hunter-gatherers and early farmers.",
"-1000":"Iron is replacing bronze after the Bronze Age collapse. David's Jerusalem, Zhou China, and Phoenician traders carrying the new alphabet around the Mediterranean.",
"-323":"Alexander dies in Babylon this very year — his empire runs from Greece to the Indus and is about to shatter. Rome is still just a regional Italian power.",
"-1":"Augustus' Rome rings the whole Mediterranean; Han China matches it in the east; the Silk Road connects them. Jesus is born right about now.",
"400":"Rome is split and buckling — Alaric sacks the city in 410. Gupta India is in its golden age; Teotihuacan booms in Mexico.",
"800":"Charlemagne is crowned in Rome this Christmas. Abbasid Baghdad is the largest, most learned city on Earth; the Maya peak; Vikings have just started raiding.",
"1000":"Vikings touch Newfoundland; Song China invents paper money and gunpowder weapons; Islam spans Spain to the Indus. Europe is a backwater of castles.",
"1279":"The Mongol moment: one family rules from Hungary's edge to Korea — the largest land empire ever. Kublai finishes conquering Song China this year.",
"1492":"Columbus sails. The Reconquista completes; Aztec and Inca empires are at their peak with no idea what's coming; Ming China has turned inward.",
"1600":"First truly global economy: Spanish silver circles the planet. Elizabethan England, Tokugawa unifying Japan, and Mughal India — the richest place on Earth.",
"1715":"Louis XIV has just died. Newton's physics is 28 years old, the Qing empire is at its height, and the Atlantic slave trade grinds at full scale.",
"1783":"★ The 1776 world. The USA just won independence — 13 states hugging the Atlantic coast. Britain is global anyway; France is bankrupt (revolution in 6 years); Mozart is 27; Watt's engines are pumping; Qing China rules a third of humanity.",
"1815":"Waterloo. Napoleon is finished, the Congress of Vienna redraws Europe, Latin America is mid-revolt, Britain enters its imperial century.",
"1880":"Steam, telegraph, and the colonial scramble — Africa is about to be carved up at Berlin. The US reconstructs; Japan modernizes at sprint pace.",
"1914":"Empires cover almost the entire map. A pistol shot in Sarajevo this year starts the war that will wreck four of them.",
"1938":"One year before WWII: Anschluss, Munich, Stalin's purges, Japan deep in China. This map is about to burn.",
"1960":"Cold War world: two superpowers, a wall about to rise in Berlin — and 17 new African nations born in this single Year of Africa.",
"1994":"The Wall is down, the USSR is gone, Mandela is president, the EU exists, and something called the World Wide Web is five years old. Recognizably today."};
