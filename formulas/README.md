# Så lägger du till en formel

Varje formel är **en textfil** i den här mappen. Programmet läser alla `.yaml`-filer här automatiskt, så du behöver aldrig ändra programkod.

Formlerna som följer med är `mandelbulb.yaml` och `mandelbox.yaml`. De kan kombineras i en kedja i programmet (se längst ned).

## Upptäcktsmetadata

Väljaren söker namn, beskrivning, upphovsroller och katalogmetadata. Ett valfritt block gör en formel lättare att hitta:

```yaml
catalog:
  category: transforms
  tags: [fold, inversion]
  dimension: 3
  family: Sphere folding
```

Kategorier: `fractals`, `ifs`, `hypercomplex`, `transforms`, `spatial`, `julia`, `difs`, `other`. Utelämnade fält fylls för visning från kärnregistret/variabeltyper och beskrivningen. Högst 24 taggar (80 tecken vardera), familj högst 160 tecken och dimension 3 eller 4. Metadata ändrar inte formel-ID, parametrar, räkning, DE eller lagrad scen. Creator-/inspirationskrediter och `reviewed` kommer fortsatt från befintliga fält. Essentials-generatorn bevarar katalogblock vid regenerering.

## Gör en egen formel

1. Kopiera en befintlig fil, till exempel `mandelbulb.yaml`, och ge den ett nytt filnamn.
2. Ändra fälten nedan.
3. Ladda om sidan. Om filen har ett fel visas en ruta som säger vilken fil och vad som är fel. Övriga formler påverkas inte.
4. Kör `npm test`. Testerna kontrollerar alla formelfiler.

## Fälten

| Fält | Krav | Förklaring |
|---|---|---|
| `format` | `1`, `2` eller `3` | Format 1/2 använder uttrycksspråket som tidigare. Format 3 väljer en registrerad formelkärna för bestående tillstånd och numerisk avståndsuppskattning (se nedan). |
| `id` | små bokstäver, siffror, bindestreck | Unik, får inte användas av en annan fil. |
| `name` | text | Namnet som visas i listan. |
| `description` | valfri | Kort förklaring. |
| `catalog` | valfri | Upptäcktsmetadata för väljaren: kategori, taggar, dimension och familj; ändrar aldrig matematiken. |
| `credits` | **minst en** | Upphovspersoner: `name`, valfri `role`, och **`status`**. Är upphovet okänt: `name: okänd`. |
| `sources` | **minst en** | Länk (`url`, måste börja med `http://` eller `https://`) eller `reference` (text, t.ex. en bok), och **`status`**. |
| `added_by` | text | Vem som skrev in formeln i filen. |
| `math_status` | text | Kort om matematikens rättsliga status (se `LICENSING.md`). |
| `reviewed` | `true`/`false` | `true` bara när en människa har kontrollerat **alla** krediter och källor. |
| `parameters` | lista, högst 16 | `name`, `default`, `min`, `max`, valfri `label`. |
| `iteration` | se nedan | Själva matematiken. `distance` får utelämnas för omvandlingar, se längst ned. |
| `view.camera_distance` | valfri, 1,5–20 | Hur långt bort kameran startar. |
| `iteration.carry` | valfri, rekommenderas | Lista med variabelnamn som förs vidare till nästa steg när formler kedjas, normalt punkten och dess derivata: `carry: [z, dr]`. Övriga variabler börjar om i varje steg. Utelämnas den förs bara banpunkten vidare. |
| `iteration.orbit_point` | valfri | Namnet på den `vec3`- eller `vec4`-variabel vars bana används för färgmåttet "Banfälla". Utelämnas den används den första `vec3`/`vec4`-variabeln. Finns ingen blir banfällan 0. |

### Verifierad eller inte (`status`)

- `unverified` = namnet eller länken är **inte kontrollerad** mot den riktiga källan. Den visas i gult med texten "ej verifierad" i programmet.
- `verified` = en människa har öppnat källan och kontrollerat att namn och länk stämmer.
- `reviewed: true` är förbjudet så länge något är `unverified`. Testerna stoppar det.
- Gissa aldrig ett namn. Är du osäker: skriv `unverified`.

