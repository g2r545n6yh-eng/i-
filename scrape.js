// scrape.js
// Kariyer.net'te belirli kategorilerde arama yapar, bulduğu ilanları
// Firebase Realtime Database'e yazar. GitHub Actions tarafından
// zamanlanmış olarak (örn. her 6 saatte) çalıştırılır.
//
// NOT: Bu script Kariyer.net'in HTML yapısına dayanıyor. Site
// tasarımını değiştirirse regex'lerin güncellenmesi gerekebilir.
// İlk çalıştırmada "Actions" sekmesindeki logdan kaç ilan bulunduğunu
// kontrol et; 0 çıkarsa bana log çıktısını gönder, regex'i düzeltelim.

const FIREBASE_URL = 'https://berk-job-portal-default-rtdb.europe-west1.firebasedatabase.app';

// Aranacak kategoriler (URL'ler kariyer.net'in kendi arama formatı)
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

// CV'ye göre eşleşme puanı hesaplamak için anahtar kelimeler
const SKILL_KEYWORDS = [
  'sap', 'wms', 'logo tiger', 'nebim', 'depo', 'lojistik', 'stok',
  'envanter', 'sevkiyat', 'operasyon', 'müdür', 'yönetici', 'sorumlu', 'uzman'
];

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(text) {
  var lower = text.toLowerCase();
  var score = 60;
  SKILL_KEYWORDS.forEach(function (kw) {
    if (lower.indexOf(kw) !== -1) score += 4;
  });
  return Math.min(score, 98);
}

async function fetchPage(url) {
  try {
    var res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      console.log('HATA: ' + url + ' -> HTTP ' + res.status);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log('HATA (fetch): ' + url + ' -> ' + err.message);
    return null;
  }
}

function extractJobsFromHtml(html) {
  var jobs = [];
  if (!html) return jobs;

  // Kariyer.net ilan linkleri şu formatta: /is-ilani/{slug}-{sayi}
  // Linkin kendi metni genelde şirket + pozisyon + konum bilgisini içeriyor.
  var linkRegex = /<a[^>]+href="(https:\/\/www\.kariyer\.net\/is-ilani\/[a-z0-9\-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  var seen = {};

  while ((match = linkRegex.exec(html)) !== null) {
    var url = match[1];
    var text = stripTags(match[2]);

    if (!text || text.length < 5) continue;
    if (seen[url]) continue;
    seen[url] = true;

    var lowerText = text.toLowerCase();
    var isExcluded = EXCLUDE_LOCATIONS.some(function (loc) {
      return lowerText.indexOf(loc) !== -1;
    });
    if (isExcluded) continue;

    jobs.push({
      rawText: text,
      url: url
    });
  }

  return jobs;
}

function parseJobFields(rawText) {
  // rawText örneği: "Şirket Adı Pozisyon Adı Şirket Adı İstanbul İş Yerinde Tam zamanlı 3 gün"
  // Kesin ayrıştırma zor olduğu için tüm metni "position" alanına koyup
  // company'yi ilk birkaç kelimeden tahmin ediyoruz. Mükemmel değil ama kullanılabilir.
  var words = rawText.split(' ');
  var company = words.slice(0, Math.min(4, Math.ceil(words.length / 3))).join(' ');
  return {
    company: company,
    position: rawText,
    location: 'İstanbul',
    age: 'Yeni tarandı'
  };
}

async function main() {
  var allJobs = [];
  var idCounter = 1;

  for (var i = 0; i < SEARCH_URLS.length; i++) {
    var url = SEARCH_URLS[i];
    console.log('Taranıyor: ' + url);
    var html = await fetchPage(url);
    var found = extractJobsFromHtml(html);
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

    // Siteyi yormamak için istekler arasında kısa bekleme
    await new Promise(function (r) { setTimeout(r, 1500); });
  }

  // Aynı url'den birden fazla varsa tekilleştir
  var uniqueByUrl = {};
  allJobs.forEach(function (job) {
    uniqueByUrl[job.url] = job;
  });
  var finalJobs = Object.values(uniqueByUrl);

  // En iyi eşleşenden başlayarak sırala, ilk 40 ile sınırla
  finalJobs.sort(function (a, b) { return b.match - a.match; });
  finalJobs = finalJobs.slice(0, 40);

  console.log('TOPLAM benzersiz ilan: ' + finalJobs.length);

  if (finalJobs.length === 0) {
    console.log('UYARI: Hiç ilan bulunamadı. Kariyer.net HTML yapısı değişmiş olabilir.');
    console.log('Firebase güncellenmedi (eski veriler korunuyor).');
    return;
  }

  // Firebase'e yaz: /jobs.json altına, id'ye göre keyed obje olarak
  var jobsObject = {};
  finalJobs.forEach(function (job) {
    jobsObject[job.id] = job;
  });

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
