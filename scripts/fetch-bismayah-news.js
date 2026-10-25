// 비스마야 신도시 관련 뉴스를 구글 뉴스 검색(한국어·아랍어·영어)으로 모아
// bismayah-news.json 으로 저장한다. GitHub Actions에서 3시간마다 실행.
//
// - 검색어: 비스마야 / بسماية / Bismayah·Bismaya
// - 아랍어·영어 제목은 한국어로 번역해 붙인다 (구글 번역 무료 주소 → 안 되면 MyMemory)
// - 이전 파일에 있던 기사도 기간 안이면 남겨서, 검색에 잠깐 안 잡혀도 목록이 비지 않게 한다

const fs = require("fs");
// NEWS_CFG=health 로 돌리면 '보건 > 세계 보건 이슈' 용 (감염병 유행·페스트·에볼라 등)
const CFGS = {
  bismayah: {
    OUT: "bismayah-news.json", KEEP_DAYS: 60, MAX_ITEMS: 60,
    SEARCHES: [
      { lang: "ko", q: "비스마야 when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "비스마야 신도시 한화 when:60d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ar", q: "بسماية when:30d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: '"مدينة بسماية" OR "مجمع بسماية" when:60d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "en", q: "(Bismayah OR Bismaya) Iraq when:60d", hl: "en-US", gl: "US", ceid: "US:en" },
      // 오타·다른 표기로 쓴 기사도 잡는다 (예: 더구루 '비스야마', 영어 'Basmaya' — 'Besmaya'는 스페인 가수 이름이라 뺌)
      { lang: "ko", q: "(비스야마 OR 비스마이야 OR 바스마야) when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "한화 이라크 (신도시 OR 미수금 OR 공사대금) when:30d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ar", q: '(بسمايا OR "هانوا" OR "هانوها") العراق when:30d', hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "en", q: "(Basmaya OR \"Hanwha Iraq\") when:30d", hl: "en-US", gl: "US", ceid: "US:en" },
    ],
    // 제목이나 요약에 비스마야(또는 다른 표기)가 실제로 나와야 한다 (검색 엔진이 엉뚱한 기사를 섞는 것 거르기)
    // 한화+이라크 기사는 비스마야 사업 얘기라 같이 받는다
    MUST: /비스마야|비스야마|비스마이야|바스마야|بسماية|بسمايه|بسمايا|bismay|basmaya|한화.{0,30}이라크|이라크.{0,30}한화|hanwha.{0,40}iraq|iraq.{0,40}hanwha|(هانوا|هانوها).{0,60}(العراق|بغداد|الاستثمار)|(العراق|بغداد|الاستثمار).{0,60}(هانوا|هانوها)/i,
  },
  health: {
    OUT: "health-issues.json", KEEP_DAYS: 30, MAX_ITEMS: 80,
    SEARCHES: [
      { lang: "ko", q: "(페스트 OR 흑사병 OR 에볼라 OR 마버그 OR 조류인플루엔자 OR 엠폭스 OR 콜레라 OR 니파) when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "해외 감염병 유행 when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "WHO 감염병 경보 when:14d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "en", q: '(plague OR ebola OR marburg OR "bird flu" OR H5N1 OR mpox OR cholera OR nipah) outbreak when:7d', hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "en", q: 'Iraq (cholera OR "hemorrhagic fever" OR CCHF OR measles OR outbreak) when:30d', hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "ar", q: "(الحمى النزفية OR الكوليرا OR انفلونزا الطيور OR الحصبة) العراق when:30d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
    ],
    // 감염병·보건 관련 낱말이 실제로 있어야 한다
    MUST: /감염|전염|확진|역학|페스트|흑사병|에볼라|마버그|바이러스|독감|인플루엔자|엠폭스|콜레라|니파|홍역|뎅기|outbreak|plague|ebola|marburg|virus|flu|h5n1|mpox|cholera|nipah|measles|dengue|epidemic|pandemic|infection|cchf|hemorrhagic|نزفية|كوليرا|انفلونزا|حصبة|فيروس|وباء|إصابات|الصحة/i,
    // 보건 탭은 제목에 감염병 낱말이 있어야 한다 (요약에만 스친 기사 거르기)
    TITLE_ONLY: true,
    // '모터페스트' 같은 게임·축제, 주식 시황 기사는 뺀다
    // '6G 비전 페스트' 처럼 행사 이름에 붙은 '페스트'(개막·개최·참가…)도 뺀다
    NOT: /(모터|뮤직|푸드|맥주|아트|영화|게임|댄스|재즈|록|락|와인|커피|스트리트|썸머|윈터|북|비전|테크|과학|드론|로봇|웹툰|청년|창업|스타트업|미디어|콘텐츠|디지털|에너지|\d\s?G|AI|IT|K-?)\s?페스트|페스트['"’”]?\s*(\d{1,2}월\s*\d{1,2}일\s*)?[^\s,…]*\s*(개막|폐막|성료|개최|열려|열린다|참가|모집|부스)|페스티벌|motorfest|festival|특징주|株|주가|급등|급락|airways|airlines? resumes?/i,
  },
  // NEWS_CFG=iraq : 기타 > 이라크 주요 이슈 (치안·시위·정치·휴일·전력·경제 등 현장 생활에 영향 주는 이라크 소식, 최근 7일)
  iraq: {
    OUT: "iraq-issues.json", KEEP_DAYS: 7, MAX_ITEMS: 70, BODY_PER_RUN: 15,
    SEARCHES: [
      { lang: "ko", q: "이라크 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "(바그다드 OR 이라크 정부 OR 이라크 시위 OR 이라크 테러) when:7d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "en", q: "Iraq (security OR attack OR protest OR curfew OR election OR parliament OR \"prime minister\") when:3d", hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "en", q: "Baghdad (electricity OR \"power outage\" OR \"public holiday\" OR \"dust storm\" OR dinar) when:7d", hl: "en-US", gl: "US", ceid: "US:en" },
      { lang: "ar", q: "بغداد (تظاهرات OR احتجاجات OR انفجار OR \"حظر التجوال\" OR \"قطع طرق\") when:3d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: "العراق (\"عطلة رسمية\" OR تعطيل الدوام) when:7d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: "العراق (الكهرباء OR \"العاصفة الترابية\" OR \"سعر الدولار\") when:3d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      // 갑작스러운 공휴일·통제 알림용 (짧은 기간으로 자주)
      { lang: "ar", q: "(\"تعطيل الدوام الرسمي\" OR \"عطلة رسمية\" OR \"عطلة الدوام\") when:2d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: "بغداد (\"حظر التجوال\" OR \"قطع الطرق\" OR \"غلق الطرق\" OR \"قطع طريق\" OR \"إغلاق جسر\") when:2d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "en", q: "Iraq (\"public holiday\" OR \"official holiday\" OR curfew OR \"roads closed\") when:2d", hl: "en-US", gl: "US", ceid: "US:en" },
    ],
    // 현장 알림: 공휴일 선포 / 통행금지·도로 통제 (바그다드 또는 전국 대상만, 기사 나온 지 36시간 안)
    ALERTS: {
      HOURS: 36,
      holiday: /공휴일|휴무|관공서.{0,6}쉰|public holiday|official holiday|day off|suspend(s|ed)? (official )?work|تعطيل الدوام|تعطل الدوام|عطلة رسمية|عطلة الدوام|تعطيل رسمي/i,
      control: /통행금지|통금|도로\s?(봉쇄|통제|차단|폐쇄)|교량\s?(폐쇄|통제)|curfew|roads? (closed|closure|blocked)|bridge closed|حظر (ال)?تجوال|قطع (ال)?طر(ق|يق)|غلق (ال)?طر(ق|يق)|إغلاق (ال)?(طرق|جسر|شوارع)|قطع جسر/i,
      // 바그다드나 전국이 아니라 다른 주(州)만 해당하면 뺀다
      HERE: /바그다드|전국|이라크|iraq|이라크 정부|총리|내각|baghdad|nationwide|all provinces|government|cabinet|prime minister|بغداد|جميع المحافظات|عموم العراق|العراق|الحكومة|مجلس الوزراء|رئيس الوزراء|الأمانة العامة/i,
      OTHER: /바스라|나자프|카르발라|모술|키르쿠크|아르빌|에르빌|술라이마니|두호크|안바르|basra|najaf|karbala|mosul|nineveh|kirkuk|erbil|sulaymaniyah|duhok|anbar|dhi qar|maysan|babil|diwaniyah|muthanna|wasit|البصرة|النجف|كربلاء|نينوى|الموصل|كركوك|أربيل|السليمانية|دهوك|الأنبار|ذي قار|ميسان|بابل|الديوانية|المثنى|واسط|صلاح الدين|ديالى/i,
      // 지난 일·해제·연장 안 함 같은 기사는 빼지 않는다 (해제도 알 필요가 있음) — 다만 스포츠·종교행사 단순 보도는 NOT에서 걸러짐
    },
    MUST: /이라크|바그다드|쿠르드|아르빌|에르빌|바스라|모술|키르쿠크|iraq|baghdad|kurdistan|erbil|basra|mosul|kirkuk|diyala|najaf|karbala|العراق|العراقي|بغداد|أربيل|البصرة|كردستان|الموصل|كركوك|ديالى|النجف|كربلاء|نينوى/i,
    TITLE_ONLY: true,
    // 스포츠·연예·주식 기사는 뺀다
    NOT: /축구|월드컵|예선|골\s|체스|선수권|K리그|야구|배구|농구|올림픽|아시안컵|드라마|가수|영화|공연|주가|특징주|football|soccer|chess|championship|world cup|qualifier|match|league|fifa|basketball|olympic|كرة القدم|المنتخب|الدوري|مباراة|منتخبنا|فيفا|كأس/i,
    GROUP: true,   // 같은 사건 기사는 하나로 묶는다
    IMPACT: true,  // 현장 영향·위험도·권장 행동 + 오늘의 현장 브리핑 (scripts/iraq-impact.js)
    // 분류 표시 (위에서부터 먼저 맞는 것)
    TAGS: [
      ["치안·테러", /테러|폭발|공격|드론|로켓|무장|IS\b|ISIS|다에시|PKK|민병대|총격|납치|암살|체포|마약|공습|전투기|보안군|군사|attack|daesh|airstrike|security forces|arrest|militar|smuggl|explosion|blast|drone|rocket|militia|gunmen|kidnap|isis|terror|انفجار|هجوم|مسيرة|صاروخ|داعش|اغتيال|خطف|مسلح|اعتقال|القبض|مخدرات|العمال الكردستاني/i],
      ["시위·통제", /시위|집회|통행금지|도로\s?봉쇄|protest|demonstrat|curfew|road closure|تظاهر|احتجاج|حظر التجوال|قطع طرق|اعتصام/i],
      ["휴일·행사", /공휴일|휴무|라마단|아르바인|아슈라|이드|holiday|ramadan|arbaeen|ashura|eid|pilgrim|عطلة|تعطيل|الدوام|رمضان|الأربعين|عاشوراء|عيد|زيارة/i],
      ["정치·선거", /선거|총리|의회|대통령|내각|정부|election|parliament|prime minister|president|cabinet|government|انتخاب|البرلمان|مجلس النواب|رئيس الوزراء|الحكومة|السوداني/i],
      ["전력·생활", /전력|정전|전기|물\s?부족|수도|electricity|power|outage|water|الكهرباء|انقطاع|الماء|المياه/i],
      ["날씨·재난", /모래|먼지|폭염|홍수|지진|dust|sandstorm|heat|flood|earthquake|عاصفة|غبار|ترابية|حرارة|فيضان|زلزال/i],
      ["경제·유가", /유가|원유|석유|디나르|환율|경제|oil|crude|dinar|dollar|economy|budget|نفط|النفط|الدينار|الدولار|اقتصاد|الموازنة/i],
      ["한국·외교", /한국|한화|대사|외교|korea|hanwha|embassy|ambassador|envoy|كوريا|السفارة|سفير/i],
    ],
  },
  // NEWS_CFG=fire : 소방 > 화재 사례 (국내 건설현장·공장·숙소 화재 / 중동 대형 화재, 최근 30일)
  fire: {
    OUT: "fire-news.json", KEEP_DAYS: 30, MAX_ITEMS: 80, BODY_PER_RUN: 15,
    SEARCHES: [
      { lang: "ko", q: "공사현장 화재 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "건설현장 화재 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "(신축 OR 공사장 OR 리모델링 OR 철거) 화재 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "(용접 OR 불티 OR 우레탄 OR 단열재) 화재 when:7d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "(공장 OR 물류창고 OR 기숙사) 화재 근로자 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "(배터리 OR 전동킥보드 OR ESS) 화재 (공장 OR 숙소 OR 현장) when:7d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ar", q: "حريق (بغداد OR العراق) when:3d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "ar", q: "حريق (برج OR مستودع OR سوق OR مصنع OR مستشفى OR مبنى) (السعودية OR الإمارات OR دبي OR الكويت OR قطر OR الأردن) when:7d", hl: "ar", gl: "IQ", ceid: "IQ:ar" },
      { lang: "en", q: "fire (building OR tower OR warehouse OR market OR factory OR hospital OR \"construction site\" OR \"labour camp\") (UAE OR Dubai OR \"Abu Dhabi\" OR Saudi OR Riyadh OR Jeddah OR Kuwait OR Qatar OR Iraq OR Baghdad OR Oman OR Bahrain) when:7d", hl: "en-US", gl: "US", ceid: "US:en" },
    ],
    // 제목에 '불'이 있어야 하고 + 일터·건물을 뜻하는 말이 있어야 한다
    MUST: /화재|불길|불이 나|불나|큰불|불타|전소|폭발|진화|불티|fire|blaze|ablaze|inferno|burn|حريق|حرائق|النيران|اندلاع|احتراق|الحريق/i,
    MUST2: /현장|공사|건설|공장|작업|근로자|노동자|작업자|용접|절단|숙소|기숙사|창고|물류|배터리|공사장|신축|리모델링|철거|타워|빌딩|건물|상가|시장|병원|호텔|플랜트|building|tower|warehouse|market|factory|hospital|site|construction|worker|labou?r|plant|refinery|mall|hotel|high-rise|skyscraper|برج|مستودع|مخزن|سوق|مصنع|معمل|مستشفى|مبنى|عمارة|موقع|فندق|مول|مجمع|دائرة|شركة|محطة|مصفى/i,
    TITLE_ONLY: true,
    // 산불·차량·재판·훈련·전쟁(포격)·'사격(fire)' 기사는 뺀다
    // 점검·협약·대책·교육 같은 예방 행정 기사, 보험·보상 기사, 유럽 등 다른 지역 기사도 뺀다 (실제 일어난 불만)
    NOT: /점검|협약|대책|전수조사|실태조사|표창|사실\s?확인|팩트체크|재공유|예측|전망|인도|붉은 어린이 시장|fact.?check|forecast|India|지원|교육|체험|로봇|과학자|뉴스픽|주요뉴스|안전기준|성능검사|추진|확대|강화|재구성|기획|칼럼|사설|보상금|보험|리얄|insurance|파리|프랑스|유럽|باريس|فرنسا|Paris|France|산불|들불|차량\s?화재|승용차|화재보험|모의|훈련|캠페인|예방\s?교육|선고|징역|재판|판결|기소|주가|특징주|소방관 채용|ceasefire|cease-fire|gunfire|open(ed)? fire|fired|firing|wildfire|forest fire|bushfire|airstrike|missile|drone strike|shelling|إطلاق (ال)?نار|وقف إطلاق|الغابات|غارة|قصف|صاروخ|مسيرة/i,
    GROUP: true, NOT_KO: true,
    TAGS: [
      ["용접·불티", /용접|절단|불티|그라인더|산소절단|welding|spark|لحام/i],
      ["단열재·자재", /우레탄|단열재|샌드위치\s?패널|스티로폼|자재|cladding|insulation|facade|الواجهة|العازل/i],
      ["전기·배터리", /전기|누전|합선|배터리|리튬|전동킥보드|ESS|electrical|short circuit|battery|تماس كهربائي|بطارية|كهربائي/i],
      ["숙소·창고", /숙소|기숙사|창고|물류|warehouse|dormitor|labou?r camp|accommodation|مستودع|مخزن|سكن/i],
      ["고층·건물", /고층|타워|빌딩|오피스텔|아파트|tower|high-rise|skyscraper|apartment|residential|برج|عمارة|مبنى|شقة/i],
      ["공장·플랜트", /공장|플랜트|정유|화학|발전소|factory|plant|refinery|chemical|مصنع|معمل|مصفى|محطة/i],
      ["시장·상가", /시장|상가|백화점|마트|market|mall|souq|souk|سوق|مول|محلات/i],
    ],
  },
  // NEWS_CFG=sa : 상황판 하단 '중대재해 보도' 알림 (국내 산업현장 사망사고 기사, 최근 7일)
  sa: {
    OUT: "sa-news.json", KEEP_DAYS: 7, MAX_ITEMS: 40, BODY_PER_RUN: 12, COMPANY: true,
    SEARCHES: [
      { lang: "ko", q: "건설현장 사망 when:2d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "공사현장 추락 숨져 when:2d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "근로자 사망 중대재해 when:2d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "작업 중 숨져 when:2d", hl: "ko", gl: "KR", ceid: "KR:ko" },
      { lang: "ko", q: "노동부 중대재해 조사 착수 when:3d", hl: "ko", gl: "KR", ceid: "KR:ko" },
    ],
    // 제목에 '사람이 숨졌다'는 말 + 일터를 뜻하는 말이 둘 다 있어야 한다
    //   (2026-10-14: '중대재해'·'매몰'만 있고 사망이 아닌 기사 — 경고등·엄정 대응·부상 등 — 는 뺌)
    MUST: /사망|숨져|숨진|숨지|숨졌|목숨|추락사|질식사|감전사|압사|참변|순직|유명을\s?달리/,
    MUST2: /현장|공사|건설|공장|작업|근로자|노동자|작업자|인부|하청|협력업체|크레인|타워|굴착|비계|사업장|중대재해/,
    TITLE_ONLY: true,
    DOMESTIC: true,   // 국내 사고만 (2026-10-21: 해외 사고·외국 언론 한국어판은 뺌)
    // 재판·처벌·통계·정책·추모 기사, 교통사고·범죄 기사는 뺀다 (새로 일어난 사고만)
    // 동물·맹수 사고, 외국 사건(英·美 등 한자 약칭), 통계·기간 집계, 농사·가족 사고도 뺀다
    NOT: /[①-⑩]|하루\s?\d+명|호랑이|맹수|동물원|사육사|우리에\s?뛰어|英|美|佛|獨|러시아|우크라|영국|프랑스|독일|인도|태국|필리핀|\d+(\.\d+)?\s?%|\d+년간|\d+년\s?동안|부친|모친|아들이|딸이|논에서|논서|밭에서|밭서|의원|역학조사|선고|징역|판결|기소|재판|항소|상고|벌금|집행유예|무죄|유죄|구형|송치|입건|압수수색|토론회|세미나|간담회|포럼|국회|개정안|법안|시행령|통계|분기|상반기|하반기|대책|캠페인|교육|주기|추모|기획|칼럼|사설|인터뷰|교통사고|음주|살인|흉기|자살|극단|실종|등산|낚시|물놀이|해외|중국|미국|일본|베트남|법원|法|대만|타이완|TSMC|홍콩|마카오|싱가포르|말레이|인도네시아|캄보디아|라오스|미얀마|방글라데시|파키스탄|네팔|몽골|카자흐|우즈벡|사우디|이라크|이란|이스라엘|튀르키예|터키|이집트|호주|캐나다|멕시코|브라질|칠레|페루|아르헨|남아공|나이지리아|케냐|스페인|이탈리아|네덜란드|폴란드|스웨덴|노르웨이|핀란드|뉴질랜드|외신|뚜옌꽝|하노이|호찌민|호치민|다낭|베이징|상하이|광둥|도쿄|오사카|산재\s?(불)?인정|업무상\s?재해|유족급여|안전한 일터|\d+\s?(개월|년)여?\s?만에|국감|국정감사|최다|올해|올들어|올 들어|전국서|전국\s|[1-9]\d+명|\d{3,}명|경고등|엄정|도입해야|해야\s?["”']|느는데|늘었|줄었|감소|증가|구멍|실태|점검\s?결과|사망\s?(사고)?\s?\d+건|건설현장\s?사망\s?\d|사망률|만인율|집유|실형|법정구속|금고형|예방|관건|수칙|요령|가이드|노하우|방지책|막으려면/,
  },
};
const CFG = CFGS[process.env.NEWS_CFG || "bismayah"];
const OUT = CFG.OUT;
const KEEP_DAYS = CFG.KEEP_DAYS;   // 이 기간 안의 기사만 남긴다
const MAX_ITEMS = CFG.MAX_ITEMS;   // 최대 몇 건까지 보여 줄지
const BODY_PER_RUN = CFG.BODY_PER_RUN || 30; // 한 번 실행할 때 본문을 새로 가져올 최대 건수
const SEARCHES = CFG.SEARCHES;
const MUST = CFG.MUST;
const NOT = CFG.NOT || null;
const keep = (n) => MUST.test(n.title + (CFG.TITLE_ONLY ? "" : " " + (n._desc || ""))) && (!CFG.MUST2 || CFG.MUST2.test(n.title)) && !(NOT && NOT.test(n.title + " " + (n._desc || "")));
// 기사 제목·본문에서 회사 이름 찾기 (예: 'OO건설 현장서 추락' → OO건설). 못 찾으면 비워 둔다
const CO_RE = /([가-힣A-Za-z0-9&]{1,12}(?:건설|이앤씨|E&C|엔지니어링|중공업|종합건설|산업개발|건영|토건|물산|에코플랜트|플랜트|디앤씨|D&C|하우징|건축))(?=[\s,·…'"’”)\]]|현장|의\s|가\s|서\s|에서|$)/g;
const CO_STOP = /^(대형|중소|지역|민간|공공|해외|국내|종합|전문|하청|원청|협력|모|한|해당|일반|국토|산업|중견|대기업|업계|부실)(건설|건축|플랜트|종합건설)$|^(건설|건축)$/;
function findCompany(text) {
  const out = [];
  for (const m of String(text || "").matchAll(CO_RE)) { const c = m[1].replace(/^[\d]+/, ""); if (c.length >= 3 && !CO_STOP.test(c) && !out.includes(c)) out.push(c); }
  if (!out.length) { const m = String(text || "").match(/([가-힣A-Za-z0-9&]{3,12})\s?(?:하청|협력업체|원청)/); if (m && !/^(건설|공사|현장|업체|회사)/.test(m[1])) out.push(m[1]); }
  return out[0] || "";
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; BismayahHSEBot/1.0)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\u00a0/g, " ");
}
function stripTags(html) { return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : v;
}

async function searchNews({ lang, q, hl, gl, ceid }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`구글 뉴스 응답 ${res.status}`);
  const xml = await res.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((block) => {
    const raw = stripTags(extractTag(block, "title"));
    const m = raw.match(/^(.*)\s-\s([^-]+)$/);
    const d = new Date(stripTags(extractTag(block, "pubDate")));
    return {
      title: m ? m[1].trim() : raw,
      source: m ? m[2].trim() : stripTags(extractTag(block, "source")),
      link: stripTags(extractTag(block, "link")),
      date: isNaN(d.getTime()) ? "" : d.toISOString(),
      lang,
      _desc: stripTags(extractTag(block, "description")),
    };
  }).filter((n) => n.title && n.link);
}

async function translateGtx(text, from) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 900))}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error("gtx " + res.status);
  const j = await res.json();
  return (j[0] || []).map((x) => x[0]).join("").trim();
}
async function translateMyMemory(text, from) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from}|ko`;
  const j = await (await fetch(url, { headers: UA })).json();
  const t = j && j.responseData && j.responseData.translatedText;
  if (j.responseStatus != 200 || !t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return "";
  return decodeEntities(t);
}
// ---- AI 번역 (Claude) — ANTHROPIC_API_KEY 시크릿이 있으면 먼저 쓰고, 없거나 실패하면 구글 번역 ----
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const RETRANSLATE = process.env.RETRANSLATE === "1"; // 예전 기사까지 AI로 다시 번역 (한 번만 쓰는 옵션)
const CLAUDE_MAX_CALLS = RETRANSLATE ? 220 : 80; // 한 번 실행에 최대 호출 수 (비용 안전장치)
let claudeCalls = 0, claudeOff = false;
const LANG_NAME = { ar: "아랍어", en: "영어", ko: "한국어", fr: "프랑스어", ku: "쿠르드어" };
const CLAUDE_SYSTEM = [
  "너는 이라크 비스마야 신도시 건설현장(한화 시공)의 한국인 안전·보건 담당자에게 외국 뉴스를 전달하는 번역가다.",
  "규칙:",
  "- 자연스러운 한국어 뉴스 문체로 옮긴다. 제목은 한국 신문 제목처럼 짧고 명확하게, 본문은 '~했다' 체로.",
  "- 뜻을 더하거나 빼지 말고, 원문에 없는 해석·설명·따옴표·머리말을 붙이지 않는다. 번역문만 출력한다.",
  "- 고유명사: بسماية/Bismayah → 비스마야, 한화/Hanwha → 한화, بغداد → 바그다드, البصرة → 바스라, أربيل → 아르빌, النجف → 나자프, كربلاء → 카르발라, الموصل → 모술, كركوك → 키르쿠크, الأنبار → 안바르, الديوانية → 디와니야, ديالى → 디얄라, صلاح الدين → 살라딘, ذي قار → 디카르, الناصرية → 나시리야, ميسان → 미산, العمارة → 아마라, واسط → 와시트, الكوت → 쿠트, المثنى → 무탄나, بابل → 바빌, الحلة → 힐라, دهوك → 두후크, السليمانية → 술라이마니야, نينوى → 니네베, الفلوجة → 팔루자, الرمادي → 라마디, سامراء → 사마라, تكريت → 티크리트.",
  "- 지명을 확실히 모르면 아랍어 발음대로 한글로 적고, 비슷한 다른 지명으로 바꾸지 않는다.",
  "- 기관명은 한국 언론 관례대로: وزارة الصحة → 보건부, وزارة الداخلية → 내무부, الدفاع المدني → 민방위(소방당국), هيئة النزاهة → 청렴위원회, رئيس الوزراء → 총리, الهيئة الوطنية للاستثمار/هيئة الاستثمار(National Investment Commission) → 국가투자위원회(NIC), رئيس هيئة الاستثمار → 국가투자위원회 위원장, مشروع بسماية → 비스마야 신도시 사업, الشركة المنفذة → 시공사, مستحقات → 미수금, دفعة → 분할금.",
  "- 주의: لجنة الاستثمار والتنمية النيابية(의회 위원회)는 '의회 투자개발위원회'로, 정부 기관인 국가투자위원회와 구분한다. مجلس النواب → 이라크 의회(국회). مصرف الرافدين → 라피다인은행, مصرف الرشيد → 라시드은행. هانوا/هانوها/هانوا الكورية → 한화.",
  "- 질병명은 의학 용어로: plague → 페스트, cholera → 콜레라, haemorrhagic fever(Crimean-Congo) → 크림-콩고 출혈열.",
  "- 사람 이름은 현지 발음대로 한글로 적는다. 숫자·날짜·단위는 그대로 살린다.",
  "- 입력에 줄바꿈이 있으면 같은 줄 구조를 유지한다.",
].join("\n");
async function translateClaude(text, from, kind) {
  if (!CLAUDE_KEY || claudeOff || claudeCalls >= CLAUDE_MAX_CALLS) return "";
  claudeCalls++;
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: kind === "body" ? 1500 : 200, temperature: 0, system: CLAUDE_SYSTEM,
        messages: [{ role: "user", content: `다음 ${LANG_NAME[from] || from} 뉴스 ${kind === "body" ? "본문 발췌" : "제목"}을 한국어로 번역해 줘.\n\n${text}` }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`::warning::AI 번역 실패 ${res.status}: ${(j.error && j.error.message) || ""}`.slice(0, 300));
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /credit|balance|billing/i.test(JSON.stringify(j)))) claudeOff = true; // 키·잔액 문제면 이번 실행은 구글로
      return "";
    }
    return ((j.content || []).map((c) => c.text || "").join("") || "").trim();
  } catch (e) { return ""; } finally { clearTimeout(tm); }
}
async function translate(text, from, kind) {
  try { const t = await translateClaude(text, from, kind || "title"); if (t) return t; } catch (e) { /* 아래로 */ }
  try { const t = await translateGtx(text, from); if (t) return t; } catch (e) { /* 아래로 */ }
  try { return await translateMyMemory(text, from); } catch (e) { return ""; }
}

// 구글 뉴스 주소(news.google.com/rss/articles/…)를 실제 기사 주소로 바꾼다
async function resolveGoogle(link) {
  const m = String(link).match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/);
  if (!m) return link;
  const id = m[1];
  try {
    const page = await (await fetch(`https://news.google.com/articles/${id}`, { headers: UA })).text();
    const sg = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return link;
    const req = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]), null, "generic"]]];
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "f.req=" + encodeURIComponent(JSON.stringify(req)),
    });
    const txt = await res.text();
    const part = txt.split("\n\n")[1];
    const url = JSON.parse(JSON.parse(part)[0][2])[1];
    return /^https?:\/\//.test(url) ? url : link;
  } catch (e) {
    return link;
  }
}

