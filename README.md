# ArmorLine

Telefon öncelikli, tarayıcıda da oynanan 3D tank PvP oyunu. Vite + TypeScript + Three.js.

## Oynanış
- Modlar: 4v4 (5 dk), 8v8 (6 dk), 12v12 (7 dk). Harita her maçta yeniden üretilir, modla birlikte büyür; 4 tema (Neon Şehir, Çöl Üssü, Zehirli Bölge, Buz Limanı).
- Rakip takımı yok et ya da süre bitince daha fazla canla kal. Savaşta 📋 (ya da Tab) ile oyun tablosu; maç sonunda da gösterilir.
- 4 silah türü (tank başına seçilir): Ağır, Standart, Hızlı, Şarjörlü (4 mermi + uzun dolum).
- Tank seviyesi 1–1000, para ile yükseltilir; her seviye can, hasar, delme, zırh ve dolumu biraz iyileştirir.
- Elektrik Kalkanı parçası: 20 sn'de dolar, doluyken hasarın %25–60'ını (nadirliğe göre) durdurur; art arda vuruşta toparlanamaz.
- Yakıt deposu (arka yanlar) delinirse tank 5 sn yanar; dolum bölmesi (taret arkası) delinirse dolum süresi maç sonuna kadar 2 katına çıkar; kopan palet 2 sn yerde görünür.
- Atış, isabet ve çarpışmalarda tank gövdesi sarsılır, namlu geri teper.
- 5 ülke (SSCB, Almanya, ABD, İngiltere, Fransa) × 4 sınıf (Tank, Mobil, Sniper, Artillery) = 20 tank.
- 8 nadirlik: Poor, Common, Uncommon, Rare, Epic, Legendary, Mythic, Divine. Düşme olasılıkları 15/12/9/6/5/4/3/2 ağırlıklarının %100'e oranlanmış hâli.
- Zırh delme, eğimli zırh, sektirme, görüş (spot) sistemi.
- 7 parça slotu: Main Gun, Turret, Armor, Ön Zırh, Engine, Palet, Optic. Parçalar sadece kendi ülkesinin tanklarına takılır.
  - Ön Zırh: ram hasarını, ön gövde zırhını ve önden sektirmeyi artırır.
  - Optic: nişangâhta delme olasılığı ve hasar tahmini her zaman yazar; optic ne kadar nadirse tahmin o kadar doğrudur.
- Nişan: halka namlunun gerçekten baktığı yeri gösterir. Durdukça küçülür, tam nişanda mermi tam halkanın ortasına gider; hareket ederken isabet düşer.
- Zırh bölgeleri: üst ön plaka eğimli ve daha çok sektirir, alt ön plaka incedir. Ön daha az, arka daha çok hasar alır. Zoom yapınca zayıf noktalar (alt plaka, kupola, motor) renkli görünür.
- Modül hasarı: palete isabet eden tank 2 saniye hareket edemez (fren yapar). Arkadan delen vuruş %35 ihtimalle motoru bozar, hız maç sonuna kadar yarıya iner.
- Çarpışma: tanklar iç içe geçmez; duvara hızlı çarpan tank hasar alır; düşmana çarpmak (ram) hasar verir.
- Mobil tankların gördüğü düşman, takıma 10 saniye görünür kalır.
- Ödüller: hasar ×0.5 + imha başına 300 + asist başına 120 para (galibiyette 2 katı); galibiyette %10 tank / %15 parça, mağlubiyette %5 tank / %10 parça şansı. Aynı tank tekrar düşerse paraya çevrilir.
- Mağaza her 5 dakikada bir yenilenir ve 5 parça satar. Nadir parçalar hem daha pahalı hem daha seyrek gelir.
- İlerleme tarayıcıda (`localStorage`) saklanır.

Denge sayıları: `src/data/tanks.ts` (ülke ve sınıf statları), `src/data/rarity.ts` (nadirlik çarpanları ve fiyatlar), `src/data/parts.ts` (parça bonusları), `src/meta/rewards.ts` (ödül oranları).

## Kontroller
- Telefon: sol yarıda sürükle → sür; sağ yarıda sürükle → nişan; ATEŞ, 🔭 zoom, 🎯 topçu görünümü.
- Bilgisayar: WASD sür, fare nişan (ekrana tıkla), sol tık / Space ateş, sağ tık / Shift zoom, E topçu görünümü.

## Geliştirme
```powershell
npm install
npm run dev
```
```powershell
npm test
```
```powershell
npm run build
```
Çıktı `dist/` klasörüne yazılır (statik dosyalar, göreli yollar).

## Yayın (Cloudflare Pages)
Çalışma akışı: yeni iş bir dalda yapılır, PR açılır. GitHub Actions (`.github/workflows/ci.yml`) testleri ve derlemeyi çalıştırır, Cloudflare dal için bir önizleme adresi verir. PR `main`'e birleşince Cloudflare siteyi otomatik yayınlar.

- Derleme komutu: `npm run build`
- Çıktı klasörü: `dist`
- Alan adı: `armorline.dorukplays.com`

## Krediler
- Tank 3D modelleri: [Animated Tank Pack](https://poly.pizza/bundle/Animated-Tank-Pack-0tfvbeAJkU), Quaternius, CC0 (kamu malı). Dosyalar `src/assets/models/` altında; oyun bunları ülke renklerine boyar ve taret/topu ayrı döndürür. Yüklenemezlerse basit kutu tanklara geri döner.