### Matematiken (`iteration`)

```yaml
iteration:
  iterations: 12          # hur många varv, 1–64
  variables:              # variabler som finns under hela beräkningen
    - { name: z, type: vec3, init: pos }   # pos = punkten som undersöks
    - { name: r, type: float, init: 0 }
  steps:                  # körs i ordning varje varv
    - "r = length(z)"                 # tilldelning: namn = uttryck
    - break_if: "r > 4.0"             # avbryt när villkoret stämmer
    - "z = z * 2.0 + pos"
  distance: "r - 1.0"     # uttrycket som ger uppskattat avstånd till ytan
```

- Typer: `float` (ett tal), `vec3` (tre tal, x/y/z) och `vec4` (fyra tal, x/y/z/w, för 4D-formler som kvaternioner).
- Tilldelningar kan vara `=`, `+=`, `-=`, `*=`, `/=`.
- Parametrar används direkt med sitt namn i uttrycken (`power`).

### Det som får användas i uttryck

- Tal, `+ - * /`, parenteser, jämförelser `< > <= >= == !=`, `pi`
- Variabler och parametrar du själv har deklarerat, samt `pos`
- Delar av en `vec3` eller `vec4`: `z.x`, `z.y`, `z.z`, `z.w`, `z.xy` …
- Funktionerna: `length sin cos tan asin acos atan atan2 sqrt pow log exp abs min max floor fract dot cross normalize clamp mix sign step select vec3 vec4`
- `select(a, b, villkor)` ger `b` om villkoret stämmer, annars `a`. Det ersätter if-satser.

Allt annat avvisas, så en formelfil kan inte köra egen kod.

### Att tänka på

- Skriv matematiken själv utifrån en **offentlig beskrivning**. Kopiera inte kod från andra program (se `CLAUDE.md` och `LICENSING.md`).
- Heltal som `2` fungerar, men `2.0` är tydligare.
- Använd `pow(x, 2.0)` eller `x * x`. Tecknet `^` finns inte.
- Matematikfel (t.ex. division med noll) syns som konstiga bilder, inte som felmeddelanden.

## Kedja av formler (hybrider)

I programmet kan flera formler läggas efter varandra. Varje steg har eget antal varv och egna parametrar, och hela kedjan kan upprepas flera gånger.

- Stegen körs i ordning. Variablerna i `carry` (normalt `z` och `dr`) förs vidare från ett steg till nästa, så nästa formel fortsätter där den förra slutade.
- Når någon formel sitt `break_if` (punkten har "flytt") stannar hela beräkningen. Avståndet tas från det steg som körde då.
- För att två formler ska kunna kedjas ska de ha samma namn och typ på variablerna i `carry`. Tre variabler eller fler kan delas på samma sätt.
- Avståndet i en hybrid är en **uppskattning** och kan ge artefakter (hackiga ytor eller brus), särskilt när formlerna är mycket olika.
- Gränser: högst 8 steg, 64 varv per steg, 32 upprepningar och 256 varv sammanlagt, samt högst 32 parametrar i hela kedjan.
- Ordningen spelar roll: Mandelbulb först och Mandelbox sedan ger ofta nästan bara Mandelbulb-formen (punkter som flyr i första steget når aldrig det andra). Ge första steget få varv för att få med mer av det andra.

## Omvandlingar (formler utan avstånd)

En formel som bara ändrar punkten (till exempel `box-fold`, `ball-fold` och `sphere-inversion`) har inget eget avstånd. Lämna då bort `distance`:

