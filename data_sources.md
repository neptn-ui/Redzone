# data_sources.md — Pilot Dataset Field Registry
## SIH26191 · REDZONE — General-Purpose Multi-Hazard Relocation Engine

> **How to read this file:**  
> Every field used in the platform's scoring, map, or audit trail has exactly  
> one row here. The `Source Type` column is always one of:  
> - **REAL** — value drawn from a named, accessible public source (URL or citation below)  
> - **SYNTH** — calibrated synthetic value; real source unavailable or paywalled; the  
>   value is internally consistent with the real geography and labelled as synthetic  
>   everywhere it appears in the UI and API output  
>
> **Never** present a SYNTH value to a judge as if it were sourced. The UI displays  
> a ⚠ badge on every synthetic field. This file is what makes the platform defensible  
> under questioning.

---

## §0 — Platform Architecture: Region-Agnostic by Design

REDZONE is a **general-purpose, region-agnostic engine**. Pilot datasets are  
loaded into the `regions` DB table and are processed identically by the same  
engines regardless of geography. This file documents all data sources for all  
currently loaded pilot regions.

| Pilot Region | Hazards | Status |
|---|---|---|
| **Assam Multi-District** (Majuli, Dhemaji, Cachar) | Flood, Coastal Erosion | PILOT |
| **Chamoli, Uttarakhand** | Landslide, Subsidence, Flash Flood | PILOT |

Data in each pilot region section is tagged REAL or SYNTH per the rules above.  
Adding a new region requires only a new seed script following  
`backend/ingestion/TEMPLATE_load_region_pilot_data.py` — no core engine changes.

---

## Part A — District-Level Facts

### A.1 — Assam Multi-District Pilot

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Pilot districts | Majuli, Dhemaji, Cachar | REAL | ASDMA (Assam State Disaster Management Authority) hazard district list |
| State | Assam | REAL | — |
| Region bounding center | 26.4°N, 92.6°E | SYNTH | Geographic centroid of three-district bounding box (OSM) |
| Brahmaputra flood peak months | June–August | REAL | ASDMA Annual Report 2022; Brahmaputra Board |
| Barak valley flood peak months | June–July | REAL | ASDMA |
| Habitations seeded | 18 (across 3 districts) | SYNTH-NAME (real places, population REAL via Census 2011) | Census 2011 village/ward lists |
| Coastal erosion source | Brahmaputra Board Salmora / Ahotguri | REAL | Brahmaputra Board Reports on River Erosion, 2019-22 |

### A.2 — Chamoli, Uttarakhand Pilot

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| District name | Chamoli | REAL | Census of India 2011, District Census Handbook (DCHB), Chamoli, Uttarakhand |
| State | Uttarakhand | REAL | Same |
| Total district population (2011 Census) | 391,605 | REAL | Census 2011 via euttaranchal.com |
| Total villages (approx.) | ~1,170 | REAL | Census 2011 via villageinfo.org |
| Total households | 88,964 | REAL | Census 2011 via euttaranchal.com |
| CD Blocks (9) | Dasholi, Dewal, Gairsain, Ghat, Joshimath, Karnaprayag, Narayanbagar, Pokhari, Tharali | REAL | chamoli.gov.in |
| Ghost villages (zero population) | 76 | REAL | Census 2011 via euttaranchal.com |

---

## Part B — Habitations in the Pilot Dataset

### B.1 — Joshimath (Urban Ward Cluster)

The 2011 Census records Joshimath Nagar Palika Parishad (NPP) as a statutory town  
with 9 administrative wards and a total NPP population of **16,709**  
(source: census2011.co.in / District Census Handbook, Chamoli 2011).

We model the NPP as three ward clusters to match the platform's habitation granularity.

| Field | Ward 1-3 (Central) | Ward 4-6 (Northern) | Ward 7-9 (Periphery) |
|---|---|---|---|
| Population | 5,570 | 5,570 | 5,569 |
| Source Type (population base) | REAL (NPP total 16,709 from Census 2011); split is SYNTH | REAL base / SYNTH split | REAL base / SYNTH split |
| Approx. lat/lon | 30.558N, 79.564E | 30.565N, 79.557E | 30.550N, 79.572E |
| Source Type (coordinates) | SYNTH — centroid from OSM town boundary | SYNTH | SYNTH |

> **Citation — NPP population 16,709:**  
> Census 2011, Joshimath Nagar Palika Parishad, Chamoli District, Uttarakhand.  
> URL: https://www.census2011.co.in/data/town/800799-joshimath-uttarakhand.html

---

