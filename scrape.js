// scrape.js
// Kariyer.net + Indeed + Eleman.net + Yenibiriş'te belirli kategorilerde
// arama yapar, bulduğu ilanları Firebase Realtime Database'e yazar.
// GitHub Actions tarafından zamanlanmış olarak (her 6 saatte) çalışır.
//
// NOT: LinkedIn buraya BİLEREK eklenmedi. LinkedIn'in kullanım
// şartları otomatik veri toplamayı (scraping) açıkça yasaklıyor ve
// bunu hukuki yollarla uyguladığı bilinen bir platform.
//
// İstekler r.jina.ai ücretsiz "reader" servisi üzerinden yapılıyor
// çünkü hedef siteler doğrudan otomatik isteklere HTTP 403 dönebiliyor.

const FIREBASE_URL = 'https://berk-job-portal-default-rtdb.europe-west1.firebasedatabase.app';
const READER_PREFIX = 'https://r.jina.ai/';

const KARIYER_URLS = [
  'https://www.kariyer.net/is-ilanlari/depo+muduru',
  'https://www.kariyer.net/is-ilanlari/istanbul-depo+sorumlusu',
  'https://www.kariyer.net/is-ilanlari/istanbul-lojistik+uzmani',
  'https://www.kariyer.net/is-ilanlari/istanbul-lojistik',
  'https://www.kariyer.net/is-ilanlari/istanbul-sevkiyat+sorumlusu',
  'https://www.kariyer.net/is-ilanlari/istanbul-depo+operasyon+sorumlusu'
];

const INDEED_URLS = [
  'https://tr.indeed.com/q-depo-sorumlusu-l-istanbul-is-ilanlari.html',
  'https://tr.indeed.com/q-depo-operasyon-l-istanbul-is-ilanlari.html',
  'https://tr.indeed.com/q-lojistik-uzman%C4%B1-l-istanbul-is-ilanlari.html',
  'https://tr.indeed.com/q-sevkiyat-sorumlusu-l-istanbul-is-ilanlari.html'
];

const ELEMAN_URLS = [
  'https://www.eleman.net/is-ilanlari/istanbul-avrupa/depo-elemani',
  'https://www.eleman.net/is-ilanlari/istanbul-anadolu/depo-elemani',
  'https://www.eleman.net/is-ilanlari/istanbul/depo'
];

const YENIBIRIS_URLS = [
  'https://www.yenibiris.com/is-ilanlari/depo-sorumlusu',
  'https://www.yenibiris.com/is-ilanlari/depo-sevkiyat-sorumlusu',
  'https://www.yenibiris.com/is-ilanlari/depo-ve-lojistik-sorumlusu',
  'https://www.yenibiris.com/is-ilanlari/depo-sefi'
];

const EXCLUDE_LOCATIONS = ['kocaeli', 'gebze'];

// Bu ifadelerden biri geçen ilan kaldırılmış/kapanmış demektir, dahil etme
const STALE_MARKERS = [
  'yayından kaldırılmıştır',
  'ilan yayından kaldırıldı',
  'başvuru kapandı',
  'bu ilan artık aktif değil'
];

const SKILL_KEYWORDS = [
  'sap', 'wms', 'logo tiger', 'nebim', 'depo', 'lojistik', 'stok',
  'envanter', 'sevkiyat', 'operasyon', 'müdür', 'yönetici', 'sorumlu', 'uzman'
];

const KNOWN_LOCATIONS = [
  'İstanbul Avrupa Yakası', 'İstanbul Anadolu Yakası',
  'İstanbul Avrupa', 'İstanbul Anadolu',
  'İstanbul(Asya)', 'İstanbul(Avr.)', 'İstanbul'
];

function scoreMatch(text) {
  var lower = text.toLowerCase();
  var score = 60;
  SKILL_KEYWORDS.forEach(function (kw) {
    if (lower.indexOf(kw) !== -1) score += 4;
  });
  return Math.min(score, 98);
}

function isExcludedLocation(text) {
  var lower = text.toLowerCase();
  return EXCLUDE_LOCATIONS.some(function (loc) { return lower.indexOf(loc) !== -1; });
}

function isStale(text) {
  var lower = text.toLowerCase();
  return STALE_MARKERS.some(function (marker) { return lower.indexOf(marker) !== -1; });
}