- Den kan inte ritas ensam: programmet svarar med "the chain has no step with a distance estimate".
- Lägg den **före** en formel som har avstånd (till exempel Mandelbulb eller Mandelbox). Avståndet tas från det **sista steg som har ett**.
- Ändra bara `z` och `dr` (och lägg dem i `carry`), så att nästa steg kan fortsätta. En omvandling bör uppdatera `dr` med hur mycket den förstorar avstånd lokalt, annars blir avståndet i nästa formel fel.
- Formler utan `carry` (som `menger-sponge`) kan inte lämna över något och passar därför inte som steg före en annan formel: nästa formel börjar om från `pos`.
- Hybrider är grova uppskattningar och ger ofta brus eller hackiga ytor. Det är normalt.

## Proveniens: formler omimplementerade från Mandelbulb 3D (format 2)

En formel som skrivs på nytt från en Mandelbulb 3D-fil (CLAUDE.md avsnitt 10) har `format: 2` och ett block `provenance`:

```yaml
provenance:
  origin: mandelbulb3d
  file: _Exempel.m3f             # ursprungligt filnamn, utan mappar
  credited_author: Namn Namnsson # exakt som i källan
  collection: M3Formulas         # eller EM_JIT_M3Formulas
  note: >                        # måste säga att det är en oberoende omimplementering
    An independent reimplementation of the mathematical formula ... The [CODE] section was not read, copied or translated.
  conditions: ...                # villkor som samlingen anger; krävs för EM_JIT_M3Formulas
  verified_against_mb3d: false   # true först när projektägaren har jämfört med Mandelbulb 3D
```

- **Krediter:** upphovspersonen ska också stå i `credits`.
- **Det som hör till varje sådan formel:** en rad i `LICENSING.md` avsnitt 7 och 10.1, ett test och en jämförelseinstruktion i `docs/mb3d-jamforelser/`.
- **Kontroll:** testerna stoppar en formel där proveniensen saknar något, eller där registret och formelfilen säger olika saker.

## Registrerade formelkärnor (format 3, batch 01)

De tio nya formlerna behöver tillstånd, rotationsmatriser med bestämd avrundning, inre loopar och/eller numerisk avståndsuppskattning. Därför kan format 3 välja en **fast, registrerad** kärna:

```yaml
format: 3
# Samma obligatoriska namn, krediter, källor och proveniens som i format 2.
# Parametrarnas namn och ordning måste stämma med kärnans registrerade lista.
iteration:
  kernel: aexion-1
  iterations: 16
```

Formelfilen innehåller fortfarande bara data. Okända kärnor och försök att lägga till egen körbar kod avvisas. `variables`, `steps`, `distance`, `carry` och `orbit_point` får inte ersätta kärnans definition. Kärnorna och standardvärdena finns i `src/engine/formula/kernels.ts`, primitiverna i `primitives.ts`, GPU-matematiken i `kernelWgsl.ts` och banor/avstånd i `kernelChain.ts`. Den styrande matematiken finns i `NewFormulas/claude-handoff-batch-01/`.

**Bakåtkompatibilitet:** ingen gammal fil behöver skrivas om. Format 1 och 2 läses till samma `Formula`-API som förut. Format 3 kräver en registrerad kärna; byt inte en gammal uttrycksformels versionsnummer till 3. Scenformatet är fortsatt version 13, med formel-id och parametervärden. Det finns ingen automatisk konvertering av godtyckliga uttrycksformler till registrerade kärnor.

**Värdinställningar:** de tre sista reglagen för vanliga räknade kärnor är `slice_w` (banans initiala w), `constant_w` (konstantens w i Julia-läge) och `bailout_squared` (faktisk radie²-gräns). I Mandelbrot-läge används samma initiala w för punkt och konstant. I en kedja bestämmer **första räknade stegets** w-inställningar banans start; varje räknat stegs flyktgräns används efter dess anrop. Hjälpkärnor har inga egna start-/bailoutreglage. Dessa reglage är våra integrationsval, inte nya återvunna formelparametrar. 3D-formlernas w är extra tillstånd och ingår aldrig i radien.