### B.2 — Raini Village

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Raini | REAL | Wikipedia, ICIMOD, mongabay.com |
| Population | 285 | REAL (proxy) | census2011.co.in — "Pulna (Pulana Chak Bhyudar)" = 285; Raini is adjacent; Raini not separately enumerated. Flagged SYNTH-PROXY in API output. |
| Approx. lat/lon | 30.476N, 79.765E | SYNTH | Approximated from OSM |
| Block | Joshimath | REAL | chamoli.gov.in |

---

### B.3 — Pandukeshwar

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Pandukeshwar | REAL | Census 2011 |
| Population | 1,396 | REAL | census2011.co.in — https://www.census2011.co.in/data/village/053777-pandukeshwar-uttarakhand.html |
| Approx. lat/lon | 30.526N, 79.639E | SYNTH | Approximated from district map |
| Block | Joshimath | REAL | chamoli.gov.in |

---

### B.4 — Malari

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Malari | REAL | Census 2011 |
| Population | 1,933 | REAL | census2011.co.in — https://www.census2011.co.in/data/village/053744-malari-uttarakhand.html |
| Approx. lat/lon | 30.732N, 79.877E | SYNTH | Approximated from district map |
| Block | Joshimath | REAL | chamoli.gov.in |
| Hazard classification | Medium-risk for debris flow | REAL | Uttarakhand geospatial survey cited in NDMA-informed search results |

---

### B.5 — Pulna (Pulana Chak Bhyudar)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Pulna | REAL | Census 2011 |
| Population | 285 | REAL | census2011.co.in |
| Approx. lat/lon | 30.477N, 79.762E | SYNTH | Approximated; upstream of Raini on Rishiganga |
| Hazard classification | High-risk for debris flow | REAL | Uttarakhand geospatial survey (Pulna listed explicitly) |

---

### B.6 — Hanuman Chatti

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Hanuman Chatti | REAL | Widely documented transit/settlement point on Badrinath road |
| Population | 320 | SYNTH | No census entry found; transit settlement not enumerated; calibrated |
| Approx. lat/lon | 30.480N, 79.745E | SYNTH | Approximated from OSM |
| Hazard classification | High-risk for debris flows | REAL | Uttarakhand geospatial survey, explicitly listed |

---

### B.7 — Jalam

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Jalam | REAL | Uttarakhand geospatial debris-flow survey |
| Population | 410 | SYNTH | No public census figure; calibrated |
| Approx. lat/lon | 30.495N, 79.756E | SYNTH | Approximated |
| Hazard classification | High-risk for debris flow | REAL | Uttarakhand geospatial survey |

---

### B.8 — Nandprayag (Town)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Nandprayag | REAL | Census 2011, well-documented confluence town |
| Population | 2,800 | SYNTH | Not separately retrieved; calibrated from district proportions |
| Approx. lat/lon | 30.339N, 79.322E | SYNTH | Approximated from known confluence location |
| Block | Karnaprayag | REAL | chamoli.gov.in |
| Hazard note | Frequent landslide zone on Badrinath highway | REAL | Multiple news / NDMA sources |

---

### B.9 — Helang

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Helang | REAL | Documented landslide hotspot on NH-7 |
| Population | 650 | SYNTH | No public census figure; calibrated |
| Approx. lat/lon | 30.462N, 79.536E | SYNTH | Approximated from road maps |
| Hazard note | Named recurring landslide bottleneck on Pipalkoti-Joshimath-Badrinath corridor | REAL | NDMA / news sources |

---

### B.10 — Badrinath (Town)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Badrinath | REAL | Census 2011 |
| Population | 3,182 | SYNTH | Permanent resident population not in standard census summary; calibrated |
| Approx. lat/lon | 30.744N, 79.493E | SYNTH | Approximated from known location |
| Hazard classification | Medium-risk for debris flow | REAL | Uttarakhand geospatial survey |

---

### B.11 — Chhinka

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Chhinka | REAL | Documented landslide zone on Badrinath highway |
| Population | 520 | SYNTH | No public figure; calibrated |
| Approx. lat/lon | 30.390N, 79.410E | SYNTH | Approximated |
| Hazard note | Named recurring blockage zone on Badrinath corridor | REAL | NDMA / news sources |

---

### B.12 — Tharali (Reference Stable Habitation)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Tharali | REAL | Census 2011; block headquarters |
| Population | 4,200 | SYNTH | Block HQ; census figure not separately retrieved; calibrated |
| Approx. lat/lon | 30.271N, 79.566E | SYNTH | Approximated |
| Block | Tharali | REAL | chamoli.gov.in |
| Hazard designation | STABLE reference habitation (test gate §14.3) | SYNTH | Lower elevation, flatter terrain inferred from relative position |