async function fetchViaReader(url) {
  var readerUrl = READER_PREFIX + url;
  try {
    var res = await fetch(readerUrl, { headers: { 'Accept': 'text/plain' } });
    if (!res.ok) {
      console.log('HATA: ' + url + ' -> Reader HTTP ' + res.status);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log('HATA (fetch): ' + url + ' -> ' + err.message);
    return null;
  }
}

// ---------- KARİYER.NET ----------
function extractKariyerJobs(markdown) {
  var jobs = [];
  if (!markdown) return jobs;
  var linkRegex = /\[([^\]]{5,300})\]\((https:\/\/www\.kariyer\.net\/is-ilani\/[a-z0-9\-]+)\)/gi;
  var match, seen = {};
  while ((match = linkRegex.exec(markdown)) !== null) {
    var text = match[1].replace(/\s+/g, ' ').trim();
    var url = match[2];
    if (seen[url] || isExcludedLocation(text) || isStale(text)) continue;
    seen[url] = true;
    jobs.push(parseKariyerFields(text, url));
  }
  return jobs;
}

function parseKariyerFields(rawText, url) {
  var text = rawText;
  var age = 'Yeni';
  var ageMatch = text.match(/(Son gün|(\d+)\s*(gün|saat|ay))\s*$/i);
  if (ageMatch) {
    age = ageMatch[0].trim();
    text = text.slice(0, ageMatch.index).trim();
  }
  text = text.replace(/(Tam zamanlı|Dönemsel\s*\/?\s*Proje bazlı|Yarı zamanlı|Serbest Zamanlı)\s*(\*update\*)?\s*$/i, '').trim();
  text = text.replace(/Ort\.\s*\d+\s*günde dönüyor/i, '').trim();

  var location = 'İstanbul';
  var locMatch = text.match(/(İstanbul(?:\(Asya\)|\(Avr\.\))?)\s*(İş Yerinde|Uzaktan\s*\/?\s*Remote|Hibrit)/i);
  if (locMatch) {
    location = locMatch[1];
    text = text.slice(0, locMatch.index).trim();
  } else {
    text = text.replace(/(İş Yerinde|Uzaktan\s*\/?\s*Remote|Hibrit)\s*$/i, '').trim();
  }

  var words = text.split(' ').filter(Boolean);
  var companyGuessLen = Math.min(4, Math.max(1, Math.floor(words.length / 3)));
  var company = words.slice(0, companyGuessLen).join(' ') || 'Bilinmiyor';

  return { company: company, position: text || rawText, location: location, age: age, url: url, match: scoreMatch(rawText), source: 'Kariyer.net' };
}

// ---------- INDEED ----------
function extractIndeedJobs(markdown) {
  var jobs = [];
  if (!markdown) return jobs;
  var linkRegex = /\[([^\]]{5,200})\]\((https:\/\/tr\.indeed\.com\/(?:rc\/clk|pagead\/clk|viewjob)\?[^\)]*jk=([a-f0-9]+)[^\)]*)\)\s*([^\n\[]{0,150})/gi;
  var match, seen = {};
  while ((match = linkRegex.exec(markdown)) !== null) {
    var position = match[1].replace(/\s+/g, ' ').trim();
    var jk = match[3];
    var trailing = (match[4] || '').replace(/\s+/g, ' ').trim();
    var cleanUrl = 'https://tr.indeed.com/viewjob?jk=' + jk;
    var fullText = position + ' ' + trailing;
    if (seen[jk] || isExcludedLocation(fullText) || isStale(fullText)) continue;
    seen[jk] = true;
    var parts = trailing.split(/\s{2,}/).filter(Boolean);
    jobs.push({
      company: parts[0] || 'Bilinmiyor',
      position: position,
      location: parts[1] || 'İstanbul',
      age: 'Yeni',
      url: cleanUrl,
      match: scoreMatch(fullText),
      source: 'Indeed'
    });
  }
  return jobs;
}

// ---------- ELEMAN.NET & YENİBİRİŞ (ortak mantık) ----------
// Bu iki site kart metinlerini genelde şu şekilde diziyor:
//   "{Şirket} - {Bölge} - {İlçe} {POZİSYON} {açıklama önizlemesi...}"
// Kesin sınırlar garanti değil; bu yüzden bilinen bölge isimlerini
// referans noktası olarak kullanıp şirket/konum/pozisyonu ayırıyoruz.
function parseRegionalCardFields(rawText, url, sourceName) {
  var text = rawText.replace(/\s+/g, ' ').trim();

  // "Giriş Metni", "İŞ İLANI" gibi site şablon ifadelerini temizle
  text = text.replace(/İŞ İLANI/gi, '').replace(/Giriş Metni/gi, '').trim();

  var company = 'Bilinmiyor';
  var location = 'İstanbul';
  var position = text;

  // Önce " - " ile ayrılmış ilk parçayı şirket adı olarak dene
  var dashParts = text.split(' - ');
  if (dashParts.length >= 2) {
    company = dashParts[0].trim();
    var rest = dashParts.slice(1).join(' - ').trim();

    // Bilinen bölge isimlerinden birini ara
    var foundLoc = null;
    for (var i = 0; i < KNOWN_LOCATIONS.length; i++) {
      var loc = KNOWN_LOCATIONS[i];
      if (rest.indexOf(loc) === 0 || rest.indexOf(' ' + loc) !== -1 && rest.indexOf(loc) < 40) {
        foundLoc = loc;
        break;
      }
    }
    if (foundLoc) {
      location = foundLoc;
      var idx = rest.indexOf(foundLoc);
      position = rest.slice(idx + foundLoc.length).replace(/^[\s\-]+/, '').trim();
    } else {
      position = rest;
    }
  }

  // Pozisyon metni çok uzunsa (açıklama karışmışsa) ilk 120 karakterle sınırla
  if (position.length > 120) {
    position = position.slice(0, 120).trim() + '…';
  }
  if (!position) position = text;

  return {
    company: company,
    position: position,
    location: location,
    age: 'Yeni',
    url: url,
    match: scoreMatch(rawText),
    source: sourceName
  };
}