**Kedjor:** följd och alternera stöds mellan räknade kärnor med samma dimension och avståndsfamilj. Bestående konstant, initieringsflagga och historik delas över hela banan; de återställs mellan provpunkter och numeriska perturbationer. Batch 03 lägger till generella oräknade hjälpanrop i numeriska kedjor, se nedan. Blandning med äldre uttrycksformler, olika räknade dimensioner/avståndsfamiljer och interpolation av bestående tillstånd avvisas med en förklaring. MB3D:s registeröverlagring emuleras inte. Slumpkedjegeneratorn lämnar dessa kärnor utanför tills den har kompatibla familjer.

**Avstånd:** IFS använder slutradie / absolut signerad derivata. Numeriska kärnor använder sex symmetriska perturbationer av flyktpotentialen på det visade 3D-snittet. Alla perturbationer kör samma anropsantal och schema som huvudbanan. Detta är en uppskattning, ingen garanterad SDF eller reproduktion av MB3D:s avståndsalgoritm. Ej flydda punkter ger 0. Vid mesh-export kan därför en positiv yttröskel behövas. DEscale/Adescale/sipow sparas som metadata i kärnregistret men appliceras inte som dolda renderingsfaktorer.

**Ogiltiga prov:** singulariteter fortsätts inte med epsilon. CPU returnerar `Infinity` i avståndet och `invalid: true`; det publika ban-API:t ger också `state.invalid`. GPU använder ett stort missavstånd (`1e20`) för att undvika falska ytor. Detta är en renderingspolicy, inte en ändring av ekvationerna. CPU är en matematik-/testväg, inte en färdig reservrenderare utan WebGPU.

**Verifiering:** `tests/mb3dBatch01.test.ts` jämför 90 prov per formel med en separat referens samt tillstånds- och integrationstester. Starta `npm run dev` och öppna `/tests/gpu/batch01.html` för riktiga GPU-beräkningar. Toleranser: formelanrop `3e-4 × max(1, |värde|)`, avstånd 2 % med ett litet absolut golv och banfälla 1 % med ett golv. Dessa kontroller verifierar portningen inom angivna toleranser, inte bildlikhet med MB3D. Se jämförelsescenerna i `docs/mb3d-jamforelser/`.

## Batch 02: algebror, inversioner, ordnade foldningar och dIFS

De tio kärnorna är Beth2422, IdesFormula, Aex-Octo, Lambda4Dc, Barnsley4Dnc, Kalisets1, MengerHyper, Octahedron4, TgladDihed och ScherkFS. Styrande underlag: `NewFormulas/batch-02/00-README.md`, `manifest.json`, tio specifikationer och `validation.json`. Paketet bevaras oförändrat. Manifestet har teckenkodningsfel i vissa svenska strängar; MengerHypers visade upphov `okänd` följer den korrekt kodade fristående specifikationen. Buddhi är inspiration. TgladDihed bevarar både Tglad och Luca GN: det valfria `provenance.credited_authors` anger namnen separat och `credited_author` behåller den sammansatta källuppgiften (`Tglad; Luca GN`). Samtliga krediter följer scenexporten; inga verifieringsflaggor har höjts.

**CPU/GPU:** den nya matematiken finns i `batch02Kernels.ts` och `batch02Wgsl.ts`. Rotationer återanvänds. Hamiltonprodukten och den kommutativa hyperkomplexa produkten hålls isär. MengerHyper använder radiella foldfaktorer och Mengerfoldning; Octahedron4 följer fem angivna byten och permutation före 4D-rotationen. TgladTetra2 och TgladDihed delar chart-/inversprimitiver med olika kartkonventioner och separata rationella avbildningar. GPU-returer har en uttrycklig ogiltig-flagga, utan att använda koordinat-w som felmarkör.

**Tillstånd och DE:** Beth2422, IdesFormula, Aex-Octo, Lambda4Dc, Barnsley4Dnc, Kalisets1 och TgladDihed använder den befintliga generella numeriska DE-vägen. Barnsley ändrar en lokal konstantkopia, aldrig banans lagrade c. MengerHyper och Octahedron4 använder separat signerad derivata, slutradie / abs(derivata) och samma scheman som övrig IFS. Källans MengerHyper-derivata i w adapteras till motorns derivataskalar; koordinat-w och radie hålls skilda. Båda inversionsfaktorerna saknas i den återvunna derivatan och har därför inte lagts till. Detta är en äldre heuristik. SIPow för Beth2422 är 4 som metadata; själva avbildningen är kvintisk.