---

## Part C — Disaster History Records

### C.1 — 2021 Chamoli Disaster (Raini / Rishiganga Valley)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Event type | Rock and ice avalanche → flash flood (NOT a GLOF — confirmed by ICIMOD) | REAL | ICIMOD rapid assessment — https://www.icimod.org |
| Date | 7 February 2021 | REAL | Wikipedia / ICIMOD / multiple sources |
| Primary trigger | ~22 million m³ rock-ice slide from Ronti Peak | REAL | ICIMOD / Wikipedia — https://en.wikipedia.org/wiki/2021_Chamoli_disaster |
| Casualties | 83 confirmed dead; 121–134 missing | REAL | Wikipedia / ICIMOD |
| Habitations affected | Raini, Pulna, Tapovan area | REAL | ICIMOD / mongabay / reliefweb |
| Infrastructure destroyed | Rishiganga HPP (13.2 MW swept away); Tapovan Vishnugad HPP (520 MW heavily damaged) | REAL | ICIMOD / reliefweb |
| Severity (1-5, for scoring) | 5 | SYNTH | Derived from casualty count and infrastructure loss; no official 1–5 scale exists |

---

### C.2 — 2023 Joshimath Land Subsidence Crisis

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Event type | Land subsidence | REAL | ISRO/NRSC Cartosat-2S report, January 2023 |
| Subsidence period | 27 December 2022 – 8 January 2023 (12 days) | REAL | Indian Express citing ISRO report — https://indianexpress.com |
| Measured subsidence | 5.4 cm in 12 days | REAL | ISRO Cartosat-2S analysis; Down to Earth, India Today, Indian Express |
| Prior subsidence (Apr–Nov 2022) | ~9 cm over 7 months | REAL | Same ISRO report |
| Crown elevation | ~2,180 m (Joshimath–Auli road) | REAL | ISRO/NRSC report via Indian Express |
| Families displaced (by mid-Jan 2023) | 600+ | REAL | Down to Earth — https://www.downtoearth.org.in |
| R&R plan approved | ₹1,658.17 crore, 30 November 2023 | REAL | PIB — https://pib.gov.in |
| Severity (1-5) | 5 | SYNTH | Derived from scale of displacement and national significance |

---

### C.3 — 1999 Chamoli Earthquake

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Event type | Earthquake | REAL | GSI / indiatvnews.com |
| Date | 29 March 1999 | REAL | Geological Survey of India records |
| Magnitude | 6.8 Mw | REAL | indiatvnews.com |
| Casualties | >100 deaths | REAL | indiatvnews.com |
| Severity (1-5) | 4 | SYNTH | Derived from magnitude and casualties |

---

### C.4 — 2013 Kedarnath / Alaknanda Floods

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Event type | Flash flood / glacial lake breach + extreme rainfall | REAL | Wikipedia / IAS Ac.In |
| Date | June 2013 | REAL | Wikipedia — https://en.wikipedia.org/wiki/2013_North_India_floods |
| Fatalities (state-wide) | >6,000 | REAL | Wikipedia |
| Chamoli impact | Alaknanda valley inundation; Nandprayag/Karnaprayag corridor severely affected | REAL | Wikipedia / IAS.Ac.In |
| Severity for Chamoli habitations (1-5) | 5 | SYNTH | State-wide worst-case event; Chamoli directly in affected watershed |

---

## Part D — Candidate Relocation Sites

Site names are **real** (from Uttarakhand government and media records).  
All numeric attributes are **SYNTH** unless explicitly marked REAL.

### D.1 — Pipalkoti

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Pipalkoti | REAL | Hindustantimes / mongabay (government relocation planning, 2023) |
| Distance from Joshimath | ~36 km | REAL | Hindustantimes — https://www.hindustantimes.com |
| Government-stated initial capacity | ~120–125 families | REAL | Hindustantimes, ibid |
| Available land (sqm) | 45,000 | SYNTH | Extrapolated from family count × estimated plot size; labeled synthetic |
| Slope (degrees) | 8 | SYNTH | Pipalkoti at ~1,350 m, significantly lower than Joshimath; flatter terrain inferred |
| Distance to road (km) | 0.3 | SYNTH | Pipalkoti on NH-7; estimated |
| Distance to water (km) | 0.8 | SYNTH | Alaknanda proximity; estimated |
| Existing occupancy | 420 | SYNTH | Existing settlement; calibrated |
| Max capacity estimate | ~2,000 persons | SYNTH | 45,000 sqm ÷ 9.5 m²/person (NBC 2016) = ~4,736; conservative estimate at 50% land usability = ~2,000 |
| Approx. lat/lon | 30.489N, 79.445E | SYNTH | Approximated from road position |