// 기사 페이지에서 본문 앞부분(요약 + 첫 문단 몇 개)만 뽑는다 (전문이 아니라 미리보기용 발췌)
async function articleText(url) {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept-Language": "ko,ar;q=0.8,en;q=0.7" }, redirect: "follow", signal: ctl.signal });
    clearTimeout(tm);
    if (!res.ok) return "";
    let html = await res.text();
    const clean = (t) => decodeEntities(String(t).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const og = clean((html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i) || [])[1] || "");
    html = html.replace(/<(script|style|nav|header|footer|aside|form|noscript|figure)[\s\S]*?<\/\1>/gi, " ");
    const art = html.match(/<article[\s\S]*?<\/article>/i);
    if (art) html = art[0];
    const paras = (html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []).map(clean).filter((t) =>
      t.length > 50 && /[.!?؟。다]/.test(t) && t.split(" ").length >= 7 &&
      !/cookie|copyright|©|subscribe|javascript|all rights reserved|جميع الحقوق|무단 ?전재|재배포 ?금지|기자\s*[a-z0-9._%+-]+@/i.test(t));
    let text = og && og.length > 40 ? og : "";
    for (const t of paras) {
      if (text.length > 800) break;
      if (!text.includes(t.slice(0, 40))) text += (text ? "\n" : "") + t;
    }
    return text.slice(0, 1000);
  } catch (e) {
    return "";
  }
}