**Generell dIFS-väg:** ScherkFS väljer `method: difs` i kärnregistret. `fieldValue` är signerat Rout, `varyScale` är bestående skala, `bestDistance` startar vid 65535 och `bestIteration` vid 0. Efter varje räknat giltigt shapeanrop tas d = fieldValue / varyScale med bevarat tecken. Endast ett strikt mindre värde ändrar minimum och iterationsindex. Vid förbättring och d < `de_stop` avslutas banan om `inside_render` avrundat nearest-even är 0; annars körs hela det valda schemat. Ingen norm²-bailout eller bulb-DE används. Nollskala i kvoten ger ogiltigt avstånd. Både CPU och GPU återställer tillståndet mellan prov, normaler och andra omprov.

De två sista **dIFS-värdreglagen** ersätter `bailout_squared`: `de_stop` (standard 0.0001) och `inside_render` (standard 0). Slice-w och Julia-w finns för samma start-API men ScherkFS använder inte c och bevarar w. Dessa är integrationsinställningar, inte nya återvunna formelparametrar. `iterations` i avståndsresultatet anger bästa fältanropets index; det publika ban-API:t ger även det totala räknade antalet. Färgmåttet `trap` för dIFS är abs(bestDistance), inte den vanliga radiebanfällan. Rotation används bara när fältet utvärderas; lagrade transformerade koordinater förblir oroterade. `inside_render` styr dIFS-loopens avslutning, inte en ny kamerafunktion eller vändning av normalsystemet.

**Gränser:** dIFS kan kedjas med dIFS i följd eller alternera, inom ordinarie parameter-/iterationsgränser. Direkt blandning med vanliga fraktaler eller IFS avvisas. Separat DE-kombination, registeröverlagring och interpolation av bestående tillstånd emuleras fortfarande inte. Hjälpkärnorna från batch 03 kan endast anslutas till numerisk DE, inte dIFS/analytisk IFS. ScherkFS:s signerade fält och MengerHypers derivata är heuristiska, inga bevisade SDF-gränser; stora strålsteg kan ge artefakter. Använd befintlig stegfaktor vid behov. CPU/GPU kan välja olika diskontinuerliga grenar nära trösklar och skilja sig på långa banor.

## Batch 03: bilinjär 4D, quaternion-sinus, dIFS-ytor och hjälpanrop

Alla tio specifikationer i `NewFormulas/batch-03/` är implementerade i `batch03Kernels.ts` och `batch03Wgsl.ts`. Faehrten behåller PLUS Squares multiplier och twist; Mandel4DBiC är två oberoende komplexa kvadrater; hyperd_1 använder sin parametriserade bilinjärprodukt med fast bas och lokal ackumulator. N konverteras nearest-even; utanför 1..16 återställs det till 2, och antalet inre produktsteg är max(1,N-1). Makin använder kvadrerade komplexnormer och den andra grenen vid likhet. _Sin4Dplus är en räknad 4D-rekursion, x är realdelen, c läggs inte till och realaxeln är ogiltig. Stabil sinh för r>0 förbättrar float32 utan att införa en realaxelfortsättning. Riemann2 använder delad avrundad rotation, Scale/r, exponent före sinusfoldning, dubbla abs och sin egen strikta riktade gren; c ignoreras.