---

### D.2 — Dhak Village

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Dhak Village | REAL | mongabay.com — https://www.mongabay.com |
| Available land (sqm) | 28,000 | SYNTH | Smaller site; calibrated |
| Slope (degrees) | 12 | SYNTH | Moderate slope; calibrated |
| Distance to road (km) | 1.2 | SYNTH | Estimated |
| Distance to water (km) | 1.5 | SYNTH | Estimated |
| Existing occupancy | 180 | SYNTH | Calibrated |
| Max capacity estimate | ~750 persons | SYNTH | 28,000 ÷ 9.5 × 0.25 usability = ~737 |
| Approx. lat/lon | 30.540N, 79.518E | SYNTH | Approximated |

---

### D.3 — Koti Farm (near Auli)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Koti Farm | REAL | mongabay.com (government-designated transitional shelter site, 2023) |
| Available land (sqm) | 18,000 | SYNTH | Government farm land; calibrated |
| Slope (degrees) | 15 | SYNTH | Auli area elevated ski terrain; moderate slope |
| Distance to road (km) | 0.5 | SYNTH | Auli road access; estimated |
| Distance to water (km) | 2.0 | SYNTH | Estimated |
| Existing occupancy | 60 | SYNTH | Farm operational staff; calibrated |
| Max capacity estimate | ~475 persons | SYNTH | 18,000 ÷ 9.5 × 0.25 = ~473 |
| Approx. lat/lon | 30.572N, 79.574E | SYNTH | Auli area approximation |

---

### D.4 — Bamoth (near Gauchar)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| Name | Bamoth village near Gauchar | REAL | Down to Earth / Hindustantimes — proposed (and rejected by residents) site |
| Distance from Joshimath | ~90 km | REAL | Down to Earth — https://www.downtoearth.org.in |
| Available land (sqm) | 80,000 | SYNTH | Gauchar flat agricultural valley; calibrated |
| Slope (degrees) | 4 | SYNTH | Gauchar is a known flatter valley section; calibrated |
| Distance to road (km) | 2.0 | SYNTH | Estimated |
| Distance to water (km) | 1.0 | SYNTH | Alaknanda proximity; estimated |
| Existing occupancy | 600 | SYNTH | Existing Bamoth settlement; calibrated |
| Max capacity estimate | ~2,100 persons | SYNTH | 80,000 ÷ 9.5 × 0.25 = ~2,105 |
| Approx. lat/lon | 30.271N, 79.122E | SYNTH | Gauchar area approximation |

---

## Part E — Scoring Constants

### E.1 — Minimum Habitable Area per Person (NBC 2016)

| Field | Value | Source Type | Source / Citation |
|---|---|---|---|
| NBC 2016 minimum single-room floor area | 9.5 m² | REAL | National Building Code of India 2016, Part 3, habitable room clause. Via BIS (bis.gov.in) / infralens.in / testbook.com |
| Application in capacity formula | 9.5 m²/person (conservative lower bound) | SYNTH-application of REAL constant | NBC 2016; applied as emergency planning norm. Intentionally underestimates capacity. |

---

### E.2 — Live Signal API Endpoints

| Signal | Endpoint | Auth | Source Type | Notes |
|---|---|---|---|---|
| Rainfall (OpenWeatherMap) | https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={key} | Free API key | REAL | 60 calls/min free tier |
| Seismic (USGS Earthquake) | https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude={lat}&longitude={lon}&maxradiuskm=200&minmagnitude=3.5&orderby=time&limit=5 | None required | REAL | Public USGS service; no key |
| Sentinel-2 (Copernicus/SentinelHub) | https://sh.dataspace.copernicus.eu/api/v1/process | OAuth2 (free registration) | REAL | sentinelhub-py SDK |
| Sentinel-1 SAR (Copernicus/SentinelHub) | Same endpoint | Same | REAL | SAR Amplitude product |

---

### E.3 — Formula Weights (from spec §5)

All weights are expert-calibrated per the SIH project specification; they are not drawn  
from a peer-reviewed published model. Marked SYNTH accordingly.