function extractElemanJobs(markdown) {
  var jobs = [];
  if (!markdown) return jobs;
  var linkRegex = /\[([^\]]{5,350})\]\((https:\/\/www\.eleman\.net\/is-ilani\/[a-z0-9\-]+-i\d+)\)/gi;
  var match, seen = {};
  while ((match = linkRegex.exec(markdown)) !== null) {
    var text = match[1].replace(/\s+/g, ' ').trim();
    var url = match[2];
    if (seen[url] || isExcludedLocation(text) || isStale(text)) continue;
    seen[url] = true;
    jobs.push(parseRegionalCardFields(text, url, 'Eleman.net'));
  }
  return jobs;
}

function extractYenibirisJobs(markdown) {
  var jobs = [];
  if (!markdown) return jobs;
  var linkRegex = /\[([^\]]{5,350})\]\((https:\/\/www\.yenibiris\.com\/is-ilani\/[a-z0-9\-]+\/\d+)\)/gi;
  var match, seen = {};
  while ((match = linkRegex.exec(markdown)) !== null) {
    var text = match[1].replace(/\s+/g, ' ').trim();
    var url = match[2];
    if (seen[url] || isExcludedLocation(text) || isStale(text)) continue;
    seen[url] = true;
    jobs.push(parseRegionalCardFields(text, url, 'Yenibiriş'));
  }
  return jobs;
}

async function scrapeSite(urls, extractFn, siteName) {
  var results = [];
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    console.log('[' + siteName + '] Taranıyor: ' + url);
    var markdown = await fetchViaReader(url);
    var found = extractFn(markdown);
    console.log('  -> ' + found.length + ' ilan bulundu');
    results = results.concat(found);
    await new Promise(function (r) { setTimeout(r, 3000); });
  }
  return results;
}

async function main() {
  var kariyerJobs = await scrapeSite(KARIYER_URLS, extractKariyerJobs, 'Kariyer.net');
  var indeedJobs = await scrapeSite(INDEED_URLS, extractIndeedJobs, 'Indeed');
  var elemanJobs = await scrapeSite(ELEMAN_URLS, extractElemanJobs, 'Eleman.net');
  var yenibirisJobs = await scrapeSite(YENIBIRIS_URLS, extractYenibirisJobs, 'Yenibiriş');

  var allJobs = kariyerJobs.concat(indeedJobs, elemanJobs, yenibirisJobs);

  var uniqueByUrl = {};
  allJobs.forEach(function (job) { uniqueByUrl[job.url] = job; });
  var finalJobs = Object.values(uniqueByUrl);

  finalJobs.sort(function (a, b) { return b.match - a.match; });
  finalJobs = finalJobs.slice(0, 60);

  finalJobs.forEach(function (job, idx) {
    job.id = idx + 1;
    job.scrapedAt = new Date().toISOString();
  });

  console.log('TOPLAM benzersiz ilan: ' + finalJobs.length +
    ' (Kariyer.net: ' + kariyerJobs.length +
    ', Indeed: ' + indeedJobs.length +
    ', Eleman.net: ' + elemanJobs.length +
    ', Yenibiriş: ' + yenibirisJobs.length + ')');

  if (finalJobs.length === 0) {
    console.log('UYARI: Hiç ilan bulunamadı. Firebase güncellenmedi (eski veriler korunuyor).');
    return;
  }

  var jobsObject = {};
  finalJobs.forEach(function (job) { jobsObject[job.id] = job; });

  var putRes = await fetch(FIREBASE_URL + '/jobs.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobsObject)
  });

  if (putRes.ok) {
    console.log('Firebase güncellendi: ' + finalJobs.length + ' ilan yazıldı.');
  } else {
    console.log('HATA: Firebase yazma başarısız. HTTP ' + putRes.status);
    console.log(await putRes.text());
    process.exit(1);
  }
}

main().catch(function (err) {
  console.log('BEKLENMEYEN HATA: ' + err.message);
  process.exit(1);
});