**Tre dIFS-fält:** TorusEllipIFS, KleinBagelIFS och helixIFS delar signerad affin utvärdering/commit. Fältet utvärderas vid scale*xyz+offset i båda apply-grenarna. Apply=0 bevarar koordinater/skala och dividerar fältet med scale; apply!=0 committar koordinaterna och multiplicerar varyScale med scale. Heltalsparametrar konverteras nearest-even; booleska värden prövas sedan mot !=0. Scale=0 är ogiltigt. Torus har valbara maxnormer och elliptisk X-term. Klein använder atan2(X,Y) före Aspect Ratio och en Gerono-polynomheuristik; atan2(±0,±0) definieras till 0. Helix väljer axel/tvärplansordning exakt, wrappar count till 1..16, använder diametrarna direkt som amplituder och behåller avståndscap 10000. Fälten är heuristiker, inte bevisade SDF:er. Varje shape räknas och deltar i den befintliga dIFS-värdens strikta minimum och stopppolicy.

**Generell hjälproll:** kernelregistret kan ange `role: helper`. Ett sådant anrop ändrar koordinater men skriver inte räknare, cachad radie eller banfälla och testar ingen bailout. _hopalong har denna roll, med verifierad PLUS-kvadratrotsgren för positiv t, Strength enbart på y och ingen c-addition. Minst en schemalagd räknad numerisk huvudformel krävs. En 3D-hjälpkärna bevarar extra w och får användas med numerisk 3D eller 4D; olika räknade dimensioner avvisas fortfarande. Första räknade steget äger start-w och DE-familj, även med hjälpanrop före det. Upprepning, start/every och ordning bevaras. DE-perturbationerna återspelar samtliga föregående hjälpanrop tills exakt huvudbanans räknade avslutningspunkt. FORMULA_ITERATIONS räknar endast huvudformelanrop, medan scenens arbetsgräns 256 fortsatt inkluderar alla anrop. Panelen visar Hjälpanrop och separata totalsiffror. För _hopalong gäller fortfarande enbart numerisk DE; Essentials utvidgar den generella rollen enligt nästa avsnitt.

**Precision och tester:** 30 levererade kontrollfall, 40 levererade sammanhängande anrop och 900 nya jämförelser med separat float64-referens, plus gränser, domäner, schema, exporterade krediter och DE. Faktisk WebGPU: `/tests/gpu/batch03.html`, **275 jämförelser**, tio batch-renderingsshaders (inklusive en giltig _hopalong-hybrid) och sex extra kedjeshaders. Enskilda anrop och korta värdtillstånd jämförs inom 3e-4 × max(1,abs(v)); avstånd inom 2 % med golv 0.01, färgtrap inom 1 % med golv 0.1. DE jämförs med round32-CPU, som rundar committat tillstånd och inte emulerar varje GPU-instruktion. Riemann vid (0.71,-0.3,0.2) kan ge ändlig float64-DE men ett ogiltigt float32-perturberat omlopp; GPU ger då missavstånd. Överflödande koordinatutgångar flaggas före räknarökning, även i hjälpanrop. Inga epsilon, grenändringar eller x87-emuleringar införs. Exakta YAML-/scenstandardvärden bevaras även när native-reglage serialiserar -1/3 något annorlunda. reviewed/verified_against_mb3d är fortsatt false; okänt upphov och inspirationsroller följer med scenen.

**Float32:** Kalisets1:s exakta standard `Fix=1e-60` sparas och används på CPU. På GPU blir det 0; origo markeras ogiltigt utan ett ersättande epsilon. Även Tglads axel-/polsingulariteter kan inträffa tidigare i float32. Små konstanter och dIFS-trösklar visas nu utan avrundning till texten 0.00. Reglagen behåller sina exakta standardvärden i scenen; shaderuniformerna är float32.

**Portens tester:** `tests/mb3dBatch02.test.ts` jämför paketets 30 kontrollfall, 900 nygenererade prov mot en separat referens samt 12 sammanhängande tillståndsanrop. Dessutom grenar, 24 koordinatordningar, numerisk/analytisk DE, dIFS-policy, scheman, metadata/hashes, scenformat och bakåtkompatibilitet. Starta devservern och öppna `/tests/gpu/batch02.html`: 184 faktiska GPU-jämförelser, tio fulla formelrenderingsshaders och tre ytterligare renderingsshaders för alternerande kedjor. Samma float32-toleranser som batch 01 används; ogiltiga avstånd kontrolleras som missar. Paketets äldre återvinningsjämförelser räknas inte som nya motorprov. Ingen native MB3D- eller bildverifiering påstås.