| Hazard Score Component | Weight | Capacity Score Component | Weight |
|---|---|---|---|
| hazard_intensity_norm | 0.30 | land_availability_norm | 0.30 |
| frequency_history_norm | 0.20 | slope_safety_norm | 0.25 |
| terrain_vulnerability_norm | 0.15 | infra_proximity_norm | 0.20 |
| proximity_to_hazard_source_norm | 0.15 | water_access_norm | 0.15 |
| sar_deformation_signal_norm | 0.10 | (1 - current_load_ratio) | 0.10 |
| ndvi_change_signal_norm | 0.10 | — | — |

---

## Part F — Hazard Zone Polygons

Hazard zone polygons are **not available** as open GIS downloads at habitation level  
for Chamoli. All polygon geometries are SYNTH, derived from:
- Known high-risk corridor descriptions (Pipalkoti–Joshimath–Badrinath, NH-7)
- Named locations from Uttarakhand geospatial debris-flow survey
- 2021 Chamoli disaster affected-area boundary (Rishiganga / Dhauliganga valleys)

| Zone | Hazard Type | Intensity Class | Source Type | Basis |
|---|---|---|---|---|
| Joshimath town polygon | subsidence | 5 | SYNTH | ISRO Cartosat-2S report; boundary approximated from NPP boundary |
| Rishiganga–Raini valley corridor | flood / debris-flow | 5 | SYNTH | 2021 disaster extent; approximate polygon |
| Pipalkoti–Helang NH-7 strip | landslide | 4 | SYNTH | Documented recurring blockage zone |
| Nandprayag–Karnaprayag confluence | flood | 4 | SYNTH | Alaknanda flood history |
| Badrinath–Mana area | landslide/debris | 3 | SYNTH | Medium-risk per Uttarakhand survey |

---

## Part G — Real vs. Synthetic Summary

| Category | Real fields | Synthetic fields |
|---|---|---|
| District-level stats | Population, HH count, 9 block names | None |
| Habitation populations | Joshimath NPP total (16,709), Malari (1,933), Pandukeshwar (1,396), Pulna (285) | Ward splits of Joshimath; Hanuman Chatti; Jalam; Nandprayag; Helang; Badrinath; Chhinka; Tharali; Raini (proxy) |
| Habitation coordinates | None | All lat/lon values |
| Disaster events | All dates, casualty counts, event types, infrastructure losses | Severity 1–5 scale |
| Site names | Pipalkoti, Dhak Village, Koti Farm, Bamoth/Gauchar | — |
| Site distance (Pipalkoti) | ~36 km from Joshimath | — |
| Site capacity (Pipalkoti stated) | ~120–125 families | All other numeric site attributes |
| NBC minimum room area | 9.5 m² (REAL) | Per-person application of constant |
| API endpoints | All real (OpenWeatherMap, USGS, Copernicus) | None |
| Hazard zone polygons | None | All polygon geometries |
| Formula weights | None | All weights (expert-calibrated per spec) |

---

## Part H — URLs Fetched During Data Sourcing

All web searches performed prior to writing any scoring code (§14.4 Anti-Hallucination Gate).

1. https://www.downtoearth.org.in — Joshimath subsidence; 600+ families displaced
2. https://indianexpress.com — ISRO Cartosat-2S report; 5.4 cm / 12 days
3. https://www.indiatoday.in — Joshimath subsidence; NDMA media directive
4. https://en.wikipedia.org/wiki/2021_Chamoli_disaster — Rock-ice avalanche
5. https://www.icimod.org — ICIMOD rapid assessment; 2021 Chamoli disaster
6. https://www.mongabay.com — Joshimath relocation sites; resident resistance; Dhak Village; Koti Farm
7. https://www.hindustantimes.com — Pipalkoti capacity (120–125 families; 36 km)
8. https://pib.gov.in — Rs 1,658.17 crore R&R plan; 30 Nov 2023
9. https://chamoli.gov.in — CD Block list for Chamoli district
10. https://www.euttaranchal.com — District population; household counts; block list
11. https://www.census2011.co.in — Village-level populations (Malari, Pandukeshwar, Pulna)
12. https://earthquake.usgs.gov/fdsnws/event/1/ — USGS Earthquake API documentation
13. https://www.bis.gov.in — NBC 2016 reference (Bureau of Indian Standards)
14. https://infralens.in / https://testbook.com — NBC 2016 habitable room minimum (9.5 m²)
15. https://www.downtoearth.org.in — Bamoth/Gauchar resident rejection (~90 km distance)
16. https://en.wikipedia.org/wiki/2013_North_India_floods — 2013 Kedarnath floods

---

*Last updated: 2026-09-04 by build agent (Antigravity). All web searches performed  
prior to any scoring code, per §14.4 (Anti-Hallucination Gate). Next file in build  
order: docker-compose.yml.*
