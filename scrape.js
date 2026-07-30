// scrape.js
// Kariyer.net'te belirli kategorilerde arama yapar, bulduğu ilanları
// Firebase Realtime Database'e yazar. GitHub Actions tarafından
// zamanlanmış olarak (örn. her 6 saatte) çalıştırılır.
//
// NOT: Kariyer.net doğrudan otomatik isteklere HTTP 403 ile karşılık
// veriyor (bot koruması). Bu yüzden istekleri ücretsiz r.jina.ai
// "reader" servisi üzerinden yapıyoruz - bu servis sayfayı kendi
// tarafında render edip temiz metin/markdown olarak döndürüyor.
// r.jina.ai da engellenirse Firebase güncellenmez, eski veriler kalır.

const FIREBASE_URL = 'https://berk-job-portal-default-rtdb.europe-west1.firebasedatabase.app';
const READER_PREFIX = 'https://r.jina.ai/';

const SEARCH_URLS = [
  'https://www.kariyer.net/is-ilanlari/depo+muduru',
  'https://www.kariyer.net/is-ilanlari/istanbul-depo+sorumlusu',
  'https://www.kariyer.net/is-ilanlari/istanbul-lojistik+uzmani',
  'https://www.kariyer.net/is-ilanlari/istanbul-lojistik',
  'https://www.kariyer.net/is-ilanlari/istanbul-sevkiyat+sorumlusu',
  'https://www.kariyer.net/is-ilanlari/istanbul-depo+operasyon+sorumlusu'
];

// Bu konumları içeren ilanları listeden çıkar (kullanıcı istemiyor)
const EXCLUDE_LOCATIONS = ['kocaeli', 'gebze'];

const SKILL_KEYWORDS = [
  'sap', 'wms', 'logo tiger', 'nebim', 'depo', 'lojistik', 'stok',
  'envanter', 'sevkiyat', 'operasyon', 'müdür', 'yönetici', 'sorumlu', 'uzman'
];

function scoreMatch(text) {
  var lower = text.toLowerCase();
  var score = 60;
  SKILL_KEYWORDS.forEach(function (kw) {
    if (lower.indexOf(kw) !== -1) score += 4;
  });
  return Math.min(score, 98);
}

async function fetchViaReader(url) {
  var readerUrl = READER_PREFIX + url;
  try {
    var res = await fetch(readerUrl, {
      headers: { 'Accept': 'text/plain' }
    });
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

function extractJobsFromMarkdown(markdown) {
  // r.jina.ai sayfayı markdown olarak döndürüyor.
  // İlan linkleri şu formatta görünüyor: [Şirket Pozisyon Konum ... N gün](https://www.kariyer.net/is-ilani/slug-id)
  var jobs = [];
  if (!markdown) return jobs;

  var linkRegex = /\[([^\]]{5,300})\]\((https:\/\/www\.kariyer\.net\/is-ilani\/[a-z0-9\-]+)\)/gi;
  var match;
  var seen = {};

  while ((match = linkRegex.exec(markdown)) !== null) {
    var text = match[1].replace(/\s+/g, ' ').trim();
    var url = match[2];

    if (seen[url]) continue;
    seen[url] = true;

    var lowerText = text.toLowerCase();
    var isExcluded = EXCLUDE_LOCATIONS.some(function (loc) {
      return lowerText.indexOf(loc) !== -1;
    });
    if (isExcluded) continue;

    jobs.push({ rawText: text, url: url });
  }

  return jobs;
}

function parseJobFields(rawText) {
  var text = rawText;
  var age = 'Yeni';

  // Sondaki "X gün / X saat / X ay / Son gün" gibi ifadeleri yakala
  var ageMatch = text.match(/(Son gün|(\d+)\s*(gün|saat|ay))\s*$/i);
  if (ageMatch) {
    age = ageMatch[0].trim();
    text = text.slice(0, ageMatch.index).trim();
  }

  // Çalışma şeklini temizle (Tam zamanlı, Dönemsel, vb.)
  text = text.replace(/(Tam zamanlı|Dönemsel\s*\/?\s*Proje bazlı|Yarı zamanlı|Serbest Zamanlı)\s*(\*update\*)?\s*$/i, '').trim();
  text = text.replace(/Ort\.\s*\d+\s*günde dönüyor/i, '').trim();

  // Konum bilgisini yakala (İş Yerinde / Uzaktan / Hibrit öncesi)
  var location = 'İstanbul';
  var locMatch = text.match(/(İstanbul(?:\(Asya\)|\(Avr\.\))?)\s*(İş Yerinde|Uzaktan\s*\/?\s*Remote|Hibrit)/i);
  if (locMatch) {
    location = locMatch[1];
    text = text.slice(0, locMatch.index).trim();
  } else {
    text = text.replace(/(İş Yerinde|Uzaktan\s*\/?\s*Remote|Hibrit)\s*$/i, '').trim();
  }

  // Geriye kalan metin genelde "Şirket Pozisyon Şirket" şeklinde tekrarlı.
  // Basit yaklaşım: tamamını "position" olarak sakla, ilk birkaç kelimeyi "company" tahmini yap.
  var words = text.split(' ').filter(Boolean);
  var companyGuessLen = Math.min(4, Math.max(1, Math.floor(words.length / 3)));
  var company = words.slice(0, companyGuessLen).join(' ') || 'Bilinmiyor';

  return {
    company: company,
    position: text || rawText,
    location: location,
    age: age
  };
}

async function main() {
  var allJobs = [];
  var idCounter = 1;

  for (var i = 0; i < SEARCH_URLS.length; i++) {
    var url = SEARCH_URLS[i];
    console.log('Taranıyor: ' + url);
    var markdown = await fetchViaReader(url);
    var found = extractJobsFromMarkdown(markdown);
    console.log('  -> ' + found.length + ' ilan linki bulundu');

    found.forEach(function (item) {
      var fields = parseJobFields(item.rawText);
      allJobs.push({
        id: idCounter++,
        company: fields.company,
        position: fields.position,
        location: fields.location,
        age: fields.age,
        url: item.url,
        match: scoreMatch(item.rawText),
        source: 'Kariyer.net',
        scrapedAt: new Date().toISOString()
      });
    });

    // r.jina.ai ücretsiz kullanımda dakikada ~20 istek sınırı var, aralarda bekle
    await new Promise(function (r) { setTimeout(r, 3000); });
  }

  var uniqueByUrl = {};
  allJobs.forEach(function (job) { uniqueByUrl[job.url] = job; });
  var finalJobs = Object.values(uniqueByUrl);

  finalJobs.sort(function (a, b) { return b.match - a.match; });
  finalJobs = finalJobs.slice(0, 40);

  console.log('TOPLAM benzersiz ilan: ' + finalJobs.length);

  if (finalJobs.length === 0) {
    console.log('UYARI: Hiç ilan bulunamadı. r.jina.ai de engellenmiş olabilir.');
    console.log('Firebase güncellenmedi (eski veriler korunuyor).');
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