## Essentials 40 (2026-10-09)

Biblioteket har nu **129 YAML-filer**. Alla 42 fristående specifikationer i `NewFormulas/essentials-40/` är registrerade med exakta namn, standardvärden, DE-hints och krediter. Riemann2 återanvänds från batch 03. DodecahedronIFS har egen parameterförinställning men samma Icosahedron-kärna. Den äldre stellahedron är kvar; `_BStellahedron_F_Sphere` är den separata exakta oräknade varianten. Full förteckning och provresultat: [Essentials-rapporten](../docs/mb3d-jamforelser/essentials-40.md).

**Roller och init:** `_Scaling`, `_Scalingplus`, `_sphereinv` och `_MobiusTpx` är räknade enligt specifikationen, trots understreck. Övriga hjälpanrop deklarerar kompatibilitet med numerisk, analytisk och IFS-DE; 4D-hjälpanrop kräver koordinat-w. `_hopalong` behåller sin numeriska begränsning. PolyFoldIFS är oräknad dIFS-transform och kräver en följande schemalagd shape, exempelvis RandCubesIFS. Transformer ökar inte count, uppdaterar inte radie/trap/minimum och testar ingen bailout. Första räknade formeln äger w/DE. Analytisk 3D startar derivata-w=1 med oberoende C.w; analytisk 4D behåller koordinat-w och Deriv1 separat.

**Återanvändbara primitiver och tillstånd:** box/sfär/smooth-foldning, triplexprodukt med axelgren, unsigned 64-bit hashprodukt, 3D/4D-matriser och delad variabel skala. original_point, OTrap, bFirstIt, free-fält och extra derivator är explicita och återställs per punkt/DE-prov. Delat C bevaras mellan slots. Alla kompilerade selector-/normgrenar följer det auktoriserade underlaget.

**Prov:** 182 tester, 4 491 CPU-matematikjämförelser och faktisk WebGPU på `/tests/gpu/essentials40.html`: 4 501 matematik-/tillståndsprov, 137 värd-/DE-prov och 45 fulla renderingsshaders. Äldre GPU-batcher passerar också. Detaljer, toleranser och rapport finns i länken ovan.

**Gränser:** Float32 kan skilja sig från float64 vid lång iteration, singulariteter och diskontinuerliga grenar. Exempelvis ger åtta anrop av _AmazingBox vid standardvärden mätbart olika koordinater efter avrundning; det är ingen bitexakt x87-emulering. _MobiusTpx:s CPU-sentinel 1e90 kan inte representeras i float32 och ger därför ett ogiltigt GPU-prov. Mycket små normgolv kan underflyta. Inga ersättande epsilon eller matematiska axelfortsättningar införs.

Registrerade räknade kärnor måste fortfarande ha samma dimension och avståndsfamilj. Interpolation och blandning med äldre uttrycksformler avvisas. 4D-koordinathjälpsteg får inte förbruka analytisk 3D-derivata-w. _hopalong förblir numerisk. PolyFoldIFS behöver en efterföljande schemalagd dIFS-shape. Kedjor har fortsatt högst 32 sammanlagda parametrar och 256 anrop. En registrerad kärna får högst 32 parametrar (RandCubesIFS använder 17); äldre uttrycksformler behåller sin gräns 16.

Numerisk DE är motorns potentialgradient över hela schemat på det valda 3D-snittet. dIFS-fält och vissa analytiska uppskattningar är heuristiker, inga bevisade SDF:er. Nästan lika dIFS-minima kan få olika vinnande index på CPU/GPU. Matematikprov och gränssnittsprov ersätter ingen native MB3D-bildgranskning; samtliga reviewed/verified_against_mb3d är falska.
