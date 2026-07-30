# İş İlanı Tarayıcı (Otomatik)

Bu depo, Kariyer.net'te belirli kategorilerde ilan arar ve bulduklarını
Firebase'e yazar. `is_portali_v2.html` paneli açıldığında bu verileri
otomatik çeker.

## Kurulum (5 dakika)

1. github.com'da ücretsiz hesap aç (yoksa)
2. Sağ üstten **New repository** → isim ver (örn. `is-ilani-tarayici`) → **Public** seç → Create
3. Bu depodaki `scrape.js` ve `.github/workflows/scrape-jobs.yml` dosyalarını
   (klasör yapısını koruyarak) yeni deponun içine sürükle-bırak ile yükle
   ("Add file" → "Upload files")
4. Commit et
5. Depo sayfasında üstteki **Actions** sekmesine tıkla → workflow'u gör →
   "I understand my workflows, go ahead and enable them" varsa onayla
6. Sağdaki **Run workflow** butonuna tıklayıp elle bir kere çalıştır
7. Çalışma bitince (yaklaşık 1 dakika) **loglara bak**:
   - "TOPLAM benzersiz ilan: X" satırını gör
   - X sıfırsa bana log çıktısının tamamını gönder, regex'i düzeltelim
   - X sıfırdan büyükse çalışıyor demektir, Firebase güncellendi

Bundan sonra sistem **her 6 saatte bir kendiliğinden** çalışacak.
Hiçbir şey yapmana gerek yok.

## Notlar

- Ücretsiz: GitHub Actions genel kullanıcılar için ayda 2000 dakika ücretsiz
  sunar, bu script çok az kullanır (günde ~4 çalıştırma x ~1 dakika)
- Firebase anahtarı gerekmiyor çünkü veritabanı test modunde (herkese yazılabilir)
- Kariyer.net kendi HTML yapısını değiştirirse tarayıcı bozulabilir —
  o zaman bana haber ver, script'i güncelleyelim