// 긴 글 번역: 문단별로 잘라서 번역 (주소 길이 제한 때문에)
async function translateLong(text, from) {
  // AI 번역이 되면 본문을 한 번에 (문맥을 살려서)
  if (CLAUDE_KEY && !claudeOff) { const t = await translateClaude(text, from, "body"); if (t) return t; }
  const out = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) continue;
    out.push((await translate(para, from)) || "");
    await sleep(250);
  }
  return out.filter(Boolean).join("\n");
}

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf-8")).items || []; } catch (e) { return []; }
}

async function main() {
  const prev = loadPrev();
  const prevKo = new Map(prev.filter((n) => n.titleKo).map((n) => [n.link, n.titleKo]));
  const found = [];
  let ok = 0;
  for (const s of SEARCHES) {
    try {
      const items = (await searchNews(s)).filter(keep);
      console.log(`[${s.lang}] "${s.q}" → ${items.length}건`);
      found.push(...items);
      ok++;
    } catch (err) {
      console.log(`::warning::[${s.lang}] "${s.q}" 실패: ${err.message}`);
    }
    await sleep(900);
  }
  if (!ok) {
    console.error("[오류] 모든 검색에 실패했습니다. 기존 파일을 유지합니다.");
    process.exit(prev.length ? 0 : 1);
  }

  // 새로 찾은 것 + 예전 것(기간 안) → 중복 제거 → 최신순
  const since = Date.now() - KEEP_DAYS * 86400000;
  const seenLink = new Set(), seenTitle = new Set();
  const list = [...found, ...prev.filter(keep)].filter((n) => {
    const t = n.date ? Date.parse(n.date) : Date.now();
    if (t < since) return false;
    const k = n.title.replace(/[\s\-–—|:"'«»]+/g, "").slice(0, 50);
    if (seenLink.has(n.link) || seenTitle.has(k)) return false;
    seenLink.add(n.link); seenTitle.add(k);
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, MAX_ITEMS);

  let translated = 0, bodies = 0;
  const tkey = (t) => String(t || "").replace(/[\s\-–—|:"'«»]+/g, "").slice(0, 50);
  // 번역 기억장치: 같은 사건 묶음·제외 단어로 화면에서 빠진 기사도 번역은 기억해 둬서 다음 실행에 다시 번역하지 않는다
  const CACHE_FILE = `cache/tr-${OUT.replace(/\.json$/, "")}.json`;
  let trCache = []; try { trCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); } catch (e) { trCache = []; }
  if (RETRANSLATE) trCache = [];
  const prevByLink = new Map(trCache.map((n) => [n.link, n]).concat(prev.map((n) => [n.link, n])));
  const prevByTitle = new Map(trCache.map((n) => [n.k, n]).concat(prev.map((n) => [tkey(n.title), n])));
  for (const n of list) {
    delete n._desc;
    const old = prevByLink.get(n.link) || prevByTitle.get(tkey(n.title)) || {};
    if (n.lang === "ko") n.titleKo = n.title;
    else {
      n.titleKo = RETRANSLATE && CLAUDE_KEY ? "" : (n.titleKo || old.titleKo || prevKo.get(n.link) || "");
      if (!n.titleKo) {
        n.titleKo = await translate(n.title, n.lang);
        if (n.titleKo) translated++;
        await sleep(350);
      }
    }
    // 본문 미리보기: 예전에 가져온 게 있으면 그대로, 없으면 이번에 가져온다 (한 번에 최대 BODY_PER_RUN건)
    const tidy = (t) => decodeEntities(t || "").replace(/&#\d*;?/g, " ").replace(/[ \t]+/g, " ").trim();
    if (old.body !== undefined && old.tried) {
      n.url = old.url; n.body = tidy(old.body); n.bodyKo = tidy(old.bodyKo); n.tried = true;
      if (RETRANSLATE && CLAUDE_KEY && n.body && n.lang !== "ko") { const t = await translateLong(n.body, n.lang); if (t) n.bodyKo = tidy(decodeEntities(t)); }
      continue;
    }
    if (bodies >= BODY_PER_RUN) continue;
    bodies++;
    n.url = await resolveGoogle(n.link);
    n.body = n.url !== n.link || !/news\.google\.com/.test(n.url) ? await articleText(n.url) : "";
    n.bodyKo = n.body ? (n.lang === "ko" ? n.body : await translateLong(n.body, n.lang)) : "";
    n.bodyKo = decodeEntities(n.bodyKo).replace(/&#\d*;?/g, " ");
    n.tried = true;
    console.log(`  본문 ${n.body ? n.body.length + "자" : "못 가져옴"} · ${n.url.slice(0, 80)}`);
    await sleep(500);
  }
  try {
    const seenK = new Set();
    const snap = list.filter((n) => n.lang !== "ko" && n.titleKo).map((n) => ({ k: tkey(n.title), link: n.link, date: n.date, titleKo: n.titleKo, url: n.url, body: n.body, bodyKo: n.bodyKo, tried: n.tried }))
      .concat(trCache).filter((n) => !seenK.has(n.k) && seenK.add(n.k) && (!n.date || Date.parse(n.date) > Date.now() - (KEEP_DAYS + 3) * 86400000)).slice(0, 400);
    fs.mkdirSync("cache", { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(snap));
  } catch (e) { console.log("번역 기억장치 저장 실패:", e.message); }
  // 자동 번역이 자주 틀리는 낱말 바로잡기 (예: plague → '전염병'이 아니라 '페스트')
  const FIX = [[/plague/i, /전염병|흑사병/g, "페스트"]];
  list.forEach((n) => FIX.forEach(([src, bad, good]) => {
    if (n.lang !== "ko" && src.test(n.title) && n.titleKo && !n.titleKo.includes(good)) n.titleKo = n.titleKo.replace(bad, good);
  }));
  // 바꾼 낱말 뒤 조사 맞추기 (페스트은 → 페스트는, 페스트으로 → 페스트로 …)
  list.forEach((n) => { if (n.titleKo) n.titleKo = n.titleKo.replace(/페스트은/g, "페스트는").replace(/페스트으로/g, "페스트로").replace(/페스트을/g, "페스트를").replace(/페스트과/g, "페스트와").replace(/페스트이(?=[\s,.]|$)/g, "페스트가"); });
  // 회사 이름 (제목에서 먼저, 없으면 본문 앞부분에서) – 언론 보도에 나온 이름 그대로
  if (CFG.COMPANY) list.forEach((n) => { n.company = findCompany(n.title) || findCompany(String(n.body || "").slice(0, 400)); });
  // 같은 사고를 여러 언론이 쓴 기사는 하나로 묶는다 (대표 기사 + 보도 건수)
  if (CFG.COMPANY) {
    const STOP = new Set("사망 숨져 숨진 숨지고 부상 중상 사고 사망사고 노동자 근로자 작업자 현장 공사장 공사 건설현장 조사 위반 여부 중대재해 중대재해법 중처법 노동부 발생 시공 1명 2명 3명 40대 50대 60대 70대 맞아 맞은 다쳐 사상 이동 중 경찰 착수 수사".split(" "));
    const norm = (c) => String(c || "").replace(/^디엘/, "DL").replace(/^지에스/, "GS").replace(/^에이치디씨/, "HDC").toUpperCase();
    const toks = (t) => (String(t).match(/[가-힣A-Za-z0-9]{2,}/g) || []).map((w) => w.replace(/(에서|으로|서|에|의|로|가|이|은|는|을|를)$/, "")).filter((w) => w.length >= 2 && !STOP.has(w));
    const groups = [];
    for (const n of list) {
      const tk = toks(n.title), first = tk.slice(0, 2), co = norm(n.company), t = Date.parse(n.date);
      const g = groups.find((g) => {
        if (Math.abs(g.t - t) > 48 * 3600000) return false;
        const share = tk.filter((w) => g.tk.has(w)).length;
        return share >= 2 || (co && g.co === co && share >= 1) || (Math.abs(g.t - t) < 24 * 3600000 && first.some((w) => g.first.has(w)));
      });
      if (g) { g.items.push(n); tk.forEach((w) => g.tk.add(w)); first.forEach((w) => g.first.add(w)); if (!g.co && co) g.co = co; }
      else groups.push({ t, co, tk: new Set(tk), first: new Set(first), items: [n] });
    }
    list.length = 0;
    groups.forEach((g) => {
      const rep = g.items.find((n) => n.company) || g.items[0];
      rep.count = g.items.length;
      rep.firstDate = g.items[g.items.length - 1].date;
      rep.date = g.items[0].date;                 // 가장 최근 보도 시각
      rep.sources = [...new Set(g.items.map((n) => n.source).filter(Boolean))].slice(0, 6);
      if (!rep.company) rep.company = (g.items.find((n) => n.company) || {}).company || "";
      list.push(rep);
    });
  }
  // 제목 앞뒤에 붙은 매체 이름 떼기 ('샤팍뉴스..', 'INA / ', ' - Al-Monitor')
  if (CFG.GROUP) list.forEach((n) => {
    const cl = (t) => String(t || "").replace(/^(샤[팍팩파]\s?뉴스|샤파크나|트와일라잇\s?뉴스|황혼\s?뉴스|Shafaq News|شفق نيوز|السومرية نيوز|INA|이나|IQ News|Rudaw|루다우|Kurdistan24|쿠르디스탄24)\s*(\.\.|\/|:|-|·|…)\s*/i, "").replace(/\s[-–|]\s[^-–|]{2,40}$/, "").replace(/\s+/g, " ").trim();
    n.titleKo = cl(n.titleKo || n.title); if (n.lang !== "ko") n.title = cl(n.title);
  });
  // 같은 사건을 여러 매체가 쓴 기사 묶기 (제목 낱말이 많이 겹치고 3일 안이면 같은 사건)
  if (CFG.GROUP) {
    const STOP = new Set("이라크 이라크의 이라크는 이라크가 이라크에 바그다드 바그다드에서 및 그리고 위해 대한 있다 있는 했다 밝혔다 말했다 따르면 새로운 관련 통해 위한 것으로 중 등 북부 남부 동부 서부 캠프 소식통 전했습니다 관계자 보고서 따라 the of in and to for on with iraq iraqi baghdad".split(" "));
    const toks = (t) => [...new Set((String(t).toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || []).map((w) => w.replace(/(에서|으로|에게|과의|와의|과|와|의|을|를|이|가|은|는|에|로|도)$/, "")).filter((w) => w.length >= 2 && !STOP.has(w)))];
    const sim = (a, b) => { const sh = a.filter((w) => b.includes(w)).length; return sh >= 2 && sh / Math.min(a.length, b.length) >= 0.4; };
    const groups = [];
    for (const n of list) {
      const tk = toks(n.titleKo || n.title), t = Date.parse(n.date) || Date.now();
      const g = groups.find((g) => Math.abs(g.t - t) < 72 * 3600000 && g.tks.some((b) => sim(tk, b)));
      if (g) { g.items.push(n); g.tks.push(tk); } else groups.push({ t, tks: [tk], items: [n] });
    }
    list.length = 0;
    groups.forEach((g) => {
      // 대표 기사: 한국어 기사 → 본문 있는 것 → 제목이 짧은 것
      const rep = g.items.slice().sort((a, b) => (b.lang === "ko") - (a.lang === "ko") || (!!b.bodyKo) - (!!a.bodyKo) || (a.titleKo || "").length - (b.titleKo || "").length)[0];
      rep.count = g.items.length;
      rep.date = g.items.map((n) => n.date).sort().pop();
      rep.sources = [...new Set(g.items.map((n) => n.source).filter(Boolean))].slice(0, 6);
      rep.related = g.items.filter((n) => n !== rep).slice(0, 5).map((n) => ({ titleKo: n.titleKo, source: n.source, link: (n.url && !/news\.google\.com/.test(n.url)) ? n.url : n.link }));
      list.push(rep);
    });
    list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  // 분류 표시 (CFG.TAGS 가 있을 때만)
  // 번역된 한국어 제목으로도 한 번 더 거른다 (아랍어 원문으로는 '보험·파리' 같은 낱말을 못 잡으므로)
  if (CFG.NOT_KO && NOT) for (let i = list.length - 1; i >= 0; i--) if (NOT.test(list[i].titleKo || "")) list.splice(i, 1);
  if (CFG.TAGS) list.forEach((n) => { const t = n.title + " " + (n.titleKo || "") + " " + (n.related || []).map((r) => r.titleKo).join(" "); const hit = CFG.TAGS.find(([, re]) => re.test(t)); n.tag = hit ? hit[0] : "기타"; });
  // 바로 가는 원문 주소가 있으면 그걸 링크로 쓴다
  list.forEach((n) => { if (n.url && !/news\.google\.com/.test(n.url)) n.link = n.url; });
  // 국내 사고만: 외국 언론의 한국어판(.vn·.cn 등), 국제면(/world/·/international/) 기사, 외국 지명이 든 기사는 뺀다
  if (CFG.DOMESTIC) {
    const FOREIGN_HOST = /\.(vn|cn|jp|tw|hk|ru|kz|uz|mn|id|th|ph|my|sg|in)(\/|$)|laodong|vietnamplus|nhandan|vov\.|xinhua|people\.com|chinadaily|cri\.cn|sputnik|nippon/i;
    const FOREIGN_PATH = /\/(world|international|global|foreign|overseas|inter)\//i;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i], u = String(n.link || "");
      if (FOREIGN_HOST.test(u) || FOREIGN_PATH.test(u) || (NOT && NOT.test(n.titleKo || ""))) list.splice(i, 1);
    }
  }

  // 현장 알림 뽑기 (CFG.ALERTS)
  let alerts;
  if (CFG.ALERTS) {
    const A = CFG.ALERTS, lim = Date.now() - A.HOURS * 3600000;
    alerts = [];
    for (const n of list) {
      if (Date.parse(n.date) < lim) continue;
      const t = [n.title, n.titleKo].concat((n.related || []).map((r) => r.titleKo)).join(" ");
      const kind = A.holiday.test(t) ? "holiday" : A.control.test(t) ? "control" : "";
      if (!kind) continue;
      const here = A.HERE.test(n.title + " " + n.titleKo);
      const otherOnly = A.OTHER.test(n.title + " " + n.titleKo) && !/بغداد|baghdad|바그다드|جميع المحافظات|عموم العراق|nationwide|전국/i.test(n.title + " " + n.titleKo);
      if (!here || otherOnly) continue;
      alerts.push({ kind, titleKo: n.titleKo, title: n.title, link: n.link, source: n.source, date: n.date, count: n.count || 1 });
      if (kind === "holiday") n.tag = "휴일·행사"; else n.tag = "시위·통제";
    }
    alerts = alerts.slice(0, 4);
    console.log(`현장 알림 ${alerts.length}건`, alerts.map((a) => a.kind + ":" + a.titleKo).join(" / "));
  }
  const out = { generatedAt: new Date().toISOString(), items: list };
  if (alerts) out.alerts = alerts;
  // 현장 영향 판단 (이라크 주요 이슈만)
  if (CFG.IMPACT) {
    const { assess, brief } = require("./iraq-impact.js");
    list.forEach((n) => { n.impact = assess(n); });
    out.brief = brief(list);
    const c = { r: 0, y: 0, g: 0 }; list.forEach((n) => { c[n.impact.lv]++; });
    console.log(`현장 영향: 즉시 주의 ${c.r} · 지켜볼 것 ${c.y} · 참고 ${c.g} · 브리핑 ${out.brief.length}건`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  const by = (l) => list.filter((n) => n.lang === l).length;
  console.log(`::notice::번역: AI ${claudeCalls}회${CLAUDE_KEY ? (claudeOff ? " (AI 막힘 → 구글로 대체)" : "") : " (키 없음 → 구글)"} · 새 제목 ${translated}건`);
  console.log(`저장 완료: 총 ${list.length}건 (한국어 ${by("ko")} · 아랍어 ${by("ar")} · 영어 ${by("en")}) · 새로 번역 ${translated}건 · 본문 있음 ${list.filter((n) => n.body).length}건 · AI 번역 호출 ${claudeCalls}회${CLAUDE_KEY ? "" : " (키 없음 → 구글 번역)"}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
